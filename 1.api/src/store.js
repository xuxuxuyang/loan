const fs = require('node:fs')
const path = require('node:path')
const { AsyncLocalStorage } = require('node:async_hooks')
const mongo = require('./mongo')
const mongoConfig = require('./mongoConfig')
const {
  getCurrentTenantId,
  getCurrentWorkspaceType,
  DEFAULT_TENANT_ID,
  normalizeTenantId,
  runWithTenant,
  runWithWorkspace,
  setCurrentTenant,
  setCurrentWorkspace,
} = require('./tenantContext')
const {
  BOOTSTRAP_ADMIN_ACCOUNTS,
  DEFAULT_SUPER_ADMIN_USERNAME,
} = require('./defaultBootstrap')

const DB_DIR = path.join(__dirname, '..', 'data')
const DB_FILE = path.join(DB_DIR, 'db.json')

/** 旧版 appState 单文档 _id */
const MAIN_STATE_ID = 'main'

/** 与 mongo.SHARDED_ENTITY_KEYS 一致：每项对应 COLLECTIONS[key] */
const ENTITY_SPECS = mongo.SHARDED_ENTITY_KEYS.map((key) => ({
  key,
  collection: mongo.COLLECTIONS[key],
}))

let mongoBacked = false
/**
 * Mongo 模式下为「当前请求」的工作副本：index 中间件在每个 /api 请求起已 refreshScopeCacheFromMongo，
 * 同一请求内读写一致；非 HTTP 脚本见 hydrateTenantDbFromMongo / import 等独立入口。
 */
let mongoMemoryDb = null
let mongoMemoryDbByTenant = new Map()
/** version 模式：scopeKey → app_meta.updatedAt 毫秒时间戳，用于跳过无变更的全量 hydrate */
const mongoScopeMetaUpdatedAtByKey = new Map()

/** 单次 HTTP 请求内已对某 scopeKey 执行过 refresh 时跳过，避免重复全库拉取 */
const mongoScopeRefreshDedup = new AsyncLocalStorage()
/** hydrateTenantDbFromMongo 正在执行时 >0，防止 refresh→hydrate→再次 refresh 递归 */
let mongoHydrateDepth = 0
/** 同 scope 并发 refresh 合并为一次 hydrate（多 tab 并行 GET 时避免重复全库读 Mongo） */
const mongoScopeHydrateInflight = new Map()
/** scopeKey → 仅加载过部分实体（冷启动账号页）；下一笔非 partial refresh 须全量 hydrate */
const mongoScopeHydrateIncomplete = new Set()

/** 串行写入，避免并发持久化乱序 */
let persistTail = Promise.resolve()
let persistTailByTenant = new Map()

function runWithMongoRequestDedup(fn) {
  return mongoScopeRefreshDedup.run(new Set(), fn)
}

function getMongoHydrateDepth() {
  return mongoHydrateDepth
}

function normalizeWorkspaceForKey(raw) {
  const value = String(raw || '').trim().toLowerCase()
  if (value === 'core' || value === 'self' || value === 'tenant') {
    return value
  }
  return 'tenant'
}

function buildScopeKey(workspaceType, tenantId) {
  const ws = normalizeWorkspaceForKey(workspaceType)
  if (ws === 'core') {
    return 'core'
  }
  if (ws === 'self') {
    return 'self'
  }
  const t = String(tenantId || DEFAULT_TENANT_ID).trim().toLowerCase() || DEFAULT_TENANT_ID
  return `tenant:${t}`
}

function getScopeState() {
  const workspaceType = String(getCurrentWorkspaceType && getCurrentWorkspaceType() || 'tenant').trim().toLowerCase() || 'tenant'
  if (workspaceType === 'core') {
    return { workspaceType, tenantId: DEFAULT_TENANT_ID, key: 'core' }
  }
  if (workspaceType === 'self') {
    return { workspaceType, tenantId: DEFAULT_TENANT_ID, key: 'self' }
  }
  const tenantId = getCurrentTenantId()
  return { workspaceType: 'tenant', tenantId, key: `tenant:${tenantId}` }
}

function hasScopeCache(workspaceType, tenantId) {
  return mongoMemoryDbByTenant.has(buildScopeKey(workspaceType, tenantId))
}

async function readAppMetaUpdatedAtMs(dbm) {
  if (!dbm) {
    return null
  }
  const metaDoc = await dbm.collection(mongo.APP_META).findOne(
    { _id: MAIN_STATE_ID },
    { projection: { updatedAt: 1 } },
  )
  if (!metaDoc || metaDoc.updatedAt == null) {
    return null
  }
  const t = metaDoc.updatedAt instanceof Date
    ? metaDoc.updatedAt.getTime()
    : new Date(metaDoc.updatedAt).getTime()
  return Number.isFinite(t) ? t : null
}

async function syncScopeMetaUpdatedAtCache(cacheKey, dbm) {
  const at = await readAppMetaUpdatedAtMs(dbm)
  if (at != null) {
    mongoScopeMetaUpdatedAtByKey.set(cacheKey, at)
  }
  else {
    mongoScopeMetaUpdatedAtByKey.delete(cacheKey)
  }
}

