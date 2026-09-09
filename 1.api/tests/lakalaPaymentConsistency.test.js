const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { AsyncLocalStorage } = require('node:async_hooks')

const indexSource = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8')
const serviceSource = fs.readFileSync(path.join(__dirname, '../src/payment/lakalaPaymentService.js'), 'utf8')
const routesSource = fs.readFileSync(path.join(__dirname, '../src/payment/registerLakalaRoutes.js'), 'utf8')
const clone = value => JSON.parse(JSON.stringify(value))

function loadBusinessFunctions({ realBilling = false } = {}) {
  const context = vm.createContext({
    orderBelongsToRegisteredMallUser: (db, order, user) => order.mallUserId === user?.id,
    ensureOrderInstallmentPlan: () => {},
    applyInstallmentCompletionOrderStatus: order => {
      if (order.installmentPlan.every(item => item.paid === true)) order.status = 'completed'
    },
    normalizeNegotiateRemainderDueDate: value => String(value || ''),
    normalizePhone: value => String(value || ''),
    INSTALLMENT_REPAY_DAYS_AFTER_CARD_ISSUE: require('../src/installmentRepaySchedule').INSTALLMENT_REPAY_DAYS_AFTER_CARD_ISSUE,
  })
  const names = [
    'installmentItemIsPaid', 'findInstallmentPlanItemByPeriod', 'applyInstallmentNegotiationPayCompleted',
    'assertBillRepayTargetOrder', 'calcBillRepayAmount', 'calcBillNegotiatedPayAmount', 'calcBillRepayAllAmount',
    'applyBillRepayInDb', 'applyBillNegotiatedPayInDb', 'applyBillRepayAllInDb', 'markOrderPaidInDb',
  ]
  if (realBilling) names.push(
    'formatDate', 'addMonths', 'addDays', 'installmentDueDateFromRepayAnchor', 'installmentRepayAnchorForOrder',
    'ensureOrderCardPackage', 'ensureOrderShipment', 'ensureOrderRiskState', 'buildInstallmentPlan',
    'ensureOrderInstallmentPlan', 'applyInstallmentCompletionOrderStatus', 'resolveRegisteredMallUserByNormalizedPhone',
    'negotiateExtensionFeeRemainderAmount', 'resolveNegotiateRemainderAmountForDisplay',
    'buildMallBillingListAndSummaries', 'buildMallBillsSuccessData',
  )
  for (const name of names) {
    const match = indexSource.match(new RegExp(`^function ${name}\\([^]*?^}`, 'm'))
    assert.ok(match, `${name} must exist`)
    vm.runInContext(match[0], context)
  }
  return Object.fromEntries(names.map(name => [name, context[name]]))
}

function createFixture(options = {}) {
  const business = loadBusinessFunctions(options)
  const user = { id: 'U1', phone: '13800000000' }
  const order = {
    id: 'O1', mallUserId: user.id, payType: 'installment', status: 'enjoying', cardPackageIssued: true,
    totalAmount: 100, installmentPlan: [{ period: 1, amount: 100, paid: false, dueDate: '2026-09-09' }],
  }
  const payment = {
    outTradeNo: 'LP1', orderId: options.orderId || 'O1', period: 1, bizType: options.bizType || 'bill_repay',
    mallUserId: user.id, mallUserPhone: user.phone, amountYuan: 100, status: 'pending',
    payChannel: 'wechat', createdAt: new Date().toISOString(), paidAt: '', ...options.payment,
  }
  if (payment.bizType === 'bill_repay_all' && !Object.hasOwn(options.payment || {}, 'settlementTargets')) {
    payment.settlementTargets = [{ orderId: 'O1', period: 1 }]
  }
  if (payment.bizType === 'order_full') order.payType = 'full'
  if (payment.bizType === 'bill_repay_negotiated') {
    const pending = { negotiatedAmount: 10, remainderAmount: 100, remainderDueDate: '2026-10-09', createdAt: '2026-09-01' }
    order.installmentPlan[0].negotiationPayPending = clone(pending)
    order.installmentPlan[0].negotiationHistory = [clone(pending)]
    payment.amountYuan = 10
  }
  let shared = { users: [user], orders: [order, { ...clone(order), id: 'unrelated', mallUserId: 'U2' }], lakalaPayments: options.payments || [payment] }
  let durable = clone(shared)
  let cacheReady = true
  const persistCalls = []
  const events = []
  const externalCalls = []
  const billingPhones = []
  const outcomes = [...(options.persistOutcomes || [])]
  const client = {
    readEnvTrim: () => '', isLakalaMockEnabled: () => true, isLakalaConfigured: () => true,
    yuanToCents: value => Math.round(value * 100), mapPayChannelToAccountType: () => 'WECHAT',
    createCounterOrder: async (args) => {
      events.push('external'); externalCalls.push(clone(args))
      if (options.createFn) return options.createFn(args)
      return { counterUrl: 'https://fake.invalid/checkout', payOrderNo: 'T1' }
    },
    extractPayPresentation: value => value,
    queryCounterOrder: async () => options.queryFn ? options.queryFn() : options.channelFailure ? Promise.reject(new Error('channel outage')) : { paid: true, tradeState: 'SUCCESS', ...(options.query || {}) },
    parseCounterQueryPaid: value => value,
    isOrderPaidStatus: value => value === 'SUCCESS', isTradeSuccessState: value => value === 'SUCCESS',
  }
  function merge(db, entries) {
    for (const { entityKey, item } of entries) {
      const key = entityKey === 'orders' ? 'id' : 'outTradeNo'
      const i = db[entityKey].findIndex(row => row[key] === item[key])
      if (i < 0) db[entityKey].push(clone(item))
      else db[entityKey][i] = clone(item)
    }
  }
  const dependencies = {
    ...business, readDb: () => shared,
    isPaymentCacheReady: () => cacheReady,
    normalizePhone: value => value,
    resolveRegisteredMallUserByNormalizedPhone: (db, phone) => db.users.find(item => item.phone === phone),
    orderBelongsToRegisteredMallUser: (db, item, mallUser) => item.mallUserId === mallUser.id,
    reconcileInstallmentCompletionAcrossDb: () => { if (options.detectReconcile) events.push('reconcile') },
    buildMallBillsSuccessData: (db, phone) => { billingPhones.push(phone); return options.realBilling ? business.buildMallBillsSuccessData(db, phone) : { summary: {} } },
    writeDbEntities: async (db, entries) => {
      persistCalls.push(clone(entries)); events.push('persist')
      cacheReady = false
      const outcome = outcomes.shift()
      if (typeof outcome === 'function') await outcome(entries, durable)
      if (outcome === 'reject') throw new Error('write outage')
      merge(durable, entries)
      merge(shared, entries)
      cacheReady = true
    },
    // Retain the legacy API in the RED harness to expose its incorrect ordering.
    writeDbPartial: (db, keys) => { persistCalls.push(keys); events.push('legacy'); durable = clone(db) },
    writeDb: db => { durable = clone(db) }, flushMongoPersist: async () => {},
  }
  const sandbox = { require: name => { assert.equal(name, './lakalaClient'); return client }, module: { exports: {} }, console, process: { env: {} }, structuredClone }
  vm.runInNewContext(serviceSource, sandbox)
  const service = sandbox.module.exports
  service.initLakalaPayment(dependencies)
  const routes = new Map()
  const routeSandbox = { require: name => name === './lakalaPaymentService' ? service : client, module: { exports: {} }, console }
  vm.runInNewContext(routesSource, routeSandbox)
  routeSandbox.module.exports.registerLakalaRoutes({ post: (name, handler) => routes.set(name, handler), get: (name, handler) => routes.set(name, handler) }, {
    readDb: () => shared, resolvePlacingMallUserFromBearer: () => user,
    success: data => ({ code: 0, data }), fail: (ctx, msg, code) => { ctx.status = code; ctx.body = { error: msg } },
  })
  return {
    service, user, business, dependencies, persistCalls, events, externalCalls, outcomes, billingPhones,
    db: () => shared, durable: () => durable,
    reload: () => { shared = clone(durable); cacheReady = true },
    payment: () => shared.lakalaPayments[0],
    notify: (outTradeNo = 'LP1') => service.handleNotifyPayload({ out_order_no: outTradeNo, order_status: 'SUCCESS', account_type: 'WECHAT' }),
    preorder: (payload = {}) => service.createMallPayment({}, { bizType: payment.bizType, orderId: 'O1', period: 1, all: true, ...payload }, user),
    route: async (name, body = {}) => { const ctx = { request: { body }, params: { outTradeNo: 'LP1' } }; await routes.get(name)(ctx); return ctx },
  }
}

