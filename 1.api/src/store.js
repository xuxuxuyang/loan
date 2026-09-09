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
  runWithWorkspace,
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
const ALL_ENTITY_KEYS = ENTITY_SPECS.map(spec => spec.key)

let mongoBacked = false
/**
 * Mongo 模式下为「当前请求」的工作副本：index 中间件在每个 /api 请求起已 refreshScopeCacheFromMongo，
 * 同一请求内读写一致；非 HTTP 脚本见 hydrateTenantDbFromMongo / import 等独立入口。
 */
let mongoMemoryDb = null
let mongoMemoryDbByTenant = new Map()
const mongoScopeEntityVersionByKey = new Map()
const mongoScopeDirtyEntityKeysByKey = new Map()

/** Request-local dedup uses the scope and requested entity signature. */
const mongoScopeRefreshDedup = new AsyncLocalStorage()
/** hydrateTenantDbFromMongo 正在执行时 >0，防止 refresh→hydrate→再次 refresh 递归 */
let mongoHydrateDepth = 0
/** 同 scope 并发 refresh 合并为一次 hydrate（多 tab 并行 GET 时避免重复全库读 Mongo） */
const mongoScopeHydrateInflight = new Map()
const mongoScopeHydrateTail = new Map()

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

function normalizeEntityKeys(entityKeys) {
  return [...new Set((Array.isArray(entityKeys) ? entityKeys : []).filter(key => ALL_ENTITY_KEYS.includes(key)))]
}

function getScopeCacheReadiness(workspaceType, tenantId, entityKeys = ALL_ENTITY_KEYS) {
  const cacheKey = buildScopeKey(workspaceType, tenantId)
  const versions = mongoScopeEntityVersionByKey.get(cacheKey) || new Map()
  const dirty = mongoScopeDirtyEntityKeysByKey.get(cacheKey) || new Set()
  const keys = normalizeEntityKeys(entityKeys)
  const coveredKeys = keys.filter(key => versions.has(key) && !dirty.has(key))
  const exists = mongoMemoryDbByTenant.has(cacheKey)
  return {
    exists,
    usable: exists && coveredKeys.length === keys.length,
    complete: ALL_ENTITY_KEYS.every(key => versions.has(key) && !dirty.has(key)),
    coveredKeys,
    dirtyKeys: keys.filter(key => dirty.has(key)),
  }
}

function appMetaUpdatedAtMs(metaDoc) {
  if (!metaDoc || metaDoc.updatedAt == null) return null
  const t = metaDoc.updatedAt instanceof Date
    ? metaDoc.updatedAt.getTime()
    : new Date(metaDoc.updatedAt).getTime()
  return Number.isFinite(t) ? t : null
}

async function readAppMetaUpdatedAtMs(dbm) {
  if (!dbm) {
    return null
  }
  const metaDoc = await dbm.collection(mongo.APP_META).findOne(
    { _id: MAIN_STATE_ID },
    { projection: { updatedAt: 1 } },
  )
  return appMetaUpdatedAtMs(metaDoc)
}

function publishScopeSnapshot(cacheKey, nextDb, keys, updatedAt) {
  const versions = new Map(mongoScopeEntityVersionByKey.get(cacheKey))
  const dirty = new Set(mongoScopeDirtyEntityKeysByKey.get(cacheKey))
  for (const key of keys) {
    versions.set(key, updatedAt)
    dirty.delete(key)
  }
  // Publish only after every collection and metadata read has succeeded.
  mongoMemoryDbByTenant.set(cacheKey, nextDb)
  mongoScopeEntityVersionByKey.set(cacheKey, versions)
  mongoScopeDirtyEntityKeysByKey.set(cacheKey, dirty)
  if (cacheKey === 'tenant:default') mongoMemoryDb = nextDb
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
    /** 后台展示配置（低频写入，读取时随报表接口取用） */
    dashboardSimulationConfigs: [],
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
    dashboardSimulationConfigs: Array.isArray(parsed.dashboardSimulationConfigs) ? parsed.dashboardSimulationConfigs : [],
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
    dashboardSimulationConfigs: db.dashboardSimulationConfigs,
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
    dashboardSimulationConfigs: Array.isArray(db.dashboardSimulationConfigs) ? db.dashboardSimulationConfigs : [],
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
  return loadShardedPartialRawFromDb(dbm, ALL_ENTITY_KEYS)
}

