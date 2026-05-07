const fs = require('node:fs')
const path = require('node:path')
const {
  products,
  orders,
  users,
  adminAccounts,
  addresses,
  bankCards,
  bills,
} = require('./mock')

const DB_DIR = path.join(__dirname, '..', 'data')
const DB_FILE = path.join(DB_DIR, 'db.json')
const ADMIN_USER_ID = 'U19900000000'
const ADMIN_PHONE = '19900000000'

// TODO(db): 接入 MongoDB 时在单独仓储模块中使用 require('./mongo').getMongoDb() 与 COLLECTIONS；
// 连接参数见 mongoConfig.js，勿在此处读写环境变量。

function ensureDbFile() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true })
  }
  if (!fs.existsSync(DB_FILE)) {
    const seed = {
      products,
      orders,
      users,
      adminAccounts,
      addresses,
      bankCards,
      bills,
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2), 'utf-8')
  }
}

function buildSeedDb() {
  return {
    products: products.map(item => ({ ...item })),
    orders: orders.map(item => ({ ...item })),
    users: users.map(item => ({ ...item })),
    adminAccounts: adminAccounts.map(item => ({ ...item })),
    addresses: addresses.map(item => ({ ...item })),
    bankCards: bankCards.map(item => ({ ...item })),
    bills: bills.map(item => ({ ...item })),
  }
}

function ensureAdminUser(list) {
  const hasAdmin = list.some(item => item && (item.phone === ADMIN_PHONE || item.id === ADMIN_USER_ID))
  if (hasAdmin) {
    return list
  }
  const adminSeed = users.find(item => item.phone === ADMIN_PHONE || item.id === ADMIN_USER_ID)
  if (adminSeed) {
    return [{ ...adminSeed }, ...list]
  }
  return [
    {
      id: ADMIN_USER_ID,
      name: '商城管理员',
      phone: ADMIN_PHONE,
      idCardFront: 'mock://admin/id-card-front',
      idCardBack: 'mock://admin/id-card-back',
      idCardHandheld: 'mock://admin/id-card-handheld',
      locationText: '广东省广州市天河区珠江新城（测试定位）',
      latitude: 23.119751,
      longitude: 113.327676,
      creditStatus: '良好',
      registerAt: new Date().toISOString(),
    },
    ...list,
  ]
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
  adminAccounts.forEach((seed) => {
    if (!map.has(seed.username)) {
      map.set(seed.username, { ...seed })
    }
  })
  return [...map.values()]
}

function readDb() {
  ensureDbFile()
  const raw = fs.readFileSync(DB_FILE, 'utf-8')
  try {
    const parsed = JSON.parse(raw)
    const db = {
      products: Array.isArray(parsed.products) ? parsed.products : [],
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      users: Array.isArray(parsed.users) ? parsed.users : [],
      adminAccounts: Array.isArray(parsed.adminAccounts) ? parsed.adminAccounts : [],
      addresses: Array.isArray(parsed.addresses) ? parsed.addresses : addresses.map(item => ({ ...item })),
      bankCards: Array.isArray(parsed.bankCards) ? parsed.bankCards : bankCards.map(item => ({ ...item })),
      bills: Array.isArray(parsed.bills) ? parsed.bills : bills.map(item => ({ ...item })),
    }
    db.users = dedupeUsersById(ensureAdminUser(db.users))
    db.adminAccounts = ensureAdminAccounts(db.adminAccounts)
    return {
      products: db.products,
      orders: db.orders,
      users: db.users,
      adminAccounts: db.adminAccounts,
      addresses: db.addresses,
      bankCards: db.bankCards,
      bills: db.bills,
    }
  }
  catch {
    return {
      products: [],
      orders: [],
      users: ensureAdminUser([]),
      adminAccounts: ensureAdminAccounts([]),
      addresses: [],
      bankCards: [],
      bills: [],
    }
  }
}

function writeDb(db) {
  ensureDbFile()
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8')
}

function resetDb() {
  const seed = buildSeedDb()
  writeDb(seed)
  return seed
}

module.exports = {
  buildSeedDb,
  readDb,
  resetDb,
  writeDb,
}
