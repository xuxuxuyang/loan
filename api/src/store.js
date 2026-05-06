const fs = require('node:fs')
const path = require('node:path')
const {
  products,
  orders,
  users,
  addresses,
  bankCards,
  bills,
} = require('./mock')

const DB_DIR = path.join(__dirname, '..', 'data')
const DB_FILE = path.join(DB_DIR, 'db.json')

// TODO(db): 后续接入真实数据库时，可在此替换为仓储层实现。

function ensureDbFile() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true })
  }
  if (!fs.existsSync(DB_FILE)) {
    const seed = {
      products,
      orders,
      users,
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
    addresses: addresses.map(item => ({ ...item })),
    bankCards: bankCards.map(item => ({ ...item })),
    bills: bills.map(item => ({ ...item })),
  }
}

function ensureAdminUser(list) {
  const hasAdmin = list.some(item => item && item.phone === '19900000000')
  if (hasAdmin) {
    return list
  }
  const adminSeed = users.find(item => item.phone === '19900000000')
  if (adminSeed) {
    return [{ ...adminSeed }, ...list]
  }
  return [
    {
      id: 'U19900000000',
      name: '商城管理员',
      phone: '19900000000',
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

function readDb() {
  ensureDbFile()
  const raw = fs.readFileSync(DB_FILE, 'utf-8')
  try {
    const parsed = JSON.parse(raw)
    const db = {
      products: Array.isArray(parsed.products) ? parsed.products : [],
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      users: Array.isArray(parsed.users) ? parsed.users : [],
      addresses: Array.isArray(parsed.addresses) ? parsed.addresses : addresses.map(item => ({ ...item })),
      bankCards: Array.isArray(parsed.bankCards) ? parsed.bankCards : bankCards.map(item => ({ ...item })),
      bills: Array.isArray(parsed.bills) ? parsed.bills : bills.map(item => ({ ...item })),
    }
    db.users = ensureAdminUser(db.users)
    return {
      products: db.products,
      orders: db.orders,
      users: db.users,
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
