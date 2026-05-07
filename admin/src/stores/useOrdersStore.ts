import { ref } from 'vue'
import { withAdminAuthHeaders } from '../composables/useAdminApi'

export interface InstallmentItem {
  period: number
  dueDate: string
  principal: number
  fee: number
  amount: number
  paid: boolean
}

export interface OrderItem {
  id: string
  user: string
  product: string
  totalAmount: number
  periods: number
  periodAmount: number
  currentPeriod: number
  nextRepayDate: string
  status: '待付款' | '待审核' | '风控未通过' | '待发货' | '待收货' | '已完成'
  riskStatus: 'passed' | 'failed'
  riskReason: string
  payType: '分期' | '全款'
  createdAt: string
  installmentPlan: InstallmentItem[]
  /** 后台登记的卡包是否已发放（仅审核通过后的订单有意义） */
  cardPackageIssued: boolean
  /** 快递单号；填写后订单进入运输流程（后台状态为待收货） */
  trackingNumber: string
}

export interface RiskDetailRule {
  code: string
  name: string
  hit: boolean
  scoreImpact: number
  detail: string
}

export interface OrderRiskDetail {
  orderId: string
  riskStatus: 'passed' | 'failed'
  decision: string
  riskScore: number
  threshold: number
  checkedAt: string
  reason: string
  modelVersion: string
  factors: string[]
  rules: RiskDetailRule[]
}

interface MallOrderPayload {
  id: string
  name: string
  totalAmount: number
  createdAt: string
  status: 'reviewing' | 'shipping' | 'receiving' | 'enjoying'
  riskStatus?: 'passed' | 'failed'
  riskReason?: string
  paid: boolean
  payType: 'installment' | 'full'
  receiverName: string
  installmentPlan?: InstallmentItem[]
  cardPackageIssued?: boolean
  trackingNumber?: string
}

interface RiskDetailPayload {
  orderId: string
  riskStatus?: 'passed' | 'failed'
  decision?: string
  riskScore?: number
  threshold?: number
  checkedAt?: string
  reason?: string
  modelVersion?: string
  factors?: string[]
  rules?: Array<{
    code?: string
    name?: string
    hit?: boolean
    scoreImpact?: number
    detail?: string
  }>
}

interface OrderFilterParams {
  keyword?: string
  status?: OrderItem['status'] | '全部'
  payType?: OrderItem['payType'] | '全部'
  date?: string
}

