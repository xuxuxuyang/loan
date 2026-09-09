const lakala = require('./lakalaClient')

/** @type {Record<string, Function>} */
let deps = {}
const settlementInflight = new Map()
const paymentWriteQueues = new Map()

function paymentScopeKey() {
  return deps.getPaymentScopeKey ? deps.getPaymentScopeKey() : 'default'
}

function runPaymentWrite(work) {
  const key = paymentScopeKey()
  const previous = paymentWriteQueues.get(key) || Promise.resolve()
  // Read the working copy after earlier settlements publish, including other periods of this order.
  const job = previous.catch(() => {}).then(work)
  paymentWriteQueues.set(key, job)
  const clean = () => {
    if (paymentWriteQueues.get(key) === job) paymentWriteQueues.delete(key)
  }
  job.then(clean, clean)
  return job
}

function runSettlementOnce(outTradeNo, work) {
  const key = `${paymentScopeKey()}|${String(outTradeNo)}`
  if (settlementInflight.has(key)) return settlementInflight.get(key)
  const job = runPaymentWrite(work).finally(() => {
    if (settlementInflight.get(key) === job) settlementInflight.delete(key)
  })
  settlementInflight.set(key, job)
  return job
}

async function persistLakalaEntities(db, entries) {
  try {
    await deps.writeDbEntities(db, entries)
  }
  catch (cause) {
    const err = cause instanceof Error ? cause : new Error(String(cause?.message || cause))
    err.lakalaPersistenceError = true
    err.statusCode = 500
    throw err
  }
}

function persistPaymentObservation(outTradeNo, update) {
  return runPaymentWrite(async () => {
    const db = structuredClone(deps.readDb())
    const record = findPayment(db, outTradeNo)
    if (!record) throw Object.assign(new Error('未知支付单'), { statusCode: 500 })
    update(record)
    await persistLakalaEntities(db, [{ entityKey: 'lakalaPayments', item: record }])
    return record
  })
}

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

