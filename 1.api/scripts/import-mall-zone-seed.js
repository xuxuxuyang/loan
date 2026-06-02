/**
 * 将 api/data/mall-zone-products.seed.json 中的商品写入当前数据存储。
 * - 默认：删除现有 salesMode=mall 的商品，再按 JSON 追加新 mall 商品（id 自增，不与非 mall 冲突）。
 * - 环境：需 MONGODB_URI 并已能连通（与 npm run dev 相同），或 ALLOW_JSON_FALLBACK=true 使用 api/data/db.json。
 *
 * 用法（在 api 目录）：
 *   npm run import:mall-seed
 *   node scripts/import-mall-zone-seed.js
 */
const fs = require('node:fs')
const path = require('node:path')
const { loadDotenvExports } = require('../src/loadEnv')

loadDotenvExports(path.join(__dirname, '..', 'src'))

const mongo = require('../src/mongo')
const mongoConfig = require('../src/mongoConfig')
const store = require('../src/store')
const { runWithTenant, DEFAULT_TENANT_ID } = require('../src/tenantContext')

const SEED_FILE = path.join(__dirname, '..', 'data', 'mall-zone-products.seed.json')

function readSeed() {
  if (!fs.existsSync(SEED_FILE)) {
    throw new Error(`找不到种子文件: ${SEED_FILE}`)
  }
  const raw = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'))
  if (!raw || !Array.isArray(raw.products)) {
    throw new Error('mall-zone-products.seed.json 缺少 products 数组')
  }
  return raw.products
}

async function main() {
  if (!mongoConfig.isMongoConfigured() && !mongoConfig.isJsonFallbackAllowed()) {
    console.error('[import:mall-seed] 请配置 MONGODB_URI，或设置 ALLOW_JSON_FALLBACK=true')
    process.exit(1)
  }

  if (mongoConfig.isMongoConfigured()) {
    await mongo.connectMongo()
  }

  await runWithTenant(DEFAULT_TENANT_ID, async () => {
    if (mongoConfig.isMongoConfigured()) {
      await store.hydrateFromMongoAfterConnect()
    }

    const templates = readSeed()
    const db = store.readDb()
    if (!Array.isArray(db.products)) {
      db.products = []
    }

    const kept = db.products.filter((p) => String(p.salesMode || '').trim() !== 'mall')
    const maxId = kept.reduce((m, p) => {
      const id = Number(p.id || 0)
      return id > m ? id : m
    }, 0)

    const now = new Date().toISOString()
    const newMall = templates.map((row, idx) => {
      const detailImages = Array.isArray(row.detailImages) ? row.detailImages : []
      return {
        id: maxId + idx + 1,
        name: String(row.name || '').trim(),
        subtitle: String(row.subtitle || '').trim(),
        description: String(row.description || '').trim(),
        origin: String(row.origin || '').trim(),
        price: Number(row.price),
        image: String(row.image || '').trim(),
        detailImages,
        category: String(row.category || '').trim(),
        salesMode: 'mall',
        cardPackageAmount: Number.isFinite(Number(row.cardPackageAmount))
          ? Math.round(Number(row.cardPackageAmount))
          : 0,
        onSale: row.onSale !== false,
        createdAt: now,
        updatedAt: now,
      }
    })

    const bad = newMall.find(
      (p) => !p.name || !p.subtitle || !p.description || !p.origin || !p.image || !p.category || !Number.isFinite(p.price) || p.price <= 0,
    )
    if (bad) {
      throw new Error(`种子数据字段不完整或价格非法: ${JSON.stringify(bad).slice(0, 200)}`)
    }

    const removed = db.products.length - kept.length
    db.products = [...newMall, ...kept]
    // 仅同步 products，避免 writeDb 全量落库误删 adminAccounts 等其它集合
    store.writeDbPartial(db, ['products'])

    if (mongoConfig.isMongoConfigured()) {
      await store.flushMongoPersist()
      await mongo.closeMongo()
    }

    console.log('[import:mall-seed] 已移除原 mall 商品:', removed, '条')
    console.log('[import:mall-seed] 已写入:', newMall.length, '条（来源 mall-zone-products.seed.json）')
    console.log('[import:mall-seed] 保留非 mall 商品:', kept.length, '条')
  })
}

main().catch((e) => {
  console.error('[import:mall-seed]', e.message || e)
  process.exit(1)
})