/**
 * Read entity collections and metadata together for an atomic cache publication.
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
  return { raw: out, updatedAt: appMetaUpdatedAtMs(metaDoc) }
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
  dashboardSimulationConfigs: SHRINK_PROTECT_DEFAULT,
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
  let nextDb
  let updatedAt

  if (legacyDoc) {
    const raw = legacyAppStateDocToRaw(legacyDoc)
    nextDb = shapeDbFromParsed(raw)
    try {
      await persistShardedSnapshot(dbm, clonePayloadForMongo(nextDb))
      await legacyColl.deleteOne({ _id: MAIN_STATE_ID })
      updatedAt = await readAppMetaUpdatedAtMs(dbm)
      console.log('[store] 已从旧版 appState(main) 迁移到分集合持久化，并删除旧文档')
    }
    catch (err) {
      console.error('[store] 迁移 appState → 分集合失败:', err?.message || err)
      throw err
    }
  }
  else {
    const loaded = await loadShardedRawFromDb(dbm)
    const { raw } = loaded
    updatedAt = loaded.updatedAt
    if (isRawShardedPayloadEmpty(raw)) {
      nextDb = buildSeedDb()
      await persistShardedSnapshot(dbm, clonePayloadForMongo(nextDb))
      updatedAt = await readAppMetaUpdatedAtMs(dbm)
    }
    else {
      nextDb = shapeDbFromParsed(raw)
    }
  }

  mongoBacked = true
  publishScopeSnapshot(scope.key, nextDb, ALL_ENTITY_KEYS, updatedAt)
  return true
}

async function hydrateTenantDbFromMongo(workspaceType, tenantId) {
  mongoHydrateDepth++
  try {
    return await runWithWorkspace(workspaceType, tenantId, async () => {
      const dbm = mongo.getMongoDb()
      if (!dbm) {
        throw mongoSnapshotUnavailable(getScopeState().key)
      }
      const loaded = await loadShardedRawFromDb(dbm)
      const { raw } = loaded
      let updatedAt = loaded.updatedAt
      let nextDb
      if (isRawShardedPayloadEmpty(raw)) {
        nextDb = buildSeedDb()
        await persistShardedSnapshot(dbm, clonePayloadForMongo(nextDb))
        updatedAt = await readAppMetaUpdatedAtMs(dbm)
      }
      else {
        nextDb = shapeDbFromParsed(raw)
      }
      const scoped = getScopeState()
      publishScopeSnapshot(scoped.key, nextDb, ALL_ENTITY_KEYS, updatedAt)
      return true
    })
  }
  finally {
    mongoHydrateDepth--
  }
}

/**
 * 在已有 scope 快照上合并刷新指定实体；无快照时回退全量 hydrate（避免其它接口读到空 orders/users）。
 */
async function hydrateTenantDbPartialFromMongo(workspaceType, tenantId, entityKeys, { allowColdPartial = false } = {}) {
  const keys = normalizeEntityKeys(entityKeys)
  if (!keys.length) {
    return hydrateTenantDbFromMongo(workspaceType, tenantId)
  }
  mongoHydrateDepth++
  try {
    return await runWithWorkspace(workspaceType, tenantId, async () => {
      const scoped = getScopeState()
      const existing = mongoMemoryDbByTenant.get(scoped.key)
      const dbm = mongo.getMongoDb()
      if (!dbm) {
        throw mongoSnapshotUnavailable(scoped.key)
      }
      if (!existing && !allowColdPartial) {
        return hydrateTenantDbFromMongo(workspaceType, tenantId)
      }
      const { raw: partialRaw, updatedAt } = await loadShardedPartialRawFromDb(dbm, keys)
      const rawMerge = buildEmptyRaw()
      ENTITY_SPECS.forEach((spec) => {
        rawMerge[spec.key] = keys.includes(spec.key) && Array.isArray(partialRaw[spec.key])
          ? partialRaw[spec.key]
          : (Array.isArray(existing?.[spec.key]) ? existing[spec.key] : [])
      })
      rawMerge._meta = { ...partialRaw._meta }
      const nextDb = shapeDbFromParsed(rawMerge)
      publishScopeSnapshot(scoped.key, nextDb, keys, updatedAt)
      return true
    })
  }
  finally {
    mongoHydrateDepth--
  }
}