function ensureDbFile() {
  if (!mongoConfig.isJsonFallbackAllowed()) {
    return
  }
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true })
  }
  if (!fs.existsSync(DB_FILE)) {
    const seed = buildSeedDb()
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2), 'utf-8')
  }
}

function buildEmptyRaw() {
  return {
    _meta: {},
    products: [],
    orders: [],
    users: [],
    adminAccounts: [],
    addresses: [],
    bankCards: [],
    bills: [],
    /** 推广渠道（H5 ?channel= 与注册归因） */
    trafficChannels: [],
    /** 流量商门户登录账号（admin-liuliang） */
    trafficPartners: [],
    partnerGatewayApplications: [],
    /** 商城客服会话（用户↔客服消息，与 users 可选关联） */
    csSessions: [],
    /** 拉卡拉支付流水（商城还款/订单支付） */
    lakalaPayments: [],
  }
}

/** 空业务数据 + 系统默认管理员与后台账号（归一化后） */
function buildSeedDb() {
  return shapeDbFromParsed(buildEmptyRaw())
}

function ensureAdminUser(list) {
  return Array.isArray(list) ? list : []
}

function dedupeUsersById(list) {
  const map = new Map()
  list.forEach((item) => {
    if (!item || !item.id) {
      return
    }
    if (!map.has(item.id)) {
      map.set(item.id, item)
    }
  })
  return [...map.values()]
}

function ensureAdminAccounts(list) {
  const tenantId = getCurrentTenantId()
  if (tenantId !== DEFAULT_TENANT_ID) {
    const normalizedOnly = Array.isArray(list) ? list : []
    const mapOnly = new Map()
    normalizedOnly.forEach((item) => {
      if (!item || !item.username) {
        return
      }
      if (!mapOnly.has(item.username)) {
        mapOnly.set(item.username, item)
      }
    })
    return [...mapOnly.values()]
  }
  const normalized = Array.isArray(list) ? list : []
  const map = new Map()
  normalized.forEach((item) => {
    if (!item || !item.username) {
      return
    }
    if (!map.has(item.username)) {
      map.set(item.username, item)
    }
  })
  BOOTSTRAP_ADMIN_ACCOUNTS.forEach((seed) => {
    if (!map.has(seed.username)) {
      map.set(seed.username, { ...seed })
    }
  })
  return [...map.values()]
}

/** 与读 db.json / Mongo 快照后相同的归一化逻辑（缺省字段为空数组，不注入商品等模拟数据） */
function shapeDbFromParsed(parsed) {
  const meta = (parsed && typeof parsed._meta === 'object' && parsed._meta !== null && !Array.isArray(parsed._meta))
    ? { ...parsed._meta }
    : {}
  const db = {
    products: Array.isArray(parsed.products) ? parsed.products : [],
    orders: Array.isArray(parsed.orders) ? parsed.orders : [],
    users: Array.isArray(parsed.users) ? parsed.users : [],
    adminAccounts: Array.isArray(parsed.adminAccounts) ? parsed.adminAccounts : [],
    addresses: Array.isArray(parsed.addresses) ? parsed.addresses : [],
    bankCards: Array.isArray(parsed.bankCards) ? parsed.bankCards : [],
    bills: Array.isArray(parsed.bills) ? parsed.bills : [],
    trafficChannels: Array.isArray(parsed.trafficChannels) ? parsed.trafficChannels : [],
    trafficPartners: Array.isArray(parsed.trafficPartners) ? parsed.trafficPartners : [],
    partnerGatewayApplications: Array.isArray(parsed.partnerGatewayApplications) ? parsed.partnerGatewayApplications : [],
    csSessions: Array.isArray(parsed.csSessions) ? parsed.csSessions : [],
    lakalaPayments: Array.isArray(parsed.lakalaPayments) ? parsed.lakalaPayments : [],
  }
  db.users = dedupeUsersById(ensureAdminUser(db.users))
  db.adminAccounts = ensureAdminAccounts(db.adminAccounts)
  return {
    _meta: meta,
    products: db.products,
    orders: db.orders,
    users: db.users,
    adminAccounts: db.adminAccounts,
    addresses: db.addresses,
    bankCards: db.bankCards,
    bills: db.bills,
    trafficChannels: db.trafficChannels,
    trafficPartners: db.trafficPartners,
    partnerGatewayApplications: db.partnerGatewayApplications,
    csSessions: db.csSessions,
    lakalaPayments: db.lakalaPayments,
  }
}

function tenantDbFile(tenantId) {
  const safe = String(tenantId || DEFAULT_TENANT_ID).replace(/[^a-z0-9_-]/gi, '').toLowerCase() || DEFAULT_TENANT_ID
  return safe === DEFAULT_TENANT_ID
    ? DB_FILE
    : path.join(DB_DIR, `db.${safe}.json`)
}

function readDbFromFile() {
  const tenantId = getCurrentTenantId()
  const file = tenantDbFile(tenantId)
  ensureDbFile()
  if (!fs.existsSync(file)) {
    const seed = buildSeedDb()
    fs.writeFileSync(file, JSON.stringify(seed, null, 2), 'utf-8')
  }
  const raw = fs.readFileSync(file, 'utf-8')
  try {
    const parsed = JSON.parse(raw)
    return shapeDbFromParsed(parsed)
  }
  catch {
    return shapeDbFromParsed(buildEmptyRaw())
  }
}

