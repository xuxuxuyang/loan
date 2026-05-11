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
  /** 下单时填写的收货地址 */
  receiverAddress: string
  /** 收货人手机号；用于关联商城用户并打开与用户页一致的风控档案 */
  receiverPhone: string
  product: string
  totalAmount: number
  periods: number
  periodAmount: number
  currentPeriod: number
  nextRepayDate: string
  status: '待付款' | '待审核' | '风控未通过' | '待发货' | '待收货' | '已完成'
  riskStatus: 'passed' | 'failed'
  riskReason: string
  payType: '先享后付' | '全款'
  createdAt: string
  installmentPlan: InstallmentItem[]
  /** 后台登记的卡包是否已发放（仅审核通过后的订单有意义） */
  cardPackageIssued: boolean
  /** 卡包领取电子合同是否已签署 */
  cardPackageContractSigned: boolean
  /** 合同签署时间（ISO），未签署为空串 */
  cardPackageContractSignedAt: string
  /** 快递单号；填写后订单进入运输流程（后台状态为待收货） */
  trackingNumber: string
  /** 用户管理中的备注（关联收货手机号 users.adminRemark） */
  userRemark: string
}

export interface RiskDetailRule {
  code: string
  name: string
  hit: boolean
  scoreImpact: number
  detail: string
  /** 用户风控弹窗：对应 `riskControlSnapshot.fourteenRows` 槽位，便于单接口重查 */
  slotKey?: string
  rowState?: 'ok' | 'fail' | 'skipped'
  httpStatus?: number | null
  skippedReason?: string
  error?: string
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
  /** 用户风控弹窗：十四项中已实测条数 */
  testedSlotCount?: number
  okSlotCount?: number
  failSlotCount?: number
  skippedSlotCount?: number
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
  receiverPhone?: string
  receiverAddress?: string
  installmentPlan?: InstallmentItem[]
  cardPackageIssued?: boolean
  cardPackageContractSignedAt?: string | null
  trackingNumber?: string
  /** 管理端列表：关联收货手机号的商城用户后台备注 */
  buyerAdminRemark?: string
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
  testedSlotCount?: number
  okSlotCount?: number
  failSlotCount?: number
  skippedSlotCount?: number
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
const MALL_INSTALLMENT_DUE_DATE_ENDPOINT = `${MALL_ORDERS_ENDPOINT}/:id/installments/:period/due-date`
const MALL_ORDER_RISK_DETAIL_ENDPOINT = `${MALL_ORDERS_ENDPOINT}/:id/risk-detail`
const MALL_ORDER_CARD_PACKAGE_CONTRACT_ENDPOINT = `${MALL_ORDERS_ENDPOINT}/:id/card-package-contract`
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
  const s = typeof status === 'string' ? status.trim() : status
  if (s === 'reviewing') {
    // 先享后付订单在人工审核通过前，统一归入“待审核”。
    if (payType === 'installment') {
      if (riskStatus === 'failed') {
        return '风控未通过'
      }
      return '待审核'
    }
    return paid ? '待发货' : '待付款'
  }
  if (s === 'shipping') {
    return '待发货'
  }
  if (s === 'receiving') {
    return '待收货'
  }
  if (s === 'enjoying') {
    return '已完成'
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
  const fallbackPeriods = order.payType === 'installment' ? 1 : 1
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
  const periodAmount = Number(
    ((nextPending || safePlan[0])?.amount ?? 0).toFixed(2),
  )
  const riskStatus = order.riskStatus === 'failed' ? 'failed' : 'passed'
  const tracking = String(order.trackingNumber || '').trim()
  const status = mapMallOrderStatus(order.status, order.paid, order.payType, order.riskStatus)
  const userRemark = typeof order.buyerAdminRemark === 'string' ? order.buyerAdminRemark.trim() : ''
  const signedAtRaw = order.cardPackageContractSignedAt
  const signedAt = typeof signedAtRaw === 'string' && signedAtRaw.trim() ? signedAtRaw.trim() : ''

  return {
    id: order.id,
    user: order.receiverName || '商城用户',
    receiverAddress: String(order.receiverAddress || '').trim(),
    receiverPhone: String(order.receiverPhone || '').trim(),
    product: order.name,
    totalAmount: Number(order.totalAmount.toFixed(2)),
    periods,
    periodAmount,
    currentPeriod: allPaid ? periods : (nextPending?.period || 1),
    nextRepayDate: allPaid ? '-' : (nextPending?.dueDate || '-'),
    status,
    riskStatus,
    riskReason: order.riskReason || '',
    payType: order.payType === 'installment' ? '先享后付' : '全款',
    createdAt: formatDateTime(order.createdAt),
    installmentPlan: safePlan,
    cardPackageIssued: Boolean(order.cardPackageIssued),
    cardPackageContractSigned: Boolean(signedAt),
    cardPackageContractSignedAt: signedAt,
    trackingNumber: tracking,
    userRemark,
  }
}

/** PATCH 返回的订单不含 buyerAdminRemark 时保留列表中已有的备注展示 */
function mergeOrderAfterPatch(prev: OrderItem, mapped: OrderItem): OrderItem {
  const ur = mapped.userRemark.trim() ? mapped.userRemark : prev.userRemark
  return { ...mapped, userRemark: ur || '' }
}

function installmentPayUrl(orderId: string, period: number) {
  return MALL_INSTALLMENT_PAY_ENDPOINT
    .replace(':id', encodeURIComponent(orderId))
    .replace(':period', encodeURIComponent(String(period)))
}

function installmentDueDateUrl(orderId: string, period: number) {
  return MALL_INSTALLMENT_DUE_DATE_ENDPOINT
    .replace(':id', encodeURIComponent(orderId))
    .replace(':period', encodeURIComponent(String(period)))
}

function riskDetailUrl(orderId: string) {
  return MALL_ORDER_RISK_DETAIL_ENDPOINT.replace(':id', encodeURIComponent(orderId))
}

function cardPackageContractUrl(orderId: string) {
  return MALL_ORDER_CARD_PACKAGE_CONTRACT_ENDPOINT.replace(':id', encodeURIComponent(orderId))
}

function mapPayTypeToApi(payType?: OrderItem['payType'] | '全部') {
  if (!payType || payType === '全部') {
    return ''
  }
  return payType === '先享后付' ? 'installment' : 'full'
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

async function updateInstallmentDueDate(orderId: string, period: number, addDays: number) {
  const response = await fetch(installmentDueDateUrl(orderId, period), {
    method: 'PATCH',
    headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ addDays }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { msg?: string }
    throw new Error(payload.msg || `延期还款日失败: ${response.status}`)
  }
  const payload = await response.json() as { success?: boolean, data?: MallOrderPayload }
  if (!payload.data) {
    return
  }
  const mapped = mapMallOrderToAdminOrder(payload.data)
  orders.value = orders.value.map(item => (item.id === mapped.id ? mergeOrderAfterPatch(item, mapped) : item))
}

async function updateInstallmentPaid(orderId: string, period: number, paid: boolean) {
  const response = await fetch(installmentPayUrl(orderId, period), {
    method: 'PATCH',
    headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ paid }),
  })
  if (!response.ok) {
    throw new Error(`更新先享后付状态失败: ${response.status}`)
  }
  const payload = await response.json() as { success?: boolean, data?: MallOrderPayload }
  if (!payload.data) {
    return
  }
  const mapped = mapMallOrderToAdminOrder(payload.data)
  orders.value = orders.value.map(item => (item.id === mapped.id ? mergeOrderAfterPatch(item, mapped) : item))
}

