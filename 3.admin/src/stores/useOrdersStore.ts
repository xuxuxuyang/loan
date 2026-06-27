import { ref } from 'vue'
import { apiErrorMessage, readApiErrorMessage, withMallTenantHeaders } from '../composables/useAdminApi'
import { mergePatchedOrder } from '../utils/orderPatchMerge'
import { resolveInstallmentEffectiveDueDate, resolveNegotiateRemainderAmountForDisplay } from '../utils/installmentEffectiveDueDate'

export interface InstallmentNegotiationRecord {
  negotiatedAmount: number
  remainderAmount: number
  remainderDueDate: string
  createdAt: string
  /** 登记协商时该期的原还款日（YYYY-MM-DD），撤销「协商支付完成」时恢复 */
  originalDueDate?: string
  /** 用户在前台完成协商支付的时间（ISO） */
  userPaidAt?: string
}

export interface InstallmentNegotiationPayPending {
  negotiatedAmount: number
  remainderAmount: number
  remainderDueDate: string
  createdAt: string
}

export interface InstallmentItem {
  period: number
  dueDate: string
  principal: number
  fee: number
  amount: number
  paid: boolean
  negotiationHistory?: InstallmentNegotiationRecord[]
  /** 后台协商后待用户在前台完成「协商支付」的款项；支付成功后清空并落库剩余本金 */
  negotiationPayPending?: InstallmentNegotiationPayPending | null
}

export interface OrderItem {
  id: string
  /** 下单注册用户的姓名（展示）；与收货人可能不同 */
  user: string
  /** 收货人姓名（物流） */
  receiverName: string
  receiverAddress: string
  /** 收货人手机号 */
  /** 收货人手机号（物流），不得当作注册账号手机号使用 */
  receiverPhone: string
  /** 注册账号手机号（仅来自接口 buyerPhone / 注册用户） */
  buyerPhone: string
  /** 下单用户 id（商城 users.id），用于优先打开档案 */
  mallUserId?: string
  product: string
  /** 卡包金额（元）：下单时商品卡包 × 数量快照；对账回填后随 GET 订单返回 */
  cardPackageAmount: number
  totalAmount: number
  periods: number
  periodAmount: number
  currentPeriod: number
  nextRepayDate: string
  status: '待付款' | '待审核' | '风控未通过' | '待发货' | '待收货' | '已完成'
  riskStatus: 'passed' | 'failed'
  riskReason: string
  manualRejectReason: string
  payType: '先享后付' | '全款'
  createdAt: string
  cardPackageIssuedAt: string
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
  /** 收货手机对应商城用户是否已填齐紧急联系人；无对应用户为 null；接口未返回该字段时不写入 */
  emergencyContactsComplete?: boolean | null
  /** 服务端判定：上一笔订单已下单、卡包已发且已全部还款 */
  isOldCustomer?: boolean
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
  manualRejectReason?: string
  paid: boolean
  payType: 'installment' | 'full'
  receiverName: string
  receiverPhone?: string
  receiverAddress?: string
  mallUserId?: string
  /** 下单注册用户的姓名（接口 enrichment） */
  buyerName?: string
  /** 注册账号手机号 */
  buyerPhone?: string
  installmentPlan?: Array<InstallmentItem & Record<string, unknown>>
  /** 卡包金额（元），与商品卡包配置一致并对账落库 */
  cardPackageAmount?: number
  cardPackageIssued?: boolean
  cardPackageIssuedAt?: string | null
  cardPackageContractSignedAt?: string | null
  trackingNumber?: string
  /** 管理端列表：关联收货手机号的商城用户后台备注 */
  buyerAdminRemark?: string
  /** GET /orders 等：与 buyer 关联的紧急联系人是否已填齐 */
  emergencyContactsComplete?: boolean | null
  /** 服务端判定：上一笔订单已下单、卡包已发且已全部还款 */
  isOldCustomer?: boolean
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
  page?: number
  pageSize?: number
  listScope?: 'pending' | 'reviewed' | 'card-data'
  repayFilter?: '全部' | '待还款' | '已还款' | '已逾期'
  riskStatus?: 'passed' | 'failed'
}

