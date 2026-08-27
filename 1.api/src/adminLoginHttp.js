const { AdminLoginSecurityError } = require('./adminLoginSecurity')

function success(data) {
  return { success: true, code: 0, msg: 'ok', data }
}

function fail(ctx, message, status = 400, code = status) {
  ctx.status = status
  ctx.body = { success: false, code, msg: message, data: null }
}

function readBearer(ctx) {
  const match = /^Bearer\s+(.+)$/i.exec(String(ctx.headers?.authorization || '').trim())
  return match ? match[1].trim() : ''
}

function handleSecurityError(ctx, error, log, operation) {
  if (error instanceof AdminLoginSecurityError) {
    fail(ctx, error.message, error.status || 400, error.code)
    return
  }
  log.error(`[admin-login] ${operation} failed:`, error?.message || error)
  fail(ctx, '后台登录服务暂不可用，请稍后重试', 503, 'ADMIN_LOGIN_UNAVAILABLE')
}

function createAdminLoginHttpHandlers(options = {}) {
  const securityService = options.securityService
  const findAccount = options.findAccount
  const resolveAccountForSession = options.resolveAccountForSession
  const resolveTenantId = options.resolveTenantId
  const accountCanAccessTenant = options.accountCanAccessTenant
  const resolveClientIp = options.resolveClientIp || (ctx => ctx.ip)
  const buildProfile = options.buildProfile
  const normalizeTenantId = options.normalizeTenantId || (value => String(value || 'default'))
  const log = options.log || console

  async function login(ctx) {
    const payload = ctx.request.body || {}
    const username = String(payload.username || '').trim()
    const password = String(payload.password || '').trim()
    const requestedTenantId = normalizeTenantId(resolveTenantId(ctx))
    const account = await findAccount(username, requestedTenantId, ctx)
    if (!account || account.password !== password) {
      fail(ctx, '账号或密码错误', 401)
      return
    }
    if (account.status !== 'active') {
      fail(ctx, '账号已被禁用，请联系超级管理员', 403)
      return
    }
    const effectiveTenant = account.scopeType === 'platform'
      ? requestedTenantId
      : normalizeTenantId(account.tenantId)
    if (!accountCanAccessTenant(account, effectiveTenant)) {
      fail(ctx, '当前账号无权访问该子系统', 403)
      return
    }
    const phone = String(account.phone || '').replace(/\D/g, '')
    if (!/^1\d{10}$/.test(phone)) {
      fail(ctx, '后台账号未绑定有效手机号，请联系超级管理员', 409, 'ADMIN_LOGIN_PHONE_MISSING')
      return
    }
    try {
      const challenge = await securityService.createChallenge({
        passwordVerified: true,
        account: { ...account, phone },
        tenantId: effectiveTenant,
        ip: resolveClientIp(ctx),
        userAgent: String(ctx.headers?.['user-agent'] || ''),
      })
      ctx.body = success({
        verificationRequired: true,
        challengeId: challenge.challengeId,
        phoneMasked: challenge.phoneMasked,
        expiresAt: challenge.expiresAt,
        resendAt: challenge.resendAt,
      })
    }
    catch (error) {
      handleSecurityError(ctx, error, log, 'challenge')
    }
  }

  async function verify(ctx) {
    const payload = ctx.request.body || {}
    let verified = null
    try {
      verified = await securityService.verifyChallenge({
        challengeId: String(payload.challengeId || '').trim(),
        code: String(payload.code || '').trim(),
      })
      const session = await securityService.resolveSession(verified.token)
      const account = await resolveAccountForSession(session, normalizeTenantId(session.tenantId), ctx)
      if (!account || account.status !== 'active') {
        await securityService.revokeSession(verified.token)
        fail(ctx, '后台登录已失效，请重新登录', 401, 'ADMIN_LOGIN_SESSION_INVALID')
        return
      }
      ctx.body = success({
        ...buildProfile(account, normalizeTenantId(session.tenantId), ctx),
        token: verified.token,
        expiresAt: verified.expiresAt,
      })
    }
    catch (error) {
      if (verified?.token) {
        await securityService.revokeSession(verified.token).catch(() => {})
      }
      handleSecurityError(ctx, error, log, 'verification')
    }
  }

  async function logout(ctx) {
    try {
      const revoked = await securityService.revokeSession(readBearer(ctx))
      ctx.body = success({ revoked })
    }
    catch (error) {
      handleSecurityError(ctx, error, log, 'logout')
    }
  }

  return { login, logout, verify }
}

function createAdminLoginSessionMiddleware(options = {}) {
  const securityService = options.securityService
  const resolveTenantId = options.resolveTenantId
  const resolveAccountForSession = options.resolveAccountForSession
  const routePolicy = options.routePolicy
  const log = options.log || console

  return async function enforceAdminLoginSession(ctx, next) {
    const protectedRequest = routePolicy.isAdminProtectedRequest(ctx.method, ctx.path)
    const bearer = readBearer(ctx)
    const optionalAdminSession = routePolicy.isAdminOptionalSessionRequest(ctx.method, ctx.path)
      && /^admin-session-v1\.[A-Za-z0-9_-]+$/.test(bearer)
    if (routePolicy.isAdminLoginPublicRequest(ctx.method, ctx.path) || (!protectedRequest && !optionalAdminSession)) {
      await next()
      return
    }
    try {
      const session = await securityService.resolveSession(bearer)
      const requestedTenantId = resolveTenantId(ctx)
      const account = await resolveAccountForSession(session, requestedTenantId, ctx)
      if (!account || account.status !== 'active') {
        fail(ctx, '后台登录已失效，请重新登录', 401, 'ADMIN_LOGIN_SESSION_INVALID')
        return
      }
      ctx.state.adminLoginSession = session
      ctx.state.adminAccount = account
      ctx.state.adminRole = account.role
      ctx.state._resolvedAdminRole = true
      ctx.state._resolvedAdminAccount = true
      await next()
    }
    catch (error) {
      if (error instanceof AdminLoginSecurityError) {
        fail(ctx, error.message, error.status || 400, error.code)
        return
      }
      log.error('[admin-login] session gateway failed:', error?.message || error)
      fail(ctx, '后台登录服务暂不可用，请稍后重试', 503, 'ADMIN_LOGIN_UNAVAILABLE')
    }
  }
}

module.exports = {
  createAdminLoginHttpHandlers,
  createAdminLoginSessionMiddleware,
  readBearer,
}
