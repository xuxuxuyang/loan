/**
 * 删除 salesMode=mall 的旧商城商品，写入 4 个分类各 6 条（共 24 条）新数据。
 * 手机分类为 iPhone 12–17；其它分类主图仍以 DummyJSON CDN 等可直连 URL 为主。
 * 用法（在仓库根目录）：
 *   node api/scripts/seed-mall-showcase-catalog.js
 * 需已配置 MONGODB_URI（会 hydrate 后写回），或 ALLOW_JSON_FALLBACK=true 使用 api/data/db.json。
 */
const { loadDotenvExports } = require('../src/loadEnv')

loadDotenvExports(require('node:path').join(__dirname, '..', 'src'))

const mongoConfig = require('../src/mongoConfig')
const mongo = require('../src/mongo')
const store = require('../src/store')

const DJ = 'https://cdn.dummyjson.com/product-images'

/**
 * 手机分类：iPhone 12–17 各一条。
 * 商品主图：Apple 在线商店 CDN（store.storeimages.cdn-apple.com / as-images.apple.com），与官网选购页同款「颜色精选」或全系展示素材，非第三方图库。
 * 展示价 = round(Apple 中国大陆官网参考起售价人民币 × 1.2)。官网会调价，部署前可按 apple.com.cn 核对后改 PHONE_OFFICIAL_CNY。
 */
const APPLE_STORE = 'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is'

const PHONE_OFFICIAL_CNY = [
  4699, // iPhone 12 128GB 档常见公示/历史入门参考
  5399, // iPhone 13 128GB
  5999, // iPhone 14 128GB
  5299, // iPhone 15 128GB（新品上市后常见入门调价口径）
  5999, // iPhone 16 128GB
  5999, // iPhone 17 256GB 入门档（以官网当前 SKU 为准）
]

const COVER_BY_CATEGORY = {
  phone: [
    `${APPLE_STORE}/iphone-12-select-2020?wid=800&hei=800&fmt=jpeg&qlt=92`,
    `${APPLE_STORE}/iphone-13-starlight-select-2021?wid=800&hei=800&fmt=jpeg&qlt=92`,
    `${APPLE_STORE}/iphone-14-blue-select-202209?wid=800&hei=800&fmt=jpeg&qlt=92`,
    `${APPLE_STORE}/iphone-15-pink-select-202309?wid=800&hei=800&fmt=jpeg&qlt=92`,
    `${APPLE_STORE}/iphone-16-ultramarine-select-202409_AV2?wid=800&hei=800&fmt=jpeg&qlt=92`,
    `${APPLE_STORE}/iphone-17-lavender-select-202509?wid=800&hei=800&fmt=jpeg&qlt=92`,
  ],
  digital: [
    `${DJ}/laptops/apple-macbook-pro-14-inch-space-grey/1.webp`,
    `${DJ}/tablets/ipad-mini-2021-starlight/1.webp`,
    `${DJ}/mobile-accessories/apple-airpods-max-silver/1.webp`,
    `${DJ}/mobile-accessories/apple-watch-series-4-gold/1.webp`,
    `${DJ}/laptops/new-dell-xps-13-9300-laptop/1.webp`,
    `${DJ}/laptops/asus-zenbook-pro-dual-screen-laptop/1.webp`,
  ],
  appliance: [
    `${DJ}/kitchen-accessories/boxed-blender/1.webp`,
    `${DJ}/kitchen-accessories/silver-pot-with-glass-cap/1.webp`,
    `${DJ}/home-decoration/table-lamp/1.webp`,
    `${DJ}/mobile-accessories/apple-homepod-mini-cosmic-grey/1.webp`,
    `${DJ}/kitchen-accessories/microwave-oven/1.webp`,
    `${DJ}/skin-care/vaseline-men-body-and-face-lotion/1.webp`,
  ],
  cosmetics: [
    `${DJ}/skin-care/olay-ultra-moisture-shea-butter-body-wash/1.webp`,
    `${DJ}/fragrances/gucci-bloom-eau-de/1.webp`,
    `${DJ}/beauty/powder-canister/1.webp`,
    `${DJ}/beauty/eyeshadow-palette-with-mirror/1.webp`,
    `${DJ}/skin-care/attitude-super-leaves-hand-soap/1.webp`,
    `${DJ}/fragrances/chanel-coco-noir-eau-de/1.webp`,
  ],
}