const MALL_ORDERS_ENDPOINT = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}/orders`
const MALL_INSTALLMENT_PAY_ENDPOINT = `${MALL_ORDERS_ENDPOINT}/:id/installments/:period/pay`
const MALL_ORDER_RISK_DETAIL_ENDPOINT = `${MALL_ORDERS_ENDPOINT}/:id/risk-detail`
const orders = ref<OrderItem[]>([])
const initialized = ref(false)

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  const yyyy = date.getFullYear()
  const mm = `${date.getMonth() + 1}`.padStart(2, '0')
  const dd = `${date.getDate()}`.padStart(2, '0')
  const hh = `${date.getHours()}`.padStart(2, '0')
  const min = `${date.getMinutes()}`.padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

function mapMallOrderStatus(
  status: MallOrderPayload['status'],
  paid: boolean,
  payType: MallOrderPayload['payType'],
  riskStatus?: MallOrderPayload['riskStatus'],
): OrderItem['status'] {
  if (status === 'reviewing') {
    // 分期订单在人工审核通过前，统一归入“待审核”。
    if (payType === 'installment') {
      if (riskStatus === 'failed') {
        return '风控未通过'
      }
      return '待审核'
    }
    return paid ? '待发货' : '待付款'
  }
  if (status === 'shipping') {
    return '待发货'
  }
  if (status === 'receiving') {
    return '待收货'
  }
  return '已完成'
}

function normalizeInstallmentPlan(payload: MallOrderPayload) {
  if (Array.isArray(payload.installmentPlan) && payload.installmentPlan.length > 0) {
    return payload.installmentPlan.map(item => ({
      period: Number(item.period),
      dueDate: item.dueDate,
      principal: Number(item.principal),
      fee: Number(item.fee),
      amount: Number(item.amount),
      paid: Boolean(item.paid),
    }))
  }
  return []
}

function mapMallOrderToAdminOrder(order: MallOrderPayload): OrderItem {
  const fallbackPeriods = order.payType === 'installment' ? 12 : 1
  const installmentPlan = normalizeInstallmentPlan(order)
  const safePlan = installmentPlan.length > 0
    ? installmentPlan
    : [{
        period: 1,
        dueDate: formatDateTime(order.createdAt).slice(0, 10),
        principal: Number(order.totalAmount.toFixed(2)),
        fee: 0,
        amount: Number(order.totalAmount.toFixed(2)),
        paid: Boolean(order.paid),
      }]
  const periods = safePlan.length || fallbackPeriods
  const nextPending = safePlan.find(item => !item.paid)
  const allPaid = safePlan.every(item => item.paid)
  const riskStatus = order.riskStatus === 'failed' ? 'failed' : 'passed'
  const tracking = String(order.trackingNumber || '').trim()
  const status = mapMallOrderStatus(order.status, order.paid, order.payType, order.riskStatus)

  return {
    id: order.id,
    user: order.receiverName || '商城用户',
    product: order.name,
    totalAmount: Number(order.totalAmount.toFixed(2)),
    periods,
    periodAmount: safePlan[0]?.amount || 0,
    currentPeriod: allPaid ? periods : (nextPending?.period || 1),
    nextRepayDate: allPaid ? '-' : (nextPending?.dueDate || '-'),
    status,
    riskStatus,
    riskReason: order.riskReason || '',
    payType: order.payType === 'installment' ? '分期' : '全款',
    createdAt: formatDateTime(order.createdAt),
    installmentPlan: safePlan,
    cardPackageIssued: Boolean(order.cardPackageIssued),
    trackingNumber: tracking,
  }
}

function installmentPayUrl(orderId: string, period: number) {
  return MALL_INSTALLMENT_PAY_ENDPOINT
    .replace(':id', encodeURIComponent(orderId))
    .replace(':period', encodeURIComponent(String(period)))
}

function riskDetailUrl(orderId: string) {
  return MALL_ORDER_RISK_DETAIL_ENDPOINT.replace(':id', encodeURIComponent(orderId))
}

function mapPayTypeToApi(payType?: OrderItem['payType'] | '全部') {
  if (!payType || payType === '全部') {
    return ''
  }
  return payType === '分期' ? 'installment' : 'full'
}

function mapStatusToApi(status?: OrderItem['status'] | '全部') {
  if (!status || status === '全部') {
    return { status: '', adminStatus: '' }
  }
  if (status === '待审核') {
    return { status: 'reviewing', adminStatus: '' }
  }
  if (status === '待付款') {
    return { status: '', adminStatus: '待付款' }
  }
  return { status: '', adminStatus: status }
}

async function fetchOrders(params: OrderFilterParams = {}) {
  const query = new URLSearchParams()
  if (params.keyword) query.set('keyword', params.keyword)
  const statusQuery = mapStatusToApi(params.status)
  if (statusQuery.status) query.set('status', statusQuery.status)
  if (statusQuery.adminStatus) query.set('adminStatus', statusQuery.adminStatus)
  const apiPayType = mapPayTypeToApi(params.payType)
  if (apiPayType) query.set('payType', apiPayType)
  if (params.date) query.set('date', params.date)

  const url = query.toString() ? `${MALL_ORDERS_ENDPOINT}?${query.toString()}` : MALL_ORDERS_ENDPOINT
  const response = await fetch(url, {
    method: 'GET',
    headers: withAdminAuthHeaders(),
  })
  if (!response.ok) {
    throw new Error(`请求订单失败: ${response.status}`)
  }
  const payload = await response.json() as { success?: boolean, data?: MallOrderPayload[] }
  const list = Array.isArray(payload.data) ? payload.data : []
  orders.value = list.map(mapMallOrderToAdminOrder)
}

async function updateInstallmentPaid(orderId: string, period: number, paid: boolean) {
  const response = await fetch(installmentPayUrl(orderId, period), {
    method: 'PATCH',
    headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ paid }),
  })
  if (!response.ok) {
    throw new Error(`更新分期状态失败: ${response.status}`)
  }
  const payload = await response.json() as { success?: boolean, data?: MallOrderPayload }
  if (!payload.data) {
    return
  }
  const mapped = mapMallOrderToAdminOrder(payload.data)
  orders.value = orders.value.map(item => (item.id === mapped.id ? mapped : item))
}

async function updateOrderCardPackage(orderId: string, cardPackageIssued: boolean) {
  const response = await fetch(`${MALL_ORDERS_ENDPOINT}/${encodeURIComponent(orderId)}/card-package`, {
    method: 'PATCH',
    headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ cardPackageIssued }),
  })
  if (!response.ok) {
    throw new Error(`更新卡包发放状态失败: ${response.status}`)
  }
  const payload = await response.json() as { success?: boolean, data?: MallOrderPayload }
  if (!payload.data) {
    return
  }
  const mapped = mapMallOrderToAdminOrder(payload.data)
  orders.value = orders.value.map(item => (item.id === mapped.id ? mapped : item))
}

async function updateOrderShipment(orderId: string, trackingNumber: string) {
  const response = await fetch(`${MALL_ORDERS_ENDPOINT}/${encodeURIComponent(orderId)}/shipment`, {
    method: 'PATCH',
    headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ trackingNumber }),
  })
  if (!response.ok) {
    throw new Error(`登记快递单号失败: ${response.status}`)
  }
  const payload = await response.json() as { success?: boolean, data?: MallOrderPayload }
  if (!payload.data) {
    return
  }
  const mapped = mapMallOrderToAdminOrder(payload.data)
  orders.value = orders.value.map(item => (item.id === mapped.id ? mapped : item))
}

async function updateOrderStatus(orderId: string, status: MallOrderPayload['status']) {
  const response = await fetch(`${MALL_ORDERS_ENDPOINT}/${encodeURIComponent(orderId)}/status`, {
    method: 'PATCH',
    headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ status }),
  })
  if (!response.ok) {
    throw new Error(`更新订单状态失败: ${response.status}`)
  }
  const payload = await response.json() as { success?: boolean, data?: MallOrderPayload }
  if (!payload.data) {
    return
  }
  const mapped = mapMallOrderToAdminOrder(payload.data)
  orders.value = orders.value.map(item => (item.id === mapped.id ? mapped : item))
}

async function fetchOrderRiskDetail(orderId: string): Promise<OrderRiskDetail> {
  const response = await fetch(riskDetailUrl(orderId), {
    method: 'GET',
    headers: withAdminAuthHeaders(),
  })
  if (!response.ok) {
    throw new Error(`获取风控详情失败: ${response.status}`)
  }
  const payload = await response.json() as { success?: boolean, data?: RiskDetailPayload }
  if (!payload.data) {
    throw new Error('风控详情数据为空')
  }
  return {
    orderId: payload.data.orderId,
    riskStatus: payload.data.riskStatus === 'failed' ? 'failed' : 'passed',
    decision: payload.data.decision || '通过',
    riskScore: Number(payload.data.riskScore || 0),
    threshold: Number(payload.data.threshold || 2200),
    checkedAt: formatDateTime(payload.data.checkedAt || ''),
    reason: payload.data.reason || '',
    modelVersion: payload.data.modelVersion || 'mock-risk-v1',
    factors: Array.isArray(payload.data.factors) ? payload.data.factors : [],
    rules: Array.isArray(payload.data.rules)
      ? payload.data.rules.map(rule => ({
          code: String(rule.code || ''),
          name: String(rule.name || ''),
          hit: Boolean(rule.hit),
          scoreImpact: Number(rule.scoreImpact || 0),
          detail: String(rule.detail || ''),
        }))
      : [],
  }
}

function recalculateOrderFields(order: OrderItem) {
  const nextPending = order.installmentPlan.find(item => !item.paid)
  const allPaid = order.installmentPlan.every(item => item.paid)

  if (allPaid) {
    order.currentPeriod = order.periods
    order.nextRepayDate = '-'
    order.status = '已完成'
    return
  }
  if (nextPending) {
    order.currentPeriod = nextPending.period
    order.nextRepayDate = nextPending.dueDate
  }
  if (order.status === '已完成') {
    order.status = '待收货'
  }
}

async function deleteOrder(orderId: string) {
  const response = await fetch(`${MALL_ORDERS_ENDPOINT}/${encodeURIComponent(orderId)}`, {
    method: 'DELETE',
    headers: withAdminAuthHeaders(),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { msg?: string }
    throw new Error(payload.msg || `删除订单失败: ${response.status}`)
  }
  orders.value = orders.value.filter(item => item.id !== orderId)
}

export function useOrdersStore() {
  if (!initialized.value) {
    initialized.value = true
    void fetchOrders()
  }

  return {
    orders,
    fetchOrders,
    recalculateOrderFields,
    updateInstallmentPaid,
    updateOrderShipment,
    updateOrderStatus,
    updateOrderCardPackage,
    fetchOrderRiskDetail,
    deleteOrder,
  }
}
