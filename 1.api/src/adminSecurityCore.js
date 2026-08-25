const crypto = require('crypto')
const net = require('net')

const ACTION_CODES = Object.freeze({
  REPAYMENT_MARK_PAID: 'repayment.mark_paid',
  REPAYMENT_CHANGE_DUE_DATE: 'repayment.change_due_date',
  REPAYMENT_NEGOTIATE: 'repayment.negotiate',
  REPAYMENT_SETTLE_AMOUNT: 'repayment.settle_amount',
  REPAYMENT_NEGOTIATION_PAID: 'repayment.negotiation_paid',
  USER_DELETE: 'user.delete',
  ORDER_DELETE: 'order.delete',
  USER_EXPORT: 'user.export',
})

const ACTION_CATALOG = Object.freeze({
  [ACTION_CODES.REPAYMENT_MARK_PAID]: { label: '标记还款状态', category: 'repayment', scope: 'repayment', reusable: true },
  [ACTION_CODES.REPAYMENT_CHANGE_DUE_DATE]: { label: '修改还款日', category: 'repayment', scope: 'repayment', reusable: true },
  [ACTION_CODES.REPAYMENT_NEGOTIATE]: { label: '协商部分还款', category: 'repayment', scope: 'repayment', reusable: true },
  [ACTION_CODES.REPAYMENT_SETTLE_AMOUNT]: { label: '协商结清金额', category: 'repayment', scope: 'repayment', reusable: true },
  [ACTION_CODES.REPAYMENT_NEGOTIATION_PAID]: { label: '修改协商支付状态', category: 'repayment', scope: 'repayment', reusable: true },
  [ACTION_CODES.USER_DELETE]: { label: '删除用户', category: 'user', scope: 'user.delete', reusable: false },
  [ACTION_CODES.ORDER_DELETE]: { label: '删除订单', category: 'order', scope: 'order.delete', reusable: false },
  [ACTION_CODES.USER_EXPORT]: { label: '导出用户', category: 'export', scope: 'user.export', reusable: false },
})

class AdminSecurityError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'AdminSecurityError'
    this.code = code
    this.status = status
  }
}

function resolveAdminSecurityMode(rawMode, tenantId, rawTenants) {
  const mode = String(rawMode || '').trim().toLowerCase()
  if (!['off', 'audit', 'enforce'].includes(mode)) {
    return 'off'
  }
  const tenants = String(rawTenants || '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
  const tenant = String(tenantId || 'default').trim().toLowerCase() || 'default'
  if (!tenants.includes('*') && !tenants.includes(tenant)) {
    return 'off'
  }
  return mode
}

function normalizeIp(value) {
  let ip = String(value || '').trim()
  if (!ip) return ''
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7)
  }
  if (ip === '::1') return '127.0.0.1'
  return net.isIP(ip) ? ip : ''
}

function isLoopbackIp(value) {
  const ip = normalizeIp(value)
  return ip === '127.0.0.1' || ip === '::1'
}

function resolveTrustedClientIp(ctx) {
  const remote = normalizeIp(ctx?.req?.socket?.remoteAddress || ctx?.request?.socket?.remoteAddress)
  if (isLoopbackIp(remote)) {
    const real = normalizeIp(ctx?.headers?.['x-real-ip'])
    if (real) return real
  }
  return remote
}

function maskPhone(value) {
  const phone = String(value || '').trim()
  return /^1\d{10}$/.test(phone) ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : ''
}

function normalizeAuditDateFilter(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const time = Date.parse(raw)
  return Number.isFinite(time) ? new Date(time).toISOString() : ''
}

function normalizeAdminPaidInput(input) {
  if (!input || typeof input.paid !== 'boolean') return null
  return {
    paid: input.paid,
    permissionAction: input.paid ? 'markPaid' : 'revokePaid',
  }
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue)
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((out, key) => {
        const next = value[key]
        if (next !== undefined) out[key] = stableValue(next)
        return out
      }, {})
  }
  return value
}

function canonicalActionFingerprint(actionCode, target = {}, input = {}) {
  const canonical = JSON.stringify(stableValue({
    actionCode: String(actionCode || '').trim(),
    target: target && typeof target === 'object' ? target : {},
    input: input && typeof input === 'object' ? input : {},
  }))
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

function getActionPolicy(actionCode) {
  return ACTION_CATALOG[String(actionCode || '').trim()] || null
}

function sanitizeAuditTarget(target = {}) {
  const raw = target && typeof target === 'object' ? target : {}
  const out = {}
  const stringKeys = ['type', 'id', 'userId', 'userName', 'orderId', 'view']
  stringKeys.forEach((key) => {
    const value = String(raw[key] == null ? '' : raw[key]).trim()
    if (value) out[key] = value.slice(0, 160)
  })
  const masked = maskPhone(raw.userPhone || raw.phone) || String(raw.phoneMasked || '').trim()
  if (masked) out.phoneMasked = masked.slice(0, 24)
  const period = Number(raw.period)
  if (Number.isInteger(period) && period > 0) out.period = period
  const historyIndex = Number(raw.historyIndex)
  if (Number.isInteger(historyIndex) && historyIndex >= 0) out.historyIndex = historyIndex
  return out
}

module.exports = {
  ACTION_CODES,
  ACTION_CATALOG,
  AdminSecurityError,
  canonicalActionFingerprint,
  getActionPolicy,
  maskPhone,
  normalizeAdminPaidInput,
  normalizeAuditDateFilter,
  normalizeIp,
  resolveAdminSecurityMode,
  resolveTrustedClientIp,
  sanitizeAuditTarget,
}
