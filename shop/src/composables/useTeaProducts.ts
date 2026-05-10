export type ProductSalesMode = 'mall' | 'installment'

export interface TeaProduct {
  id: number
  name: string
  subtitle: string
  description: string
  origin: string
  price: number
  image: string
  category: MallCategoryKey
  /** mall=仅展示；installment=可下单 */
  salesMode: ProductSalesMode
  onSale?: boolean
  createdAt?: string
  updatedAt?: string
}

export type MallCategoryKey = 'all' | 'travel' | 'calligraphy' | 'mobile' | 'jewelry'

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
  { key: 'travel', name: '旅游产品', icon: 'tabler:plane' },
  { key: 'calligraphy', name: '字画定制', icon: 'tabler:photo' },
  { key: 'mobile', name: '手机通讯', icon: 'tabler:device-mobile' },
  { key: 'jewelry', name: '珠宝黄金', icon: 'tabler:diamond' },
]

function resolveMallApiBase() {
  const runtimeConfig = useRuntimeConfig()
  return runtimeConfig.public.mallApiBase || '/api'
}

function normalizeApiProduct(product: Partial<TeaProduct>): TeaProduct {
  const category = String(product.category || '')
  const resolvedCategory = isMallCategoryKey(category) ? category : 'travel'
  const sm = String(product.salesMode || 'installment').trim() === 'mall' ? 'mall' : 'installment'
  return {
    id: Number(product.id || 0),
    name: String(product.name || ''),
    subtitle: String(product.subtitle || ''),
    description: String(product.description || ''),
    origin: String(product.origin || ''),
    price: Number(product.price || 0),
    image: String(product.image || ''),
    category: resolvedCategory,
    salesMode: sm,
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

/** 可下单商品（分期专区） */
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
        console.error('[商城] 拉取分期商品失败', logUrl || resolveMallApiBase(), error)
        products.value = []
      }
      finally {
        installmentLoadInFlight = null
      }
    })()
  }
  return installmentLoadInFlight
}

/** 仅展示商品（商城专区） */
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
        console.error('[商城] 拉取展示商品失败', logUrl || resolveMallApiBase(), error)
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