function clonePayloadForMongo(db) {
  const payload = {
    _meta: db._meta && typeof db._meta === 'object' ? db._meta : {},
    products: db.products,
    orders: db.orders,
    users: db.users,
    adminAccounts: db.adminAccounts,
    addresses: db.addresses,
    bankCards: db.bankCards,
    bills: db.bills,
    trafficChannels: Array.isArray(db.trafficChannels) ? db.trafficChannels : [],
    trafficPartners: Array.isArray(db.trafficPartners) ? db.trafficPartners : [],
    partnerGatewayApplications: Array.isArray(db.partnerGatewayApplications) ? db.partnerGatewayApplications : [],
    csSessions: Array.isArray(db.csSessions) ? db.csSessions : [],
    lakalaPayments: Array.isArray(db.lakalaPayments) ? db.lakalaPayments : [],
  }
  return JSON.parse(JSON.stringify(payload))
}

function stablePrimaryKeyString(pk) {
  if (pk === null || pk === undefined) {
    return ''
  }
  const t = typeof pk
  if (t === 'number' || t === 'string' || t === 'boolean') {
    return `${t}:${pk}`
  }
  if (pk && typeof pk.toHexString === 'function') {
    return `oid:${pk.toString()}`
  }
  return `s:${String(pk)}`
}

/** Mongo 文档主键：与业务 id 一致（数字 id 保持为 number，便于与路由参数一致） */
function entityMongoPrimaryKey(item, entityKey) {
  if (!item || typeof item !== 'object') {
    return undefined
  }
  if (entityKey === 'lakalaPayments') {
    const outTradeNo = String(item.outTradeNo || '').trim()
    if (outTradeNo) {
      return outTradeNo
    }
  }
  if (item.id !== undefined && item.id !== null) {
    return item.id
  }
  if (entityKey === 'adminAccounts' && item.username) {
    return item.username
  }
  return undefined
}

function fromMongoEntityDoc(doc) {
  if (!doc || typeof doc !== 'object') {
    return null
  }
  const { _id, ...rest } = doc
  if (rest.id === undefined && _id !== undefined) {
    if (typeof _id === 'object' && _id && typeof _id.toHexString === 'function') {
      return { ...rest, id: _id.toString() }
    }
    return { ...rest, id: _id }
  }
  return { ...rest }
}

function isRawShardedPayloadEmpty(raw) {
  if (!raw || typeof raw !== 'object') {
    return true
  }
  const meta = raw._meta && typeof raw._meta === 'object' ? raw._meta : {}
  if (Object.keys(meta).length > 0) {
    return false
  }
  for (const spec of ENTITY_SPECS) {
    const arr = raw[spec.key]
    if (Array.isArray(arr) && arr.length > 0) {
      return false
    }
  }
  return true
}

/**
 * 从分集合读取为与 db.json / 旧 appState 相同结构的原始对象（供 shapeDbFromParsed）。
 */
async function loadShardedRawFromDb(dbm) {
  const lists = await Promise.all(
    ENTITY_SPECS.map(spec => dbm.collection(spec.collection).find({}).toArray()),
  )
  const metaDoc = await dbm.collection(mongo.APP_META).findOne({ _id: MAIN_STATE_ID })
  const meta = metaDoc && metaDoc.meta && typeof metaDoc.meta === 'object' && !Array.isArray(metaDoc.meta)
    ? { ...metaDoc.meta }
    : {}
  const out = {
    _meta: meta,
  }
  ENTITY_SPECS.forEach((spec, i) => {
    out[spec.key] = lists[i].map(fromMongoEntityDoc).filter(Boolean)
  })
  return out
}

/**
 * 仅读取指定实体分集合 + app_meta（供账号管理等轻量 GET，须已有全量内存快照再合并）。
 */
async function loadShardedPartialRawFromDb(dbm, entityKeys) {
  const allowed = new Set(Array.isArray(entityKeys) ? entityKeys : [])
  const specs = ENTITY_SPECS.filter(spec => allowed.has(spec.key))
  const lists = specs.length
    ? await Promise.all(
        specs.map(spec => dbm.collection(spec.collection).find({}).toArray()),
      )
    : []
  const metaDoc = await dbm.collection(mongo.APP_META).findOne({ _id: MAIN_STATE_ID })
  const meta = metaDoc && metaDoc.meta && typeof metaDoc.meta === 'object' && !Array.isArray(metaDoc.meta)
    ? { ...metaDoc.meta }
    : {}
  const out = { _meta: meta }
  specs.forEach((spec, i) => {
    out[spec.key] = lists[i].map(fromMongoEntityDoc).filter(Boolean)
  })
  return out
}

const BULK_CHUNK = 400
const SHRINK_PROTECT_DEFAULT = { minExisting: 5, maxRemoveRatio: 0.8 }
const SHRINK_PROTECT_BY_ENTITY = {
  products: SHRINK_PROTECT_DEFAULT,
  orders: { minExisting: 50, maxRemoveRatio: 0.5 },
  users: { minExisting: 50, maxRemoveRatio: 0.2 },
  adminAccounts: SHRINK_PROTECT_DEFAULT,
  addresses: { minExisting: 50, maxRemoveRatio: 0.5 },
  bankCards: SHRINK_PROTECT_DEFAULT,
  bills: SHRINK_PROTECT_DEFAULT,
  trafficChannels: SHRINK_PROTECT_DEFAULT,
  trafficPartners: SHRINK_PROTECT_DEFAULT,
  partnerGatewayApplications: SHRINK_PROTECT_DEFAULT,
  csSessions: SHRINK_PROTECT_DEFAULT,
  lakalaPayments: SHRINK_PROTECT_DEFAULT,
}

