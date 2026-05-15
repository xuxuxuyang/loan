export type ProductSalesMode = 'mall' | 'installment'

/** 商品归属品类（后端/筛选用）；不含 Tab 专有项「全部」「先享后付」 */
export type MallShelfCategoryKey = 'phones' | 'digital' | 'appliances' | 'cosmetics'

export type MallCategoryKey = 'all' | 'installment' | MallShelfCategoryKey

export interface TeaProduct {
  id: number
  name: string
  subtitle: string
  description: string
  origin: string
  price: number
  image: string
  /** 商品详情页展示的多张详情图（URL 或 data URL） */
  detailImages?: string[]
  category: MallShelfCategoryKey
  /** mall=首页商城；installment=先享后付；均可下单 */
  salesMode: ProductSalesMode
  /** 先享后付卡包现金礼金额（元） */
  cardPackageAmount?: number
  onSale?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface MallCategoryItem {
  key: MallCategoryKey
  name: string
  icon: string
  /** 列表页顶部主标题 */
  heroTitle: string
  /** 列表页顶部副文案 */
  heroSubtitle: string
}

const STATE_INSTALLMENT = 'index-tea-products-installment'
const STATE_MALL = 'index-tea-products-mall'
const STATE_FETCH_OK_PREFIX = 'index-tea-products-fetch-ok-'

const mallCategories: MallCategoryItem[] = [
  {
    key: 'all',
    name: '全部',
    icon: 'tabler:apps',
    heroTitle: '全部商品',
    heroSubtitle: '手机数码 · 家电美妆 · 正品速达',
  },
  {
    key: 'installment',
    name: '先享后付',
    icon: 'tabler:credit-card-pay',
    heroTitle: '先享后付',
    heroSubtitle: '先用后付 · 灵活分期 · 正品速达',
  },
  {
    key: 'phones',
    name: '手机',
    icon: 'tabler:device-mobile',
    heroTitle: '手机专区',
    heroSubtitle: '旗舰新品 · 品质通信 · 快速发货',
  },
  {
    key: 'digital',
    name: '数码产品',
    icon: 'tabler:device-laptop',
    heroTitle: '数码产品',
    heroSubtitle: '电脑影音 · 智能配件 · 严选热卖',
  },
  {
    key: 'appliances',
    name: '家用电器',
    icon: 'tabler:fridge',
    heroTitle: '家用电器',
    heroSubtitle: '厨房生活 · 小电大家电 · 送到家',
  },
  {
    key: 'cosmetics',
    name: '化妆品',
    icon: 'tabler:sparkles',
    heroTitle: '美妆护肤',
    heroSubtitle: '口碑爆款 · 温和呵护 · 正品保障',
  },
]

function resolveMallApiBase() {
  const runtimeConfig = useRuntimeConfig()
  return runtimeConfig.public.mallApiBase || '/api'
}

const CATEGORY_LEGACY: Record<string, MallShelfCategoryKey> = {
  travel: 'digital',
  calligraphy: 'digital',
  mobile: 'phones',
  jewelry: 'cosmetics',
  phone: 'phones',
  appliance: 'appliances',
}

const MALL_SHELF_KEYS = new Set<MallShelfCategoryKey>(['phones', 'digital', 'appliances', 'cosmetics'])

function isMallShelfCategoryKey(value: string): value is MallShelfCategoryKey {
  return MALL_SHELF_KEYS.has(value as MallShelfCategoryKey)
}

function resolveShopCategory(raw: string): MallShelfCategoryKey {
  const t = String(raw || '').trim()
  if (isMallShelfCategoryKey(t)) {
    return t
  }
  const mapped = CATEGORY_LEGACY[t]
  if (mapped) {
    return mapped
  }
  return 'phones'
}

function normalizeDetailImagesFromApi(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.map(u => String(u || '').trim()).filter(Boolean)
}

export function normalizeApiProduct(product: Partial<TeaProduct>): TeaProduct {
  const resolvedCategory = resolveShopCategory(String(product.category || ''))
  const sm = String(product.salesMode || 'installment').trim() === 'mall' ? 'mall' : 'installment'
  return {
    id: Number(product.id || 0),
    name: String(product.name || ''),
    subtitle: String(product.subtitle || ''),
    description: String(product.description || ''),
    origin: String(product.origin || ''),
    price: Number(product.price || 0),
    image: String(product.image || ''),
    detailImages: normalizeDetailImagesFromApi(product.detailImages),
    category: resolvedCategory,
    salesMode: sm,
    cardPackageAmount: Math.max(0, Math.round(Number(product.cardPackageAmount) || 0)),
    onSale: typeof product.onSale === 'boolean' ? product.onSale : true,
    createdAt: product.createdAt || '',
    updatedAt: product.updatedAt || '',
  }
}

function buildProductsUrl(base: string, salesMode: ProductSalesMode) {
  const b = base.replace(/\/$/, '')
  return `${b}/products?salesMode=${salesMode}`
}

let installmentLoadInFlight: Promise<void> | null = null
let mallLoadInFlight: Promise<void> | null = null

function getInstallmentRefs() {
  const products = useState<TeaProduct[]>(STATE_INSTALLMENT, () => [])
  const fetchOk = useState<boolean>(`${STATE_FETCH_OK_PREFIX}installment`, () => false)
  return { products, fetchOk }
}

function getMallRefs() {
  const products = useState<TeaProduct[]>(STATE_MALL, () => [])
  const fetchOk = useState<boolean>(`${STATE_FETCH_OK_PREFIX}mall`, () => false)
  return { products, fetchOk }
}

/** 可下单商品（先享后付） */
export async function ensureMallProductsLoaded(): Promise<void> {
  if (import.meta.env.SSR) {
    return Promise.resolve()
  }
  const { products, fetchOk } = getInstallmentRefs()
  if (fetchOk.value) {
    return Promise.resolve()
  }
  if (!installmentLoadInFlight) {
    installmentLoadInFlight = (async () => {
      let logUrl = ''
      try {
        const base = resolveMallApiBase()
        logUrl = buildProductsUrl(base, 'installment')
        const response = await $fetch<{ success: boolean, data: TeaProduct[] }>(logUrl, { method: 'GET' })
        products.value = Array.isArray(response?.data) ? response.data.map(normalizeApiProduct) : []
        fetchOk.value = true
      }
      catch (error) {
        console.error('[商城] 拉取先享后付商品失败', logUrl || resolveMallApiBase(), error)
        products.value = []
      }
      finally {
        installmentLoadInFlight = null
      }
    })()
  }
  return installmentLoadInFlight
}

/** 首页商城分区商品（与先享后付列表分开展示，均可下单） */
export async function ensureMallShowcaseProductsLoaded(): Promise<void> {
  if (import.meta.env.SSR) {
    return Promise.resolve()
  }
  const { products, fetchOk } = getMallRefs()
  if (fetchOk.value) {
    return Promise.resolve()
  }
  if (!mallLoadInFlight) {
    mallLoadInFlight = (async () => {
      let logUrl = ''
      try {
        const base = resolveMallApiBase()
        logUrl = buildProductsUrl(base, 'mall')
        const response = await $fetch<{ success: boolean, data: TeaProduct[] }>(logUrl, { method: 'GET' })
        products.value = Array.isArray(response?.data) ? response.data.map(normalizeApiProduct) : []
        fetchOk.value = true
      }
      catch (error) {
        console.error('[商城] 拉取首页商城商品失败', logUrl || resolveMallApiBase(), error)
        products.value = []
      }
      finally {
        mallLoadInFlight = null
      }
    })()
  }
  return mallLoadInFlight
}

export async function ensureShopHomeProductsLoaded(): Promise<void> {
  await Promise.all([
    ensureMallProductsLoaded(),
    ensureMallShowcaseProductsLoaded(),
  ])
}

export function useTeaProducts() {
  getInstallmentRefs()
  if (!import.meta.env.SSR) {
    const vm = getCurrentInstance()
    if (vm) {
      onMounted(() => {
        void ensureMallProductsLoaded()
      })
    }
    else {
      queueMicrotask(() => {
        void ensureMallProductsLoaded()
      })
    }
  }
  return useState<TeaProduct[]>(STATE_INSTALLMENT, () => [])
}

export function useMallShowcaseProducts() {
  getMallRefs()
  if (!import.meta.env.SSR) {
    const vm = getCurrentInstance()
    if (vm) {
      onMounted(() => {
        void ensureMallShowcaseProductsLoaded()
      })
    }
    else {
      queueMicrotask(() => {
        void ensureMallShowcaseProductsLoaded()
      })
    }
  }
  return useState<TeaProduct[]>(STATE_MALL, () => [])
}

export function useMallCategories() {
  return mallCategories
}

export function isMallCategoryKey(value: string): value is MallCategoryKey {
  return mallCategories.some(item => item.key === value)
}
