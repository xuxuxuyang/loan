#!/usr/bin/env node
const path = require('node:path')
const { MongoClient } = require('mongodb')
const dotenv = require('dotenv')

dotenv.config({ path: path.join(process.cwd(), '.env.production'), quiet: true })
dotenv.config({ path: path.join(process.cwd(), '.env'), quiet: true })

const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL
const rootDbName = String(process.env.MONGODB_DB_NAME || process.env.MONGO_DB_NAME || 'mall').trim() || 'mall'

const ORDER_INDEXES = [
  { keys: { status: 1, createdAt: -1 }, name: 'idx_admin_orders_status_createdAt' },
  { keys: { riskStatus: 1, status: 1, createdAt: -1 }, name: 'idx_admin_orders_risk_status_createdAt' },
  { keys: { cardPackageIssued: 1, status: 1, createdAt: -1 }, name: 'idx_admin_orders_card_status_createdAt' },
  { keys: { payType: 1, createdAt: -1 }, name: 'idx_admin_orders_payType_createdAt' },
  { keys: { mallUserId: 1, createdAt: -1 }, name: 'idx_admin_orders_mallUser_createdAt' },
  { keys: { receiverPhone: 1 }, name: 'idx_admin_orders_receiverPhone' },
  { keys: { name: 1 }, name: 'idx_admin_orders_name' },
]

const USER_INDEXES = [
  { keys: { phone: 1 }, name: 'idx_admin_users_phone' },
  { keys: { registerAt: -1 }, name: 'idx_admin_users_registerAt' },
  { keys: { registerChannelCode: 1, registerAt: -1 }, name: 'idx_admin_users_channel_registerAt' },
  { keys: { idNumber: 1 }, name: 'idx_admin_users_idNumber' },
  { keys: { name: 1 }, name: 'idx_admin_users_name' },
]

async function collectionExists(db, name) {
  const rows = await db.listCollections({ name }, { nameOnly: true }).toArray()
  return rows.length > 0
}

async function ensureIndexes(db, collectionName, specs) {
  if (!(await collectionExists(db, collectionName))) {
    console.log(`[skip] ${db.databaseName}.${collectionName}: collection not found`)
    return
  }
  const coll = db.collection(collectionName)
  const count = await coll.estimatedDocumentCount()
  if (count <= 0) {
    console.log(`[skip] ${db.databaseName}.${collectionName}: empty collection`)
    return
  }
  for (const spec of specs) {
    try {
      const name = await coll.createIndex(spec.keys, { name: spec.name, background: true })
      console.log(`[ok] ${db.databaseName}.${collectionName}.${name}`)
    }
    catch (err) {
      console.error(`[fail] ${db.databaseName}.${collectionName}.${spec.name}: ${err && err.message ? err.message : err}`)
    }
  }
}

async function main() {
  if (!uri) {
    throw new Error('MONGODB_URI is required')
  }
  const client = new MongoClient(uri, { maxPoolSize: 3, serverSelectionTimeoutMS: 10000 })
  await client.connect()
  try {
    const admin = client.db().admin()
    let dbNames = [rootDbName, `${rootDbName}__core`, `${rootDbName}__self`]
    try {
      const listed = await admin.listDatabases()
      const tenantPrefix = `${rootDbName}__tenant_`
      dbNames = listed.databases
        .map(item => String(item.name || ''))
        .filter(name => name === rootDbName || name === `${rootDbName}__core` || name === `${rootDbName}__self` || name.startsWith(tenantPrefix))
        .sort()
    }
    catch (err) {
      console.warn(`[warn] listDatabases failed, using default database list: ${err && err.message ? err.message : err}`)
    }

    for (const dbName of dbNames) {
      const db = client.db(dbName)
      await ensureIndexes(db, 'orders', ORDER_INDEXES)
      await ensureIndexes(db, 'users', USER_INDEXES)
    }
  }
  finally {
    await client.close()
  }
}

main().catch((err) => {
  console.error(`[fatal] ${err && err.message ? err.message : err}`)
  process.exit(1)
})