function mongoSnapshotUnavailable(cacheKey) {
  const error = new Error(`[store] Mongo snapshot unavailable for ${cacheKey}`)
  error.code = 'MONGO_SNAPSHOT_UNAVAILABLE'
  return error
}

function readDb() {
  const scope = getScopeState()
  if (mongoBacked) {
    const scoped = mongoMemoryDbByTenant.get(scope.key)
    if (scoped) {
      return scoped
    }
    throw mongoSnapshotUnavailable(scope.key)
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
  mongoScopeEntityVersionByKey.delete(key)
  mongoScopeDirtyEntityKeysByKey.delete(key)
}

async function shouldSkipScopeMongoRefresh(workspaceType, tenantId, cacheKey, keys, refreshMode) {
  if (!getScopeCacheReadiness(workspaceType, tenantId, keys).usable) {
    return false
  }
  if (refreshMode === 'single_instance') return true
  if (refreshMode === 'version') {
    const remoteAt = await readAppMetaUpdatedAtMs(mongo.getMongoDb())
    const versions = mongoScopeEntityVersionByKey.get(cacheKey)
    return remoteAt != null && keys.every(key => versions.get(key) === remoteAt)
  }
  return false
}

function runScopeMongoHydrate(workspaceType, rawTenantIdFromRequest, entityKeys, { allowColdPartial = false } = {}) {
  const ws = normalizeWorkspaceForKey(workspaceType)
  const hydrateTenantId = ws === 'tenant'
    ? normalizeTenantId(rawTenantIdFromRequest || DEFAULT_TENANT_ID)
    : DEFAULT_TENANT_ID
  const cacheKey = buildScopeKey(ws, hydrateTenantId)
  const keys = !mongoMemoryDbByTenant.has(cacheKey) && !allowColdPartial
    ? ALL_ENTITY_KEYS
    : entityKeys
  const signature = `${cacheKey}|${[...keys].sort().join(',')}`
  const dedup = mongoScopeRefreshDedup.getStore()
  if (dedup?.has(signature) && getScopeCacheReadiness(ws, hydrateTenantId, keys).usable) return Promise.resolve()
  const inflight = mongoScopeHydrateInflight.get(signature)
  if (inflight) return inflight
  const refreshMode = mongoConfig.getMongoRefreshMode()
  const hydrateWork = () => runWithWorkspace(ws, hydrateTenantId, async () => {
    // Recheck after prior partial jobs have published their own entity versions.
    if (!await shouldSkipScopeMongoRefresh(ws, hydrateTenantId, cacheKey, keys, refreshMode)) {
      if (keys.length === ALL_ENTITY_KEYS.length) {
        await hydrateTenantDbFromMongo(ws, hydrateTenantId)
      }
      else {
        await hydrateTenantDbPartialFromMongo(ws, hydrateTenantId, keys, { allowColdPartial })
      }
    }
    if (dedup) dedup.add(signature)
  })
  const prev = mongoScopeHydrateTail.get(cacheKey) || Promise.resolve()
  const job = prev.then(hydrateWork, hydrateWork).finally(() => {
    if (mongoScopeHydrateInflight.get(signature) === job) mongoScopeHydrateInflight.delete(signature)
    if (mongoScopeHydrateTail.get(cacheKey) === job) mongoScopeHydrateTail.delete(cacheKey)
  })
  mongoScopeHydrateInflight.set(signature, job)
  mongoScopeHydrateTail.set(cacheKey, job)
  return job
}

function refreshScopeCacheFromMongo(workspaceType, rawTenantIdFromRequest) {
  if (!mongoBacked) return Promise.resolve()
  return runScopeMongoHydrate(workspaceType, rawTenantIdFromRequest, ALL_ENTITY_KEYS)
}

/**
 * Refresh requested entities; cold scopes require full hydration unless explicitly allowed.
 */
function refreshScopePartialFromMongo(workspaceType, rawTenantIdFromRequest, entityKeys, options = {}) {
  if (!mongoBacked) return Promise.resolve()
  const keys = normalizeEntityKeys(entityKeys)
  if (!keys.length) {
    return refreshScopeCacheFromMongo(workspaceType, rawTenantIdFromRequest)
  }
  return runScopeMongoHydrate(workspaceType, rawTenantIdFromRequest, keys, options)
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
  getScopeCacheReadiness,
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