function assertSafeEntitySnapshotShrink(spec, existing, list) {
  const rule = spec && SHRINK_PROTECT_BY_ENTITY[spec.key]
  if (!rule) {
    return
  }
  const existingCount = Array.isArray(existing) ? existing.length : 0
  const nextCount = Array.isArray(list) ? list.length : 0
  if (existingCount < rule.minExisting) {
    return
  }
  const removedCount = Math.max(0, existingCount - nextCount)
  const removedRatio = existingCount > 0 ? removedCount / existingCount : 0
  if (removedRatio <= rule.maxRemoveRatio) {
    return
  }
  throw new Error(`[store] refusing to shrink ${spec.key} from ${existingCount} to ${nextCount}; possible stale snapshot`)
}

/**
 * 同步单个分集合：删除库中不在快照内的 _id，再 bulkWrite replace upsert。
 */
async function persistEntityCollection(dbm, spec, items) {
  const coll = dbm.collection(spec.collection)
  const list = Array.isArray(items) ? items : []
  const wantKeys = new Set()
  const keyedItems = []
  for (const item of list) {
    const pk = entityMongoPrimaryKey(item, spec.key)
    if (pk === undefined || pk === null) {
      console.warn(`[store] 跳过缺少主键的 ${spec.key} 记录`, item && typeof item === 'object' ? Object.keys(item) : item)
      continue
    }
    wantKeys.add(stablePrimaryKeyString(pk))
    keyedItems.push({ pk, item })
  }

  const existing = await coll.find({}, { projection: { _id: 1 } }).toArray()
  assertSafeEntitySnapshotShrink(spec, existing, list)
  const toRemove = existing
    .map(e => e._id)
    .filter(_id => !wantKeys.has(stablePrimaryKeyString(_id)))

  for (let i = 0; i < toRemove.length; i += 500) {
    const slice = toRemove.slice(i, i + 500)
    if (slice.length) {
      await coll.deleteMany({ _id: { $in: slice } })
    }
  }

  for (let i = 0; i < keyedItems.length; i += BULK_CHUNK) {
    const chunk = keyedItems.slice(i, i + BULK_CHUNK)
    const ops = chunk.map(({ pk, item }) => {
      const body = JSON.parse(JSON.stringify(item))
      delete body._id
      return {
        replaceOne: {
          filter: { _id: pk },
          replacement: { ...body, _id: pk },
          upsert: true,
        },
      }
    })
    if (ops.length) {
      await coll.bulkWrite(ops, { ordered: false })
    }
  }
}

async function persistAppMeta(dbm, snapshot, updatedAt = new Date()) {
  const meta = snapshot._meta && typeof snapshot._meta === 'object' ? snapshot._meta : {}
  await dbm.collection(mongo.APP_META).replaceOne(
    { _id: MAIN_STATE_ID },
    {
      _id: MAIN_STATE_ID,
      updatedAt,
      meta: JSON.parse(JSON.stringify(meta)),
    },
    { upsert: true },
  )
}

/**
 * 将快照写入分集合 + app_meta（已深拷贝的 plain 对象）。
 * 每集合：删除内存中已不存在的 _id，再 bulkWrite replace upsert。
 */
async function persistShardedSnapshot(dbm, snapshot) {
  for (const spec of ENTITY_SPECS) {
    await persistEntityCollection(dbm, spec, snapshot[spec.key])
  }
  await persistAppMeta(dbm, snapshot)
}

/**
 * 仅同步指定实体键（供商品种子脚本等使用，避免误删 adminAccounts 等未加载字段）。
 * @param {string[]} entityKeys ENTITY_SPECS.key 子集，如 ['products']
 */
async function persistShardedSnapshotPartial(dbm, snapshot, entityKeys) {
  const allowed = new Set(Array.isArray(entityKeys) ? entityKeys : [])
  for (const spec of ENTITY_SPECS) {
    if (!allowed.has(spec.key)) {
      continue
    }
    await persistEntityCollection(dbm, spec, snapshot[spec.key])
  }
  await persistAppMeta(dbm, snapshot)
}

async function persistEntityItem(dbm, entityKey, item, snapshot, updatedAt = new Date()) {
  if (!dbm) {
    return
  }
  const spec = ENTITY_SPECS.find(s => s.key === entityKey)
  if (!spec) {
    throw new Error(`[store] unknown entity key: ${entityKey}`)
  }
  const pk = entityMongoPrimaryKey(item, spec.key)
  if (pk === undefined || pk === null) {
    throw new Error(`[store] missing primary key for ${entityKey}`)
  }
  const body = JSON.parse(JSON.stringify(item || {}))
  delete body._id
  await dbm.collection(spec.collection).replaceOne(
    { _id: pk },
    { ...body, _id: pk },
    { upsert: true },
  )
  await persistAppMeta(dbm, snapshot || {}, updatedAt)
}

