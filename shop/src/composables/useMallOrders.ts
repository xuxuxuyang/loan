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
  riskStatus?: 'passed' | 'failed'
  riskReason?: string
  paid: boolean
  payType: MallPayType
  installmentPeriods?: number
  payChannel: MallPayChannel
  receiverName: string
  receiverPhone: string
  receiverAddress: string
  /** 卡包是否已领取（仅 shipping/receiving/enjoying 等有卡包业务的订单有意义） */
  cardPackageIssued?: boolean
  /** 快递运单号（后台登记后有值；shipping 填单后接口通常会改为 receiving） */
  trackingNumber?: string
}

interface CreateOrderPayload {
  productId: number
  name: string
  spec: string
  totalAmount: number
  /** 购买数量；先享后付订单服务端应还总额与商品小计一致 */
  quantity?: number
  status: MallOrderStatus
  paid: boolean
  payType: MallPayType
  installmentPeriods?: number
  payChannel: MallPayChannel
  receiverName: string
  receiverPhone: string
  receiverAddress: string
  /** 信誉初审用：身份证号（与 API 订单 body 一致） */
  idNumber?: string
  idCardFront?: string
  idCardBack?: string
  /** 先享后付：已在浏览器侧完成 7 步风控 wave，下单时由服务端核销，避免重复调上游 */
  installmentRiskWaveId?: string
}

const ORDER_STORAGE_KEY = 'mall-orders'
const ORDER_REMOTE_PATH = '/orders'

function resolveMallApiBase() {
  const runtimeConfig = useRuntimeConfig()
  return runtimeConfig.public.mallApiBase || '/api'
}

function saveOrdersToStorage(orders: MallOrder[]) {
  if (import.meta.env.SSR) {
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

export function normalizeOrderTrackingNumber(value: unknown): string {
  return String(value ?? '').trim()
}

/** 有待展示运单号且处于发货后流程的订单（含待发货但已录单号的边界情况） */
export function orderHasShippedTracking(order: MallOrder): boolean {
  const tn = normalizeOrderTrackingNumber(order.trackingNumber)
  if (!tn) {
    return false
  }
  return order.status === 'shipping' || order.status === 'receiving' || order.status === 'enjoying'
}

export interface SimulatedLogisticsNode {
  timeLabel: string
  text: string
}

/** 基于运单号与订单状态生成的示例物流轨迹，后续可整体替换为快递查询 API 结果 */
export function getSimulatedLogisticsTrace(order: MallOrder): SimulatedLogisticsNode[] {
  if (!orderHasShippedTracking(order)) {
    return []
  }
  const tn = normalizeOrderTrackingNumber(order.trackingNumber)
  const created = new Date(order.createdAt)
  if (Number.isNaN(created.getTime())) {
    return [{ timeLabel: '', text: '物流信息暂不可用' }]
  }

  const carriers = ['顺丰速运', '中通快递', '圆通速递', '韵达快递'] as const
  let h = 0
  for (let i = 0; i < tn.length; i++) {
    h = (h * 31 + tn.charCodeAt(i)) | 0
  }
  const carrier = carriers[Math.abs(h) % carriers.length]

  const pad = (n: number) => String(n).padStart(2, '0')
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`

  const addHours = (ms: number, hours: number) => new Date(ms + hours * 3600000)

  const base = created.getTime()
  const t0 = addHours(base, 1)
  const t1 = addHours(base, 8)
  const t2 = addHours(base, 28)
  const t3 = addHours(base, order.status === 'enjoying' ? 52 : 40)

  const nodes: SimulatedLogisticsNode[] = [
    { timeLabel: fmt(t0), text: `【${carrier}】快递员已揽收，包裹运输中（运单号 ${tn}）` },
    { timeLabel: fmt(t1), text: '包裹已离开发货地分拨中心，正发往目的城市' },
    { timeLabel: fmt(t2), text: '包裹已到达收件城市分拨中心，等待安排派送' },
  ]
  if (order.status === 'enjoying') {
    nodes.push({ timeLabel: fmt(t3), text: '快件已签收，感谢您的支持与信任' })
  }
  else {
    nodes.push({ timeLabel: fmt(t3), text: '包裹正在派送中，请保持手机畅通以便派件员与您联系' })
  }

  return [...nodes].reverse()
}

export function useMallOrders() {
  const orders = useState<MallOrder[]>('mall-orders', () => [])
  const initialized = useState<boolean>('mall-orders-initialized', () => false)
  const syncingRemote = useState<boolean>('mall-orders-remote-syncing', () => false)

  const syncFromStorage = () => {
    if (import.meta.env.SSR || initialized.value) {
      return
    }
    // 订单以接口为单一数据源，主动清除历史本地缓存避免脏数据回流。
    localStorage.removeItem(ORDER_STORAGE_KEY)
    initialized.value = true
  }

  const syncFromRemote = async () => {
    if (import.meta.env.SSR || syncingRemote.value) {
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
    if (import.meta.env.SSR) {
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

  if (!import.meta.env.SSR && !initialized.value) {
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
