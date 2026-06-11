import { MALL_RUNTIME_CONFIG } from '~/config/mallRuntime'
import type { MallPostOrderRefreshPayload } from '~/composables/useMallMy'

export type MallOrderStatus = 'reviewing' | 'shipping' | 'receiving' | 'enjoying'
export type MallPayType = 'installment' | 'full'
export type MallPayChannel = 'wechat' | 'alipay' | 'card'

export interface MallOrder {
  id: string
  /** 下单时记录在订单上的注册商城用户 id（与 users.id 对应）；新版订单必填，统计与归属均以该字段为准 */
  mallUserId?: string
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
  /** GET /my/orders enrichment：注册姓名（与收货人可能不同） */
  buyerName?: string
  buyerPhone?: string
  /** 卡包是否已领取（仅 shipping/receiving/enjoying 等有卡包业务的订单有意义） */
  cardPackageIssued?: boolean
  /** 快递运单号（后台登记后有值；shipping 填单后接口通常会改为 receiving） */
  trackingNumber?: string
  /** 先享后付分期是否已全部还清（GET /my/orders） */
  installmentAllPaid?: boolean
}

export interface MallCreateOrderResult {
  order: MallOrder
  mallRefresh?: MallPostOrderRefreshPayload
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
  /** 老客户复购可申请免风控直过审核（由服务端二次校验是否满足条件） */
  riskBypassReason?: 'returning_customer'
}

function buildMockMallAuthHeader(phoneRaw: unknown): Record<string, string> | undefined {
  let u = normalizeReceiverPhoneDigits(String(phoneRaw || ''))
  if (u.startsWith('86') && u.length === 13)
    u = u.slice(2)
  if (!/^1\d{10}$/.test(u))
    return undefined
  return { Authorization: `Bearer mock-token-${u}` }
}

function normalizeMallAccountPhone(phoneRaw: unknown): string {
  let u = normalizeReceiverPhoneDigits(String(phoneRaw || ''))
  if (u.startsWith('86') && u.length === 13) {
    u = u.slice(2)
  }
  return u
}

const ORDER_STORAGE_KEY = 'mall-orders'
const MY_ORDERS_PATH = '/my/orders'
const ORDER_CREATE_PATH = '/orders'

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalizeMallOrderStatus(value: unknown): MallOrderStatus {
  const status = String(value || '').trim()
  if (status === 'reviewing' || status === 'shipping' || status === 'receiving' || status === 'enjoying') {
    return status
  }
  return 'reviewing'
}

function normalizeMallPayType(value: unknown): MallPayType {
  const payType = String(value || '').trim()
  return payType === 'full' ? 'full' : 'installment'
}

function normalizeMallPayChannel(value: unknown): MallPayChannel {
  const channel = String(value || '').trim()
  if (channel === 'wechat' || channel === 'alipay' || channel === 'card') {
    return channel
  }
  return 'wechat'
}

function normalizeMallOrder(item: unknown): MallOrder | null {
  if (!item || typeof item !== 'object') {
    return null
  }
  const raw = item as Record<string, unknown>
  const id = String(raw.id || '').trim()
  if (!id) {
    return null
  }
  return {
    id,
    mallUserId: String(raw.mallUserId || '').trim() || undefined,
    productId: toNumber(raw.productId),
    name: String(raw.name || '').trim(),
    spec: String(raw.spec || '').trim(),
    totalAmount: toNumber(raw.totalAmount),
    createdAt: String(raw.createdAt || '').trim(),
    status: normalizeMallOrderStatus(raw.status),
    riskStatus: raw.riskStatus === 'passed' || raw.riskStatus === 'failed' ? raw.riskStatus : undefined,
    riskReason: String(raw.riskReason || '').trim() || undefined,
    paid: Boolean(raw.paid),
    payType: normalizeMallPayType(raw.payType),
    installmentPeriods: Number.isFinite(Number(raw.installmentPeriods)) ? Number(raw.installmentPeriods) : undefined,
    payChannel: normalizeMallPayChannel(raw.payChannel),
    receiverName: String(raw.receiverName || '').trim(),
    receiverPhone: String(raw.receiverPhone || '').trim(),
    receiverAddress: String(raw.receiverAddress || '').trim(),
    buyerName: String(raw.buyerName || '').trim() || undefined,
    buyerPhone: String(raw.buyerPhone || '').trim() || undefined,
    cardPackageIssued: raw.cardPackageIssued === undefined ? undefined : Boolean(raw.cardPackageIssued),
    trackingNumber: String(raw.trackingNumber || '').trim() || undefined,
    installmentAllPaid: raw.installmentAllPaid === undefined ? undefined : Boolean(raw.installmentAllPaid),
  }
}

/** 与账单 API `normalizePhone` 一致：比较收货人与登录账号是否为同一手机号（仅兼容无 mallUserId 的旧订单） */
export function normalizeReceiverPhoneDigits(phone: string) {
  return String(phone || '').replace(/\D/g, '')
}

/** 订单是否属于当前登录的注册账号：仅 order.mallUserId === profileUserId（禁止按收货手机号归户） */
export function mallOrderBelongsToLoggedIn(order: MallOrder, profileUserId?: string) {
  const mid = String(order.mallUserId || '').trim()
  const pid = String(profileUserId || '').trim()
  return Boolean(mid && pid && mid === pid)
}

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

