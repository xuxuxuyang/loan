'use strict'

const REPAYMENT_RECORD_PERMISSION_KEY = 'orders.repayment.records'
const REPAYMENT_STATUS_SET = new Set(['all', 'paid'])
const ONLINE_REPAY_BIZ_TYPES = new Set(['bill_repay', 'bill_repay_negotiated', 'bill_repay_all'])
const PAYMENT_CHANNEL_LABELS = {
  wechat: '微信',
  alipay: '支付宝',
  union: '银联',
  other: '其他支付',
}
const BIZ_TYPE_LABELS = {
  bill_repay: '账单还款',
  bill_repay_negotiated: '协商支付',
  bill_repay_all: '全部还款',
}

function normalizeActualPayChannel(raw) {
  const value = trimString(raw).toUpperCase()
  if (!value) {
    return ''
  }
  if (value.includes('WECHAT') || value.includes('WX') || value.includes('微信')) {
    return 'wechat'
  }
  if (value.includes('ALIPAY') || value.includes('ALI') || value.includes('支付宝')) {
    return 'alipay'
  }
  if (value.includes('UNION') || value.includes('BANK') || value.includes('银联')) {
    return 'union'
  }
  return 'other'
}

function pickActualPayChannelSource(payload) {
  if (!payload || typeof payload !== 'object') {
    return ''
  }
  const keys = [
    'actualPayChannel',
    'actual_pay_channel',
    'pay_channel',
    'payChannel',
    'pay_mode',
    'payMode',
    'account_type',
    'accountType',
    'trade_type',
    'tradeType',
    'bank_type',
    'bankType',
  ]
  for (const key of keys) {
    if (payload[key] != null && trimString(payload[key])) {
      return trimString(payload[key])
    }
  }
  const list = payload.order_trade_info_list || payload.orderTradeInfoList
  if (Array.isArray(list)) {
    for (const item of list) {
      const picked = pickActualPayChannelSource(item)
      if (picked) {
        return picked
      }
    }
  }
  const nested = payload.req_data || payload.resp_data || payload.data
  if (nested && typeof nested === 'object') {
    return pickActualPayChannelSource(nested)
  }
  return ''
}

function resolvePaymentActualChannel(payment) {
  return normalizeActualPayChannel(payment && payment.actualPayChannel)
    || normalizeActualPayChannel(pickActualPayChannelSource(payment && payment.notifyRaw))
    || normalizeActualPayChannel(payment && payment.payChannel)
}

function trimString(value) {
  return String(value || '').trim()
}

function normalizePhoneDigits(value) {
  let digits = trimString(value).replace(/\D/g, '')
  if (digits.startsWith('86') && digits.length === 13) {
    digits = digits.slice(2)
  }
  return digits
}