test('business validation failure leaves payment pending and does not persist', async () => {
  const f = createFixture({ orderId: 'missing', bizType: 'order_full' })
  await assert.rejects(f.notify(), /关联订单不存在/)
  assert.equal(f.payment().status, 'pending')
  assert.equal(f.persistCalls.length, 0)
})

test('unknown payment notification rejects and route does not ACK success', async () => {
  const f = createFixture({ payments: [] })
  await assert.rejects(f.notify('LP-missing'), /未知支付单/)
  const ctx = await f.route('/payment/lakala/notify', { out_order_no: 'LP-missing', order_status: 'SUCCESS' })
  assert.equal(ctx.status, 500)
  assert.equal(ctx.body.code, 'FAIL')
})

test('persist failure rejects notify and a later notify can settle', async () => {
  const f = createFixture({ persistOutcomes: ['reject', 'resolve'] })
  await assert.rejects(f.notify(), /write outage/)
  assert.equal(f.payment().status, 'pending')
  assert.equal(f.db().orders[0].installmentPlan[0].paid, false)
  await f.notify()
  assert.equal(f.durable().lakalaPayments[0].status, 'success')
  assert.equal(f.durable().orders[0].installmentPlan[0].paid, true)
  assert.deepEqual(f.persistCalls[1].map(entry => [entry.entityKey, entry.item.id || entry.item.outTradeNo]), [['orders', 'O1'], ['lakalaPayments', 'LP1']])
})

test('concurrent notifications wait for one failed settlement and can retry', async () => {
  let rejectPersist
  let started
  const began = new Promise(resolve => { started = resolve })
  const gate = new Promise((resolve, reject) => { rejectPersist = reject })
  const f = createFixture({ persistOutcomes: [async () => { started(); await gate }] })
  const results = Promise.allSettled([f.notify(), f.notify()])
  // The timeout only prevents a broken implementation from leaving this test hanging.
  await Promise.race([began, new Promise(resolve => setTimeout(resolve, 20))])
  if (f.events.includes('persist')) rejectPersist(new Error('write outage'))
  else rejectPersist(new Error('legacy path'))
  gate.catch(() => {})
  const settled = await results
  assert.deepEqual(settled.map(item => item.status), ['rejected', 'rejected'])
  assert.equal(f.persistCalls.length, 1)
  await f.notify()
  assert.equal(f.payment().status, 'success')
})

test('preorder persists pending before external call and rejects either write failure', async () => {
  const first = createFixture({ persistOutcomes: ['reject'] })
  await assert.rejects(first.preorder(), /write outage/)
  assert.deepEqual(first.events, ['persist'])
  const second = createFixture({ persistOutcomes: ['resolve', 'reject'] })
  await assert.rejects(second.preorder(), /write outage/)
  assert.deepEqual(second.events, ['persist', 'external', 'persist'])
  assert.equal(second.durable().lakalaPayments.at(-1).payCode, '')
})