/**
 * 与后台一致：先享后付且卡包已发放即视为已完成（enjoying），
 * 避免对账逻辑把 enjoying 回退为 receiving 后，商城仍显示「待收货」。
 */
export function effectiveMallOrderStatus(order: MallOrder): MallOrderStatus {
  if (order.payType === 'installment' && Boolean(order.cardPackageIssued)) {
    return 'enjoying'
  }
  return order.status
}

/** 上一笔订单是否满足老客户判定：已下单、卡包已发、已全部还款（与后台口径一致） */
export function doesOrderQualifyAsPriorForReturningCustomer(order: MallOrder): boolean {
  if (order.payType !== 'installment') {
    return false
  }
  if (order.status === 'reviewing' || order.riskStatus === 'failed') {
    return false
  }
  if (!order.cardPackageIssued) {
    return false
  }
  return Boolean(order.installmentAllPaid)
}

/** 最近一笔订单满足老客户判定时可走复购免风控 */
export function isReturningMallCustomer(orders: MallOrder[]): boolean {
  if (orders.length === 0) {
    return false
  }
  const sorted = [...orders].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  return doesOrderQualifyAsPriorForReturningCustomer(sorted[0])
}

/** 有待展示运单号且处于发货后流程的订单（含待发货但已录单号的边界情况） */
export function orderHasShippedTracking(order: MallOrder): boolean {
  const tn = normalizeOrderTrackingNumber(order.trackingNumber)
  if (!tn) {
    return false
  }
  const st = effectiveMallOrderStatus(order)
  return st === 'shipping' || st === 'receiving' || st === 'enjoying'
}

/**
 * Opens the configured third-party tracking lookup page.
 * Keep the production URL in VITE_MALL_TRACKING_LOOKUP_URL, not in business code.
 */
export function trackingNumberThirdPartyLookupUrl(): string {
  return MALL_RUNTIME_CONFIG.trackingLookupUrl
}

export interface SyncMallOrdersOptions {
  /** 服务端按状态筛选，减少传输（all 时不传） */
  status?: 'all' | MallOrderStatus
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

  const syncFromRemote = async (account?: string, options?: SyncMallOrdersOptions) => {
    if (import.meta.env.SSR || syncingRemote.value) {
      return
    }
    const phone = normalizeMallAccountPhone(account)
    if (!/^1\d{10}$/.test(phone)) {
      orders.value = []
      return
    }
    const authHeaders = buildMockMallAuthHeader(phone)
    if (!authHeaders) {
      return
    }

    syncingRemote.value = true
    try {
      const status = options?.status
      const query: Record<string, string> = { phone }
      if (status && status !== 'all') {
        query.status = status
      }
      const response = await $fetch<{ success: boolean, data: MallOrder[] }>(
        `${resolveMallApiBase()}${MY_ORDERS_PATH}`,
        {
          method: 'GET',
          query,
          headers: authHeaders,
        },
      )
      if (Array.isArray(response?.data)) {
        orders.value = response.data
          .map(normalizeMallOrder)
          .filter((item): item is MallOrder => Boolean(item))
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

  const createOrder = async (payload: CreateOrderPayload, auth?: { mallLoginPhone?: string }): Promise<MallCreateOrderResult> => {
    const authHeaders = buildMockMallAuthHeader(auth?.mallLoginPhone)
    const response = await $fetch<{ success: boolean, data: Record<string, unknown> }>(`${resolveMallApiBase()}${ORDER_CREATE_PATH}`, {
      method: 'POST',
      body: payload,
      ...(authHeaders ? { headers: authHeaders } : {}),
    })
    const rawAll = response.data || {}
    const mallRefreshRaw = rawAll.mallRefresh
    const mallRefresh = mallRefreshRaw && typeof mallRefreshRaw === 'object' && mallRefreshRaw !== null
      ? (mallRefreshRaw as MallPostOrderRefreshPayload)
      : undefined
    const orderClone: Record<string, unknown> = { ...rawAll }
    delete orderClone.mallRefresh
    const order = normalizeMallOrder(orderClone)
    if (!order) {
      throw new Error('订单创建返回数据异常')
    }
    orders.value = [order, ...orders.value.filter(item => item.id !== order.id)]
    saveOrdersToStorage(orders.value)
    return { order, mallRefresh }
  }

  const markOrderPaid = async (orderId: string, payChannel: MallPayChannel, account?: string) => {
    const authHeaders = buildMockMallAuthHeader(account)
    const response = await $fetch<{ success: boolean, data: MallOrder }>(
      `${resolveMallApiBase()}${ORDER_CREATE_PATH}/${orderId}/pay`,
      {
        method: 'PATCH',
        body: { payChannel },
        ...(authHeaders ? { headers: authHeaders } : {}),
      },
    )
    const order = normalizeMallOrder(response.data)
    if (order) {
      orders.value = [order, ...orders.value.filter(item => item.id !== order.id)]
    }
    else {
      await syncFromRemote(account)
    }
    saveOrdersToStorage(orders.value)
  }

  if (!import.meta.env.SSR && !initialized.value) {
    syncFromStorage()
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
