const lakala = require('./lakalaClient')

/** @type {Record<string, Function>} */
let deps = {}

function initLakalaPayment(dependencies) {
  deps = dependencies
}

function ensurePaymentStore(db) {
  if (!Array.isArray(db.lakalaPayments)) {
    db.lakalaPayments = []
  }
}

function findPayment(db, outTradeNo) {
  ensurePaymentStore(db)
  return db.lakalaPayments.find(item => String(item.outTradeNo) === String(outTradeNo))
}

function generateOutTradeNo(prefix = 'LP') {
  return `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 8)}`.slice(0, 32)
}

function resolveNotifyUrl() {
  const url = lakala.readEnvTrim('LAKALA_NOTIFY_URL')
  if (!url) {
    throw new Error('未配置 LAKALA_NOTIFY_URL（拉卡拉异步通知地址，须为公网 HTTPS）')
  }
  return url
}

function resolveCallbackUrl() {
  return lakala.readEnvTrim('LAKALA_CALLBACK_URL') || ''
}

function buildPaymentRecordBase({
  bizType,
  mallUserId,
  mallUserPhone,
  amountYuan,
  payChannel,
  orderId,
  period,
  subject,
}) {
  return {
    outTradeNo: generateOutTradeNo(),
    tradeNo: '',
    bizType,
    mallUserId: String(mallUserId || ''),
    mallUserPhone: String(mallUserPhone || ''),
    orderId: orderId ? String(orderId) : '',
    period: Number.isFinite(Number(period)) ? Number(period) : undefined,
    amountYuan: Number(Number(amountYuan).toFixed(2)),
    amountCents: lakala.yuanToCents(amountYuan),
    payChannel: String(payChannel || 'wechat'),
    accountType: lakala.mapPayChannelToAccountType(payChannel),
    status: 'pending',
    tradeState: '',
    payCode: '',
    createdAt: new Date().toISOString(),
    paidAt: '',
    notifyRaw: null,
    subject: String(subject || '商城支付').slice(0, 42),
  }
}

async function createMallPayment(ctx, payload, mallUser) {
  const db = deps.readDb()
  deps.reconcileInstallmentCompletionAcrossDb(db)
  const bizType = String(payload.bizType || '').trim()
  const payChannel = String(payload.payChannel || 'wechat').trim()
  const orderId = String(payload.orderId || '').trim()
  const period = Number(payload.period)
  const repayAll = payload.all === true || payload.all === 'true' || payload.all === 1

  let amountYuan = 0
  let subject = '商城支付'
  let record

  if (bizType === 'order_full') {
    const order = db.orders.find(item => String(item.id) === orderId && deps.orderBelongsToRegisteredMallUser(db, item, mallUser))
    if (!order) {
      throw Object.assign(new Error('订单不存在'), { statusCode: 404 })
    }
    if (order.paid) {
      throw Object.assign(new Error('订单已支付'), { statusCode: 400 })
    }
    if (order.payType !== 'full') {
      throw Object.assign(new Error('该订单须使用账单还款支付'), { statusCode: 400 })
    }
    amountYuan = Number(order.totalAmount)
    subject = `订单${order.id}`
    record = buildPaymentRecordBase({
      bizType,
      mallUserId: mallUser.id,
      mallUserPhone: mallUser.phone,
      amountYuan,
      payChannel,
      orderId: order.id,
      subject,
    })
  }
  else if (bizType === 'bill_repay') {
    if (!orderId || !Number.isInteger(period) || period <= 0) {
      throw Object.assign(new Error('请提供 orderId 与 period'), { statusCode: 400 })
    }
    const calc = deps.calcBillRepayAmount(db, mallUser, { orderId, period })
    amountYuan = calc.amountYuan
    subject = calc.subject
    record = buildPaymentRecordBase({
      bizType,
      mallUserId: mallUser.id,
      mallUserPhone: mallUser.phone,
      amountYuan,
      payChannel,
      orderId,
      period,
      subject,
    })
  }
  else if (bizType === 'bill_repay_negotiated') {
    if (!orderId || !Number.isInteger(period) || period <= 0) {
      throw Object.assign(new Error('请提供 orderId 与 period'), { statusCode: 400 })
    }
    const calc = deps.calcBillNegotiatedPayAmount(db, mallUser, { orderId, period })
    amountYuan = calc.amountYuan
    subject = calc.subject
    record = buildPaymentRecordBase({
      bizType,
      mallUserId: mallUser.id,
      mallUserPhone: mallUser.phone,
      amountYuan,
      payChannel,
      orderId,
      period,
      subject,
    })
  }
  else if (bizType === 'bill_repay_all') {
    if (!repayAll) {
      throw Object.assign(new Error('bill_repay_all 需 all=true'), { statusCode: 400 })
    }
    const calc = deps.calcBillRepayAllAmount(db, mallUser)
    amountYuan = calc.amountYuan
    subject = calc.subject
    record = buildPaymentRecordBase({
      bizType,
      mallUserId: mallUser.id,
      mallUserPhone: mallUser.phone,
      amountYuan,
      payChannel,
      subject,
    })
  }
  else {
    throw Object.assign(new Error('不支持的支付业务类型'), { statusCode: 400 })
  }

  if (amountYuan <= 0) {
    throw Object.assign(new Error('支付金额须大于 0'), { statusCode: 400 })
  }

  let notifyUrl = ''
  if (!lakala.isLakalaMockEnabled()) {
    notifyUrl = resolveNotifyUrl()
  }

  const preorder = await lakala.createCounterOrder({
    outOrderNo: record.outTradeNo,
    totalAmountYuan: amountYuan,
    orderInfo: record.subject,
    notifyUrl,
    callbackUrl: resolveCallbackUrl(),
    payChannel: record.payChannel,
  })
  const presentation = lakala.extractPayPresentation(preorder)
  record.tradeNo = presentation.payOrderNo || presentation.tradeNo
  record.payCode = presentation.counterUrl || presentation.payCode
  record.payCodeImage = presentation.payCodeImage

  ensurePaymentStore(db)
  db.lakalaPayments.unshift(record)
  deps.writeDb(db)
  await deps.flushMongoPersist()

  return {
    outTradeNo: record.outTradeNo,
    tradeNo: record.tradeNo,
    amountYuan: record.amountYuan,
    payChannel: record.payChannel,
    accountType: record.accountType,
    payCode: record.payCode,
    payCodeImage: record.payCodeImage,
    counterUrl: record.payCode,
    payOrderNo: record.tradeNo,
    mock: lakala.isLakalaMockEnabled(),
    bizType: record.bizType,
    orderId: record.orderId,
    period: record.period,
  }
}

