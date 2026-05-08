export interface TeaProduct {
  id: number
  name: string
  subtitle: string
  description: string
  origin: string
  price: number
  image: string
  category: MallCategoryKey
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

const STATE_PRODUCTS = 'index-tea-products'
/** 已成功完成一次远端 GET 并成功解析 `{ success, data }`（data 可为空数组）；失败永远不置 true，便于登录后进首页仍可重拉 */
const STATE_FETCH_OK = 'index-tea-products-fetch-ok'

const mallCategories: MallCategoryItem[] = [
  { key: 'all', name: '全部', icon: 'tabler:apps' },
  { key: 'travel', name: '旅游产品', icon: 'tabler:plane' },
  { key: 'calligraphy', name: '字画定制', icon: 'tabler:photo' },
  { key: 'mobile', name: '手机通讯', icon: 'tabler:device-mobile' },
  { key: 'jewelry', name: '珠宝黄金', icon: 'tabler:diamond' },
]

function resolveMallApiBase() {
  const runtimeConfig = useRuntimeConfig()
  return runtimeConfig.public.mallApiBase || 'http://localhost:3110/api'
}

function normalizeApiProduct(product: Partial<TeaProduct>): TeaProduct {
  const category = String(product.category || '')
  const resolvedCategory = isMallCategoryKey(category) ? category : 'travel'
  return {
    id: Number(product.id || 0),
    name: String(product.name || ''),
    subtitle: String(product.subtitle || ''),
    description: String(product.description || ''),
    origin: String(product.origin || ''),
    price: Number(product.price || 0),
    image: String(product.image || ''),
    category: resolvedCategory,
    onSale: typeof product.onSale === 'boolean' ? product.onSale : true,
    createdAt: product.createdAt || '',
    updatedAt: product.updatedAt || '',
  }
}

/** 合并并发拉取（多组件 / 路由守卫共用同一 Promise） */
let productsLoadInFlight: Promise<void> | null = null

function buildProductsUrl(base: string) {
  const b = base.replace(/\/$/, '')
  return `${b}/products`
}

function getProductsRefs() {
  const products = useState<TeaProduct[]>(STATE_PRODUCTS, () => [])
  const fetchOk = useState<boolean>(STATE_FETCH_OK, () => false)
  return { products, fetchOk }
}

/**
 * 显式请求 `/products`（可在路由钩子调用）。不会因「finally 误判完成」锁住导致永不请求 Network。
 */
export async function ensureMallProductsLoaded(): Promise<void> {
  if (import.meta.env.SSR) {
    return Promise.resolve()
  }

  const { products, fetchOk } = getProductsRefs()
  if (fetchOk.value) {
    return Promise.resolve()
  }

  if (!productsLoadInFlight) {
    productsLoadInFlight = (async () => {
      let logUrl = ''
      try {
        const base = resolveMallApiBase()
        logUrl = buildProductsUrl(base)
        const response = await $fetch<{ success: boolean, data: TeaProduct[] }>(logUrl, {
          method: 'GET',
        })
        products.value = Array.isArray(response?.data) ? response.data.map(normalizeApiProduct) : []
        fetchOk.value = true
      }
      catch (error) {
        console.error('[商城] 拉取商品失败，请确认 mall-api 已启动且 Vite 代理 / VITE_MALL_API_BASE 正确', logUrl || resolveMallApiBase(), error)
        /** 不写 fetchOk，下次进首页仍可重试 */
        products.value = []
      }
      finally {
        productsLoadInFlight = null
      }
    })()
  }

  return productsLoadInFlight
}

export function useTeaProducts() {
  getProductsRefs()

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

  return useState<TeaProduct[]>(STATE_PRODUCTS, () => [])
}

export function useMallCategories() {
  return mallCategories
}

export function isMallCategoryKey(value: string): value is MallCategoryKey {
  return mallCategories.some(item => item.key === value)
}
