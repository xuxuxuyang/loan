/**
 * 删除与本项目配置的根库及所有后缀库（如 mall__core、mall__tenant_*），再写入「最小空库 + 内置超管」；
 * 不读取 api/data/db.json。
 * npm run mongo:fresh  （仅 Mongo；本地目录请用 npm run reset:project）
 * 全量测试重置（Mongo + 清空整个 api/data + generated）：npm run reset:project 或 npm run fresh
 * 默认 seeds 不含「商城注册用户」影子账号（users 为空）；后台 adminAccounts 仍有内置超管。
 */
const path = require('node:path')
const { loadDotenvExports } = require('../src/loadEnv')

loadDotenvExports(path.join(__dirname, '..', 'src'))

const mongoConfig = require('../src/mongoConfig')
const mongo = require('../src/mongo')
const store = require('../src/store')
const { runWithWorkspace, DEFAULT_TENANT_ID } = require('../src/tenantContext')

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
    console.log('[fresh] 根库（默认租户 mall）已写入分集合 + app_meta，条数:', {
      products: snapshot.products.length,
      orders: snapshot.orders.length,
      users: snapshot.users.length,
      adminAccounts: snapshot.adminAccounts.length,
    })

    for (const ws of ['core', 'self']) {
      await runWithWorkspace(ws, DEFAULT_TENANT_ID, async () => {
        const scopedDb = mongo.getMongoDb()
        if (!scopedDb) {
          throw new Error(`[fresh] 无法解析工作区 ${ws} 对应 Mongo 库`)
        }
        const snap = store.buildSeedDb()
        await store.persistShardedSnapshot(scopedDb, store.clonePayloadForMongo(snap))
        console.log(`[fresh] 工作区 ${ws} → ${scopedDb.databaseName} 已写入种子（adminAccounts=${snap.adminAccounts.length}）`)
      })
    }
    console.warn('[fresh] 请重启 mall-api，并清除浏览器 localStorage 中的 mall-admin-session（或重新登录）')
  }
  finally {
    await mongo.closeMongo()
  }
}

main().catch((e) => {
  console.error('[fresh]', e.message || e)
  process.exit(1)
})