function normalizeDateKey(value) {
  const raw = trimString(value)
  if (!raw) {
    return ''
  }
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  if (match) {
    return match[1]
  }
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const yyyy = date.getFullYear()
  const mm = `${date.getMonth() + 1}`.padStart(2, '0')
  const dd = `${date.getDate()}`.padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function roundMoney(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0
}

function parseRepaymentStatus(raw) {
  const value = trimString(raw || 'paid').toLowerCase()
  return REPAYMENT_STATUS_SET.has(value) ? value : 'paid'
}

function parseDateRange(query, startKey, endKey) {
  const start = normalizeDateKey(query[startKey])
  const end = normalizeDateKey(query[endKey])
  return { start, end }
}

function dateInRange(value, range) {
  const key = normalizeDateKey(value)
  if (!key) {
    return false
  }
  if (range.start && key < range.start) {
    return false
  }
  if (range.end && key > range.end) {
    return false
  }
  return true
}

function optionalDateInRange(value, range) {
  if (!range.start && !range.end) {
    return true
  }
  return dateInRange(value, range)
}

function paymentIsSuccessfulOnlineRepayment(payment) {
  return payment
    && ONLINE_REPAY_BIZ_TYPES.has(trimString(payment.bizType))
    && trimString(payment.status).toLowerCase() === 'success'
    && Boolean(trimString(payment.paidAt))
}

function paymentChannelLabel(payment) {
  if (!payment) {
    return '未知渠道'
  }
  const channel = resolvePaymentActualChannel(payment)
  return PAYMENT_CHANNEL_LABELS[channel] || trimString(payment.payChannel) || '未知渠道'
}

function resolveBuyerFromPayment(db, payment) {
  if (!db || !Array.isArray(db.users) || !payment) {
    return null
  }
  const mallUserId = trimString(payment.mallUserId)
  if (mallUserId) {
    const byId = db.users.find(user => user && trimString(user.id) === mallUserId)
    if (byId) {
      return byId
    }
  }
  const phone = normalizePhoneDigits(payment.mallUserPhone)
  if (!/^1\d{10}$/.test(phone)) {
    return null
  }
  return db.users.find(user => user && normalizePhoneDigits(user.phone) === phone) || null
}

function paymentTimestampMs(payment) {
  const ms = Date.parse(trimString(payment && (payment.createdAt || payment.paidAt)))
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY
}

function orderCreatedAtMs(order) {
  const ms = Date.parse(trimString(order && order.createdAt))
  return Number.isFinite(ms) ? ms : 0
}

function orderCreatedBeforePayment(order, payment) {
  const orderMs = orderCreatedAtMs(order)
  const payMs = paymentTimestampMs(payment)
  if (!Number.isFinite(payMs)) {
    return true
  }
  return orderMs <= payMs
}

function orderInstallmentTotal(order, deps) {
  deps.ensureOrderInstallmentPlan(order)
  const plan = Array.isArray(order.installmentPlan) ? order.installmentPlan : []
  const total = plan.reduce((sum, item) => sum + roundMoney(item && (item.amount || order.totalAmount)), 0)
  return roundMoney(total || order.totalAmount)
}

function resolvePaymentOrderRef({ db, deps, payment }) {
  const savedOrderId = trimString(payment && payment.orderId)
  if (savedOrderId) {
    return { orderId: savedOrderId, period: Number(payment.period) || 0 }
  }
  if (!db || !payment || trimString(payment.bizType) !== 'bill_repay_all') {
    return { orderId: '', period: 0 }
  }
  const buyer = resolveBuyerFromPayment(db, payment)
  if (!buyer || !Array.isArray(db.orders)) {
    return { orderId: '', period: 0 }
  }
  const candidates = []
  for (const order of db.orders) {
    if (!deps.orderBelongsToRegisteredMallUser(db, order, buyer) || order.payType !== 'installment' || order.status === 'reviewing') {
      continue
    }
    if (!orderCreatedBeforePayment(order, payment)) {
      continue
    }
    if (orderInstallmentTotal(order, deps) !== roundMoney(payment.amountYuan)) {
      continue
    }
    candidates.push({
      orderId: trimString(order.id),
      period: 1,
      createdAtMs: orderCreatedAtMs(order),
    })
  }
  candidates.sort((a, b) => b.createdAtMs - a.createdAtMs)
  if (candidates.length === 0 || (candidates[1] && candidates[1].createdAtMs === candidates[0].createdAtMs)) {
    return { orderId: '', period: 0 }
  }
  return candidates[0]
}

function buildPaymentRecordRow({ db, deps, payment }) {
  const buyer = resolveBuyerFromPayment(db, payment)
  const registerChannelView = deps.resolveOrderRegisterChannelView(db, buyer)
  const inferredOrder = resolvePaymentOrderRef({ db, deps, payment })
  const period = Number(payment.period || inferredOrder.period)
  const actualPayChannel = resolvePaymentActualChannel(payment)
  return {
    id: trimString(payment.outTradeNo) || `${trimString(payment.tradeNo)}-${trimString(payment.paidAt)}`,
    outTradeNo: trimString(payment.outTradeNo),
    tradeNo: trimString(payment.tradeNo),
    bizType: trimString(payment.bizType),
    bizTypeLabel: BIZ_TYPE_LABELS[trimString(payment.bizType)] || trimString(payment.bizType) || '还款',
    payChannel: actualPayChannel || trimString(payment.payChannel),
    paymentMethodLabel: paymentChannelLabel(payment),
    status: trimString(payment.status),
    statusLabel: '已支付',
    tradeState: trimString(payment.tradeState),
    paidAmount: roundMoney(payment.amountYuan),
    createdAt: trimString(payment.createdAt),
    paidAt: trimString(payment.paidAt),
    subject: trimString(payment.subject),
    orderId: trimString(payment.orderId) || inferredOrder.orderId,
    period: Number.isFinite(period) && period > 0 ? period : 0,
    mallUserId: trimString(payment.mallUserId),
    mallUserPhone: normalizePhoneDigits(payment.mallUserPhone) || trimString(payment.mallUserPhone),
    buyerName: trimString(buyer && buyer.name),
    buyerAdminRemark: trimString(buyer && buyer.adminRemark),
    registerChannelCode: registerChannelView.registerChannelCode,
    registerChannelName: registerChannelView.registerChannelName,
    registerChannelLabel: registerChannelView.registerChannelLabel,
  }
}

function keywordMatches(row, keyword) {
  const kw = trimString(keyword)
  if (!kw) {
    return true
  }
  const lower = kw.toLowerCase()
  const digits = normalizePhoneDigits(kw)
  const textFields = [
    row.outTradeNo,
    row.tradeNo,
    row.orderId,
    row.subject,
    row.buyerName,
    row.mallUserId,
    row.bizTypeLabel,
    row.paymentMethodLabel,
  ]
  if (textFields.some(value => trimString(value).toLowerCase().includes(lower))) {
    return true
  }
  if (!digits) {
    return false
  }
  return normalizePhoneDigits(row.mallUserPhone).includes(digits)
}

function paymentChannelMatches(row, channel) {
  const value = trimString(channel).toLowerCase()
  if (!value || value === 'all') {
    return true
  }
  if (value === 'negotiated') {
    return row.bizType === 'bill_repay_negotiated'
  }
  return trimString(row.payChannel).toLowerCase() === value
}

function compareTimestampDesc(a, b) {
  const left = Date.parse(trimString(a))
  const right = Date.parse(trimString(b))
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) {
    return right - left
  }
  return trimString(b).localeCompare(trimString(a))
}

