export interface TeaProduct {
  id: number
  name: string
  subtitle: string
  description: string
  origin: string
  price: number
  image: string
  category: MallCategoryKey
}

export type MallCategoryKey = 'all' | 'travel' | 'calligraphy' | 'mobile' | 'jewelry'

export interface MallCategoryItem {
  key: MallCategoryKey
  name: string
  icon: string
}

const mallCategories: MallCategoryItem[] = [
  { key: 'all', name: '全部', icon: 'tabler:apps' },
  { key: 'travel', name: '旅游产品', icon: 'tabler:plane' },
  { key: 'calligraphy', name: '字画定制', icon: 'tabler:photo' },
  { key: 'mobile', name: '手机通讯', icon: 'tabler:device-mobile' },
  { key: 'jewelry', name: '珠宝黄金', icon: 'tabler:diamond' },
]

const teaProducts: TeaProduct[] = [
  {
    id: 1,
    name: '三亚海岛自由行',
    subtitle: '五星海景酒店，往返机票',
    description: '含双人机酒套餐与接送机服务，支持节假日预约，适合家庭与情侣出游。',
    origin: '海南三亚',
    price: 3980,
    image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1400&q=80',
    category: 'travel',
  },
  {
    id: 2,
    name: '云南丽江慢游套票',
    subtitle: '古城客栈，玉龙雪山一日游',
    description: '含三晚精品客栈和景区联票，行程轻松，附赠当地特色接待服务。',
    origin: '云南丽江',
    price: 3280,
    image: 'https://images.unsplash.com/photo-1501555088652-021faa106b9b?auto=format&fit=crop&w=1400&q=80',
    category: 'travel',
  },
  {
    id: 3,
    name: '日本关西深度游',
    subtitle: '大阪+京都+奈良，中文导览',
    description: '热门关西路线，覆盖经典打卡地，含境外意外险与签证代办咨询。',
    origin: '日本关西',
    price: 5680,
    image: 'https://images.unsplash.com/photo-1492571350019-22de08371fd3?auto=format&fit=crop&w=1400&q=80',
    category: 'travel',
  },
  {
    id: 4,
    name: '行书书法定制',
    subtitle: '名家手写，支持题字落款',
    description: '可定制家训、店名、赠礼祝词，宣纸装裱可选，支持视频验稿确认。',
    origin: '江苏苏州',
    price: 1280,
    image: 'https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=1400&q=80',
    category: 'calligraphy',
  },
  {
    id: 5,
    name: '国画山水定制',
    subtitle: '写意山水，客厅装饰推荐',
    description: '根据空间尺寸定制构图，附高清电子版，支持送礼包装与署名题跋。',
    origin: '安徽黄山',
    price: 2280,
    image: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&w=1400&q=80',
    category: 'calligraphy',
  },
  {
    id: 6,
    name: '篆刻印章礼盒',
    subtitle: '石章雕刻，商务收藏佳选',
    description: '提供姓名章、闲章与篆刻设计，含锦盒包装，适合商务往来与收藏。',
    origin: '浙江杭州',
    price: 980,
    image: 'https://images.unsplash.com/photo-1518834107812-67b0b7c58434?auto=format&fit=crop&w=1400&q=80',
    category: 'calligraphy',
  },
  {
    id: 7,
    name: '旗舰智能手机 Pro',
    subtitle: '2K屏幕，影像系统升级',
    description: '新一代旗舰芯片与大底主摄，支持双卡5G与超快充，提供官方保修。',
    origin: '深圳',
    price: 5299,
    image: 'https://images.unsplash.com/photo-1598327105666-5b89351aff97?auto=format&fit=crop&w=1400&q=80',
    category: 'mobile',
  },
  {
    id: 8,
    name: '轻薄商务手机 Air',
    subtitle: '超轻机身，全天候续航',
    description: '主打轻薄手感与稳定续航，支持NFC与双扬声器，适合商务通勤场景。',
    origin: '上海',
    price: 3699,
    image: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1400&q=80',
    category: 'mobile',
  },
  {
    id: 9,
    name: '折叠屏手机 Fold',
    subtitle: '大屏办公，多任务高效',
    description: '内外双屏设计，支持分屏协作与手写笔，适合内容创作与移动办公。',
    origin: '北京',
    price: 8999,
    image: 'https://images.unsplash.com/photo-1580910051074-3eb694886505?auto=format&fit=crop&w=1400&q=80',
    category: 'mobile',
  },
  {
    id: 10,
    name: '足金转运珠手链',
    subtitle: '足金工艺，简约百搭',
    description: '足金打造，细腻抛光处理，支持刻字定制，附国检证书与礼盒包装。',
    origin: '深圳水贝',
    price: 2680,
    image: 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=1400&q=80',
    category: 'jewelry',
  },
  {
    id: 11,
    name: '钻石锁骨链',
    subtitle: '18K金镶嵌，闪耀日常',
    description: '甄选小克拉天然钻石，日常佩戴精致百搭，支持免费改链长服务。',
    origin: '广州番禺',
    price: 4899,
    image: 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=1400&q=80',
    category: 'jewelry',
  },
  {
    id: 12,
    name: '和田玉平安扣',
    subtitle: '温润细腻，寓意平安',
    description: '甄选和田玉料，手工打磨抛光，附鉴定证书，礼赠自戴皆宜。',
    origin: '新疆和田',
    price: 1999,
    image: 'https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=1400&q=80',
    category: 'jewelry',
  },
]

function shuffleProducts(list: TeaProduct[]) {
  const copied = [...list]

  for (let index = copied.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    const current = copied[index]
    const random = copied[randomIndex]

    if (!current || !random) {
      continue
    }

    copied[index] = random
    copied[randomIndex] = current
  }

  return copied
}

export function useTeaProducts() {
  return useState<TeaProduct[]>('index-tea-products', () => shuffleProducts(teaProducts))
}

export function useMallCategories() {
  return mallCategories
}

export function isMallCategoryKey(value: string): value is MallCategoryKey {
  return mallCategories.some(item => item.key === value)
}
