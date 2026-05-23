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

/** 单次 HTTP 请求内已对某 scopeKey 执行过 refresh 时跳过，避免重复全库拉取 */
const mongoScopeRefreshDedup = new AsyncLocalStorage()
/** hydrateTenantDbFromMongo 正在执行时 >0，防止 refresh→hydrate→再次 refresh 递归 */
let mongoHydrateDepth = 0

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

const BULK_CHUNK = 400

/**
 * 将快照写入分集合 + app_meta（已深拷贝的 plain 对象）。
 * 每集合：删除内存中已不存在的 _id，再 bulkWrite replace upsert。
 */
async function persistShardedSnapshot(dbm, snapshot) {
  const updatedAt = new Date()
  for (const spec of ENTITY_SPECS) {
    const coll = dbm.collection(spec.collection)
    const items = Array.isArray(snapshot[spec.key]) ? snapshot[spec.key] : []
    const wantKeys = new Set()
    const keyedItems = []
    for (const item of items) {
      const pk = entityMongoPrimaryKey(item, spec.key)
      if (pk === undefined || pk === null) {
        console.warn(`[store] 跳过缺少主键的 ${spec.key} 记录`, item && typeof item === 'object' ? Object.keys(item) : item)
        continue
      }
      wantKeys.add(stablePrimaryKeyString(pk))
      keyedItems.push({ pk, item })
    }

    const existing = await coll.find({}, { projection: { _id: 1 } }).toArray()
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

function legacyAppStateDocToRaw(legacyDoc) {
  const { _id: _drop, updatedAt: _u, ...rest } = legacyDoc
  return rest
}

function scheduleMongoPersist(snapshot) {
  const scope = getScopeState()
  const currentTail = persistTailByTenant.get(scope.key) || Promise.resolve()
  const nextTail = currentTail
    .then(async () => {
      const dbm = mongo.getMongoDb()
      if (!dbm || !mongoBacked) {
        return
      }
      try {
        await persistShardedSnapshot(dbm, snapshot)
      }
      catch (err) {
        console.error('[store] MongoDB 分集合持久化失败:', err?.message || err)
      }
    })
    .catch((err) => {
      console.error('[store] MongoDB 持久化队列失败:', err?.message || err)
    })
  persistTailByTenant.set(scope.key, nextTail)
  if (scope.key === 'tenant:default') {
    persistTail = nextTail
  }
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

/** 供脚本在 writeDb 后 await，确保 Mongo 持久化已完成再断开连接 */
function flushMongoPersist() {
  const scope = getScopeState()
  return persistTailByTenant.get(scope.key) || persistTail
}

function resetDb() {
  const scope = getScopeState()
  const seed = buildSeedDb()
  if (mongoBacked) {
    mongoMemoryDbByTenant.set(scope.key, seed)
    if (scope.key === 'tenant:default') {
      mongoMemoryDb = seed
    }
    scheduleMongoPersist(clonePayloadForMongo(seed))
    return seed
  }
  writeDb(seed)
  return seed
}

const MONGO_BUILTIN_DBS = new Set(['admin', 'local', 'config'])

/**
 * 删除与本项目配置的根数据库名同名及后缀库（例如 mall、mall__core、mall__tenant_xxx）。
 * 与 mongo.getMongoDb() 的根库解析一致（MONGODB_DB_NAME 或未填时用连接串默认库名）。
 * @param {import('mongodb').MongoClient | null | undefined} client
 * @returns {Promise<string[]>}
 */
async function dropAllMongoProjectDatabases(client) {
  if (!client) {
    throw new Error('MongoClient 未就绪')
  }
  const configuredName = mongoConfig.getMongoConfig().dbName
  const rootDb = configuredName && String(configuredName).trim()
    ? client.db(String(configuredName).trim())
    : client.db()
  const base = rootDb.databaseName

  const adminDb = client.db('admin').admin()
  const res = await adminDb.listDatabases()
  const rows = Array.isArray(res?.databases) ? res.databases : []
  const toDrop = []
  for (const entry of rows) {
    const name = String(entry?.name ?? '').trim()
    if (!name || MONGO_BUILTIN_DBS.has(name)) {
      continue
    }
    if (name === base || name.startsWith(`${base}__`)) {
      toDrop.push(name)
    }
  }

  /** @type {string[]} */
  const dropped = []
  for (const name of toDrop) {
    try {
      await client.db(name).dropDatabase()
      dropped.push(name)
    }
    catch (err) {
      console.warn('[store] dropDatabase 跳过', name + ':', err?.message || err)
    }
  }
  return dropped
}

/**
 * 清空单个库内的分集合 + app_meta + 旧 appState（不删其它后缀库）。
 */
async function wipeAllMongoPersistence(dbm) {
  for (const spec of ENTITY_SPECS) {
    await dbm.collection(spec.collection).deleteMany({})
  }
  await dbm.collection(mongo.APP_META).deleteMany({})
  await dbm.collection(mongo.APP_STATE).deleteMany({})
}

/**
 * 将 api/data/db.json（若存在且合法）或最小空库快照覆盖写入 Mongo（分集合）。
 */
async function importLocalSnapshotToMongo() {
  const dbm = mongo.getMongoDb()
  if (!dbm) {
    throw new Error('MongoDB 未连接，请先调用 connectMongo()')
  }
  let snapshot
  let sourceUsed
  if (fs.existsSync(DB_FILE)) {
    try {
      snapshot = shapeDbFromParsed(JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')))
      sourceUsed = 'db.json'
    }
    catch {
      console.warn('[store] api/data/db.json 解析失败，已改用空库 + 默认账号')
      snapshot = buildSeedDb()
      sourceUsed = 'empty-bootstrap(db.json 无效)'
    }
  }
  else {
    snapshot = buildSeedDb()
    sourceUsed = 'empty-bootstrap'
  }
  await persistShardedSnapshot(dbm, clonePayloadForMongo(snapshot))
  await dbm.collection(mongo.APP_STATE).deleteOne({ _id: MAIN_STATE_ID }).catch(() => {})
  if (mongoBacked) {
    const scope = getScopeState()
    mongoMemoryDbByTenant.set(scope.key, snapshot)
    if (scope.key === 'tenant:default') {
      mongoMemoryDb = snapshot
    }
  }
  const counts = {
    products: snapshot.products.length,
    orders: snapshot.orders.length,
    users: snapshot.users.length,
    adminAccounts: snapshot.adminAccounts.length,
    addresses: snapshot.addresses.length,
    bankCards: snapshot.bankCards.length,
    bills: snapshot.bills.length,
    trafficChannels: Array.isArray(snapshot.trafficChannels) ? snapshot.trafficChannels.length : 0,
    csSessions: Array.isArray(snapshot.csSessions) ? snapshot.csSessions.length : 0,
  }
  return { source: sourceUsed, counts }
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
  mongoMemoryDbByTenant.delete(`tenant:${t}`)
}

/**
 * 丢弃当前 workspace 在内存中的快照并从 Mongo 重载（与 hasScopeCache / readDb 使用的 key 一致）。
 * 解决多进程、多实例或总部跨库读取时「进程内快照与 Mongo 不一致」。
 */
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
  mongoMemoryDbByTenant.delete(cacheKey)
  if (ws === 'core') {
    await hydrateTenantDbFromMongo('core', DEFAULT_TENANT_ID)
  }
  else if (ws === 'self') {
    await hydrateTenantDbFromMongo('self', DEFAULT_TENANT_ID)
  }
  else {
    await hydrateTenantDbFromMongo('tenant', hydrateTenantId)
  }
  if (dedup) {
    dedup.add(cacheKey)
  }
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

/** 删除本地 JSON 形态的子系统快照文件 db.<tenant>.json（不影响 mall/default 主文件） */
function removeTenantJsonStoreFile(rawTenantId) {
  const t = normalizeTenantId(rawTenantId || DEFAULT_TENANT_ID)
  if (!t || t === DEFAULT_TENANT_ID) {
    return false
  }
  const safe = String(t).replace(/[^a-z0-9_-]/gi, '').toLowerCase()
  const file = path.join(DB_DIR, `db.${safe}.json`)
  try {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file)
      return true
    }
  }
  catch (err) {
    console.warn('[store] removeTenantJsonStoreFile', err?.message || err)
  }
  return false
}

module.exports = {
  buildSeedDb,
  readDb,
  resetDb,
  writeDb,
  flushMongoPersist,
  hydrateFromMongoAfterConnect,
  hydrateTenantDbFromMongo,
  hasScopeCache,
  importLocalSnapshotToMongo,
  isMongoPersistenceEnabled,
  evictTenantMemoryCache,
  refreshScopeCacheFromMongo,
  refreshTenantCacheFromMongo,
  runWithMongoRequestDedup,
  getMongoHydrateDepth,
  removeTenantJsonStoreFile,
  clonePayloadForMongo,
  /** 脚本：清空云库 mall 相关集合并写入 buildSeedDb() */
  wipeAllMongoPersistence,
  /** 脚本：删除根库 + mall__* 后缀库（完整重置多子系统/workspace 数据） */
  dropAllMongoProjectDatabases,
  persistShardedSnapshot,
}