async function fulfillPaymentRecord(db, record, { tradeState, notifyRaw } = {}) {
  if (!record || record.status === 'success') {
    return { already: true }
  }
  record.tradeState = tradeState || record.tradeState || 'SUCCESS'
  record.status = 'success'
  record.paidAt = new Date().toISOString()
  if (notifyRaw) {
    record.notifyRaw = notifyRaw
  }

  const phone = deps.normalizePhone(record.mallUserPhone)
  const mallUser = deps.resolveRegisteredMallUserByNormalizedPhone(db, phone)

  if (record.bizType === 'order_full') {
    const target = db.orders.find(item => String(item.id) === String(record.orderId))
    if (!target) {
      throw new Error('关联订单不存在')
    }
    deps.markOrderPaidInDb(target, record.payChannel)
  }
  else if (record.bizType === 'bill_repay') {
    deps.applyBillRepayInDb(db, mallUser, { orderId: record.orderId, period: record.period })
  }
  else if (record.bizType === 'bill_repay_negotiated') {
    deps.applyBillNegotiatedPayInDb(db, mallUser, { orderId: record.orderId, period: record.period })
  }
  else if (record.bizType === 'bill_repay_all') {
    deps.applyBillRepayAllInDb(db, mallUser)
  }

  deps.writeDb(db)
  await deps.flushMongoPersist()

  let billing
  if (/^1\d{10}$/.test(phone)) {
    const dbAfter = deps.readDb()
    billing = deps.buildMallBillsSuccessData(dbAfter, phone)
  }
  return { already: false, billing }
}