function catalogRows() {
  const now = new Date().toISOString()
  const rows = []
  const defs = [
    {
      category: 'phone',
      items: [
        ['Apple iPhone 12 128GB', '5G · 超视网膜 XDR 显示屏', '全面屏设计，A14 仿生，支持 5G。国行全网通，以 Apple 中国官网规格为准。'],
        ['Apple iPhone 13 128GB', 'A15 仿生 · 电影效果模式', '更持久续航，电影级浅景深视频，超视网膜 XDR 屏。'],
        ['Apple iPhone 14 128GB', 'A16 仿生 · 运动模式', '新增运动模式防抖，光像引擎优化低光拍摄，安全可靠功能。'],
        ['Apple iPhone 15 128GB', 'A16 仿生 · 灵动岛', '灵动岛交互，USB-C 接口，超瓷晶面板与融色玻璃。'],
        ['Apple iPhone 16 128GB', 'A18 仿生 · 相机控制', '相机控制快捷操作，性能与影像升级（具体以 Apple 中国官网为准）。'],
        ['Apple iPhone 17 256GB', '新一代仿生芯片 · 耐用设计', '最新标准版 iPhone，更大起步容量与续航体验（以官网在售型号为准）。'],
      ],
    },
    {
      category: 'digital',
      items: [
        ['MacBook Air M3', '轻薄办公 · 长续航', '13/15 英寸可选，适合学习与创作。'],
        ['11 英寸平板电脑', '高刷屏 · 多任务', '影音网课与轻办公一机搞定。'],
        ['无线降噪耳机', '通透模式 · 快充', '通勤与运动场景沉浸式听感。'],
        ['智能手表', '健康监测 · 运动模式', '心率血氧与睡眠记录，日常提醒。'],
        ['机械键盘 87 键', '热插拔 · RGB', '段落/线性轴体可选，桌面生产力。'],
        ['27 英寸 4K 显示器', '广色域 · 低蓝光', '设计剪辑与办公清晰细腻。'],
      ],
    },
    {
      category: 'appliance',
      items: [
        ['洗烘一体机 10kg', '变频节能 · 除菌', '省空间一站式洗烘，家庭常用。'],
        ['双开门冰箱 600L', '风冷无霜 · 分区', '大容量囤货，食材分区保鲜。'],
        ['1.5 匹智能空调', '一级能效 · 自清洁', '冷暖快速，远程与语音控制。'],
        ['扫地机器人', '激光导航 · 拖扫一体', '日常地面清洁省心省力。'],
        ['空气炸锅 5L', '少油烹饪 · 预设菜单', '快手菜与健康零食轻松做。'],
        ['厨下净水器', '多级过滤 · 大通量', '直饮安心，换芯提醒更省心。'],
      ],
    },
    {
      category: 'cosmetics',
      items: [
        ['保湿精华水 200ml', '玻尿酸 · 清爽吸收', '妆前打底与日常补水。'],
        ['防晒乳 SPF50+', '轻薄不闷 · 成膜快', '通勤户外防护，敏感肌友好配方请咨询客服。'],
        ['持妆粉底液', '自然遮瑕 · 雾面', '整日服帖，多色号可选。'],
        ['修护眼霜 15g', '淡化干纹 · 滋润', '眼周护理夜间修护。'],
        ['氨基酸洁面乳', '温和清洁 · 不拔干', '早晚洁面基础护理。'],
        ['护手霜礼盒 3 支装', '滋润不腻 · 便携', '秋冬常备，送礼自用皆宜。'],
      ],
    },
  ]
  const prices = {
    phone: PHONE_OFFICIAL_CNY.map((cny) => Math.round(Number(cny) * 1.2)),
    digital: [8999, 1899, 799, 1299, 459, 2199],
    appliance: [3299, 4599, 2799, 1999, 299, 1599],
    cosmetics: [159, 89, 199, 268, 79, 99],
  }
  let i = 0
  for (const block of defs) {
    const cat = block.category
    const plist = prices[cat]
    const covers = COVER_BY_CATEGORY[cat]
    if (!covers || covers.length !== block.items.length) {
      throw new Error(`[seed-mall] 封面数量与商品不一致: ${cat}`)
    }
    block.items.forEach(([name, subtitle, description], idx) => {
      rows.push({
        name,
        subtitle,
        description,
        origin: '中国大陆',
        price: plist[idx],
        image: covers[idx],
        category: cat,
        salesMode: 'mall',
        onSale: true,
        createdAt: now,
        updatedAt: now,
        _sort: i++,
      })
    })
  }
  return rows
}

async function main() {
  if (!mongoConfig.isMongoConfigured() && !mongoConfig.isJsonFallbackAllowed()) {
    console.error('[seed-mall] 请配置 MONGODB_URI，或设置 ALLOW_JSON_FALLBACK=true 以使用 api/data/db.json')
    process.exit(1)
  }

  if (mongoConfig.isMongoConfigured()) {
    await mongo.connectMongo()
    await store.hydrateFromMongoAfterConnect()
  }

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
  const templates = catalogRows()
  const newMall = templates.map((row, idx) => ({
    id: maxId + idx + 1,
    name: row.name,
    subtitle: row.subtitle,
    description: row.description,
    origin: row.origin,
    price: row.price,
    image: row.image,
    category: row.category,
    salesMode: 'mall',
    onSale: true,
    createdAt: now,
    updatedAt: now,
  }))

  const removed = db.products.length - kept.length
  db.products = [...newMall, ...kept]
  store.writeDb(db)

  if (mongoConfig.isMongoConfigured()) {
    await store.flushMongoPersist()
    await mongo.closeMongo()
  }

  console.log('[seed-mall] 已移除 mall 商品:', removed, '条；写入新 mall 商品:', newMall.length, '条；保留非 mall:', kept.length, '条')
}

main().catch((e) => {
  console.error('[seed-mall]', e.message || e)
  process.exit(1)
})
