const crypto = require('crypto')
const {
  AdminSecurityError,
  canonicalActionFingerprint,
  getActionPolicy,
  maskPhone,
  sanitizeAuditTarget,
} = require('./adminSecurityCore')

function securityId(prefix) {
  return `${prefix}${Date.now().toString(36)}${crypto.randomBytes(8).toString('hex')}`
}

function hmac(secret, value) {
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex')
}

function actorId(account) {
  return String(account?.id || account?.username || '').trim()
}

function createAdminSecurityService(options) {
  const store = options.store
  const now = options.now || Date.now
  const secret = String(options.secret || '').trim()
  const smsTemplate = String(options.smsTemplate || '').trim()
  const modeResolver = options.modeResolver || (() => 'off')
  const sendSms = options.sendSms || (async () => {
    throw new Error('短信发送器未配置')
  })
  const smsReady = options.smsReady || (() => true)
  const otpTtlMs = Number(options.otpTtlMs)
  const resendMs = Number(options.resendMs)
  const repaymentProofTtlMs = Number(options.repaymentProofTtlMs)
  const logRetentionDays = Number(options.logRetentionDays)
  const hourlySendLimit = Number(options.hourlySendLimit)
  const maxAttempts = Number(options.maxAttempts)

  function hasValidRuntimeConfig() {
    return [otpTtlMs, resendMs, repaymentProofTtlMs, logRetentionDays, hourlySendLimit, maxAttempts]
      .every(value => Number.isInteger(value) && value > 0)
  }

  function mode(ctx) {
    return modeResolver(String(ctx?.tenantId || 'default'))
  }

  function ensureStoreReady() {
    if (!store || !store.isReady()) {
      throw new AdminSecurityError('ADMIN_SECURITY_UNAVAILABLE', '安全存储暂不可用，请稍后重试', 503)
    }
  }

  function ensureOtpReady() {
    ensureStoreReady()
    if (!hasValidRuntimeConfig()) {
      throw new AdminSecurityError('ADMIN_SECURITY_UNAVAILABLE', '后台安全环境变量未完整配置', 503)
    }
    if (secret.length < 16) {
      throw new AdminSecurityError('ADMIN_SECURITY_UNAVAILABLE', '后台安全密钥未正确配置', 503)
    }
  }

  function policyFor(actionCode) {
    const policy = getActionPolicy(actionCode)
    if (!policy) {
      throw new AdminSecurityError('ADMIN_SECURITY_ACTION_INVALID', '不支持的敏感操作类型', 400)
    }
    return policy
  }

  function isSmsReady() {
    try {
      return Boolean(smsReady())
    }
    catch {
      return false
    }
  }

  function actorView(account) {
    return {
      id: actorId(account),
      username: String(account?.username || '').trim(),
      name: String(account?.name || '').trim(),
      role: String(account?.role || '').trim(),
      phoneMasked: maskPhone(account?.phone),
    }
  }

  function intentFingerprint(policy, actionCode, target, input) {
    return policy.reusable ? '' : canonicalActionFingerprint(actionCode, target, input)
  }

  async function appendBlockedAudit(ctx, challenge, reason) {
    const policy = policyFor(challenge.actionCode)
    const createdAt = new Date(now())
    const row = {
      id: securityId('ASL'),
      requestId: securityId('REQ'),
      tenantId: ctx.tenantId,
      actor: actorView(ctx.account),
      ip: ctx.ip,
      userAgent: String(ctx.userAgent || '').slice(0, 500),
      actionCode: challenge.actionCode,
      actionLabel: policy.label,
      category: policy.category,
      target: sanitizeAuditTarget(challenge.target),
      summary: '手机验证码连续校验失败，操作已拦截',
      verificationMode: 'sms',
      status: 'blocked',
      error: String(reason || '').slice(0, 300),
      createdAt,
      completedAt: createdAt,
      expireAt: new Date(createdAt.getTime() + logRetentionDays * 86_400_000),
    }
    try {
      await store.insertAuditLog(row)
    }
    catch (error) {
      console.warn('[admin-security] blocked audit write failed:', error?.message || error)
    }
  }

  async function createChallenge(ctx, intent) {
    ensureOtpReady()
    if (mode(ctx) !== 'enforce') {
      throw new AdminSecurityError('ADMIN_SECURITY_NOT_ENFORCED', '当前租户未启用敏感操作验证码', 409)
    }
    const actionCode = String(intent?.actionCode || '').trim()
    const policy = policyFor(actionCode)
    const id = actorId(ctx.account)
    const phone = String(ctx.account?.phone || '').trim()
    if (!id) throw new AdminSecurityError('ADMIN_SECURITY_ACCOUNT_INVALID', '无法识别当前后台账号', 401)
    if (!/^1\d{10}$/.test(phone)) {
      throw new AdminSecurityError('ADMIN_SECURITY_PHONE_MISSING', '当前后台账号未绑定有效手机号', 409)
    }
    if (!smsTemplate.includes('{code}') || !smsTemplate.includes('{action}')) {
      throw new AdminSecurityError('ADMIN_SECURITY_UNAVAILABLE', '后台安全短信模板未正确配置', 503)
    }
    if (!isSmsReady()) {
      throw new AdminSecurityError('ADMIN_SECURITY_UNAVAILABLE', '后台安全短信通道未就绪', 503)
    }
    await store.ensureIndexes()
    const nowMs = now()
    const reservation = await store.reserveChallengeSend({
      actorId: id,
      tenantId: ctx.tenantId,
      now: new Date(nowMs),
      resendMs,
      hourlyLimit: hourlySendLimit,
      reservationId: securityId('ASR'),
    })
    if (!reservation?.reserved) {
      const message = reservation?.reason === 'hourly'
        ? '验证码发送次数过多，请稍后再试'
        : '发送过于频繁，请稍后再试'
      throw new AdminSecurityError('ADMIN_SECURITY_SMS_RATE_LIMIT', message, 429)
    }

    const challengeId = securityId('ASC')
    const code = String(crypto.randomInt(100000, 1000000))
    const createdAt = new Date(nowMs)
    const target = sanitizeAuditTarget(intent?.target)
    const row = {
      id: challengeId,
      actorId: id,
      actor: actorView(ctx.account),
      tenantId: ctx.tenantId,
      ip: ctx.ip,
      actionCode,
      scope: policy.scope,
      reusable: policy.reusable,
      target,
      fingerprint: intentFingerprint(policy, actionCode, intent?.target, intent?.input),
      codeHash: hmac(secret, `otp:${challengeId}:${code}`),
      attempts: 0,
      status: 'pending',
      createdAt,
      resendAt: new Date(nowMs + resendMs),
      expireAt: new Date(nowMs + otpTtlMs),
    }
    await store.insertChallenge(row)
    const message = smsTemplate.split('{code}').join(code).split('{action}').join(policy.label)
    try {
      await sendSms(phone, message)
    }
    catch (error) {
      await store.updateChallenge(challengeId, { status: 'send_failed', sendError: String(error?.message || error).slice(0, 300) })
      throw new AdminSecurityError('ADMIN_SECURITY_SMS_FAILED', '验证码发送失败，请稍后重试', 502)
    }
    return {
      challengeId,
      phoneMasked: maskPhone(phone),
      expiresAt: row.expireAt.toISOString(),
      resendAt: row.resendAt.toISOString(),
    }
  }

  async function verifyChallenge(ctx, challengeId, inputCode) {
    ensureOtpReady()
    const challenge = await store.getChallenge(String(challengeId || '').trim())
    const id = actorId(ctx.account)
    if (!challenge
      || challenge.actorId !== id
      || challenge.tenantId !== ctx.tenantId
      || challenge.ip !== ctx.ip
      || challenge.status !== 'pending') {
      throw new AdminSecurityError('ADMIN_SECURITY_CHALLENGE_INVALID', '验证码请求无效或已失效', 403)
    }
    const nowMs = now()
    if (new Date(challenge.expireAt).getTime() <= nowMs) {
      await store.updateChallenge(challenge.id, { status: 'expired' })
      throw new AdminSecurityError('ADMIN_SECURITY_CHALLENGE_EXPIRED', '验证码已过期，请重新获取', 403)
    }
    const code = String(inputCode || '').trim()
    const valid = /^\d{6}$/.test(code)
      && crypto.timingSafeEqual(
        Buffer.from(challenge.codeHash, 'hex'),
        Buffer.from(hmac(secret, `otp:${challenge.id}:${code}`), 'hex'),
      )
    if (!valid) {
      const failure = await store.recordChallengeFailure(challenge.id, new Date(nowMs), maxAttempts)
      if (!failure) {
        throw new AdminSecurityError('ADMIN_SECURITY_CHALLENGE_INVALID', '验证码请求无效或已失效', 403)
      }
      if (failure.blockedNow) {
        await appendBlockedAudit(ctx, failure.challenge, `验证码连续输错 ${maxAttempts} 次`)
        throw new AdminSecurityError('ADMIN_SECURITY_CHALLENGE_BLOCKED', '验证码错误次数过多，请重新获取', 403)
      }
      throw new AdminSecurityError('ADMIN_SECURITY_CODE_INVALID', '短信验证码不正确', 403)
    }

    const claimedChallenge = await store.claimChallengeVerification(challenge.id, new Date(nowMs), maxAttempts)
    if (!claimedChallenge) {
      throw new AdminSecurityError('ADMIN_SECURITY_CHALLENGE_INVALID', '验证码请求无效或已失效', 403)
    }
    const proofToken = crypto.randomBytes(32).toString('base64url')
    const proofHash = hmac(secret, `proof:${proofToken}`)
    const ttl = claimedChallenge.reusable ? repaymentProofTtlMs : otpTtlMs
    await store.insertProof({
      proofHash,
      actorId: id,
      tenantId: ctx.tenantId,
      ip: ctx.ip,
      scope: claimedChallenge.scope,
      actionCode: claimedChallenge.actionCode,
      fingerprint: claimedChallenge.fingerprint,
      reusable: claimedChallenge.reusable,
      challengeId: claimedChallenge.id,
      useCount: 0,
      consumedAt: null,
      createdAt: new Date(nowMs),
      expireAt: new Date(nowMs + ttl),
    })
    return {
      proofToken,
      expiresAt: new Date(nowMs + ttl).toISOString(),
      scope: claimedChallenge.scope,
      reusable: claimedChallenge.reusable,
    }
  }

  async function authorize(ctx, intent) {
    const currentMode = mode(ctx)
    if (currentMode === 'off') return { ok: true, verificationMode: 'off', mode: currentMode }
    if (currentMode === 'audit') return { ok: true, verificationMode: 'audit', mode: currentMode }
    ensureOtpReady()
    const policy = policyFor(intent?.actionCode)
    const proofToken = String(intent?.proofToken || '').trim()
    if (!proofToken) {
      throw new AdminSecurityError('ADMIN_SECURITY_PROOF_REQUIRED', '该操作需要手机验证码确认', 428)
    }
    const proofHash = hmac(secret, `proof:${proofToken}`)
    const proof = await store.getProof(proofHash)
    const expectedFingerprint = intentFingerprint(policy, intent.actionCode, intent.target, intent.input)
    const valid = proof
      && proof.actorId === actorId(ctx.account)
      && proof.tenantId === ctx.tenantId
      && proof.ip === ctx.ip
      && new Date(proof.expireAt).getTime() > now()
      && proof.scope === policy.scope
      && (policy.reusable || (proof.actionCode === intent.actionCode && proof.fingerprint === expectedFingerprint))
    if (!valid) {
      throw new AdminSecurityError('ADMIN_SECURITY_PROOF_INVALID', '安全验证已失效，请重新验证', 403)
    }
    const claimed = await store.claimProof(proofHash, policy.reusable)
    if (!claimed) {
      throw new AdminSecurityError('ADMIN_SECURITY_PROOF_INVALID', '安全验证已使用或已失效', 403)
    }
    return {
      ok: true,
      verificationMode: claimed.useCount === 1 ? 'sms' : 'repayment_window',
      challengeId: claimed.challengeId,
      mode: currentMode,
    }
  }

  async function beginAudit(ctx, detail) {
    const currentMode = mode(ctx)
    if (currentMode === 'off') return null
    const policy = policyFor(detail.actionCode)
    const createdAt = new Date(now())
    const row = {
      id: securityId('ASL'),
      requestId: String(detail.requestId || securityId('REQ')).slice(0, 100),
      tenantId: ctx.tenantId,
      actor: actorView(ctx.account),
      ip: ctx.ip,
      userAgent: String(ctx.userAgent || '').slice(0, 500),
      actionCode: detail.actionCode,
      actionLabel: policy.label,
      category: policy.category,
      target: sanitizeAuditTarget(detail.target),
      summary: String(detail.summary || policy.label).slice(0, 500),
      changes: Array.isArray(detail.changes) ? detail.changes.slice(0, 20) : [],
      verificationMode: String(detail.verificationMode || currentMode).slice(0, 40),
      status: 'pending',
      error: '',
      createdAt,
      completedAt: null,
      expireAt: new Date(createdAt.getTime() + logRetentionDays * 86_400_000),
    }
    try {
      await store.ensureIndexes()
      await store.insertAuditLog(row)
      return row
    }
    catch (error) {
      if (currentMode === 'enforce') {
        throw new AdminSecurityError('ADMIN_SECURITY_UNAVAILABLE', '操作记录暂不可用，敏感操作已停止', 503)
      }
      console.warn('[admin-security] audit write failed:', error?.message || error)
      return null
    }
  }

  async function completeAudit(logOrId, result = {}) {
    const id = typeof logOrId === 'string' ? logOrId : logOrId?.id
    if (!id) return null
    try {
      return await store.updateAuditLog(id, {
        status: result.status === 'failed' ? 'failed' : 'success',
        summary: String(result.summary || '').slice(0, 500),
        changes: Array.isArray(result.changes) ? result.changes.slice(0, 20) : [],
        error: String(result.error || '').slice(0, 300),
        completedAt: new Date(now()),
      })
    }
    catch (error) {
      console.warn('[admin-security] audit finalize failed:', error?.message || error)
      return null
    }
  }

  async function getStatus(ctx) {
    const currentMode = mode(ctx)
    return {
      mode: currentMode,
      tenantEnabled: currentMode !== 'off',
      otpReady: Boolean(store?.isReady())
        && hasValidRuntimeConfig()
        && secret.length >= 16
        && smsTemplate.includes('{code}')
        && smsTemplate.includes('{action}')
        && isSmsReady(),
      phoneMasked: maskPhone(ctx.account?.phone),
    }
  }

  async function listAuditLogs(filter) {
    ensureStoreReady()
    return store.listAuditLogs(filter)
  }

  async function getAuditLog(id) {
    ensureStoreReady()
    return store.getAuditLog(id)
  }

  return {
    authorize,
    beginAudit,
    completeAudit,
    createChallenge,
    getAuditLog,
    getStatus,
    listAuditLogs,
    verifyChallenge,
  }
}

module.exports = { createAdminSecurityService }
