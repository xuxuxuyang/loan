export type MallOrderStatus = 'reviewing' | 'shipping' | 'receiving' | 'enjoying'
export type MallPayType = 'installment' | 'full'
export type MallPayChannel = 'wechat' | 'alipay' | 'card'

export interface MallOrder {
  id: string
  productId: number
  name: string
  spec: string
  totalAmount: number
  createdAt: string
  status: MallOrderStatus
  paid: boolean
  payType: MallPayType
  payChannel: MallPayChannel
  receiverName: string
  receiverPhone: string
  receiverAddress: string
}

interface CreateOrderPayload {
  productId: number
  name: string
  spec: string
  totalAmount: number
  status: MallOrderStatus
  paid: boolean
  payType: MallPayType
  payChannel: MallPayChannel
  receiverName: string
  receiverPhone: string
  receiverAddress: string
}

const ORDER_STORAGE_KEY = 'mall-orders'
const ORDER_REMOTE_PATH = '/orders'

function resolveMallApiBase() {
  const runtimeConfig = useRuntimeConfig()
  return runtimeConfig.public.mallApiBase || 'http://localhost:3110/api'
}

function saveOrdersToStorage(orders: MallOrder[]) {
  if (!import.meta.client) {
    return
  }
  localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(orders))
}

export function formatMallOrderTime(createdAt: string) {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) {
    return createdAt
  }
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return formatter.format(date).replace(/\//g, '-')
}

export function useMallOrders() {
  const orders = useState<MallOrder[]>('mall-orders', () => [])
  const initialized = useState<boolean>('mall-orders-initialized', () => false)
  const syncingRemote = useState<boolean>('mall-orders-remote-syncing', () => false)

  const syncFromStorage = () => {
    if (!import.meta.client || initialized.value) {
      return
    }
    // 订单以接口为单一数据源，主动清除历史本地缓存避免脏数据回流。
    localStorage.removeItem(ORDER_STORAGE_KEY)
    initialized.value = true
  }

  const syncFromRemote = async () => {
    if (!import.meta.client || syncingRemote.value) {
      return
    }

    syncingRemote.value = true
    try {
      const response = await $fetch<{ success: boolean, data: MallOrder[] }>(`${resolveMallApiBase()}${ORDER_REMOTE_PATH}`, {
        method: 'GET',
      })
      if (Array.isArray(response?.data)) {
        orders.value = response.data
        saveOrdersToStorage(orders.value)
      }
    }
    catch (error) {
      console.error('同步远端订单失败', error)
    }
    finally {
      syncingRemote.value = false
    }
  }

  const saveToRemote = async () => {
    if (!import.meta.client) {
      return
    }
    // 历史兼容：保留方法，但订单写入走 createOrder / markOrderPaid。
  }

  const createOrder = async (payload: CreateOrderPayload) => {
    const response = await $fetch<{ success: boolean, data: MallOrder }>(`${resolveMallApiBase()}${ORDER_REMOTE_PATH}`, {
      method: 'POST',
      body: payload,
    })
    const order = response.data
    orders.value = [order, ...orders.value.filter(item => item.id !== order.id)]
    saveOrdersToStorage(orders.value)
    return order
  }

  const markOrderPaid = async (orderId: string, payChannel: MallPayChannel) => {
    await $fetch<{ success: boolean, data: MallOrder }>(`${resolveMallApiBase()}${ORDER_REMOTE_PATH}/${orderId}/pay`, {
      method: 'PATCH',
      body: { payChannel },
    })
    await syncFromRemote()
    saveOrdersToStorage(orders.value)
  }

  if (import.meta.client && !initialized.value) {
    syncFromStorage()
    void syncFromRemote()
  }

  return {
    orders,
    syncFromStorage,
    syncFromRemote,
    saveToRemote,
    createOrder,
    markOrderPaid,
  }
}