function legacyAppStateDocToRaw(legacyDoc) {
  const { _id: _drop, updatedAt: _u, ...rest } = legacyDoc
  return rest
}

function scheduleMongoPersistJob(scopeKey, job) {
  const currentTail = persistTailByTenant.get(scopeKey) || Promise.resolve()
  const nextTail = currentTail
    .then(async () => {
      if (!mongoBacked) {
        return
      }
      try {
        await job()
      }
      catch (err) {
        console.error('[store] MongoDB 分集合持久化失败:', err?.message || err)
      }
    })
    .catch((err) => {
      console.error('[store] MongoDB 持久化队列失败:', err?.message || err)
    })
  persistTailByTenant.set(scopeKey, nextTail)
  if (scopeKey === 'tenant:default') {
    persistTail = nextTail
  }
}

function scheduleMongoPersist(snapshot) {
  const scopeKey = getScopeState().key
  scheduleMongoPersistJob(scopeKey, async () => {
    const dbm = mongo.getMongoDb()
    if (!dbm) {
      return
    }
    const latest = mongoMemoryDbByTenant.get(scopeKey)
    await persistShardedSnapshot(dbm, clonePayloadForMongo(latest || snapshot))
  })
}

function scheduleMongoPersistPartial(snapshot, entityKeys) {
  const scopeKey = getScopeState().key
  const keys = Array.isArray(entityKeys) ? [...entityKeys] : []
  scheduleMongoPersistJob(scopeKey, async () => {
    const dbm = mongo.getMongoDb()
    if (!dbm) {
      return
    }
    /** 执行落库时取内存最新快照，避免队列中较早任务用旧 csSessions 覆盖较新写入 */
    const latest = mongoMemoryDbByTenant.get(scopeKey)
    await persistShardedSnapshotPartial(dbm, clonePayloadForMongo(latest || snapshot), keys)
  })
}

function scheduleMongoPersistEntity(snapshot, entityKey, item) {
  const scopeKey = getScopeState().key
  const itemSnapshot = JSON.parse(JSON.stringify(item || {}))
  scheduleMongoPersistJob(scopeKey, async () => {
    const dbm = mongo.getMongoDb()
    if (!dbm) {
      return
    }
    await persistEntityItem(dbm, entityKey, itemSnapshot, clonePayloadForMongo(snapshot))
  })
}

function assertDatastoreReady() {
  if (mongoBacked && mongoMemoryDb) {
    return
  }
  if (mongoConfig.isJsonFallbackAllowed()) {
    return
  }
  throw new Error('[store] MongoDB 未完成初始化，或未设置 ALLOW_JSON_FALLBACK=true')
}

/**
 * connectMongo() 成功后调用：优先迁移旧版 appState(main)；否则从分集合加载；空库则写入种子数据。
 * @returns {Promise<boolean>}
 */
async function hydrateFromMongoAfterConnect() {
  const scope = getScopeState()
  const dbm = mongo.getMongoDb()
  if (!dbm) {
    return false
  }

  const legacyColl = dbm.collection(mongo.APP_STATE)
  const legacyDoc = await legacyColl.findOne({ _id: MAIN_STATE_ID })

  if (legacyDoc) {
    const raw = legacyAppStateDocToRaw(legacyDoc)
    mongoMemoryDb = shapeDbFromParsed(raw)
    try {
      await persistShardedSnapshot(dbm, clonePayloadForMongo(mongoMemoryDb))
      await legacyColl.deleteOne({ _id: MAIN_STATE_ID })
      console.log('[store] 已从旧版 appState(main) 迁移到分集合持久化，并删除旧文档')
    }
    catch (err) {
      console.error('[store] 迁移 appState → 分集合失败:', err?.message || err)
      throw err
    }
  }
  else {
    const raw = await loadShardedRawFromDb(dbm)
    if (isRawShardedPayloadEmpty(raw)) {
      mongoMemoryDb = buildSeedDb()
      await persistShardedSnapshot(dbm, clonePayloadForMongo(mongoMemoryDb))
    }
    else {
      mongoMemoryDb = shapeDbFromParsed(raw)
    }
  }

  mongoBacked = true
  mongoMemoryDbByTenant.set(scope.key, mongoMemoryDb)
  return true
}

async function hydrateTenantDbFromMongo(workspaceType, tenantId) {
  const prevTenant = getCurrentTenantId()
  const prevWorkspace = String(getCurrentWorkspaceType && getCurrentWorkspaceType() || 'tenant').trim().toLowerCase() || 'tenant'
  const targetWorkspace = String(workspaceType || 'tenant').trim().toLowerCase() || 'tenant'
  const targetTenant = String(tenantId || DEFAULT_TENANT_ID)
  const runner = targetWorkspace === 'tenant'
    ? (fn) => runWithTenant(targetTenant, fn)
    : (fn) => runWithWorkspace(targetWorkspace, DEFAULT_TENANT_ID, fn)
  mongoHydrateDepth++
  try {
    return await runner(async () => {
      const dbm = mongo.getMongoDb()
      if (!dbm) {
        return false
      }
      const raw = await loadShardedRawFromDb(dbm)
      let nextDb
      if (isRawShardedPayloadEmpty(raw)) {
        nextDb = buildSeedDb()
        await persistShardedSnapshot(dbm, clonePayloadForMongo(nextDb))
      }
      else {
        nextDb = shapeDbFromParsed(raw)
      }
      const scoped = getScopeState()
      mongoMemoryDbByTenant.set(scoped.key, nextDb)
      if (scoped.key === 'tenant:default') {
        mongoMemoryDb = nextDb
      }
      await syncScopeMetaUpdatedAtCache(scoped.key, dbm)
      return true
    })
  }
  finally {
    mongoHydrateDepth--
    if (prevWorkspace === 'tenant') {
      setCurrentTenant(prevTenant || DEFAULT_TENANT_ID)
    }
    else {
      setCurrentWorkspace(prevWorkspace, DEFAULT_TENANT_ID)
    }
  }
}