async function syncPaymentStatus(outTradeNo, { mallUser } = {}) {
  const db = deps.readDb()
  const record = findPayment(db, outTradeNo)
  if (!record) {
    throw Object.assign(new Error('支付单不存在'), { statusCode: 404 })
  }
  if (mallUser && String(record.mallUserId) !== String(mallUser.id)) {
    throw Object.assign(new Error('无权查询该支付单'), { statusCode: 403 })
  }
  if (record.status === 'success') {
    return {
      status: 'success',
      tradeState: record.tradeState || 'SUCCESS',
      outTradeNo: record.outTradeNo,
      billing: undefined,
    }
  }

  const queried = await lakala.queryCounterOrder({
    outOrderNo: record.outTradeNo,
    payOrderNo: record.tradeNo,
  })
  const payState = lakala.parseCounterQueryPaid(queried)
  const tradeState = payState.tradeState
  record.tradeState = tradeState
  if (payState.paid) {
    const result = await fulfillPaymentRecord(db, record, { tradeState })
    return {
      status: 'success',
      tradeState,
      outTradeNo: record.outTradeNo,
      billing: result.billing,
    }
  }

  deps.writeDb(db)
  await deps.flushMongoPersist()
  return {
    status: 'pending',
    tradeState,
    outTradeNo: record.outTradeNo,
  }
}

/** 同步当前用户近期 pending 支付单（覆盖 session 丢失、收银台内换支付方式等场景） */
async function syncAllPendingPayments(mallUser, { maxAgeMs = 24 * 60 * 60 * 1000, limit = 5 } = {}) {
  const db = deps.readDb()
  ensurePaymentStore(db)
  const userId = String(mallUser?.id || '')
  if (!userId) {
    return { synced: 0, billing: undefined }
  }
  const cutoff = Date.now() - maxAgeMs
  const pending = db.lakalaPayments.filter((item) => {
    if (String(item.mallUserId) !== userId || item.status === 'success') {
      return false
    }
    const created = Date.parse(String(item.createdAt || ''))
    return Number.isFinite(created) && created >= cutoff
  }).slice(0, limit)

  let synced = 0
  let billing
  for (const item of pending) {
    try {
      const result = await syncPaymentStatus(item.outTradeNo, { mallUser })
      if (result.status === 'success') {
        synced += 1
        if (result.billing) {
          billing = result.billing
        }
      }
    }
    catch (err) {
      console.warn('[lakala] sync pending failed', item.outTradeNo, err.message)
    }
  }
  return { synced, billing }
}

async function handleNotifyPayload(notifyBody) {
  const raw = notifyBody && typeof notifyBody === 'object' ? notifyBody : {}
  const nested = raw.req_data && typeof raw.req_data === 'object' ? raw.req_data : raw
  const outTradeNo = String(
    nested.out_order_no || nested.out_trade_no || raw.out_order_no || raw.out_trade_no || '',
  ).trim()
  const tradeStatus = String(
    nested.order_status || nested.trade_status || nested.trade_state
    || raw.order_status || raw.trade_status || raw.trade_state || '',
  ).trim()
  if (!outTradeNo) {
    throw new Error('通知缺少 out_order_no')
  }
  const db = deps.readDb()
  const record = findPayment(db, outTradeNo)
  if (!record) {
    console.warn('[lakala-notify] 未知支付单', outTradeNo)
    return { ok: true }
  }
  if (nested.pay_order_no || raw.pay_order_no) {
    record.tradeNo = String(nested.pay_order_no || raw.pay_order_no)
  }
  if (lakala.isOrderPaidStatus(tradeStatus) || lakala.isTradeSuccessState(tradeStatus)) {
    await fulfillPaymentRecord(db, record, { tradeState: tradeStatus, notifyRaw: notifyBody })
  }
  else {
    record.tradeState = tradeStatus
    record.notifyRaw = notifyBody
    deps.writeDb(db)
    await deps.flushMongoPersist()
  }
  return { ok: true }
}

async function mockCompletePayment(outTradeNo, mallUser) {
  if (!lakala.isLakalaMockEnabled()) {
    throw Object.assign(new Error('模拟支付未启用'), { statusCode: 403 })
  }
  const db = deps.readDb()
  const record = findPayment(db, outTradeNo)
  if (!record) {
    throw Object.assign(new Error('支付单不存在'), { statusCode: 404 })
  }
  if (mallUser && String(record.mallUserId) !== String(mallUser.id)) {
    throw Object.assign(new Error('无权操作'), { statusCode: 403 })
  }
  const result = await fulfillPaymentRecord(db, record, { tradeState: 'SUCCESS', notifyRaw: { mock: true } })
  return { status: 'success', billing: result.billing }
}

module.exports = {
  initLakalaPayment,
  createMallPayment,
  syncPaymentStatus,
  syncAllPendingPayments,
  handleNotifyPayload,
  mockCompletePayment,
  findPayment,
}