test('status and sync-pending expose durable settlement failures', async () => {
  const f = createFixture({ persistOutcomes: ['reject', 'reject'] })
  await assert.rejects(f.service.syncPaymentStatus('LP1'), /write outage/)
  await assert.rejects(f.service.syncAllPendingPayments(f.user), /write outage/)
  assert.equal(f.payment().status, 'pending')
})

for (const bizType of ['order_full', 'bill_repay', 'bill_repay_negotiated', 'bill_repay_all']) {
  test(`${bizType}: durable success repairs its incomplete target before ACK`, async () => {
    const f = createFixture({ bizType, payment: { status: 'success', paidAt: '2026-09-09T00:00:00.000Z', createdAt: '2026-09-02T00:00:00.000Z' } })
    if (bizType === 'bill_repay_all') f.db().orders[0].installmentPlan.push({ period: 2, amount: 200, paid: false })
    await f.notify()
    const order = f.durable().orders[0]
    const plan = order.installmentPlan[0]
    if (bizType === 'bill_repay_negotiated') {
      assert.equal(plan.negotiationPayPending, null)
      assert.ok(plan.negotiationHistory[0].userPaidAt)
      assert.deepEqual(plan.negotiationPaymentOutTradeNos, ['LP1'])
    }
    else assert.equal(plan.paid, true)
    if (bizType === 'order_full') assert.equal(order.paid, true)
    if (bizType === 'bill_repay_all') assert.equal(order.installmentPlan[1].paid, false)
    assert.deepEqual(f.persistCalls[0].map(entry => entry.entityKey), ['orders', 'lakalaPayments'])
    const confirmed = clone(f.durable().orders)
    await f.notify()
    assert.deepEqual(f.durable().orders, confirmed)
    assert.deepEqual(f.persistCalls[1].map(entry => entry.entityKey), ['lakalaPayments'])
    assert.equal(f.payment().paidAt, '2026-09-09T00:00:00.000Z')
  })

  test(`${bizType}: incomplete success waits for repair durability and returns FAIL on rejection`, async () => {
    let release
    let started
    const began = new Promise(resolve => { started = resolve })
    const gate = new Promise(resolve => { release = resolve })
    const f = createFixture({ bizType, payment: { status: 'success', createdAt: '2026-09-02T00:00:00.000Z' }, persistOutcomes: [async (entries) => {
      started(entries)
      await gate
      throw new Error('repair write outage')
    }] })
    let replied = false
    const request = f.route('/payment/lakala/notify', { out_order_no: 'LP1', order_status: 'SUCCESS' }).then(ctx => { replied = true; return ctx })
    const entries = await began
    const repairIncluded = entries.some(entry => entry.entityKey === 'orders')
    assert.equal(replied, false)
    release()
    const response = await request
    assert.equal(response.body.code, 'FAIL')
    assert.equal(repairIncluded, true)
  })

  test(`${bizType}: duplicate success is durable and business result is idempotent`, async () => {
    const f = createFixture({ bizType })
    await f.notify()
    const after = clone(f.db().orders)
    const paidAt = f.payment().paidAt
    await f.notify()
    assert.deepEqual(clone(f.db().orders), after)
    assert.equal(f.payment().paidAt, paidAt)
    assert.equal(f.persistCalls.length, 2)
    assert.ok(f.persistCalls.every(entries => entries.every(entry => entry.entityKey === 'lakalaPayments' || entry.item.id === 'O1')))
    f.outcomes.push('reject')
    await assert.rejects(f.notify(), /write outage/)
  })
  test(`${bizType}: partial durable order write can be reloaded and retried`, async () => {
    const f = createFixture({ bizType, persistOutcomes: [(entries, durable) => {
      for (const entry of entries.filter(item => item.entityKey === 'orders')) {
        const i = durable.orders.findIndex(item => item.id === entry.item.id)
        durable.orders[i] = clone(entry.item)
      }
      throw new Error('write outage')
    }] })
    await assert.rejects(f.notify(), /write outage/)
    const applied = clone(f.durable().orders)
    f.reload()
    await f.notify()
    assert.deepEqual(f.durable().orders, applied)
    assert.equal(f.payment().status, 'success')
  })
}

test('full-order success also repairs an unpaid plan behind its paid order flag', async () => {
  const f = createFixture({ bizType: 'order_full', payment: { status: 'success' } })
  f.db().orders[0].paid = true
  await f.notify()
  assert.equal(f.durable().orders[0].installmentPlan[0].paid, true)
})

for (const settlementTargets of [undefined, []]) {
  test(`legacy success repay-all without ${settlementTargets ? 'nonempty' : 'fixed'} targets fails closed`, async () => {
    const f = createFixture({ bizType: 'bill_repay_all', payment: { status: 'success', settlementTargets } })
    f.db().orders[0].installmentPlan.push({ period: 2, amount: 100, paid: false })
    await assert.rejects(f.notify(), /还款目标/)
    assert.equal(f.persistCalls.length, 0)
    assert.equal(f.db().orders[0].installmentPlan[1].paid, false)
  })
}

for (const mismatch of ['other-payment', 'newer-pending', 'missing-history']) {
  test(`negotiated success rejects ${mismatch} instead of confirming the wrong business result`, async () => {
    const f = createFixture({ bizType: 'bill_repay_negotiated', payment: { status: 'success', createdAt: '2026-09-02T00:00:00.000Z' } })
    const plan = f.db().orders[0].installmentPlan[0]
    if (mismatch === 'other-payment') {
      plan.negotiationPayPending = null
      plan.negotiationHistory[0].userPaidAt = '2026-09-03'
      plan.negotiationPaymentOutTradeNos = ['LP-other']
    }
    if (mismatch === 'newer-pending') {
      plan.negotiationPayPending.createdAt = '2026-09-04'
      plan.negotiationHistory[0].createdAt = '2026-09-04'
    }
    if (mismatch === 'missing-history') {
      plan.negotiationPayPending = null
      plan.negotiationHistory = []
      plan.negotiationPaymentOutTradeNos = ['LP1']
    }
    const before = clone(f.db().orders)
    await assert.rejects(f.notify(), /协商/)
    assert.equal(f.persistCalls.length, 0)
    assert.deepEqual(f.db().orders, before)
  })
}