/**
 * 在已有 scope 快照上合并刷新指定实体；无快照时回退全量 hydrate（避免其它接口读到空 orders/users）。
 */
async function hydrateTenantDbPartialFromMongo(workspaceType, tenantId, entityKeys, { allowColdPartial = false } = {}) {
  const keys = Array.isArray(entityKeys) ? entityKeys.filter(Boolean) : []
  if (!keys.length) {
    return hydrateTenantDbFromMongo(workspaceType, tenantId)
  }
  const prevTenant = getCurrentTenantId()
  const prevWorkspace = String(getCurrentWorkspaceType && getCurrentWorkspaceType() || 'tenant').trim().toLowerCase() || 'tenant'
  const targetWorkspace = String(workspaceType || 'tenant').trim().toLowerCase() || 'tenant'
  const targetTenant = String(tenantId || DEFAULT_TENANT_ID)
  const runner = targetWorkspace === 'tenant'
    ? (fn) => runWithTenant(targetTenant, fn)
    : (fn) => runWithWorkspace(targetWorkspace, DEFAULT_TENANT_ID, fn)
  mongoHydrateDepth++
  try {
    return await runner(async () => {
      const scoped = getScopeState()
      const existing = mongoMemoryDbByTenant.get(scoped.key)
      const dbm = mongo.getMongoDb()
      if (!dbm) {
        return false
      }
      const partialRaw = await loadShardedPartialRawFromDb(dbm, keys)
      if (!existing) {
        if (!allowColdPartial) {
          return hydrateTenantDbFromMongo(workspaceType, tenantId)
        }
        const rawMerge = buildEmptyRaw()
        keys.forEach((key) => {
          if (Array.isArray(partialRaw[key])) {
            rawMerge[key] = partialRaw[key]
          }
        })
        rawMerge._meta = partialRaw._meta && typeof partialRaw._meta === 'object'
          ? { ...partialRaw._meta }
          : {}
        const nextDb = shapeDbFromParsed(rawMerge)
        mongoMemoryDbByTenant.set(scoped.key, nextDb)
        // 单集合冷启动（如账号页）须标记 incomplete；多集合（如流量 overview）则允许 sidebar-counts 等同版本跳过
        if (keys.length <= 1) {
          mongoScopeHydrateIncomplete.add(scoped.key)
        }
        if (scoped.key === 'tenant:default') {
          mongoMemoryDb = nextDb
        }
        await syncScopeMetaUpdatedAtCache(scoped.key, dbm)
        return true
      }
      const rawMerge = buildEmptyRaw()
      ENTITY_SPECS.forEach((spec) => {
        rawMerge[spec.key] = keys.includes(spec.key) && Array.isArray(partialRaw[spec.key])
          ? partialRaw[spec.key]
          : (Array.isArray(existing[spec.key]) ? existing[spec.key] : [])
      })
      rawMerge._meta = partialRaw._meta && typeof partialRaw._meta === 'object' && Object.keys(partialRaw._meta).length
        ? { ...partialRaw._meta }
        : (existing._meta && typeof existing._meta === 'object' ? { ...existing._meta } : {})
      const nextDb = shapeDbFromParsed(rawMerge)
      mongoMemoryDbByTenant.set(scoped.key, nextDb)
      if (scoped.key === 'tenant:default') {
        mongoMemoryDb = nextDb
      }
      await syncScopeMetaUpdatedAtCache(scoped.key, dbm)
      return true
    })
  }
  finally {
    mongoHydrateDepth--
    if (prevWorkspace === 'tenant') {
      setCurrentTenant(prevTenant || DEFAULT_TENANT_ID)
    }
    else {
      setCurrentWorkspace(prevWorkspace, DEFAULT_TENANT_ID)
    }
  }
}

function readDb() {
  const scope = getScopeState()
  if (mongoBacked) {
    const scoped = mongoMemoryDbByTenant.get(scope.key)
    if (scoped) {
      return scoped
    }
    const seeded = buildSeedDb()
    const ws = normalizeWorkspaceForKey(scope.workspaceType)
    const tid = getCurrentTenantId()
    // 非 default 租户：禁止在未 hydrate 前把空种子塞进 mongoMemoryDbByTenant。
    // 否则后续占位曾会导致错误的全量 persist 覆盖 Mongo。
    const tenantColdMustNotCacheEmpty = ws === 'tenant' && tid !== DEFAULT_TENANT_ID
    if (!tenantColdMustNotCacheEmpty) {
      mongoMemoryDbByTenant.set(scope.key, seeded)
      if (scope.key === 'tenant:default') {
        mongoMemoryDb = seeded
      }
    }
    return seeded
  }
  assertDatastoreReady()
  return readDbFromFile()
}

