/**
 * One-off helper: writes api/data/mall-zone-products.seed.json
 * Run from repo root: node api/scripts/write-mall-zone-seed.js
 *
 * import-mall-zone-seed.js 仅映射固定字段录入数据库；本条 JSON 中下划线字段仅作校对用。
 */
const fs = require('node:fs')
const path = require('node:path')

const outPath = path.join(__dirname, '..', 'data', 'mall-zone-products.seed.json')

const doc = {
  generatedAt: '2026-05-19',
  _comment:
    '商城专区 mall 种子：name/subtitle/description 仅面向顾客的官网式文案（勿写调价规则）。价差由 price 字段体现；_officialCnyReference 仅供内部校对，不入库。',
  products: [
    // --- phones (Apple)
    {
      name: 'iPhone 17 Pro 256GB 银色',
      subtitle: '钛金属设计 · Pro 级影像 · A19 Pro 芯片 · 超长电池续航',
      description:
        '256GB，银色饰面。搭载 A19 Pro 芯片与进阶版 Pro 摄像头系统（含 4800 万像素 Fusion 摄像头等）；采用钛金属外观设计，配备操作按钮与相机控制。支持新一代人像功能与突破性视频画质。在中国大陆可使用双 nano‑SIM 蜂窝网络。功能与支持频段以苹果公司在中国大陆官网机型技术规格为准。',
      origin: '中国大陆',
      price: 11999,
      category: 'phone',
      image:
        'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/iphone-17-pro-finish-select-silver-202509_AV2?wid=724&hei=540&fmt=jpeg&qlt=90&.v=NUNzdzNKR0FJbmhKWm5YamRHb05tVGJOdEdsYjE3KzExOGFjT0NXdW5CR0ZuR0xSWXBlNjhaVFk2ZGJNSGE3NEVrYzZ4aGx2Q085bnhRaVROeFdKVDdrNkxqcEdrM2x6OUZ3Z2JnTllhUVBsaDdVbyt6ZHpBMTRqaGk0VVUxTnE',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 9999,
      _officialUrl: 'https://www.apple.com.cn/shop/buy-iphone/iphone-17-pro/MG034CH/A',
    },
    {
      name: 'iPhone Air 256GB 云白色',
      subtitle: '超薄设计 · A19 Pro 芯片 · 陶瓷盾前面板 · 支持 eSIM',
      description:
        '256GB，云白色饰面。以纤薄轻巧为主打的全面屏 iPhone，搭载 A19 Pro 芯片与美国康宁联合研发的陶瓷盾玻璃；配备支持自动对焦的前置摄像头、融合式主摄与超长焦摄像头。在中国大陆仅可使用 eSIM（无实体 nano-SIM 卡槽）；运营商与入网方式以苹果公司说明为准。',
      origin: '中国大陆',
      price: 9599,
      category: 'phone',
      image:
        'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/iphone-air-finish-select-cloudwhite-202509_AV2?wid=724&hei=540&fmt=jpeg&qlt=90&.v=NUpaQVl1bitSNmJWZUdKdi9QZHhsTS8xdU11cWJCczZ1VVpEY09DWGZFdS9vQm9BbU9iTXhwOWJWSlZnMHdabzVIZlkyUVhTaG1vWWJFN2NXNUI3d0w2TGhYaGhMVkJpQ2RGWWVURTZNbXduOTZFQklBa1M3UUxXZjlYeTJScDI',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 7999,
      _officialUrl: 'https://www.apple.com.cn/shop/buy-iphone/iphone-air/MG334CH/A',
    },
    {
      name: 'iPhone 17 512GB 黑色',
      subtitle: 'A19 芯片 · 双摄系统 · 6.3 英寸超视网膜屏 · 抗水防尘',
      description:
        '512GB，黑色饰面。灵动岛全面屏，搭载 A19 芯片与双摄系统；支持人像模式、夜间模式与人像光效等常用拍摄场景，视频支持杜比视界。支持双 nano-SIM 在中国大陆使用。',
      origin: '中国大陆',
      price: 9599,
      category: 'phone',
      image:
        'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/iphone-17-finish-select-black-202509_AV2?wid=724&hei=540&fmt=jpeg&qlt=90&.v=WGdCRlQ0YVlqbTdXTEkxRnVQb0oxb2VRRjNicDE2eUYxNWtxdDZEUE9tUjZxZmJIdzBBQWpZVTVJdFRoUUcxVloyU1hvUEtRbDVNbTllSjBLTk1lc0Q2K3c3eDN1QlVKV09nQzhyNmV5TTFHQlJWZzByU21DbUFERkJnRlpYeEw',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 7999,
      _officialUrl: 'https://www.apple.com.cn/shop/buy-iphone/iphone-17/MG724CH/A',
    },
    {
      name: 'iPhone 17 256GB 薰衣草紫色',
      subtitle: 'A19 芯片 · 流体玻璃饰面 · 相机控制',
      description:
        '256GB，薰衣草紫色饰面。灵动岛全面屏，配备操作按钮；搭载 A19 芯片与双摄系统，支持人像与夜间等拍摄场景。防尘、抗飞溅、抗水能力与防护等级请参阅苹果公司在中国大陆公布的技术规格。',
      origin: '中国大陆',
      price: 7199,
      category: 'phone',
      image:
        'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/iphone-17-finish-select-lavender-202509_AV2?wid=724&hei=540&fmt=jpeg&qlt=90&.v=WGdCRlQ0YVlqbTdXTEkxRnVQb0oxcUlHcmZkMUl0cGRrS2JXMzRCZWNFazhoSGozaDhHYjRWeWk3WVBoTXNuNnppRFFUQWNsM2txTVJoMG04WVAwREFYUldRZVYxMHFkRFZrQVZuaWMwSkR4MllpU2FhU1VMNEZndkhvL0N1bFc',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 5999,
      _officialUrl: 'https://www.apple.com.cn/shop/buy-iphone/iphone-17/MG704CH/A',
    },
    {
      name: 'iPhone 16 Plus 128GB 群青色',
      subtitle: '6.7 英寸显示屏 · A18 芯片 · 相机控制',
      description:
        '128GB，群青色饰面。配备操作按钮与相机控制；双摄系统可满足日常与高画质照片、视频的需要。在中国大陆支持双 nano-SIM。',
      origin: '中国大陆',
      price: 7199,
      category: 'phone',
      image:
        'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/iphone-16-plus-teal-select-202409_AV2?wid=750&hei=506&fmt=jpeg&qlt=90&.v=eDZ4TmIwZjhkZTBEY1FWRFo2MS9LbGFmbVd6K1RXMWxjdEkrQVBucngrbzBheEFod0h5bjlZMy9HdThwTGxyN0NFTWIwNkMxdkxTeHZVcnJSRDJJeGJSRU41dGlmYUdSR0xmUHJvbWIrb2NYWnlkQXFhaVVyYVFKSUFQUTdBKzM',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 5999,
      _officialUrl: 'https://www.apple.com.cn/shop/buy-iphone/iphone-16/MXUD3CH/A',
    },
    {
      name: 'iPhone 16 128GB 白色',
      subtitle: 'A18 芯片 · 双摄系统 · 灵动岛全面屏',
      description:
        '128GB，白色饰面。搭载 A18 芯片与双摄系统；配备灵动岛与铝金属外观设计。在中国大陆支持双 nano-SIM。',
      origin: '中国大陆',
      price: 7199,
      category: 'phone',
      image:
        'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/iphone-16-finish-select-202409-6-7inch-white?wid=750&hei=750&fmt=jpeg&qlt=90&.v=1726132045369',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 5999,
      _officialUrl: 'https://www.apple.com.cn/shop/buy-iphone/iphone-16/MXUA3CH/A',
    },
    // --- digital (Apple)
    {
      name: 'MacBook Air 13 英寸 (M5) 512GB 天蓝色',
      subtitle: 'M5 · 最长可达 24 小时的电池续航 · Liquid 视网膜显示屏 · 触控 ID',
      description:
        '13.6 英寸 Liquid 视网膜显示屏（支持十亿色彩和 P3 广色域）。搭载 Apple M5 芯片（本配置内置 16GB 统一内存与 512GB 固态硬盘）。配备 1080p FaceTime HD 摄像头、妙控键盘、触控 ID 与多款雷雳/USB 4 端口。最长可达苹果官网公布的电池使用时间（视使用场景而异）。重量与整机尺寸请参阅苹果公司在中国大陆的技术规格。',
      origin: '中国大陆',
      price: 10199,
      category: 'digital',
      image:
        'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/macbook-air-specs-select-202601-13inch-skyblue?wid=1200&hei=630&fmt=jpeg&qlt=95&.v=1767641167679',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 8499,
      _officialUrl:
        'https://www.apple.com.cn/shop/buy-mac/macbook-air/13-inch-sky-blue-m5-chip-10-core-cpu-8-core-gpu-16gb-memory-512gb-storage',
    },
    {
      name: 'iPad mini（第六代）无线局域网机型 64GB',
      subtitle: '8.3 英寸 Liquid 视网膜屏 · A15 仿生芯片 · USB-C',
      description:
        '8.3 英寸全面屏设计，Liquid 视网膜显示屏与 P3 广色域。搭载 A15 仿生芯片（6 核中央处理器与 5 核图形处理器）；主摄与支持人物居中的自适应超广角前置摄像头可满足日常文档与视频会议。触控 ID 置于顶部按钮，整机配备 USB‑C 接口。无线网络与蜂窝机型差异以苹果公司说明为准。',
      origin: '中国大陆',
      price: 4799,
      category: 'digital',
      image:
        'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/ipad-mini-finish-unselect-gallery-1-202410?wid=1200&hei=630&fmt=jpeg&qlt=95&.v=1727219500737',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 3999,
      _officialUrl: 'https://www.apple.com.cn/shop/buy-ipad/ipad-mini',
    },
    {
      name: '11 英寸 iPad Pro (M4) 无线局域网机型',
      subtitle: '超薄设计 · Liquid 视网膜屏 · Apple M4 芯片 · 雷雳/USB 4',
      description:
        '11 英寸型号的 iPad Pro 搭载超精视网膜 XDR 显示屏与高动态范围；配备 M4 芯片，适合照片与视频等专业工作流以及日常多任务处理。后置与前置摄像头组合支持多款专业视频与视频会议功能。图示为浅色外观的无线局域网机型，容量与镌刻等选项请参阅苹果公司在中国大陆的产品页面。',
      origin: '中国大陆',
      price: 10799,
      category: 'digital',
      image:
        'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/ipad-pro-11-witb-silver-wifi-202405?wid=580&hei=680&fmt=jpeg&qlt=90&.v=VmZyMGJaRGRneGVrVWdYK1BVR3BXaVk0c0hkN3lReVJLSEkvRXJBKzVzckdwREFPMWxlOFZXNFh3a1p6b3Q3eFMwWnZwL3FIMTFsdjJkaGdCV1RvWXZIWi9hVnZnV1JzWWp4b1VEcVo3WXZyUFFmcmlSNjk2c1VNbWU1bU9lTnM',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 8999,
      _officialUrl: 'https://www.apple.com.cn/shop/buy-ipad/ipad-pro',
    },
    {
      name: '11 英寸 iPad Air 无线局域网机型',
      subtitle: 'M 系列芯片 · Liquid 视网膜屏 · 横向前置广角 · USB-C',
      description:
        '11 英寸型号采用全面屏 Liquid 视网膜显示屏与支持人物居中的广角前置摄像头。搭配 Apple Pencil（通过官网确认兼容代数）与外接键盘可满足笔记、绘图与工作效率需求。无线网络与可用的存储选项以在中国市场销售的配置为准。',
      origin: '中国大陆',
      price: 5759,
      category: 'digital',
      image:
        'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/ipad-air-witb-purple-11in-wifi-202405?wid=640&hei=680&fmt=jpeg&qlt=90&.v=dzJtY0gyTUNmY0dCc1NRTUtvblJvTHZTclJ3OHdXallQVjRIYXMwVzZ0OHJoMlAvYlErMC91VWE4WXF3M2ZkS0ZhcFd6czV0TmRENDc1UlFkM2ZEdlJLVXk4N0laVjhXWHRqL2ZqeDBCRUxZSlFJWXpOQ1NlbjVJUm1JMk5walM',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 4799,
      _officialUrl: 'https://www.apple.com.cn/shop/buy-ipad/ipad-air',
    },
    {
      name: 'AirPods（第四代），支持主动降噪',
      subtitle: 'H2 芯片 · 主动降噪 · 自适应音频 · 个性化空间音频',
      description:
        '搭载 Apple H2 芯片，支持透明模式与主动降噪、自适应音频、对话感知与个性化音量等聆听体验。上述音频功能须搭配兼容的苹果公司软件与支持机型使用，请参阅产品附带说明与公司中国大陆官网。',
      origin: '中国大陆',
      price: 1679,
      category: 'digital',
      image:
        'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/airpods-4-select-202409?wid=700&hei=700&fmt=jpeg&qlt=90',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 1399,
      _officialUrl: 'https://www.apple.com.cn/airpods/',
    },
    {
      name: 'HomePod mini（橙色）',
      subtitle: '全频驱动单元 · 四麦克风 · Siri · 隔空播放',
      description:
        '小巧外形下提供 360° 音频；多台 HomePod mini 可组成立体声对，带来更宽阔的声场。智能家居与隔空播放等功能需与支持的家庭 App、iOS 设备及网络环境配合，详见苹果公司说明。',
      origin: '中国大陆',
      price: 899,
      category: 'digital',
      image:
        'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/homepod-mini-select-orange-202110?wid=640&hei=640&fmt=jpeg&qlt=90',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 749,
      _officialUrl: 'https://www.apple.com.cn/homepod-mini/',
    },
    // --- appliances（米家大件，小米 CDN 图示）
    {
      name: '米家冰箱 对开门 636L（BCD-636WKMP）',
      subtitle: '风冷无霜 · 变频节能 · 646mm 厚度 · 分区精储',
      description:
        '对开门大容量设计，风冷无霜，避免食材结霜粘连；内置控温与静音运行，适合家庭日常冷藏冷冻分区存储。能效与噪音、内部结构以小米商城该款商品页与说明书为准。',
      origin: '中国大陆',
      price: 2279,
      category: 'appliance',
      image: 'https://cdn.cnbj1.fds.api.mi-img.com/mi-mall/9092bab053cfce13cbeac92ae3cb31e0.png',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 1899,
      _officialUrl: 'https://www.mi.com/mijia-refrigerator-636/specs',
    },
    {
      name: '米家空调 巨省电 Pro 立式 3 匹（超一级能效）',
      subtitle: '超一级能效 · 双缸压缩机 · 广域送风 · 米家远程控制',
      description:
        '柜机形式，适合大空间快速制冷制热；高能效设计有助于降低长时间使用能耗。支持澎湃智联与米家 App 远程操作与场景联动。具体匹数、能效标识、安装要求以小米商城该款商品页与能效贴为准。',
      origin: '中国大陆',
      price: 6599,
      category: 'appliance',
      image:
        'https://cdn.cnbj1.fds.api.mi-img.com/mi-mall/e5bc8371b1e2efb551605cf2eb1baa87.png',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 5499,
      _officialUrl: 'https://www.mi.com/mijia-air-cond-cabinets/save-electricity-pro/specs',
    },
    {
      name: '米家分区洗衣机 Pro 滚筒 10kg（XQG105MJ101）',
      subtitle: '分区独立洗 · DD 直驱电机 · 超薄嵌入',
      description:
        '多区独立洗涤，减少串色与交叉感染；直驱电机运转平稳、噪音较低。洗涤程序、洗净比、用水量与安装尺寸以小米说明书与商城参数表为准。',
      origin: '中国大陆',
      price: 5639,
      category: 'appliance',
      image: 'https://cdn.cnbj1.fds.api.mi-img.com/mi-mall/e572a5faf66af872ede51445bc52a125.png',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 4699,
      _officialUrl: 'https://www.mi.com/mijia-3zone-washer-pro-10kg/specs',
    },
    {
      name: '米家冰箱 Pro 微冰鲜 双系统 十字平嵌 560L 冰晶白',
      subtitle: '60cm 标准柜体平嵌 · 双系统 · 主动制冰',
      description:
        '十字四门与平嵌式设计，适配常见厨房柜体深度；独立双系统可减少串味并更好保持不同温区保鲜。内置制冰等增值功能请以该款上市配置与说明书为准。',
      origin: '中国大陆',
      price: 8399,
      category: 'appliance',
      image: 'https://cdn.cnbj1.fds.api.mi-img.com/mi-mall/278274069c3521eaa960abcf668d4a4d.png',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 6999,
      _officialUrl: 'https://www.mi.com/shop/buy?product_id=1230804802&cfrom=search',
    },
    {
      name: '米家洗衣机 Pro 蓝氧洗烘 12kg',
      subtitle: '洗烘一体 · DD 电机 · 蓝氧护洗程序',
      description:
        '大容量滚筒洗烘一体机，可满足大家庭日常衣物洗护；蓝氧类程序有助于去污与护色，具体洗涤模式、烘干能力与能耗请参照能效标识与附带说明书。',
      origin: '中国大陆',
      price: 3359,
      category: 'appliance',
      image: 'https://cdn.cnbj1.fds.api.mi-img.com/mi-mall/9eecffb5bc87201ca5ab0383bfd2037b.png',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 2799,
      _officialUrl: 'https://www.mi.com/mijia-wash-dryers/clean-ultra-12kg/specs',
    },
    {
      name: '米家空气净化器',
      subtitle: '高效滤芯 · 低噪睡眠档 · 米家智联',
      description:
        '适用于卧室与客厅等小至中等面积的空气净化场景；可多档风速调节并通过米家 App 查看滤芯寿命与定时任务。颗粒物与气态污染物净化能力请在小米商城该款商品页的 CADR、CCM、适用面积等认证参数为准。',
      origin: '中国大陆',
      price: 839,
      category: 'appliance',
      image:
        'https://cdn.cnbj0.fds.api.mi-img.com/b2c-mimall-media/e997ed31cd5199ec0a24eeb48a37b1e7.jpg',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 699,
      _officialUrl: 'https://www.mi.com/',
    },
    // --- cosmetics / 美妆护肤（图示为多用途静物素材；文字对齐各品牌大中华区常见官宣口径）
    {
      name: '雅诗兰黛特润修护肌活精华露',
      subtitle: '明星「小棕瓶」· 彻夜修护 · 焕现细腻透亮',
      description:
        '雅诗兰黛明星修护精华液，可帮助肌肤锁水保湿、柔嫩平滑；适用于夜间与日间护肤流程中的精华步骤。使用前请先做局部试用；孕产妇与敏感肌请遵医嘱。原产国（地区）请以包装标示为准。',
      origin: '中国大陆',
      price: 1159,
      category: 'cosmetics',
      image:
        'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=800&q=85',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 960,
      _officialUrl: 'https://www.esteelauder.com.cn/',
    },
    {
      name: '兰蔻全新精华肌底液',
      subtitle: '「小黑瓶」· 维稳修护 · 强韧屏障 · 清透易吸收',
      description:
        '帮助调理肤质、提升后续护肤吸收；清爽的蛋清质地适合多种肤质日常使用。使用效果因人而异；请避开眼周伤口，出现异常请停用并咨询皮肤科医师。',
      origin: '中国大陆',
      price: 1109,
      category: 'cosmetics',
      image:
        'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?auto=format&fit=crop&w=800&q=85',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 920,
      _officialUrl: 'https://www.lancome.com.cn/',
    },
    {
      name: 'SK-II 护肤精华露',
      subtitle: 'PITERA™ 匠心配方 · 调理角质 · 水感清透',
      description:
        '含经典 PITERA™ 发酵精华与水润保湿成分，令肌肤呈现晶莹通透感。可于洁面后轻拍全脸与颈部做为精华水步骤。使用前请阅读包装成分表与注意事项。',
      origin: '日本',
      price: 2029,
      category: 'cosmetics',
      image:
        'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=800&q=85',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 1690,
      _officialUrl: 'https://www.sk-ii.com/',
    },
    {
      name: '海蓝之谜修护精萃水',
      subtitle: '满蕴灵魂成分 神奇活性精萃 Miracle Broth™ · 沁润焕活 · 为后续修护打底',
      description:
        '海蓝之谜明星精华水质地丝滑清透，轻拍间为肌肤补水保湿并焕活柔嫩触感，帮助后续精华液与乳霜更好吸收。请根据肤质与季节调整用量。',
      origin: '美国',
      price: 1549,
      category: 'cosmetics',
      image:
        'https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?auto=format&fit=crop&w=800&q=85',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 1290,
      _officialUrl: 'https://www.cremedelamer.com/',
    },
    {
      name: '圣罗兰细管纯口红',
      subtitle: '皮革哑光质感 · 高显色一笔成型 · 多种明星色号可选',
      description:
        '经典细管造型设计，柔滑遮盖唇色，哑光妆效持久不脱妆感（实际持妆因人而异）。使用前可用润唇膏打底以减少干燥感。',
      origin: '法国',
      price: 439,
      category: 'cosmetics',
      image:
        'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=800&q=85',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 360,
      _officialUrl: 'https://www.yslbeauty.com/',
    },
    {
      name: '纪梵希明星四宫格散粉',
      subtitle: '四色糅合定妆 · 柔焦雾面 · 持久控油清透',
      description:
        '四色随行搭配，轻拍即可均匀肤色、定妆控油并让底妆更清透自然。色号与珠光/哑光配比以专柜或官方渠道在售版本为准。',
      origin: '法国',
      price: 659,
      category: 'cosmetics',
      image:
        'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?auto=format&fit=crop&w=800&q=85',
      detailImages: [],
      cardPackageAmount: 0,
      _officialCnyReference: 550,
      _officialUrl: 'https://www.givenchybeauty.com/',
    },
  ],
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(doc, null, 2))
console.log('[write-mall-zone-seed] wrote', doc.products.length, 'products to', outPath)

/** 拷贝到小程序/商城 dev server 可直接访问的路径，便于 static 预览 */
const shopSeed = path.join(__dirname, '..', '..', 'shop', 'public', 'mall-zone-products.seed.json')
fs.mkdirSync(path.dirname(shopSeed), { recursive: true })
fs.copyFileSync(outPath, shopSeed)
console.log('[write-mall-zone-seed] copied to', shopSeed)
