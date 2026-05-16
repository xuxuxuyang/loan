/**
 * 删除与本项目配置的根库及所有后缀库（如 mall__core、mall__tenant_*），再写入「最小空库 + 内置超管」；
 * 不读取 api/data/db.json。
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
    const mongoClient = mongo.getMongoClient()
    if (!mongoClient) {
      console.error('[fresh] 无法连接 Mongo')
      process.exit(1)
    }
    const dropped = await store.dropAllMongoProjectDatabases(mongoClient)
    console.log('[fresh] 已从实例删除项目相关库:', dropped.length ? dropped.join(', ') : '(无匹配名称，仍将写入种子)')

    const dbm = mongo.getMongoDb()
    if (!dbm) {
      console.error('[fresh] drop 后无法解析根库，请检查 MONGODB_URI / MONGODB_DB_NAME')
      process.exit(1)
    }

    const snapshot = store.buildSeedDb()
    await store.persistShardedSnapshot(dbm, store.clonePayloadForMongo(snapshot))
    console.log('[fresh] 根库已写入分集合 + app_meta，条数:', {
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