test('negotiated success matched to this payment preserves a later pending negotiation', async () => {
  const f = createFixture({ bizType: 'bill_repay_negotiated' })
  await f.notify()
  const plan = f.db().orders[0].installmentPlan[0]
  const pending = { negotiatedAmount: 20, createdAt: '2026-10-01', remainderDueDate: '2026-11-09' }
  plan.negotiationPayPending = clone(pending)
  plan.negotiationHistory.push(clone(pending))
  await f.notify()
  assert.deepEqual(f.db().orders[0].installmentPlan[0].negotiationPayPending, pending)
  assert.equal(f.persistCalls[1].length, 1)
})

for (const incomplete of ['restored-pending', 'unpaid-current-history']) {
  test(`negotiated success repairs ${incomplete} even when its payment marker exists`, async () => {
    const f = createFixture({ bizType: 'bill_repay_negotiated', payment: { status: 'success', createdAt: '2026-09-02T00:00:00.000Z' } })
    const plan = f.db().orders[0].installmentPlan[0]
    plan.negotiationPaymentOutTradeNos = ['LP1']
    if (incomplete === 'restored-pending') plan.negotiationHistory[0].userPaidAt = '2026-09-02T01:00:00.000Z'
    else plan.negotiationHistory.unshift({ negotiatedAmount: 10, createdAt: '2026-08-01', userPaidAt: '2026-08-02' })
    await f.notify()
    const result = f.durable().orders[0].installmentPlan[0]
    assert.equal(result.negotiationPayPending, null)
    assert.deepEqual(result.negotiationPaymentOutTradeNos, ['LP1'])
    assert.ok(result.negotiationHistory.at(-1).userPaidAt)
    if (incomplete === 'restored-pending') assert.equal(result.negotiationHistory[0].userPaidAt, '2026-09-02T01:00:00.000Z')
    assert.equal(f.persistCalls[0][0].entityKey, 'orders')
  })
}

test('repay-all fixes targets at creation and leaves later bills unpaid', async () => {
  const f = createFixture({ bizType: 'bill_repay_all' })
  const checkout = await f.preorder()
  const record = f.db().lakalaPayments.find(item => item.outTradeNo === checkout.outTradeNo)
  assert.deepEqual(record.settlementTargets, [{ orderId: 'O1', period: 1 }])
  f.db().orders[0].installmentPlan.push({ period: 2, amount: 200, paid: false })
  f.db().orders.push({ ...clone(f.db().orders[0]), id: 'later' })
  await f.notify(checkout.outTradeNo)
  assert.equal(f.db().orders[0].installmentPlan[0].paid, true)
  assert.equal(f.db().orders[0].installmentPlan[1].paid, false)
  assert.equal(f.db().orders.at(-1).installmentPlan[0].paid, false)
})

test('repay-all validates all fixed targets before committing anything', async () => {
  const f = createFixture({ bizType: 'bill_repay_all', payment: { settlementTargets: [{ orderId: 'O1', period: 1 }, { orderId: 'missing', period: 1 }] } })
  await assert.rejects(f.notify(), /订单不存在/)
  assert.equal(f.persistCalls.length, 0)
  assert.equal(f.db().orders[0].installmentPlan[0].paid, false)
  assert.equal(f.payment().status, 'pending')
})

test('missing installment rejects without confirming payment', async () => {
  const f = createFixture({ payment: { period: 99 } })
  await assert.rejects(f.notify(), /账单期次不存在/)
  assert.equal(f.persistCalls.length, 0)
})

test('channel enrichment failure does not overturn durable repayment', async () => {
  const f = createFixture({ query: { account_type: 'ALIPAY' }, persistOutcomes: ['resolve', 'reject'] })
  await f.service.handleNotifyPayload({ out_order_no: 'LP1', order_status: 'SUCCESS' })
  assert.equal(f.payment().status, 'success')
  assert.equal(f.durable().orders[0].installmentPlan[0].paid, true)
  assert.equal(f.persistCalls.length, 2)
  assert.equal(f.payment().actualPayChannel, undefined)
})

