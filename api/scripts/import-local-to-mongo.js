/**
 * 将 api/data/db.json（若存在）或最小空库快照（仅默认后台账号）写入云库 mall.appState(_id: main)。
 * 用法：在 api 目录执行 npm run import:mongo-local
 */
const path = require('node:path')
const { loadDotenvExports } = require('../src/loadEnv')

loadDotenvExports(path.join(__dirname, '..', 'src'))

const mongoConfig = require('../src/mongoConfig')
const mongo = require('../src/mongo')
const store = require('../src/store')

async function main() {
  if (!mongoConfig.isMongoConfigured()) {
    console.error('[import] 未配置 MONGODB_URI，请在 api/.env.development / .env.production（或 api/.env、项目根 .env）中设置')
    process.exit(1)
  }

  await mongo.connectMongo()

  try {
    const result = await store.importLocalSnapshotToMongo()
    console.log('[import] 已写入 Mongo 集合', mongo.APP_STATE)
    console.log('[import] 数据来源:', result.source)
    console.log('[import] 条数:', JSON.stringify(result.counts, null, 2))
  }
  finally {
    await mongo.closeMongo()
  }
}

main().catch((err) => {
  console.error('[import] 失败:', err.message || err)
  process.exit(1)
})
