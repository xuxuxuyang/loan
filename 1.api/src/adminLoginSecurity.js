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

const SESSION_TTL_MS = 43_200_000
const OTP_TTL_RANGE_MS = [120_000, 600_000]
const RESEND_RANGE_MS = [30_000, 300_000]
const HOURLY_SEND_LIMIT_RANGE = [1, 10]
const MAX_ATTEMPTS_RANGE = [3, 5]
const ADMIN_LOGIN_SESSION_TOKEN_PATTERN = /^admin-session-v1\.[A-Za-z0-9_-]{43}$/

function isAdminLoginSessionToken(value) {
  return ADMIN_LOGIN_SESSION_TOKEN_PATTERN.test(String(value || '').trim())
}

function isIntegerInRange(value, [minimum, maximum]) {
  return Number.isInteger(value) && value >= minimum && value <= maximum
}

function hasStrongEncodedSecret(secret) {
  if (!/^[A-Za-z0-9_-]+$/.test(secret)) return false
  try {
    const bytes = Buffer.from(secret, 'base64url')
    return bytes.length >= 32
      && bytes.toString('base64url') === secret
      && new Set(bytes).size >= 16
  }
  catch {
    return false
  }
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

  if (!hasStrongEncodedSecret(secret)
    || !isIntegerInRange(otpTtlMs, OTP_TTL_RANGE_MS)
    || !isIntegerInRange(resendMs, RESEND_RANGE_MS)
    || resendMs > otpTtlMs
    || !isIntegerInRange(hourlySendLimit, HOURLY_SEND_LIMIT_RANGE)
    || !isIntegerInRange(maxAttempts, MAX_ATTEMPTS_RANGE)
    || sessionTtlMs !== SESSION_TTL_MS) {
    throw new AdminLoginSecurityError('ADMIN_LOGIN_UNAVAILABLE', 'Admin login security configuration is incomplete', 503)
  }

  const digest = value => crypto.createHmac('sha256', secret).update(String(value)).digest('hex')

  function ensureStoreReady() {
    if (!store || typeof store.isReady !== 'function' || !store.isReady()) {
      throw new AdminLoginSecurityError('ADMIN_LOGIN_UNAVAILABLE', 'Admin login security storage is unavailable', 503)
    }
  }

  function ensureRuntimeConfig() {
    return true
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
      status: 'send_pending',
      createdAt,
      resendAt: new Date(nowMs + resendMs),
      expireAt: new Date(nowMs + otpTtlMs),
      requestIp: String(context.ip || '').trim(),
      userAgent: String(context.userAgent || '').slice(0, 500),
    }
    await store.insertChallenge(row)
    async function recoverReplacement() {
      let failed = null
      try {
        failed = await store.markChallengeSendFailed(challengeId)
      }
      catch {
        // A write may have committed before its result was lost, so confirm state before restoring old codes.
      }
      if (failed?.status !== 'send_failed') {
        try {
          failed = await store.getChallenge(challengeId)
        }
        catch {
          return false
        }
      }
      if (failed?.status !== 'send_failed') return false
      try {
        await store.restoreSuspendedChallenges({ replacementId: challengeId })
        return true
      }
      catch {
        return false
      }
    }
    try {
      await store.suspendPendingChallengesForResend({
        accountId: id,
        tenantId: row.tenantId,
        exceptId: challengeId,
        replacementId: challengeId,
        now: createdAt,
      })
    }
    catch {
      await recoverReplacement()
      throw new AdminLoginSecurityError('ADMIN_LOGIN_UNAVAILABLE', 'Admin login security storage is unavailable', 503)
    }
    try {
      await sendSms(phone, formatSmsMessage(code, context))
    }
    catch {
      const recovered = await recoverReplacement()
      const errorCode = recovered ? 'ADMIN_LOGIN_SMS_UNAVAILABLE' : 'ADMIN_LOGIN_UNAVAILABLE'
      const message = recovered
        ? 'Admin login SMS delivery is unavailable'
        : 'Admin login security storage is unavailable'
      throw new AdminLoginSecurityError(errorCode, message, 503)
    }
    let activated = null
    try {
      activated = await store.activateChallenge(challengeId, createdAt)
    }
    catch {
      // Read-after-write distinguishes a failed activation from a committed write with a lost result.
    }
    if (activated?.status !== 'pending') {
      try {
        activated = await store.getChallenge(challengeId)
      }
      catch {
        activated = null
      }
    }
    if (activated?.status !== 'pending') {
      await recoverReplacement()
      throw new AdminLoginSecurityError('ADMIN_LOGIN_UNAVAILABLE', 'Admin login security storage is unavailable', 503)
    }
    try {
      await store.supersedeSuspendedChallenges({
        replacementId: challengeId,
        now: createdAt,
      })
    }
    catch {
      // The replacement is already the only consumable challenge; old rows remain safely suspended.
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
    const rawToken = String(token || '').trim()
    if (!isAdminLoginSessionToken(rawToken)) {
      throw new AdminLoginSecurityError('ADMIN_LOGIN_SESSION_INVALID', 'Admin login session is invalid', 401)
    }
    ensureStoreReady()
    ensureRuntimeConfig()
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
    const rawToken = String(token || '').trim()
    if (!isAdminLoginSessionToken(rawToken)) return false
    ensureStoreReady()
    ensureRuntimeConfig()
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
  isAdminLoginSessionToken,
}
