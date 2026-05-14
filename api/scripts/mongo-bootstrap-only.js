/**
 * 仅将代码中的「最小空库 + 内置超管」写入云库（分集合 + app_meta），不读取 api/data/db.json。
 * npm run mongo:fresh
 */
const path = require('node:path')
const { loadDotenvExports } = require('../src/loadEnv')

loadDotenvExports(path.join(__dirname, '..', 'src'))

const mongoConfig = require('../src/mongoConfig')
const mongo = require('../src/mongo')
const store = require('../src/store')

async function main() {
  if (!mongoConfig.isMongoConfigured()) {
    console.error('[fresh] 未配置 MONGODB_URI，请在 api/.env.development / .env.production（或 api/.env、项目根 .env）中设置')
    process.exit(1)
  }
  await mongo.connectMongo()
  try {
    const dbm = mongo.getMongoDb()
    if (!dbm) {
      console.error('[fresh] 无法连接 Mongo')
      process.exit(1)
    }
    await store.wipeAllMongoPersistence(dbm)
    const snapshot = store.buildSeedDb()
    await store.persistShardedSnapshot(dbm, store.clonePayloadForMongo(snapshot))
    console.log('[fresh] 已清空并写入分集合 + app_meta，条数:', {
      products: snapshot.products.length,
      orders: snapshot.orders.length,
      users: snapshot.users.length,
      adminAccounts: snapshot.adminAccounts.length,
    })
    console.warn('[fresh] 若 mall-api 正在运行请重启，以载入新数据')
  }
  finally {
    await mongo.closeMongo()
  }
}

main().catch((e) => {
  console.error('[fresh]', e.message || e)
  process.exit(1)
})
