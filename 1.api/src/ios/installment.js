const { setError } = require('./auth')
const { isInstallmentProfileComplete } = require('./validation')

const iosRiskOwnership = new Map()

function riskIdentity(user, normalizePhone) {
  return {
    userName: String(user.name || '').trim(),
    phoneNumber: normalizePhone(user.phone),
    idNumber: String(user.idNumber || '').trim().toUpperCase(),
  }
}

function requireInstallmentUser(ctx, deps, options = {}) {
  const db = deps.readDb()
  const user = deps.resolveUser(ctx, db)
  if (!user) {
    setError(ctx, 'UNAUTHORIZED', '请先登录后再申请先享后付', 401)
    return null
  }
  if (options.requireProfile !== false && !isInstallmentProfileComplete(user)) {
    setError(ctx, 'IOS_PROFILE_INCOMPLETE', '请先完整填写先享后付申请资料')
    return null
  }
  if (user.orderBlacklisted) {
    setError(ctx, 'ACCOUNT_ORDER_BLOCKED', '该账号暂不可申请先享后付', 403)
    return null
  }
  return { db, user }
}

function findOwnedWave(waveId, user) {
  const id = String(waveId || '').trim()
  const owned = iosRiskOwnership.get(id)
  if (!owned) return { error: 'missing' }
  if (Number(owned.expiresAt || 0) <= Date.now()) {
    iosRiskOwnership.delete(id)
    return { error: 'expired' }
  }
  if (String(owned.userId) !== String(user.id)) return { error: 'forbidden' }
  return { id, owned }
}

function validateOrderInput(db, user, body, deps) {
  const products = Array.isArray(db.products) ? db.products : []
  const rawProduct = products.find(item => String(item && item.id) === String(body.productId))
  const product = rawProduct ? deps.normalizeProduct(rawProduct) : null
  if (!product) return { error: ['PRODUCT_NOT_FOUND', '商品不存在', 404] }
  if (!product.onSale) return { error: ['PRODUCT_NOT_ON_SALE', '商品已下架', 400] }

  const orders = Array.isArray(db.orders) ? db.orders : []
  const hasActiveOrder = orders.some(order => String(order && order.mallUserId) === String(user.id) && !deps.isOrderSettled(order))
  if (hasActiveOrder) return { error: ['ACCOUNT_HAS_ACTIVE_BUSINESS', '您尚有未结清订单', 400] }

  const quantityRaw = Number(body.quantity)
  const quantity = Number.isInteger(quantityRaw) && quantityRaw > 0 ? Math.min(99, quantityRaw) : 1
  const totalAmount = Number((Number(product.price || 0) * quantity).toFixed(2))
  if (!(totalAmount > 0)) return { error: ['INVALID_PRODUCT_AMOUNT', '商品金额不正确', 400] }
  const quota = deps.normalizeQuota(user.quota)
  if (totalAmount > quota) return { error: ['CREDIT_LIMIT_EXCEEDED', '商品金额超过当前授信额度', 400] }

  const receiverName = String(body.receiverName || '').trim()
  const receiverPhone = deps.normalizePhone(body.receiverPhone)
  const receiverAddress = String(body.receiverAddress || '').trim()
  if (!receiverName || !/^1\d{10}$/.test(receiverPhone) || !receiverAddress) {
    return { error: ['INVALID_RECEIVER', '请完整填写收货人、手机号和地址', 400] }
  }
  return { product, quantity, totalAmount, receiverName, receiverPhone, receiverAddress }
}