function positiveIntegerEnv(key, fallback) {
  const raw = String(process.env[key] || '').trim()
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : fallback
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

function normalizeActualPayChannel(raw) {
  const value = String(raw || '').trim().toUpperCase()
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
  const directKeys = [
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
  for (const key of directKeys) {
    if (payload[key] != null && String(payload[key]).trim()) {
      return String(payload[key]).trim()
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

function resolveActualPayChannel(payload) {
  const source = pickActualPayChannelSource(payload)
  return {
    actualPayChannel: normalizeActualPayChannel(source),
    actualPayChannelRaw: source,
  }
}

function shouldRefreshActualPayChannel(record) {
  if (!record || record.status !== 'success') {
    return false
  }
  const raw = String(record.actualPayChannelRaw || '').trim()
  if (raw) {
    return false
  }
  const actual = normalizeActualPayChannel(record.actualPayChannel)
  const requested = normalizeActualPayChannel(record.payChannel)
  return !actual || actual === requested
}

async function refreshActualPayChannelFromLakala(db, record) {
  if (!shouldRefreshActualPayChannel(record)) {
    return false
  }
  let queried
  try {
    queried = await lakala.queryCounterOrder({
      outOrderNo: record.outTradeNo,
      payOrderNo: record.tradeNo,
    })
  }
  catch (err) {
    console.warn('[lakala] refresh actual pay channel failed', record.outTradeNo, err.message)
    return false
  }
  const channel = resolveActualPayChannel(queried)
  if (!channel.actualPayChannel) {
    return false
  }
  await persistPaymentObservation(record.outTradeNo, (current) => {
    current.actualPayChannel = channel.actualPayChannel
    if (channel.actualPayChannelRaw) current.actualPayChannelRaw = channel.actualPayChannelRaw
  })
  return true
}

async function refreshActualPayChannelBestEffort(outTradeNo) {
  try {
    const db = deps.readDb()
    await refreshActualPayChannelFromLakala(db, findPayment(db, outTradeNo))
  }
  catch (err) {
    console.warn('[lakala] channel enrichment failed', outTradeNo, err.message)
  }
}

async function createMallPayment(ctx, payload, mallUser) {
  const db = structuredClone(deps.readDb())
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
      orderId: calc.orderId,
      period: calc.period,
      subject,
    })
    record.settlementTargets = calc.settlementTargets
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

  await persistLakalaEntities(db, [{ entityKey: 'lakalaPayments', item: record }])

  const preorder = await lakala.createCounterOrder({
    outOrderNo: record.outTradeNo,
    totalAmountYuan: amountYuan,
    orderInfo: record.subject,
    notifyUrl,
    callbackUrl: resolveCallbackUrl(),
    payChannel: record.payChannel,
  })
  const presentation = lakala.extractPayPresentation(preorder)
  record = await persistPaymentObservation(record.outTradeNo, (current) => {
    current.tradeNo = presentation.payOrderNo || presentation.tradeNo
    current.payCode = presentation.counterUrl || presentation.payCode
    current.payCodeImage = presentation.payCodeImage
  })

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

function fulfillPaymentRecord(outTradeNo, { tradeState, notifyRaw, actualPayChannelPayload, tradeNo } = {}) {
  return runSettlementOnce(outTradeNo, async () => {
    const db = structuredClone(deps.readDb())
    const record = findPayment(db, outTradeNo)
    if (!record) throw Object.assign(new Error('未知支付单'), { statusCode: 500 })
    const already = record.status === 'success'
    const userId = String(record.mallUserId || '').trim()
    const mallUser = userId
      ? (db.users || []).find(item => String(item.id) === userId)
      : deps.resolveRegisteredMallUserByNormalizedPhone(db, deps.normalizePhone(record.mallUserPhone))
    const phone = deps.normalizePhone(mallUser?.phone || record.mallUserPhone)
    let touchedOrders = []

    // A durable success has already applied its business result; still confirm its exact upsert.
    if (!already) {
      if (!mallUser) throw new Error('支付关联用户不存在')
      if (record.bizType === 'order_full') {
        const target = db.orders.find(item => String(item.id) === String(record.orderId))
        if (!target) throw new Error('关联订单不存在')
        if (!deps.orderBelongsToRegisteredMallUser(db, target, mallUser)) throw new Error('关联订单不存在')
        if (!target.paid) {
          deps.markOrderPaidInDb(target, record.payChannel)
          touchedOrders = [target]
        }
      }
      else if (record.bizType === 'bill_repay') {
        touchedOrders = deps.applyBillRepayInDb(db, mallUser, { orderId: record.orderId, period: record.period })
      }
      else if (record.bizType === 'bill_repay_negotiated') {
        touchedOrders = deps.applyBillNegotiatedPayInDb(db, mallUser, { orderId: record.orderId, period: record.period, outTradeNo })
      }
      else if (record.bizType === 'bill_repay_all') {
        touchedOrders = deps.applyBillRepayAllInDb(db, mallUser, { settlementTargets: record.settlementTargets })
      }
      else {
        throw new Error('不支持的支付业务类型')
      }
    }

    record.tradeState = tradeState || record.tradeState || 'SUCCESS'
    record.status = 'success'
    record.paidAt = record.paidAt || new Date().toISOString()
    if (tradeNo) record.tradeNo = tradeNo
    const channel = resolveActualPayChannel(actualPayChannelPayload || notifyRaw)
    if (channel.actualPayChannel) {
      record.actualPayChannel = channel.actualPayChannel
    }
    if (channel.actualPayChannelRaw) {
      record.actualPayChannelRaw = channel.actualPayChannelRaw
    }
    if (notifyRaw) {
      record.notifyRaw = notifyRaw
    }

    await persistLakalaEntities(db, [
      ...touchedOrders.map(item => ({ entityKey: 'orders', item })),
      { entityKey: 'lakalaPayments', item: record },
    ])

    let billing
    if (!already && /^1\d{10}$/.test(phone)) {
      const dbAfter = deps.readDb()
      billing = deps.buildMallBillsSuccessData(dbAfter, phone)
    }
    return { already, billing }
  })
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
    await fulfillPaymentRecord(outTradeNo)
    await refreshActualPayChannelBestEffort(outTradeNo)
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
  if (payState.paid) {
    const result = await fulfillPaymentRecord(outTradeNo, { tradeState, actualPayChannelPayload: queried })
    return {
      status: 'success',
      tradeState,
      outTradeNo: record.outTradeNo,
      billing: result.billing,
    }
  }

  const pendingRecord = await persistPaymentObservation(outTradeNo, (current) => {
    if (current.status !== 'success') current.tradeState = tradeState
  })
  return {
    status: pendingRecord.status === 'success' ? 'success' : 'pending',
    tradeState: pendingRecord.tradeState,
    outTradeNo: record.outTradeNo,
  }
}

/** 同步当前用户近期 pending 支付单（覆盖 session 丢失、收银台内换支付方式等场景） */
async function syncAllPendingPayments(mallUser, {
  maxAgeMs = positiveIntegerEnv('LAKALA_PENDING_SYNC_MAX_AGE_MS', 24 * 60 * 60 * 1000),
  limit = positiveIntegerEnv('LAKALA_PENDING_SYNC_LIMIT', 5),
} = {}) {
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
      if (err.lakalaPersistenceError) throw err
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
    throw Object.assign(new Error('未知支付单'), { statusCode: 500 })
  }
  if (lakala.isOrderPaidStatus(tradeStatus) || lakala.isTradeSuccessState(tradeStatus)) {
    await fulfillPaymentRecord(outTradeNo, {
      tradeState: tradeStatus, notifyRaw: notifyBody,
      tradeNo: String(nested.pay_order_no || raw.pay_order_no || ''),
    })
    await refreshActualPayChannelBestEffort(outTradeNo)
  }
  else {
    await persistPaymentObservation(outTradeNo, (current) => {
      if (current.status !== 'success') current.tradeState = tradeStatus
      current.notifyRaw = notifyBody
      if (nested.pay_order_no || raw.pay_order_no) current.tradeNo = String(nested.pay_order_no || raw.pay_order_no)
    })
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
  const result = await fulfillPaymentRecord(outTradeNo, { tradeState: 'SUCCESS', notifyRaw: { mock: true } })
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