function writeDb(db) {
  const scope = getScopeState()
  if (mongoBacked) {
    mongoMemoryDbByTenant.set(scope.key, db)
    if (scope.key === 'tenant:default') {
      mongoMemoryDb = db
    }
    scheduleMongoPersist(clonePayloadForMongo(db))
    return
  }
  assertDatastoreReady()
  ensureDbFile()
  const file = tenantDbFile(scope.tenantId)
  fs.writeFileSync(file, JSON.stringify(db, null, 2), 'utf-8')
}

/**
 * 更新内存快照并仅持久化指定实体（Mongo 模式）。JSON 回退模式仍写整文件（内存中其它字段未改则安全）。
 * @param {object} db
 * @param {string[]} entityKeys 如 ['products']
 */
function writeDbPartial(db, entityKeys) {
  const scope = getScopeState()
  if (mongoBacked) {
    mongoMemoryDbByTenant.set(scope.key, db)
    if (scope.key === 'tenant:default') {
      mongoMemoryDb = db
    }
    scheduleMongoPersistPartial(clonePayloadForMongo(db), entityKeys)
    return
  }
  writeDb(db)
}

/** Mongo 模式下仅持久化单条实体；JSON 回退模式仍写完整快照以保持原语义。 */
function writeDbEntity(db, entityKey, item) {
  const scope = getScopeState()
  if (mongoBacked) {
    mongoMemoryDbByTenant.set(scope.key, db)
    if (scope.key === 'tenant:default') {
      mongoMemoryDb = db
    }
    scheduleMongoPersistEntity(clonePayloadForMongo(db), entityKey, item)
    return
  }
  writeDb(db)
}

/** 供脚本在 writeDb 后 await，确保 Mongo 持久化已完成再断开连接 */
function flushMongoPersist() {
  const scope = getScopeState()
  return persistTailByTenant.get(scope.key) || persistTail
}

function isMongoPersistenceEnabled() {
  return mongoBacked
}

/** 子系统物理库删除后剔除内存快照，避免后续 read 命中陈旧缓存 */
function evictTenantMemoryCache(rawTenantId) {
  const t = normalizeTenantId(rawTenantId || DEFAULT_TENANT_ID)
  if (!t || t === DEFAULT_TENANT_ID) {
    return
  }
  const key = `tenant:${t}`
  mongoMemoryDbByTenant.delete(key)
  mongoScopeMetaUpdatedAtByKey.delete(key)
  mongoScopeHydrateIncomplete.delete(key)
}

/**
 * 丢弃当前 workspace 在内存中的快照并从 Mongo 重载（与 hasScopeCache / readDb 使用的 key 一致）。
 * 解决多进程、多实例或总部跨库读取时「进程内快照与 Mongo 不一致」。
 */
async function shouldSkipScopeMongoRefresh(cacheKey, refreshMode) {
  if (mongoScopeHydrateIncomplete.has(cacheKey)) {
    return false
  }
  const hasMemory = mongoMemoryDbByTenant.has(cacheKey)
  if (refreshMode !== 'every_request' && hasMemory) {
    if (refreshMode === 'single_instance') {
      return true
    }
    if (refreshMode === 'version') {
      const dbm = mongo.getMongoDb()
      if (dbm) {
        const cachedAt = mongoScopeMetaUpdatedAtByKey.get(cacheKey)
        const remoteAt = await readAppMetaUpdatedAtMs(dbm)
        if (cachedAt != null && remoteAt != null && cachedAt === remoteAt) {
          return true
        }
      }
    }
  }
  return false
}

async function runScopeMongoHydrate(workspaceType, hydrateTenantId, cacheKey, { partialEntityKeys, allowColdPartial = false } = {}) {
  const ws = normalizeWorkspaceForKey(workspaceType)
  const keys = Array.isArray(partialEntityKeys) ? partialEntityKeys.filter(Boolean) : []
  const usePartial = keys.length > 0 && (mongoMemoryDbByTenant.has(cacheKey) || allowColdPartial)
  const hydrateWork = async () => {
    if (!usePartial) {
      mongoMemoryDbByTenant.delete(cacheKey)
      mongoScopeHydrateIncomplete.delete(cacheKey)
    }
    if (usePartial) {
      const partialOpts = { allowColdPartial }
      if (ws === 'core') {
        await hydrateTenantDbPartialFromMongo('core', DEFAULT_TENANT_ID, keys, partialOpts)
      }
      else if (ws === 'self') {
        await hydrateTenantDbPartialFromMongo('self', DEFAULT_TENANT_ID, keys, partialOpts)
      }
      else {
        await hydrateTenantDbPartialFromMongo('tenant', hydrateTenantId, keys, partialOpts)
      }
    }
    else if (ws === 'core') {
      await hydrateTenantDbFromMongo('core', DEFAULT_TENANT_ID)
    }
    else if (ws === 'self') {
      await hydrateTenantDbFromMongo('self', DEFAULT_TENANT_ID)
    }
    else {
      await hydrateTenantDbFromMongo('tenant', hydrateTenantId)
    }
    const dbm = mongo.getMongoDb()
    if (dbm) {
      await syncScopeMetaUpdatedAtCache(cacheKey, dbm)
    }
  }
  /** 同 scope 串行队列：accounts / sidebar-counts / badge 并行到达时按序 partial，且不会误用他人集合的快照 */
  const prev = mongoScopeHydrateInflight.get(cacheKey) || Promise.resolve()
  const job = prev.then(hydrateWork, hydrateWork)
  mongoScopeHydrateInflight.set(cacheKey, job)
  try {
    await job
  }
  finally {
    if (mongoScopeHydrateInflight.get(cacheKey) === job) {
      mongoScopeHydrateInflight.delete(cacheKey)
    }
  }
}