async function updateOrderCardPackage(orderId: string, cardPackageIssued: boolean) {
  const response = await fetch(`${MALL_ORDERS_ENDPOINT}/${encodeURIComponent(orderId)}/card-package`, {
    method: 'PATCH',
    headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ cardPackageIssued }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { msg?: string }
    throw new Error(payload.msg || `更新卡包发放状态失败: ${response.status}`)
  }
  const payload = await response.json() as { success?: boolean, data?: MallOrderPayload }
  if (!payload.data) {
    return
  }
  const mapped = mapMallOrderToAdminOrder(payload.data)
  orders.value = orders.value.map(item => (item.id === mapped.id ? mergeOrderAfterPatch(item, mapped) : item))
}

async function updateOrderCardPackageContract(orderId: string, signed: boolean) {
  const response = await fetch(cardPackageContractUrl(orderId), {
    method: 'PATCH',
    headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ signed }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { msg?: string }
    throw new Error(payload.msg || `更新合同签署状态失败: ${response.status}`)
  }
  const payload = await response.json() as { success?: boolean, data?: MallOrderPayload }
  if (!payload.data) {
    return
  }
  const mapped = mapMallOrderToAdminOrder(payload.data)
  orders.value = orders.value.map(item => (item.id === mapped.id ? mergeOrderAfterPatch(item, mapped) : item))
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
  orders.value = orders.value.map(item => (item.id === mapped.id ? mergeOrderAfterPatch(item, mapped) : item))
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
  orders.value = orders.value.map(item => (item.id === mapped.id ? mergeOrderAfterPatch(item, mapped) : item))
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
    testedSlotCount: payload.data.testedSlotCount != null ? Number(payload.data.testedSlotCount) : undefined,
    okSlotCount: payload.data.okSlotCount != null ? Number(payload.data.okSlotCount) : undefined,
    failSlotCount: payload.data.failSlotCount != null ? Number(payload.data.failSlotCount) : undefined,
    skippedSlotCount: payload.data.skippedSlotCount != null ? Number(payload.data.skippedSlotCount) : undefined,
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
    const tn = (order.trackingNumber || '').trim()
    order.status = tn ? '待收货' : '待发货'
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
    updateInstallmentDueDate,
    updateOrderShipment,
    updateOrderStatus,
    updateOrderCardPackage,
    updateOrderCardPackageContract,
    fetchOrderRiskDetail,
    deleteOrder,
  }
}
