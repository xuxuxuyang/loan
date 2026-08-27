const crypto = require('crypto')

class AdminLoginSecurityError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'AdminLoginSecurityError'
    this.code = code
    this.status = status
  }
}

function maskPhone(value) {
  const phone = String(value || '').trim()
  return /^1\d{10}$/.test(phone) ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : ''
}

function accountId(account) {
  return String(account?.id || account?.username || '').trim()
}

function createAdminLoginSecurityService(options = {}) {
  const store = options.store
  const now = options.now || Date.now
  const randomInt = options.randomInt || crypto.randomInt
  const randomBytes = options.randomBytes || crypto.randomBytes
  const sendSms = options.sendSms
  const smsReady = options.smsReady || (() => true)
  const formatSmsMessage = options.formatSmsMessage || (code => `Your admin login verification code is ${code}.`)
  const secret = String(options.secret || '')
  const otpTtlMs = Number(options.otpTtlMs)
  const resendMs = Number(options.resendMs)
  const hourlySendLimit = Number(options.hourlySendLimit)
  const maxAttempts = Number(options.maxAttempts)
  const sessionTtlMs = Number(options.sessionTtlMs)

  const digest = value => crypto.createHmac('sha256', secret).update(String(value)).digest('hex')

  function validPositiveInteger(value) {
    return Number.isInteger(value) && value > 0
  }

  function ensureStoreReady() {
    if (!store || typeof store.isReady !== 'function' || !store.isReady()) {
      throw new AdminLoginSecurityError('ADMIN_LOGIN_UNAVAILABLE', 'Admin login security storage is unavailable', 503)
    }
  }

  function ensureRuntimeConfig() {
    if (secret.length < 16
      || !validPositiveInteger(otpTtlMs)
      || !validPositiveInteger(resendMs)
      || !validPositiveInteger(hourlySendLimit)
      || !validPositiveInteger(maxAttempts)
      || !validPositiveInteger(sessionTtlMs)) {
      throw new AdminLoginSecurityError('ADMIN_LOGIN_UNAVAILABLE', 'Admin login security configuration is incomplete', 503)
    }
  }

  function ensureSmsReady() {
    if (typeof sendSms !== 'function') {
      throw new AdminLoginSecurityError('ADMIN_LOGIN_SMS_UNAVAILABLE', 'Admin login SMS delivery is unavailable', 503)
    }
    try {
      if (!smsReady()) {
        throw new AdminLoginSecurityError('ADMIN_LOGIN_SMS_UNAVAILABLE', 'Admin login SMS delivery is unavailable', 503)
      }
    }
    catch (error) {
      if (error instanceof AdminLoginSecurityError) throw error
      throw new AdminLoginSecurityError('ADMIN_LOGIN_SMS_UNAVAILABLE', 'Admin login SMS delivery is unavailable', 503)
    }
  }

  async function ensureIndexes() {
    ensureStoreReady()
    const ready = await store.ensureIndexes()
    if (!ready) {
      throw new AdminLoginSecurityError('ADMIN_LOGIN_UNAVAILABLE', 'Admin login security storage is unavailable', 503)
    }
    return true
  }

  async function createChallenge(context = {}) {
    ensureStoreReady()
    ensureRuntimeConfig()
    ensureSmsReady()
    if (context.passwordVerified !== true) {
      throw new AdminLoginSecurityError('ADMIN_LOGIN_PASSWORD_REQUIRED', 'Password verification is required before SMS verification', 401)
    }
    const account = context.account || {}
    const id = accountId(account)
    if (!id) {
      throw new AdminLoginSecurityError('ADMIN_LOGIN_ACCOUNT_INVALID', 'Admin account is invalid', 401)
    }
    const phone = String(account.phone || '').trim()
    if (!/^1\d{10}$/.test(phone)) {
      throw new AdminLoginSecurityError('ADMIN_LOGIN_PHONE_MISSING', 'Admin account does not have a valid phone number', 409)
    }
    await ensureIndexes()
    const nowMs = Number(now())
    const createdAt = new Date(nowMs)
    const reservationId = randomBytes(16).toString('base64url')
    const reservation = await store.reserveChallengeSend({
      accountId: id,
      tenantId: String(context.tenantId || 'default'),
      now: createdAt,
      resendMs,
      hourlyLimit: hourlySendLimit,
      reservationId,
    })
    if (!reservation?.reserved) {
      const code = reservation?.reason === 'hourly' ? 'ADMIN_LOGIN_HOURLY_LIMITED' : 'ADMIN_LOGIN_RESEND_LIMITED'
      throw new AdminLoginSecurityError(code, 'SMS verification requests are rate limited', 429)
    }
    const challengeId = `admin-challenge-v1.${randomBytes(24).toString('base64url')}`
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const row = {
      id: challengeId,
      kind: 'challenge',
      accountId: id,
      tenantId: String(context.tenantId || 'default'),
      username: String(account.username || '').trim(),
      name: String(account.name || '').trim(),
      role: String(account.role || '').trim(),
      codeHash: digest(code),
      attempts: 0,
      status: 'pending',
      createdAt,
      resendAt: new Date(nowMs + resendMs),
      expireAt: new Date(nowMs + otpTtlMs),
      requestIp: String(context.ip || '').trim(),
      userAgent: String(context.userAgent || '').slice(0, 500),
    }
    await store.insertChallenge(row)
    try {
      await sendSms(phone, formatSmsMessage(code, context))
    }
    catch {
      await store.markChallengeSendFailed(challengeId)
      throw new AdminLoginSecurityError('ADMIN_LOGIN_SMS_UNAVAILABLE', 'Admin login SMS delivery is unavailable', 503)
    }
    return {
      challengeId,
      phoneMasked: maskPhone(phone),
      expiresAt: row.expireAt.toISOString(),
      resendAt: row.resendAt.toISOString(),
    }
  }

  async function verifyChallenge(input = {}) {
    ensureStoreReady()
    ensureRuntimeConfig()
    const challengeId = String(input.challengeId || '').trim()
    const challenge = await store.getChallenge(challengeId)
    if (!challenge || challenge.status !== 'pending') {
      throw new AdminLoginSecurityError('ADMIN_LOGIN_CHALLENGE_INVALID', 'Admin login challenge is invalid', 403)
    }
    const nowMs = Number(now())
    if (new Date(challenge.expireAt).getTime() <= nowMs) {
      await store.expireChallenge(challengeId, new Date(nowMs))
      throw new AdminLoginSecurityError('ADMIN_LOGIN_CHALLENGE_EXPIRED', 'Admin login challenge has expired', 403)
    }
    const code = String(input.code || '').trim()
    const expectedHash = digest(code)
    const actualHash = String(challenge.codeHash || '')
    const valid = /^\d{6}$/.test(code)
      && actualHash.length === expectedHash.length
      && crypto.timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'))
    if (!valid) {
      const failed = await store.recordChallengeFailure(challengeId, new Date(nowMs), maxAttempts)
      if (!failed) {
        throw new AdminLoginSecurityError('ADMIN_LOGIN_CHALLENGE_INVALID', 'Admin login challenge is invalid', 403)
      }
      if (failed.status === 'blocked') {
        throw new AdminLoginSecurityError('ADMIN_LOGIN_CHALLENGE_BLOCKED', 'Too many incorrect verification codes', 403)
      }
      throw new AdminLoginSecurityError('ADMIN_LOGIN_CODE_INVALID', 'Verification code is invalid', 403)
    }
    const claimed = await store.claimChallenge(challengeId, new Date(nowMs), maxAttempts)
    if (!claimed) {
      throw new AdminLoginSecurityError('ADMIN_LOGIN_CHALLENGE_INVALID', 'Admin login challenge is invalid', 403)
    }
    const token = `admin-session-v1.${randomBytes(32).toString('base64url')}`
    const expireAt = new Date(nowMs + sessionTtlMs)
    await store.insertSession({
      id: `admin-session-record-v1.${randomBytes(16).toString('base64url')}`,
      tokenHash: digest(token),
      accountId: claimed.accountId,
      tenantId: claimed.tenantId,
      username: claimed.username,
      name: claimed.name,
      role: claimed.role,
      createdAt: new Date(nowMs),
      expireAt,
      revokedAt: null,
      createdIp: claimed.requestIp,
    })
    return { token, expiresAt: expireAt.toISOString() }
  }

  function sessionView(session) {
    return {
      accountId: session.accountId,
      tenantId: session.tenantId,
      username: session.username,
      name: session.name,
      role: session.role,
      expiresAt: new Date(session.expireAt).toISOString(),
    }
  }

  async function resolveSession(token) {
    ensureStoreReady()
    ensureRuntimeConfig()
    const rawToken = String(token || '').trim()
    if (!rawToken.startsWith('admin-session-v1.')) {
      throw new AdminLoginSecurityError('ADMIN_LOGIN_SESSION_INVALID', 'Admin login session is invalid', 401)
    }
    const tokenHash = digest(rawToken)
    const nowDate = new Date(Number(now()))
    const active = await store.findActiveSession(tokenHash, nowDate)
    if (active) return sessionView(active)
    const stored = await store.getSession(tokenHash)
    if (stored && !stored.revokedAt && new Date(stored.expireAt).getTime() <= nowDate.getTime()) {
      throw new AdminLoginSecurityError('ADMIN_LOGIN_SESSION_EXPIRED', 'Admin login session has expired', 401)
    }
    throw new AdminLoginSecurityError('ADMIN_LOGIN_SESSION_INVALID', 'Admin login session is invalid', 401)
  }

  async function revokeSession(token) {
    ensureStoreReady()
    ensureRuntimeConfig()
    const rawToken = String(token || '').trim()
    if (!rawToken.startsWith('admin-session-v1.')) return false
    return Boolean(await store.revokeSession(digest(rawToken), new Date(Number(now()))))
  }

  return {
    createChallenge,
    ensureIndexes,
    resolveSession,
    revokeSession,
    verifyChallenge,
  }
}

module.exports = {
  AdminLoginSecurityError,
  createAdminLoginSecurityService,
}
