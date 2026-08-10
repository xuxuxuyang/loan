const crypto = require('node:crypto')
const { setError } = require('./auth')

const ACTIVE_ORDER_STATUSES = new Set(['reviewing', 'shipping', 'receiving'])
const ACTIVE_PAYMENT_STATUSES = new Set(['pending', 'processing'])

function resolveLegalRetentionDays(env = process.env) {
  const raw = String(env.IOS_ACCOUNT_LEGAL_RETENTION_DAYS || '').trim()
  if (!raw) return 1825
  const days = Number(raw)
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error('IOS_ACCOUNT_LEGAL_RETENTION_DAYS must be a positive integer')
  }
  return days
}

function ownedOrders(db, user) {
  return (Array.isArray(db.orders) ? db.orders : []).filter(order => String(order && order.mallUserId || '') === String(user.id || ''))
}

function ownedPayments(db, user, normalizePhone) {
  return (Array.isArray(db.lakalaPayments) ? db.lakalaPayments : [])
    .filter(payment => accountRecordMatches(payment, user, normalizePhone))
}

function deletionBlockers(db, user, deps) {
  const blockers = []
  for (const order of ownedOrders(db, user)) {
    const status = String(order.status || '')
    if (ACTIVE_ORDER_STATUSES.has(status)) {
      blockers.push({ code: 'ORDER_IN_PROGRESS', orderId: String(order.id || ''), msg: '存在审核中、待发货或待收货订单' })
      continue
    }
    if (!deps.isOrderSettled(order)) {
      blockers.push({ code: 'INSTALLMENT_NOT_SETTLED', orderId: String(order.id || ''), msg: '存在未结清分期或待还账单' })
      continue
    }
    if (order.payType === 'installment' && !String(order.cardPackageContractSignedAt || order.contractSignedAt || '').trim()) {
      blockers.push({ code: 'CONTRACT_NOT_COMPLETED', orderId: String(order.id || ''), msg: '存在尚未完成的合同' })
    }
  }
  for (const payment of ownedPayments(db, user, deps.normalizePhone)) {
    if (ACTIVE_PAYMENT_STATUSES.has(String(payment.status || '').trim().toLowerCase())) {
      blockers.push({ code: 'PAYMENT_IN_PROGRESS', paymentId: String(payment.outTradeNo || ''), msg: '存在尚未完成的支付流水' })
    }
  }
  return blockers
}

function accountRecordMatches(record, user, normalizePhone) {
  if (!record || typeof record !== 'object') return false
  const userId = String(user.id || '')
  if (userId && [record.userId, record.mallUserId].some(value => String(value || '') === userId)) return true
  const phone = normalizePhone(user.phone)
  return Boolean(phone && [record.userPhone, record.mallUserPhone].some(value => normalizePhone(value) === phone))
}

function anonymizedReference(user) {
  const digest = crypto.createHash('sha256').update(`${String(user.id || '')}:${String(user.phone || '')}`).digest('hex')
  return `deleted_${digest.slice(0, 24)}`
}

function anonymizeOrder(order, reference, retentionDays) {
  const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString()
  order.mallUserId = reference
  for (const key of [
    'receiverName', 'receiverPhone', 'receiverAddress', 'buyerName', 'buyerPhone',
    'contractSignerName', 'contractSignerPhone', 'contactName', 'contactPhone',
  ]) {
    if (Object.prototype.hasOwnProperty.call(order, key)) order[key] = ''
  }
  order.accountDeletedAt = new Date().toISOString()
  order.legalRetentionExpiresAt = expiresAt
}

function anonymizePayment(payment, reference, retentionDays) {
  const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString()
  payment.mallUserId = reference
  for (const key of ['mallUserPhone', 'userPhone', 'phone', 'payerPhone', 'buyerPhone']) {
    if (Object.prototype.hasOwnProperty.call(payment, key)) payment[key] = ''
  }
  payment.accountDeletedAt = new Date().toISOString()
  payment.legalRetentionExpiresAt = expiresAt
}