function buildRepaymentRecords(db, deps, query) {
  const paidRange = parseDateRange(query, 'paidStartDate', 'paidEndDate')
  const status = parseRepaymentStatus(query.status)
  const keyword = trimString(query.keyword)
  const paymentChannel = trimString(query.paymentChannel || 'all')
  const rows = []

  for (const payment of Array.isArray(db.lakalaPayments) ? db.lakalaPayments : []) {
    if (!paymentIsSuccessfulOnlineRepayment(payment)) {
      continue
    }
    const row = buildPaymentRecordRow({ db, deps, payment })
    if (!optionalDateInRange(row.paidAt, paidRange)) {
      continue
    }
    if (status !== 'all' && row.status !== 'success') {
      continue
    }
    if (!paymentChannelMatches(row, paymentChannel)) {
      continue
    }
    if (!keywordMatches(row, keyword)) {
      continue
    }
    rows.push(row)
  }

  rows.sort((a, b) => {
    const paidDiff = compareTimestampDesc(a.paidAt, b.paidAt)
    if (paidDiff !== 0) return paidDiff
    const createdDiff = compareTimestampDesc(a.createdAt, b.createdAt)
    if (createdDiff !== 0) return createdDiff
    return trimString(b.outTradeNo).localeCompare(trimString(a.outTradeNo))
  })
  return rows
}

function summarizeRows(rows) {
  const customerKeys = new Set()
  const summary = {
    paidAmount: 0,
    recordCount: rows.length,
    customerCount: 0,
  }
  for (const row of rows) {
    summary.paidAmount += row.paidAmount
    const key = row.mallUserId || row.mallUserPhone || row.buyerName
    if (key) {
      customerKeys.add(key)
    }
  }
  summary.paidAmount = roundMoney(summary.paidAmount)
  summary.customerCount = customerKeys.size
  return summary
}

function registerRepaymentRecordRoutes(router, ctxApi) {
  const {
    success,
    readDb,
    requireAdminPermissionOnAny,
    parseOptionalListPagination,
    paginateRows,
    ...deps
  } = ctxApi

  router.get('/admin/orders/repayment-records', async (ctx) => {
    if (!await requireAdminPermissionOnAny(ctx, [REPAYMENT_RECORD_PERMISSION_KEY, 'orders.receivable.data'], 'view', '查看还款记录')) {
      return
    }
    const db = readDb()
    const rows = buildRepaymentRecords(db, deps, ctx.query || {})
    const summary = summarizeRows(rows)
    const pagination = parseOptionalListPagination(ctx.query || {}, { defaultPageSize: 50, maxPageSize: 200 })
    const paged = pagination.enabled
      ? paginateRows(rows, pagination.page, pagination.pageSize)
      : { list: rows.slice(0, 50), total: rows.length, page: 1, pageSize: 50 }
    ctx.body = success({
      rows: paged.list,
      total: paged.total,
      page: paged.page,
      pageSize: paged.pageSize,
      summary,
    })
  })
}

module.exports = {
  REPAYMENT_RECORD_PERMISSION_KEY,
  buildRepaymentRecords,
  summarizeRows,
  registerRepaymentRecordRoutes,
}