async function refreshScopeCacheFromMongo(workspaceType, rawTenantIdFromRequest) {
  if (!mongoBacked) {
    return
  }
  const ws = normalizeWorkspaceForKey(workspaceType)
  const hydrateTenantId = ws === 'tenant'
    ? normalizeTenantId(rawTenantIdFromRequest || DEFAULT_TENANT_ID)
    : DEFAULT_TENANT_ID
  const cacheKey = buildScopeKey(workspaceType, hydrateTenantId)
  const dedup = mongoScopeRefreshDedup.getStore()
  if (dedup && dedup.has(cacheKey)) {
    return
  }
  const refreshMode = mongoConfig.getMongoRefreshMode()
  if (await shouldSkipScopeMongoRefresh(cacheKey, refreshMode)) {
    if (dedup) {
      dedup.add(cacheKey)
    }
    return
  }
  await runScopeMongoHydrate(workspaceType, hydrateTenantId, cacheKey)
  if (dedup) {
    dedup.add(cacheKey)
  }
}

/**
 * 仅刷新指定实体（须已有全量快照）；无快照时内部回退全量 hydrate。
 */
async function refreshScopePartialFromMongo(workspaceType, rawTenantIdFromRequest, entityKeys, options = {}) {
  if (!mongoBacked) {
    return
  }
  const keys = Array.isArray(entityKeys) ? entityKeys.filter(Boolean) : []
  if (!keys.length) {
    await refreshScopeCacheFromMongo(workspaceType, rawTenantIdFromRequest)
    return
  }
  const allowColdPartial = Boolean(options.allowColdPartial)
  const ws = normalizeWorkspaceForKey(workspaceType)
  const hydrateTenantId = ws === 'tenant'
    ? normalizeTenantId(rawTenantIdFromRequest || DEFAULT_TENANT_ID)
    : DEFAULT_TENANT_ID
  const cacheKey = buildScopeKey(workspaceType, hydrateTenantId)
  const dedup = mongoScopeRefreshDedup.getStore()
  if (dedup && dedup.has(cacheKey)) {
    return
  }
  if (!mongoMemoryDbByTenant.has(cacheKey) && !allowColdPartial) {
    await refreshScopeCacheFromMongo(workspaceType, rawTenantIdFromRequest)
    if (dedup) {
      dedup.add(cacheKey)
    }
    return
  }
  const refreshMode = mongoConfig.getMongoRefreshMode()
  if (await shouldSkipScopeMongoRefresh(cacheKey, refreshMode)) {
    if (dedup) {
      dedup.add(cacheKey)
    }
    return
  }
  await runScopeMongoHydrate(workspaceType, hydrateTenantId, cacheKey, {
    partialEntityKeys: keys,
    allowColdPartial,
  })
  if (dedup) {
    dedup.add(cacheKey)
  }
}

/** 鉴权等仅需 adminAccounts 时：优化开启且已有快照则 partial，否则全量 */
async function refreshScopeForAdminAuth(workspaceType, rawTenantIdFromRequest) {
  if (!mongoBacked) {
    return
  }
  if (mongoConfig.isAdminReadOptimizeEnabled()) {
    await refreshScopePartialFromMongo(workspaceType, rawTenantIdFromRequest, ['adminAccounts'])
    return
  }
  await refreshScopeCacheFromMongo(workspaceType, rawTenantIdFromRequest)
}

/**
 * 丢弃指定子系统租户库内存快照并从 Mongo 重新加载（非 default 租户）。
 */
async function refreshTenantCacheFromMongo(rawTenantId) {
  if (!mongoBacked) {
    return
  }
  const t = normalizeTenantId(rawTenantId || DEFAULT_TENANT_ID)
  if (!t || t === DEFAULT_TENANT_ID) {
    return
  }
  await refreshScopeCacheFromMongo('tenant', t)
}

module.exports = {
  buildSeedDb,
  readDb,
  writeDb,
  writeDbPartial,
  writeDbEntity,
  flushMongoPersist,
  hydrateFromMongoAfterConnect,
  hydrateTenantDbFromMongo,
  hasScopeCache,
  isMongoPersistenceEnabled,
  evictTenantMemoryCache,
  refreshScopeCacheFromMongo,
  refreshScopePartialFromMongo,
  refreshScopeForAdminAuth,
  refreshTenantCacheFromMongo,
  runWithMongoRequestDedup,
  getMongoHydrateDepth,
  clonePayloadForMongo,
  persistEntityItem,
  persistShardedSnapshot,
  persistShardedSnapshotPartial,
}
