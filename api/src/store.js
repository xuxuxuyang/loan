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

/** Mongo 中为整库快照片段使用固定 _id（集合名 mongo.APP_STATE） */
const MAIN_STATE_ID = 'main'

let mongoBacked = false
/** 使用 Mongo 时 readDb/writeDb 均针对该常驻对象 */
let mongoMemoryDb = null

/** 串行写入，避免并发 replaceOne 乱序 */
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
  }
  return JSON.parse(JSON.stringify(payload))
}

function scheduleMongoPersist(snapshot) {
  persistTail = persistTail
    .then(async () => {
      const dbm = mongo.getMongoDb()
      if (!dbm || !mongoBacked) {
        return
      }
      const coll = dbm.collection(mongo.APP_STATE)
      const doc = {
        _id: MAIN_STATE_ID,
        updatedAt: new Date(),
        ...snapshot,
      }
      await coll.replaceOne({ _id: MAIN_STATE_ID }, doc, { upsert: true })
    })
    .catch((err) => {
      console.error('[store] MongoDB 持久化失败:', err?.message || err)
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
 * connectMongo() 成功后调用：从 Mongo 加载整库快照，若不存在则写入最小空库快照（仅存默认后台账号）。
 * @returns {Promise<boolean>}
 */
async function hydrateFromMongoAfterConnect() {
  const dbm = mongo.getMongoDb()
  if (!dbm) {
    return false
  }

  const coll = dbm.collection(mongo.APP_STATE)
  const doc = await coll.findOne({ _id: MAIN_STATE_ID })

  if (!doc) {
    mongoMemoryDb = buildSeedDb()
    await coll.replaceOne(
      { _id: MAIN_STATE_ID },
      {
        _id: MAIN_STATE_ID,
        updatedAt: new Date(),
        ...clonePayloadForMongo(mongoMemoryDb),
      },
      { upsert: true },
    )
  }
  else {
    const { _id: _ignore, updatedAt: _u2, ...rest } = doc
    mongoMemoryDb = shapeDbFromParsed(rest)
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
 * 将 api/data/db.json（若存在且合法）或最小空库快照覆盖写入 Mongo。
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
  const coll = dbm.collection(mongo.APP_STATE)
  await coll.replaceOne(
    { _id: MAIN_STATE_ID },
    {
      _id: MAIN_STATE_ID,
      updatedAt: new Date(),
      ...clonePayloadForMongo(snapshot),
    },
    { upsert: true },
  )
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
  hydrateFromMongoAfterConnect,
  importLocalSnapshotToMongo,
  isMongoPersistenceEnabled,
}