const MALL_ORDERS_ENDPOINT = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}/orders`
const MALL_INSTALLMENT_PAY_ENDPOINT = `${MALL_ORDERS_ENDPOINT}/:id/installments/:period/pay`
const MALL_INSTALLMENT_DUE_DATE_ENDPOINT = `${MALL_ORDERS_ENDPOINT}/:id/installments/:period/due-date`
const MALL_INSTALLMENT_NEGOTIATE_ENDPOINT = `${MALL_ORDERS_ENDPOINT}/:id/installments/:period/negotiate`
const MALL_INSTALLMENT_SETTLE_AMOUNT_ENDPOINT = `${MALL_ORDERS_ENDPOINT}/:id/installments/:period/settle-amount`
const MALL_INSTALLMENT_NEGOTIATION_HISTORY_PAID_ENDPOINT = `${MALL_ORDERS_ENDPOINT}/:id/installments/:period/negotiation/history/:historyIndex/paid`
const MALL_ORDER_RISK_DETAIL_ENDPOINT = `${MALL_ORDERS_ENDPOINT}/:id/risk-detail`
const MALL_ORDER_CARD_PACKAGE_CONTRACT_ENDPOINT = `${MALL_ORDERS_ENDPOINT}/:id/card-package-contract`
const orders = ref<OrderItem[]>([])

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

/** 与商城 / API 一致：Mongo 或 JSON 中 paid 可能为 1、'1'、'true'；避免 Boolean('false')===true */
function parseInstallmentPaid(raw: unknown): boolean {
  if (raw === true || raw === 1 || raw === '1') {
    return true
  }
  if (typeof raw === 'string' && raw.toLowerCase() === 'true') {
    return true
  }
  return false
}

function normalizeInstallmentPlan(payload: MallOrderPayload) {
  if (Array.isArray(payload.installmentPlan) && payload.installmentPlan.length > 0) {
    return payload.installmentPlan.map((item) => {
      const amount = Number(item.amount)
      const rawHist = (item as { negotiationHistory?: unknown }).negotiationHistory
      const negotiationHistory = Array.isArray(rawHist)
        ? rawHist.map((row: Record<string, unknown>) => ({
            negotiatedAmount: Number(row.negotiatedAmount || 0),
            remainderAmount: resolveNegotiateRemainderAmountForDisplay({ amount }, Number(row.remainderAmount || 0)),
            remainderDueDate: String(row.remainderDueDate || ''),
            createdAt: String(row.createdAt || ''),
            ...(typeof row.originalDueDate === 'string' && row.originalDueDate.trim()
              ? { originalDueDate: row.originalDueDate.trim() }
              : {}),
            ...(typeof row.userPaidAt === 'string' && row.userPaidAt.trim()
              ? { userPaidAt: row.userPaidAt.trim() }
              : {}),
          }))
        : undefined
      const rawPend = (item as { negotiationPayPending?: unknown }).negotiationPayPending
      const pend = rawPend && typeof rawPend === 'object' && rawPend !== null && !Array.isArray(rawPend)
        ? rawPend as Record<string, unknown>
        : null
      const negotiationPayPending = pend && Number(pend.negotiatedAmount || 0) > 0
        ? {
            negotiatedAmount: Number(pend.negotiatedAmount || 0),
            remainderAmount: resolveNegotiateRemainderAmountForDisplay({ amount }, Number(pend.remainderAmount || 0)),
            remainderDueDate: String(pend.remainderDueDate || '').trim(),
            createdAt: String(pend.createdAt || '').trim(),
          }
        : undefined
      return {
        period: Number(item.period),
        dueDate: item.dueDate,
        principal: Number(item.principal),
        fee: Number(item.fee),
        amount: Number(item.amount),
        paid: parseInstallmentPaid(item.paid),
        ...(negotiationHistory && negotiationHistory.length > 0 ? { negotiationHistory } : {}),
        ...(negotiationPayPending ? { negotiationPayPending } : {}),
      }
    })
  }
  return []
}

function mapMallOrderToAdminOrder(order: MallOrderPayload): OrderItem {
  const fallbackPeriods = order.payType === 'installment' ? 1 : 1
  const installmentPlan = normalizeInstallmentPlan(order)
  const cardPackageIssued = Boolean(order.cardPackageIssued)
  const safePlan = installmentPlan.length > 0
    ? installmentPlan
    : [{
        period: 1,
        dueDate: cardPackageIssued ? formatDateTime(order.createdAt).slice(0, 10) : '',
        principal: Number(order.totalAmount.toFixed(2)),
        fee: 0,
        amount: Number(order.totalAmount.toFixed(2)),
        paid: parseInstallmentPaid(order.paid),
      }]
  const periods = safePlan.length || fallbackPeriods
  const nextPending = safePlan.find(item => !item.paid)
  const allPaid = safePlan.every(item => item.paid)
  const nextRepayDue = nextPending ? resolveInstallmentEffectiveDueDate(nextPending) : ''
  const periodAmount = Number(
    ((nextPending || safePlan[0])?.amount ?? 0).toFixed(2),
  )
  const riskStatus = order.riskStatus === 'failed' ? 'failed' : 'passed'
  const tracking = String(order.trackingNumber || '').trim()
  const status = mapMallOrderStatus(order.status, order.paid, order.payType, order.riskStatus)
  const userRemark = typeof order.buyerAdminRemark === 'string' ? order.buyerAdminRemark.trim() : ''
  const signedAtRaw = order.cardPackageContractSignedAt
  const signedAt = typeof signedAtRaw === 'string' && signedAtRaw.trim() ? signedAtRaw.trim() : ''
  const rawEc = order.emergencyContactsComplete

  const recvName = String(order.receiverName || '').trim()
  const recvPhone = String(order.receiverPhone || '').trim()
  const buyerName = String(order.buyerName || '').trim()
  let buyerPhone = String(order.buyerPhone || '').trim().replace(/\D/g, '')
  if (buyerPhone.startsWith('86') && buyerPhone.length === 13) {
    buyerPhone = buyerPhone.slice(2)
  }
  if (!/^1\d{10}$/.test(buyerPhone)) {
    buyerPhone = ''
  }
  const mallUserId = String(order.mallUserId || '').trim() || undefined

  return {
    id: order.id,
    user: buyerName || '—',
    receiverName: recvName,
    receiverAddress: String(order.receiverAddress || '').trim(),
    receiverPhone: recvPhone,
    buyerPhone,
    mallUserId,
    product: order.name,
    cardPackageAmount: Math.max(0, Math.round(Number(order.cardPackageAmount ?? 0))),
    totalAmount: Number(order.totalAmount.toFixed(2)),
    periods,
    periodAmount,
    currentPeriod: allPaid ? periods : (nextPending?.period || 1),
    nextRepayDate: allPaid ? '-' : (cardPackageIssued && nextRepayDue ? nextRepayDue : '-'),
    status,
    riskStatus,
    riskReason: order.riskReason || '',
    manualRejectReason: order.manualRejectReason || '',
    payType: order.payType === 'installment' ? '先享后付' : '全款',
    createdAt: formatDateTime(order.createdAt),
    cardPackageIssuedAt: formatDateTime(order.cardPackageIssuedAt || ''),
    installmentPlan: safePlan,
    cardPackageIssued,
    cardPackageContractSigned: Boolean(signedAt),
    cardPackageContractSignedAt: signedAt,
    trackingNumber: tracking,
    userRemark,
    ...(rawEc === true ? { emergencyContactsComplete: true as const }
      : rawEc === false ? { emergencyContactsComplete: false as const }
        : rawEc === null ? { emergencyContactsComplete: null }
          : {}),
    isOldCustomer: Boolean(order.isOldCustomer),
  }
}

function mergeOrderAfterPatch(prev: OrderItem, mapped: OrderItem): OrderItem {
  return mergePatchedOrder(prev, mapped)
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

function installmentNegotiateUrl(orderId: string, period: number) {
  return MALL_INSTALLMENT_NEGOTIATE_ENDPOINT
    .replace(':id', encodeURIComponent(orderId))
    .replace(':period', encodeURIComponent(String(period)))
}

function installmentSettleAmountUrl(orderId: string, period: number) {
  return MALL_INSTALLMENT_SETTLE_AMOUNT_ENDPOINT
    .replace(':id', encodeURIComponent(orderId))
    .replace(':period', encodeURIComponent(String(period)))
}

function installmentNegotiationHistoryPaidUrl(orderId: string, period: number, historyIndex: number) {
  return MALL_INSTALLMENT_NEGOTIATION_HISTORY_PAID_ENDPOINT
    .replace(':id', encodeURIComponent(orderId))
    .replace(':period', encodeURIComponent(String(period)))
    .replace(':historyIndex', encodeURIComponent(String(historyIndex)))
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

async function fetchOrders(params: OrderFilterParams = {}): Promise<number> {
  const query = new URLSearchParams()
  if (params.keyword) query.set('keyword', params.keyword)
  const statusQuery = mapStatusToApi(params.status)
  if (statusQuery.status) query.set('status', statusQuery.status)
  if (statusQuery.adminStatus) query.set('adminStatus', statusQuery.adminStatus)
  const apiPayType = mapPayTypeToApi(params.payType)
  if (apiPayType) query.set('payType', apiPayType)
  if (params.date) query.set('date', params.date)
  if (params.listScope) query.set('listScope', params.listScope)
  if (params.repayFilter && params.repayFilter !== '全部') {
    query.set('repayFilter', params.repayFilter)
  }
  if (params.riskStatus) query.set('riskStatus', params.riskStatus)
  const page = Math.max(1, Number(params.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 20))
  query.set('page', String(page))
  query.set('pageSize', String(pageSize))

  const url = `${MALL_ORDERS_ENDPOINT}?${query.toString()}`
  const response = await fetch(url, {
    method: 'GET',
    headers: withMallTenantHeaders(),
  })
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, '请求订单失败'))
  }
  const payload = await response.json() as {
    success?: boolean
    data?: MallOrderPayload[] | {
      list?: MallOrderPayload[]
      total?: number
    }
  }
  const data = payload.data
  let list: MallOrderPayload[] = []
  let total = 0
  if (Array.isArray(data)) {
    list = data
    total = data.length
  }
  else if (data && Array.isArray(data.list)) {
    list = data.list
    total = Math.max(0, Number(data.total) || 0)
  }
  orders.value = list.map(mapMallOrderToAdminOrder)
  return total
}

async function fetchOrderById(orderId: string): Promise<OrderItem> {
  const response = await fetch(`${MALL_ORDERS_ENDPOINT}/${encodeURIComponent(orderId)}`, {
    method: 'GET',
    headers: withMallTenantHeaders(),
  })
  const payload = await response.json().catch(() => ({})) as { success?: boolean, data?: MallOrderPayload, msg?: string }
  if (!response.ok) {
    throw new Error(apiErrorMessage(payload, '请求订单失败'))
  }
  if (!payload.data) {
    throw new Error(payload.msg || '订单数据为空')
  }
  const mapped = mapMallOrderToAdminOrder(payload.data)
  orders.value = orders.value.map(item => (item.id === mapped.id ? mapped : item))
  return mapped
}

async function updateInstallmentDueDate(orderId: string, period: number, addDays: number) {
  const response = await fetch(installmentDueDateUrl(orderId, period), {
    method: 'PATCH',
    headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ addDays }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { msg?: string }
    throw new Error(apiErrorMessage(payload, '延期还款日失败'))
  }
  const payload = await response.json() as { success?: boolean, data?: MallOrderPayload }
  if (!payload.data) {
    return
  }
  const mapped = mapMallOrderToAdminOrder(payload.data)
  orders.value = orders.value.map(item => (item.id === mapped.id ? mergeOrderAfterPatch(item, mapped) : item))
}

async function setInstallmentRepaymentDueDate(orderId: string, period: number, dueDate: string) {
  const response = await fetch(installmentDueDateUrl(orderId, period), {
    method: 'PATCH',
    headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ dueDate }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { msg?: string }
    throw new Error(apiErrorMessage(payload, '修改协商还款日失败'))
  }
  const payload = await response.json() as { success?: boolean, data?: MallOrderPayload }
  if (!payload.data) {
    return
  }
  const mapped = mapMallOrderToAdminOrder(payload.data)
  orders.value = orders.value.map(item => (item.id === mapped.id ? mergeOrderAfterPatch(item, mapped) : item))
}

async function updateInstallmentSettleAmount(orderId: string, period: number, amount: number) {
  const response = await fetch(installmentSettleAmountUrl(orderId, period), {
    method: 'PATCH',
    headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ amount }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { msg?: string }
    throw new Error(apiErrorMessage(payload, '修改应还金额失败'))
  }
  const payload = await response.json() as { success?: boolean, data?: MallOrderPayload }
  if (!payload.data) {
    return
  }
  const mapped = mapMallOrderToAdminOrder(payload.data)
  orders.value = orders.value.map(item => (item.id === mapped.id ? mergeOrderAfterPatch(item, mapped) : item))
}

async function updateInstallmentNegotiate(
  orderId: string,
  period: number,
  body: { negotiatedAmount: number, remainderDueDate: string },
) {
  const response = await fetch(installmentNegotiateUrl(orderId, period), {
    method: 'PATCH',
    headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { msg?: string }
    throw new Error(apiErrorMessage(payload, '协商还款失败'))
  }
  const payload = await response.json() as { success?: boolean, data?: MallOrderPayload }
  if (!payload.data) {
    return
  }
  const mapped = mapMallOrderToAdminOrder(payload.data)
  orders.value = orders.value.map(item => (item.id === mapped.id ? mergeOrderAfterPatch(item, mapped) : item))
}

async function updateInstallmentNegotiationHistoryPaid(orderId: string, period: number, historyIndex: number, paid: boolean) {
  const response = await fetch(installmentNegotiationHistoryPaidUrl(orderId, period, historyIndex), {
    method: 'PATCH',
    headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ paid }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { msg?: string }
    throw new Error(apiErrorMessage(payload, '更新协商还款状态失败'))
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
    headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ paid }),
  })
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, '更新先享后付状态失败'))
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
    headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ cardPackageIssued }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { msg?: string }
    throw new Error(apiErrorMessage(payload, '更新卡包发放状态失败'))
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
    headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ signed }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { msg?: string }
    throw new Error(apiErrorMessage(payload, '更新合同签署状态失败'))
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
    headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ trackingNumber }),
  })
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, '登记快递单号失败'))
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
    headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ status }),
  })
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, '更新订单状态失败'))
  }
  const payload = await response.json() as { success?: boolean, data?: MallOrderPayload }
  if (!payload.data) {
    return
  }
  const mapped = mapMallOrderToAdminOrder(payload.data)
  orders.value = orders.value.map(item => (item.id === mapped.id ? mergeOrderAfterPatch(item, mapped) : item))
}

/** 审核页「审核不通过」：订单仍为 reviewing，仅 riskStatus 置为 failed */
async function rejectOrderReview(orderId: string, riskReason: string) {
  const reason = riskReason.trim()
  if (!reason) {
    throw new Error('请填写审核不通过原因')
  }
  const response = await fetch(`${MALL_ORDERS_ENDPOINT}/${encodeURIComponent(orderId)}/status`, {
    method: 'PATCH',
    headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      riskStatus: 'failed',
      riskReason: reason,
    }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { msg?: string }
    throw new Error(apiErrorMessage(payload, '审核不通过失败'))
  }
  const payload = await response.json() as { success?: boolean, data?: MallOrderPayload }
  if (!payload.data) {
    return
  }
  const mapped = mapMallOrderToAdminOrder(payload.data)
  orders.value = orders.value.map(item => (item.id === mapped.id ? mergeOrderAfterPatch(item, mapped) : item))
}

/** 审核页「重新审核」：风控未通过订单恢复为待审核（riskStatus=passed） */
async function reReviewOrderReview(orderId: string) {
  const response = await fetch(`${MALL_ORDERS_ENDPOINT}/${encodeURIComponent(orderId)}/status`, {
    method: 'PATCH',
    headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ riskStatus: 'passed' }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { msg?: string }
    throw new Error(apiErrorMessage(payload, '重新审核失败'))
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
    headers: withMallTenantHeaders(),
  })
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, '获取风控详情失败'))
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
    const due = resolveInstallmentEffectiveDueDate(nextPending)
    order.nextRepayDate = order.cardPackageIssued && due ? due : '-'
  }
  if (order.status === '已完成') {
    const tn = (order.trackingNumber || '').trim()
    order.status = tn ? '待收货' : '待发货'
  }
}

async function deleteOrder(orderId: string) {
  const response = await fetch(`${MALL_ORDERS_ENDPOINT}/${encodeURIComponent(orderId)}`, {
    method: 'DELETE',
    headers: withMallTenantHeaders(),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { msg?: string }
    throw new Error(apiErrorMessage(payload, '删除订单失败'))
  }
  orders.value = orders.value.filter(item => item.id !== orderId)
}

export function useOrdersStore() {
  return {
    orders,
    fetchOrders,
    fetchOrderById,
    recalculateOrderFields,
    updateInstallmentPaid,
    updateInstallmentDueDate,
    setInstallmentRepaymentDueDate,
    updateInstallmentSettleAmount,
    updateInstallmentNegotiate,
    updateInstallmentNegotiationHistoryPaid,
    updateOrderShipment,
    updateOrderStatus,
    rejectOrderReview,
    reReviewOrderReview,
    updateOrderCardPackage,
    updateOrderCardPackageContract,
    fetchOrderRiskDetail,
    deleteOrder,
  }
}
