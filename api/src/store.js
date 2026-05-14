const fs = require('node:fs')
const path = require('node:path')
const mongo = require('./mongo')
const mongoConfig = require('./mongoConfig')
const {
  BOOTSTRAP_ADMIN_USER,
  BOOTSTRAP_ADMIN_ACCOUNTS,
  DEFAULT_SUPER_ADMIN_USERNAME,
  DEFAULT_SUPER_ADMIN_PHONE,
} = require('./defaultBootstrap')

const DB_DIR = path.join(__dirname, '..', 'data')
const DB_FILE = path.join(DB_DIR, 'db.json')
const ADMIN_USER_ID = `U${DEFAULT_SUPER_ADMIN_PHONE}`
const ADMIN_PHONE = DEFAULT_SUPER_ADMIN_PHONE

/** 旧版 appState 单文档 _id */
const MAIN_STATE_ID = 'main'

/** 与 mongo.SHARDED_ENTITY_KEYS 一致：每项对应 COLLECTIONS[key] */
const ENTITY_SPECS = mongo.SHARDED_ENTITY_KEYS.map((key) => ({
  key,
  collection: mongo.COLLECTIONS[key],
}))

let mongoBacked = false
/** 使用 Mongo 时 readDb/writeDb 均针对该常驻对象 */
let mongoMemoryDb = null

/** 串行写入，避免并发持久化乱序 */
let persistTail = Promise.resolve()

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
  }
}

/** 空业务数据 + 系统默认管理员与后台账号（归一化后） */
function buildSeedDb() {
  return shapeDbFromParsed(buildEmptyRaw())
}

function ensureAdminUser(list) {
  const hasAdmin = list.some(item => item && (item.phone === ADMIN_PHONE || item.id === ADMIN_USER_ID))
  if (hasAdmin) {
    return list
  }
  const now = new Date().toISOString()
  const adminSeed = { ...BOOTSTRAP_ADMIN_USER, registerAt: now }
  return [adminSeed, ...list]
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
  }
}

function readDbFromFile() {
  ensureDbFile()
  const raw = fs.readFileSync(DB_FILE, 'utf-8')
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
  persistTail = persistTail
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
  return true
}

function readDb() {
  if (mongoBacked && mongoMemoryDb) {
    return mongoMemoryDb
  }
  assertDatastoreReady()
  return readDbFromFile()
}

function writeDb(db) {
  if (mongoBacked) {
    scheduleMongoPersist(clonePayloadForMongo(db))
    return
  }
  assertDatastoreReady()
  ensureDbFile()
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8')
}

/** 供脚本在 writeDb 后 await，确保 Mongo 持久化已完成再断开连接 */
function flushMongoPersist() {
  return persistTail
}

function resetDb() {
  const seed = buildSeedDb()
  if (mongoBacked) {
    mongoMemoryDb = seed
    scheduleMongoPersist(clonePayloadForMongo(mongoMemoryDb))
    return mongoMemoryDb
  }
  writeDb(seed)
  return seed
}

/**
 * 清空分集合 + app_meta + 旧 appState，再写入种子快照（供 mongo:fresh 脚本）。
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
    mongoMemoryDb = snapshot
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

module.exports = {
  buildSeedDb,
  readDb,
  resetDb,
  writeDb,
  flushMongoPersist,
  hydrateFromMongoAfterConnect,
  importLocalSnapshotToMongo,
  isMongoPersistenceEnabled,
  clonePayloadForMongo,
  /** 脚本：清空云库 mall 相关集合并写入 buildSeedDb() */
  wipeAllMongoPersistence,
  persistShardedSnapshot,
}