function registerInstallmentRoutes(router, deps) {
  router.post('/ios/installment-risk/wave', async (ctx) => {
    const resolved = requireInstallmentUser(ctx, deps)
    if (!resolved) return
    try {
      const data = await deps.createRiskWave(riskIdentity(resolved.user, deps.normalizePhone))
      iosRiskOwnership.set(String(data.waveId), {
        userId: resolved.user.id,
        stepKeys: Array.isArray(data.stepKeys) ? data.stepKeys : deps.getRiskStepKeys(),
        expiresAt: Number(data.expiresAt || Date.now() + 30 * 60 * 1000),
      })
      ctx.body = deps.success(data)
    }
    catch (error) {
      setError(ctx, 'IOS_RISK_WAVE_CREATE_FAILED', String(error && error.message || '创建风控会话失败'), Number(error && error.statusCode) || 400)
    }
  })

  router.post('/ios/installment-risk/wave/:waveId/step/:stepKey', async (ctx) => {
    const resolved = requireInstallmentUser(ctx, deps, { requireProfile: false })
    if (!resolved) return
    const found = findOwnedWave(ctx.params.waveId, resolved.user)
    if (found.error === 'forbidden') {
      setError(ctx, 'FORBIDDEN', '风控会话不属于当前账号', 403)
      return
    }
    if (found.error) {
      setError(ctx, 'IOS_RISK_WAVE_INVALID', '风控会话不存在或已过期', 404)
      return
    }
    const stepKey = String(ctx.params.stepKey || '').trim()
    if (!found.owned.stepKeys.includes(stepKey)) {
      setError(ctx, 'INVALID_RISK_STEP', '未知的风控步骤')
      return
    }
    try {
      const result = await deps.runRiskStep({ stepKey, ...riskIdentity(resolved.user, deps.normalizePhone) })
      const step = result && result.step ? result.step : result
      deps.recordRiskStep(found.id, stepKey, step)
      ctx.body = deps.success({ ok: Boolean(step && step.ok), step })
    }
    catch (error) {
      const failedStep = { key: stepKey, ok: false, error: String(error && error.message || '风控步骤调用异常') }
      deps.recordRiskStep(found.id, stepKey, failedStep)
      ctx.body = deps.success({ ok: false, step: failedStep })
    }
  })

  router.post('/ios/installment/orders', async (ctx) => {
    const resolved = requireInstallmentUser(ctx, deps)
    if (!resolved) return
    const body = ctx.request.body || {}
    const input = validateOrderInput(resolved.db, resolved.user, body, deps)
    if (input.error) {
      setError(ctx, input.error[0], input.error[1], input.error[2])
      return
    }

    const found = findOwnedWave(body.installmentRiskWaveId, resolved.user)
    if (found.error === 'forbidden') {
      setError(ctx, 'FORBIDDEN', '风控会话不属于当前账号', 403)
      return
    }
    if (found.error) {
      setError(ctx, 'IOS_RISK_NOT_PASSED', '风控会话不存在、已过期或已核销')
      return
    }
    const consumed = deps.consumeRiskWave(found.id, riskIdentity(resolved.user, deps.normalizePhone))
    if (!consumed || !consumed.ok) {
      setError(ctx, 'IOS_RISK_NOT_PASSED', consumed && consumed.reason || '先享后付风控未全部通过')
      return
    }
    iosRiskOwnership.delete(found.id)

    const now = new Date().toISOString()
    const order = {
      id: `ODIOS${Date.now()}${Math.floor(Math.random() * 1000)}`,
      productId: input.product.id,
      name: String(input.product.title || input.product.name || body.name || '').trim(),
      spec: String(body.spec || '').trim(),
      totalAmount: input.totalAmount,
      quantity: input.quantity,
      cardPackageAmount: Math.max(0, Number(input.product.cardPackageAmount || 0)) * input.quantity,
      createdAt: now,
      status: 'reviewing',
      paid: false,
      payType: 'installment',
      installmentPeriods: Math.max(1, Number(body.installmentPeriods) || 1),
      payChannel: 'card',
      receiverName: input.receiverName,
      receiverPhone: input.receiverPhone,
      receiverAddress: input.receiverAddress,
      riskStatus: 'passed',
      riskReason: '',
      riskCheckedAt: now,
      riskPreliminaryStepsSummary: Array.isArray(consumed.steps) ? consumed.steps.map(step => ({
        key: step.key,
        state: step.ok ? 'ok' : 'fail',
        label: step.label,
        error: step.error,
      })) : [],
      cardPackageIssued: false,
      trackingNumber: '',
      mallUserId: resolved.user.id,
    }
    order.installmentPlan = deps.buildInstallmentPlan(order.totalAmount, 'installment', '', false, order.installmentPeriods)
    resolved.db.orders.unshift(order)
    await deps.writeOrders(resolved.db)
    await deps.flushPersist()
    ctx.body = deps.success({ order })
  })
}

module.exports = {
  registerInstallmentRoutes,
  riskIdentity,
  validateOrderInput,
}