test('pending notification arriving during settlement cannot overwrite its durable success', async () => {
  let release
  let started
  const began = new Promise(resolve => { started = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const f = createFixture({ persistOutcomes: [async () => { started(); await gate }] })
  const settlement = f.notify()
  await began
  const pending = f.service.handleNotifyPayload({ out_order_no: 'LP1', order_status: 'WAITING' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.payment().status, 'pending')
  release()
  await Promise.all([settlement, pending])
  assert.equal(f.payment().status, 'success')
  assert.equal(f.payment().tradeState, 'SUCCESS')
  assert.ok(f.persistCalls.slice(1).every(entries => entries.every(entry => entry.entityKey !== 'lakalaPayments' || entry.item.status === 'success')))
})

test('late pending query returns the concurrent durable success', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const f = createFixture({ queryFn: () => gate })
  const query = f.service.syncPaymentStatus('LP1')
  await f.notify()
  release({ paid: false, tradeState: 'WAITING' })
  const result = await query
  assert.equal(result.status, 'success')
  assert.equal(f.payment().tradeState, 'SUCCESS')
})

test('negotiated partial retry preserves a newer pending negotiation', async () => {
  const f = createFixture({ bizType: 'bill_repay_negotiated', persistOutcomes: [(entries, durable) => {
    durable.orders[0] = clone(entries.find(entry => entry.entityKey === 'orders').item)
    throw new Error('write outage')
  }] })
  await assert.rejects(f.notify(), /write outage/)
  f.reload()
  const plan = f.db().orders[0].installmentPlan[0]
  const newer = { negotiatedAmount: 20, remainderAmount: 100, remainderDueDate: '2026-11-09', createdAt: '2026-10-01' }
  plan.negotiationPayPending = clone(newer)
  plan.negotiationHistory.push(clone(newer))
  await f.notify()
  assert.deepEqual(f.db().orders[0].installmentPlan[0].negotiationPayPending, newer)
})

test('bill apply functions return actual changes and no changes on repeat', () => {
  for (const [bizType, name, args] of [
    ['bill_repay', 'applyBillRepayInDb', { orderId: 'O1', period: 1 }],
    ['bill_repay_negotiated', 'applyBillNegotiatedPayInDb', { orderId: 'O1', period: 1, outTradeNo: 'LP1' }],
    ['bill_repay_all', 'applyBillRepayAllInDb', { settlementTargets: [{ orderId: 'O1', period: 1 }] }],
  ]) {
    const f = createFixture({ bizType })
    const touched = f.business[name](f.db(), f.user, args)
    assert.equal(touched.length, 1)
    assert.equal(touched[0], f.db().orders[0])
    assert.equal(f.business[name](f.db(), f.user, args).length, 0)
  }
})

test('preorder has no legacy whole-database reconciliation writes', async () => {
  const f = createFixture({ detectReconcile: true })
  const result = await f.preorder()
  assert.equal(result.amountYuan, 100)
  assert.equal(result.counterUrl, 'https://fake.invalid/checkout')
  assert.deepEqual(f.events, ['persist', 'external', 'persist'])
})

test('settlement prefers immutable user ID after phone change and supports legacy phone records', async () => {
  const f = createFixture()
  f.db().users[0].phone = '13900000000'
  await f.notify()
  assert.equal(f.payment().status, 'success')
  assert.deepEqual(f.billingPhones, ['13900000000'])
  const legacy = createFixture({ payment: { mallUserId: '' } })
  await legacy.notify()
  assert.equal(legacy.payment().status, 'success')
})

test('explicit missing user ID never falls back to a reused phone', async () => {
  const f = createFixture({ payment: { mallUserId: 'missing-user' } })
  await assert.rejects(f.notify(), /用户不存在|订单不存在/)
  assert.equal(f.persistCalls.length, 0)
})

test('unknown business type cannot confirm a payment', async () => {
  const f = createFixture({ bizType: 'unsupported' })
  await assert.rejects(f.notify(), /不支持的支付业务类型/)
  assert.equal(f.payment().status, 'pending')
  assert.equal(f.persistCalls.length, 0)
})

test('different payments for different periods preserve both changes on the same order', async () => {
  let release
  let started
  const began = new Promise(resolve => { started = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const f = createFixture({ persistOutcomes: [async () => { started(); await gate }] })
  f.db().orders[0].installmentPlan.push({ period: 2, amount: 100, paid: false })
  f.db().lakalaPayments.push({ ...clone(f.payment()), outTradeNo: 'LP2', period: 2 })
  const first = f.notify()
  await began
  const second = f.notify('LP2')
  await new Promise(resolve => setImmediate(resolve))
  release()
  await Promise.all([first, second])
  assert.deepEqual(f.durable().orders[0].installmentPlan.map(item => item.paid), [true, true])
  assert.ok(f.durable().lakalaPayments.every(item => item.status === 'success'))
})

test('same payment number in independent scopes never shares a settlement or failure', async () => {
  const f = createFixture()
  const context = new AsyncLocalStorage()
  const scopes = { A: clone(f.db()), B: clone(f.db()) }
  let release
  let started
  const gate = new Promise(resolve => { release = resolve })
  const began = new Promise(resolve => { started = resolve })
  f.service.initLakalaPayment({
    ...f.dependencies, getPaymentScopeKey: () => context.getStore(), readDb: () => scopes[context.getStore()],
    writeDbEntities: async (db, entries) => {
      const scope = context.getStore()
      if (scope === 'A') { started(); await gate; throw new Error('scope A outage') }
      for (const { entityKey, item } of entries) {
        const key = entityKey === 'orders' ? 'id' : 'outTradeNo'
        const i = scopes[scope][entityKey].findIndex(row => row[key] === item[key])
        scopes[scope][entityKey][i] = clone(item)
      }
    },
  })
  const first = context.run('A', () => f.notify())
  const rejected = assert.rejects(first, /scope A outage/)
  await began
  await context.run('B', () => f.notify())
  assert.equal(scopes.B.lakalaPayments[0].status, 'success')
  assert.equal(scopes.A.lakalaPayments[0].status, 'pending')
  release()
  await rejected
})

test('notify and status routes reject durable writes and notify waits before ACK', async () => {
  const f = createFixture({ persistOutcomes: ['reject', 'reject'] })
  const notify = await f.route('/payment/lakala/notify', { out_order_no: 'LP1', order_status: 'SUCCESS' })
  assert.equal(notify.body.code, 'FAIL')
  assert.equal(notify.status, 500)
  const status = await f.route('/payment/lakala/status/:outTradeNo')
  assert.equal(status.status, 500)
  assert.match(status.body.error, /write outage/)
  let release
  let started
  const gate = new Promise(resolve => { release = resolve })
  const began = new Promise(resolve => { started = resolve })
  const delayed = createFixture({ persistOutcomes: [async () => { started(); await gate }] })
  let acknowledged = false
  const job = delayed.route('/payment/lakala/notify', { out_order_no: 'LP1', order_status: 'SUCCESS', account_type: 'WECHAT' }).then(ctx => { acknowledged = true; return ctx })
  await began
  assert.equal(acknowledged, false)
  assert.equal(delayed.payment().status, 'pending')
  release()
  assert.equal((await job).body.code, 'SUCCESS')
})

test('legacy negotiated completion can retry without creating historical target metadata', async () => {
  const f = createFixture({ bizType: 'bill_repay_negotiated' })
  const plan = f.db().orders[0].installmentPlan[0]
  plan.negotiationPayPending = null
  plan.negotiationHistory[0].userPaidAt = '2026-09-08T00:00:00.000Z'
  await f.notify()
  assert.equal(f.persistCalls[0].length, 1)
  assert.equal(f.payment().status, 'success')
  assert.equal(f.payment().settlementTargets, undefined)
  assert.equal(plan.negotiationPaymentOutTradeNos, undefined)
})

test('pending state writes and mock completion also propagate persistence failure', async () => {
  const f = createFixture({ query: { paid: false, tradeState: 'WAITING' }, persistOutcomes: ['reject', 'reject'] })
  await assert.rejects(f.service.syncPaymentStatus('LP1'), /write outage/)
  await assert.rejects(f.service.mockCompletePayment('LP1', f.user), /write outage/)
  assert.equal(f.payment().status, 'pending')
  assert.equal(f.payment().tradeState, undefined)
})

async function withRealStorePaymentFixture(t, work, options = {}) {
  const mongo = require('../src/mongo')
  const store = require('../src/store')
  const { runWithTenant, getCurrentTenantId } = require('../src/tenantContext')
  const f = createFixture(options)
  f.db().orders[0].installmentPlan.push({ period: 2, amount: 100, paid: false })
  f.db().lakalaPayments.push({ ...clone(f.payment()), outTradeNo: 'LP2', period: 2 })
  const tenantId = `payment-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const data = new Map(mongo.SHARDED_ENTITY_KEYS.map(key => [mongo.COLLECTIONS[key], clone(f.db()[key] || []).map(item => ({ ...item, _id: key === 'lakalaPayments' ? item.outTradeNo : item.id }))]))
  const calls = []
  const failures = []
  let bootstrapping = true
  let writes = 0
  let failurePositions = new Set()
  let gate
  const dbm = { collection: name => ({
    find: () => {
      assert.equal(bootstrapping, true, 'payment execution must never scan a collection')
      return { toArray: async () => structuredClone(data.get(name) || []) }
    },
    findOne: async () => {
      assert.equal(bootstrapping, true, 'payment execution must not use refresh reads')
      return name === mongo.APP_META ? { _id: 'main', updatedAt: new Date(1), meta: { fixture: true } } : null
    },
    replaceOne: async (filter, item) => {
      assert.equal(getCurrentTenantId(), tenantId)
      calls.push({ name, filter: clone(filter), item: clone(item) })
      writes++
      if (gate) { const current = gate; gate = null; current.started(); await current.promise }
      if (failurePositions.has(writes)) {
        failures.push({
          order: clone(data.get('orders').find(row => row.id === 'O1')),
          payment: clone(data.get(mongo.COLLECTIONS.lakalaPayments).find(row => row.outTradeNo === 'LP1')),
          cachedOrder: clone(store.readDb().orders.find(row => row.id === 'O1')),
        })
        throw new Error('partial Mongo outage')
      }
      if (name !== mongo.APP_META) data.set(name, [...data.get(name).filter(row => row._id !== filter._id), clone(item)])
    },
    deleteMany: () => assert.fail('payment execution must never delete'),
    bulkWrite: () => assert.fail('payment execution must never bulkWrite'),
  }) }
  t.mock.method(mongo, 'getMongoDb', () => dbm)
  await runWithTenant(tenantId, async () => {
    await store.hydrateFromMongoAfterConnect()
    bootstrapping = false
    f.service.initLakalaPayment({
      ...f.dependencies, readDb: store.readDb, writeDbEntities: store.writeDbEntities,
      getPaymentScopeKey: () => `tenant:${getCurrentTenantId()}`,
      isPaymentCacheReady: () => store.getScopeCacheReadiness('tenant', tenantId, ['orders', 'lakalaPayments']).usable,
    })
    await work({
      ...f, calls, failures, read: store.readDb,
      durableRows: key => clone(data.get(mongo.COLLECTIONS[key])).map(({ _id, ...item }) => item),
      readiness: () => store.getScopeCacheReadiness('tenant', tenantId, ['orders', 'lakalaPayments']),
      failAt: (...positions) => { failurePositions = new Set(positions) },
      block: () => {
        let release
        let started
        const promise = new Promise(resolve => { release = resolve })
        const began = new Promise(resolve => { started = resolve })
        gate = { promise, started }
        return { release, began }
      },
    })
  })
}

test('generic request flush preserves core payment ACK when only channel enrichment fails', async (t) => {
  const store = require('../src/store')
  const match = indexSource.match(/async function flushMongoForRequest\([^]*?\n\}/)
  assert.ok(match)
  const middleware = vm.runInNewContext(`(${match[0]})`, {
    isMongoPersistenceEnabled: () => true, isManagedApiPath: () => true,
    flushMongoPersist: store.flushMongoPersist,
    fail: (ctx, message, status) => { ctx.status = status; ctx.body = { code: status } }, console: { error() {} },
  })
  await withRealStorePaymentFixture(t, async (f) => {
    f.failAt(4)
    const ctx = { method: 'POST', path: '/api/payment/lakala/notify', state: {} }
    await store.runWithMongoRequestDedup(() => middleware(ctx, async () => {
      Object.assign(ctx, await f.route('/payment/lakala/notify', { out_order_no: 'LP1', order_status: 'SUCCESS' }))
    }))
    assert.equal(ctx.body.code, 'SUCCESS')
    assert.equal(f.durableRows('orders').find(row => row.id === 'O1').installmentPlan[0].paid, true)
    assert.equal(f.durableRows('lakalaPayments').find(row => row.outTradeNo === 'LP1').status, 'success')
    assert.equal(f.readiness().usable, false, 'optional failed target still requires recovery before stale serving')
  }, { query: { account_type: 'ALIPAY' } })
})

for (const failAt of [2, 3]) {
  test(`partial precise write at position ${failAt} recovers before queued payment without reloading memory`, async (t) => {
    await withRealStorePaymentFixture(t, async (f) => {
      f.failAt(failAt)
      const gate = f.block()
      const first = f.notify()
      const rejected = assert.rejects(first, /partial Mongo outage/)
      await gate.began
      const second = f.notify('LP2')
      gate.release()
      await rejected
      await second
      assert.deepEqual(f.failures[0].order.installmentPlan.map(item => item.paid), [true, false])
      assert.deepEqual(f.failures[0].cachedOrder.installmentPlan.map(item => item.paid), [false, false])
      assert.equal(f.failures[0].payment.status, failAt === 3 ? 'success' : 'pending')
      assert.deepEqual(f.durableRows('orders').find(item => item.id === 'O1').installmentPlan.map(item => item.paid), [true, true])
      await f.notify()
      assert.deepEqual(f.read().orders[0].installmentPlan.map(item => item.paid), [true, true])
      assert.ok(f.durableRows('lakalaPayments').every(item => item.status === 'success'))
      assert.equal(f.readiness().usable, true)
      assert.ok(f.calls.every(call => (call.name === 'orders' && call.filter._id === 'O1')
        || (call.name === 'lakalaPayments' && ['LP1', 'LP2'].includes(call.filter._id))
        || call.name === 'app_meta'))
    })
  })
}

test('failed exact recovery blocks later jobs and retains the original batch until confirmed', async (t) => {
  await withRealStorePaymentFixture(t, async (f) => {
    f.failAt(3, 4, 5)
    const gate = f.block()
    const first = f.notify()
    const firstRejected = assert.rejects(first, /partial Mongo outage/)
    await gate.began
    const second = f.notify('LP2')
    const secondRejected = assert.rejects(second, /partial Mongo outage/)
    gate.release()
    await Promise.all([firstRejected, secondRejected])
    await assert.rejects(f.notify('LP2'), /partial Mongo outage/)
    assert.equal(f.calls.some(call => call.name === 'lakalaPayments' && call.filter._id === 'LP2'), false)
    assert.deepEqual(f.calls.filter(call => call.name === 'orders').map(call => call.item.installmentPlan.map(item => item.paid)), [[true, false], [true, false], [true, false]])
    await f.notify('LP2')
    await f.notify()
    assert.deepEqual(f.durableRows('orders').find(item => item.id === 'O1').installmentPlan.map(item => item.paid), [true, true])
    assert.equal(f.readiness().usable, true)
  })
})

test('real billing and apply path never enrich an unrelated shared or durable order', async () => {
  const f = createFixture({ realBilling: true })
  const unrelated = { id: 'same-user-unrelated', mallUserId: f.user.id, payType: 'installment', totalAmount: 200, status: 'enjoying', cardPackageIssued: true, createdAt: '2026-09-01T00:00:00.000Z' }
  f.db().orders.push(clone(unrelated))
  f.durable().orders.push(clone(unrelated))
  const result = await f.service.mockCompletePayment('LP1', f.user)
  assert.ok(result.billing.list.some(row => row.orderId === unrelated.id), 'real display generates the missing plan on its response copy')
  assert.deepEqual(f.db().orders.find(item => item.id === unrelated.id), unrelated)
  assert.deepEqual(f.durable().orders.find(item => item.id === unrelated.id), unrelated)
  assert.equal(f.db().orders[0].installmentPlan[0].paid, true)
  assert.deepEqual(f.persistCalls[0].map(entry => [entry.entityKey, entry.item.id || entry.item.outTradeNo]), [['orders', 'O1'], ['lakalaPayments', 'LP1']])
})

test('failed recovery entries are immutable even if a dependency retains and mutates its input', async () => {
  let captured
  const f = createFixture({ persistOutcomes: [(entries) => { captured = entries; throw new Error('write outage') }] })
  await assert.rejects(f.notify(), /write outage/)
  captured[0].item.installmentPlan[0].paid = false
  captured[0].item.id = 'wrong-target'
  captured.push({ entityKey: 'users', item: { id: 'injected' } })
  await f.notify()
  assert.deepEqual(f.persistCalls[1].map(entry => [entry.entityKey, entry.item.id || entry.item.outTradeNo]), [['orders', 'O1'], ['lakalaPayments', 'LP1']])
  assert.equal(f.persistCalls[1][0].item.installmentPlan[0].paid, true)
})

test('billing and best-effort channel errors never register a failed core batch', async () => {
  const billing = createFixture()
  billing.service.initLakalaPayment({ ...billing.dependencies, buildMallBillsSuccessData: () => { throw new Error('billing display outage') } })
  await assert.rejects(billing.notify(), /billing display outage/)
  assert.equal(billing.payment().status, 'success')
  await billing.notify()
  assert.equal(billing.persistCalls.length, 2)
  assert.equal(billing.persistCalls[1].length, 1)

  const channel = createFixture({ query: { account_type: 'ALIPAY' }, persistOutcomes: ['resolve', 'reject'] })
  await channel.service.handleNotifyPayload({ out_order_no: 'LP1', order_status: 'SUCCESS' })
  await channel.notify()
  assert.equal(channel.persistCalls.length, 3)
  assert.equal(channel.persistCalls[2].length, 1)
  assert.equal(channel.payment().status, 'success')
})

test('a later failed batch replaces recovery only after the earlier batch is confirmed', async (t) => {
  await withRealStorePaymentFixture(t, async (f) => {
    f.failAt(3, 8)
    await assert.rejects(f.notify(), /partial Mongo outage/)
    await assert.rejects(f.notify('LP2'), /partial Mongo outage/)
    assert.deepEqual(f.calls.slice(3, 6).map(call => [call.name, call.filter._id]), [['orders', 'O1'], ['lakalaPayments', 'LP1'], ['app_meta', 'main']])
    await f.notify()
    assert.deepEqual(f.calls.slice(8, 11).map(call => [call.name, call.filter._id]), [['orders', 'O1'], ['lakalaPayments', 'LP2'], ['app_meta', 'main']])
    assert.deepEqual(f.durableRows('orders').find(item => item.id === 'O1').installmentPlan.map(item => item.paid), [true, true])
    assert.equal(f.readiness().usable, true)
  })
})

test('exact recovery refuses to overwrite a newer target while the scope remains untrusted', async (t) => {
  await withRealStorePaymentFixture(t, async (f) => {
    const store = require('../src/store')
    f.failAt(3)
    await assert.rejects(f.notify(), /partial Mongo outage/)
    const newer = { ...f.durableRows('orders').find(item => item.id === 'O1'), adminNote: 'newer confirmed edit' }
    await store.writeDbEntities(f.read(), [{ entityKey: 'orders', item: newer }])
    assert.equal(f.readiness().usable, false)
    const writesBefore = f.calls.length
    await assert.rejects(f.notify('LP2'), /缓存已变化/)
    assert.equal(f.calls.length, writesBefore)
    assert.equal(f.durableRows('orders').find(item => item.id === 'O1').adminNote, 'newer confirmed edit')
    await store.writeDbEntities(f.read(), [{ entityKey: 'lakalaPayments', item: f.durableRows('lakalaPayments').find(item => item.outTradeNo === 'LP1') }])
    assert.equal(f.readiness().usable, true)
    await f.notify('LP2')
    assert.equal(f.durableRows('orders').find(item => item.id === 'O1').adminNote, 'newer confirmed edit')
  })
})

for (const bizType of ['order_full', 'bill_repay', 'bill_repay_negotiated']) {
  test(`preorder ${bizType} revalidates after partial durable recovery before external checkout`, async (t) => {
    await withRealStorePaymentFixture(t, async (f) => {
      f.failAt(3)
      await assert.rejects(f.notify(), /partial Mongo outage/)
      assert.equal(f.readiness().usable, false)
      assert.equal(f.read().lakalaPayments.find(item => item.outTradeNo === 'LP1').status, 'pending')
      await assert.rejects(f.preorder(), /已支付|已还款|暂无待支付的协商款项/)
      assert.equal(f.externalCalls.length, 0)
      assert.equal(f.durableRows('lakalaPayments').length, 2, 'rejected preorder must not create a new pending row')
      assert.equal(f.readiness().usable, true)
    }, { bizType })
  })
}

test('preorder repay-all recalculates amount and targets from the recovered order', async (t) => {
  await withRealStorePaymentFixture(t, async (f) => {
    f.failAt(3)
    await assert.rejects(f.notify(), /partial Mongo outage/)
    assert.equal(f.readiness().usable, false)
    const result = await f.preorder({ bizType: 'bill_repay_all' })
    assert.equal(result.amountYuan, 100)
    assert.equal(f.externalCalls.length, 1)
    assert.equal(f.externalCalls[0].totalAmountYuan, 100)
    const pending = f.durableRows('lakalaPayments').find(item => item.outTradeNo === result.outTradeNo)
    assert.deepEqual(pending.settlementTargets, [{ orderId: 'O1', period: 2 }])
    assert.equal(pending.amountYuan, 100)
  })
})

test('preorder queued while a settlement is in flight validates only after recovery', async (t) => {
  await withRealStorePaymentFixture(t, async (f) => {
    f.failAt(2)
    const gate = f.block()
    const rejectedSettlement = assert.rejects(f.notify(), /partial Mongo outage/)
    await gate.began
    const rejectedPreorder = assert.rejects(f.preorder(), /该期已还款/)
    gate.release()
    await Promise.all([rejectedSettlement, rejectedPreorder])
    assert.equal(f.externalCalls.length, 0)
    assert.equal(f.durableRows('lakalaPayments').length, 2)
  })
})

for (const bizType of ['order_full', 'bill_repay', 'bill_repay_negotiated', 'bill_repay_all']) {
  test(`normal ${bizType} preorder preserves its amount and checkout response`, async () => {
    const f = createFixture({ bizType })
    const result = await f.preorder()
    assert.equal(result.amountYuan, bizType === 'bill_repay_negotiated' ? 10 : 100)
    assert.equal(result.bizType, bizType)
    assert.equal(result.orderId, 'O1')
    assert.equal(result.period, bizType === 'order_full' ? undefined : 1)
    assert.equal(result.counterUrl, 'https://fake.invalid/checkout')
    assert.equal(result.payCode, result.counterUrl)
    assert.equal(result.payOrderNo, 'T1')
    assert.equal(result.tradeNo, 'T1')
    assert.equal(result.payChannel, 'wechat')
    assert.equal(result.accountType, 'WECHAT')
    assert.equal(result.mock, true)
    assert.deepEqual(Object.keys(result).sort(), ['outTradeNo', 'tradeNo', 'amountYuan', 'payChannel', 'accountType', 'payCode', 'payCodeImage', 'counterUrl', 'payOrderNo', 'mock', 'bizType', 'orderId', 'period'].sort())
    assert.deepEqual(f.events, ['persist', 'external', 'persist'])
    assert.equal(f.externalCalls[0].totalAmountYuan, result.amountYuan)
    assert.equal(f.externalCalls[0].outOrderNo, result.outTradeNo)
  })
}

test('external preorder network wait does not hold the scope payment queue', { timeout: 2000 }, async () => {
  let release
  let started
  const gate = new Promise(resolve => { release = resolve })
  const began = new Promise(resolve => { started = resolve })
  const f = createFixture({ createFn: async () => {
    started()
    await gate
    return { counterUrl: 'https://fake.invalid/checkout', payOrderNo: 'T1' }
  } })
  const preorder = f.preorder()
  await began
  try {
    await f.notify()
    assert.equal(f.payment().status, 'success')
  }
  finally { release() }
  assert.equal((await preorder).counterUrl, 'https://fake.invalid/checkout')
})