function requireDeletionUser(ctx, deps) {
  const db = deps.readDb()
  const user = deps.resolveUser(ctx, db)
  if (!user) {
    setError(ctx, 'UNAUTHORIZED', '账号不存在或登录状态已失效', 401)
    return null
  }
  return { db, user }
}

function registerAccountDeletionRoutes(router, deps) {
  const retentionDays = resolveLegalRetentionDays()

  router.get('/ios/account/deletion-eligibility', async (ctx) => {
    const resolved = requireDeletionUser(ctx, deps)
    if (!resolved) return
    const blockers = deletionBlockers(resolved.db, resolved.user, deps)
    ctx.body = deps.success({ canDelete: blockers.length === 0, blockers })
  })

  router.post('/ios/account/delete', async (ctx) => {
    const resolved = requireDeletionUser(ctx, deps)
    if (!resolved) return
    const body = ctx.request.body || {}
    if (body.confirm !== true) {
      setError(ctx, 'ACCOUNT_DELETE_CONFIRMATION_REQUIRED', '请确认永久注销账号')
      return
    }
    const currentPassword = String(body.currentPassword || '')
    if (!currentPassword || !deps.verifyPassword(currentPassword, resolved.user.passwordHash)) {
      setError(ctx, 'INVALID_CURRENT_PASSWORD', '当前密码不正确')
      return
    }
    const blockers = deletionBlockers(resolved.db, resolved.user, deps)
    if (blockers.length) {
      setError(ctx, 'ACCOUNT_HAS_ACTIVE_BUSINESS', blockers[0].msg, 409)
      return
    }

    const phone = deps.normalizePhone(resolved.user.phone)
    const imageUrls = [resolved.user.idCardFront, resolved.user.idCardBack, resolved.user.idCardHandheld]
      .map(value => String(value || '').trim())
      .filter(Boolean)
    await deps.deleteContactsByAccount({ userId: String(resolved.user.id || ''), phone })
    for (const imageUrl of imageUrls) await deps.deleteIdCardImage(imageUrl, phone)

    const history = ownedOrders(resolved.db, resolved.user)
    const payments = ownedPayments(resolved.db, resolved.user, deps.normalizePhone)
    const hasLegalHistory = history.length > 0 || payments.length > 0
    const mode = hasLegalHistory ? 'anonymized_with_legal_retention' : 'hard_deleted'
    if (hasLegalHistory) {
      const reference = anonymizedReference(resolved.user)
      for (const order of history) anonymizeOrder(order, reference, retentionDays)
      for (const payment of payments) anonymizePayment(payment, reference, retentionDays)
    }
    resolved.db.users = (Array.isArray(resolved.db.users) ? resolved.db.users : []).filter(item => item !== resolved.user)
    resolved.db.addresses = (Array.isArray(resolved.db.addresses) ? resolved.db.addresses : [])
      .filter(item => !accountRecordMatches(item, resolved.user, deps.normalizePhone))
    resolved.db.bankCards = (Array.isArray(resolved.db.bankCards) ? resolved.db.bankCards : [])
      .filter(item => !accountRecordMatches(item, resolved.user, deps.normalizePhone))
    const userId = String(resolved.user.id || '')
    resolved.db.csSessions = (Array.isArray(resolved.db.csSessions) ? resolved.db.csSessions : [])
      .filter(session => String(session && session.mallUserId || '') !== userId)
    await deps.writeAccountDeletion(resolved.db)
    await deps.flushPersist()
    ctx.body = deps.success({ mode, ...(hasLegalHistory ? { retentionDays } : {}) })
  })
}

module.exports = {
  accountRecordMatches,
  anonymizeOrder,
  anonymizePayment,
  deletionBlockers,
  registerAccountDeletionRoutes,
  resolveLegalRetentionDays,
}
