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

export function useTeaProducts() {
  const products = useState<TeaProduct[]>('index-tea-products', () => [])
  const synced = useState<boolean>('index-tea-products-synced', () => false)

  const syncFromApi = async () => {
    try {
      const response = await $fetch<{ success: boolean, data: TeaProduct[] }>(`${resolveMallApiBase()}/products`, {
        method: 'GET',
      })
      products.value = Array.isArray(response?.data) ? response.data.map(normalizeApiProduct) : []
    }
    catch (error) {
      console.error('读取商品接口失败', error)
      products.value = []
    }
  }

  if (import.meta.client && !synced.value) {
    synced.value = true
    void syncFromApi()
  }

  return products
}

export function useMallCategories() {
  return mallCategories
}

export function isMallCategoryKey(value: string): value is MallCategoryKey {
  return mallCategories.some(item => item.key === value)
}
