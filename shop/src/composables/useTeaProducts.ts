export type ProductSalesMode = 'mall' | 'installment'

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
  category: MallCategoryKey
  /** mall=首页商城；installment=先享后付；均可下单 */
  salesMode: ProductSalesMode
  /** 先享后付卡包现金礼金额（元） */
  cardPackageAmount?: number
  onSale?: boolean
  createdAt?: string
  updatedAt?: string
}

export type MallCategoryKey = 'all' | 'phones' | 'digital' | 'appliances' | 'cosmetics'

export interface MallCategoryItem {
  key: MallCategoryKey
  name: string
  icon: string
}

const STATE_INSTALLMENT = 'index-tea-products-installment'
const STATE_MALL = 'index-tea-products-mall'
const STATE_FETCH_OK_PREFIX = 'index-tea-products-fetch-ok-'

const mallCategories: MallCategoryItem[] = [
  { key: 'all', name: '全部', icon: 'tabler:apps' },
  { key: 'phones', name: '手机', icon: 'tabler:device-mobile' },
  { key: 'digital', name: '数码产品', icon: 'tabler:device-laptop' },
  { key: 'appliances', name: '家用电器', icon: 'tabler:fridge' },
  { key: 'cosmetics', name: '化妆品', icon: 'tabler:sparkles' },
]

function resolveMallApiBase() {
  const runtimeConfig = useRuntimeConfig()
  return runtimeConfig.public.mallApiBase || '/api'
}

const CATEGORY_LEGACY: Record<string, MallCategoryKey> = {
  travel: 'digital',
  calligraphy: 'digital',
  mobile: 'phones',
  jewelry: 'cosmetics',
  phone: 'phones',
  appliance: 'appliances',
}

function resolveShopCategory(raw: string): MallCategoryKey {
  const t = String(raw || '').trim()
  if (isMallCategoryKey(t) && t !== 'all') {
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
