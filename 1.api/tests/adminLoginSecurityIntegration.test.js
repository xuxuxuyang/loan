const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const {
  AdminLoginSecurityError,
  createAdminLoginSecurityService,
} = require('../src/adminLoginSecurity')
const {
  createMemoryAdminLoginSecurityStore,
} = require('../src/adminLoginSecurityStore')

let routePolicy = {}
try {
  routePolicy = require('../src/adminLoginRoutePolicy')
}
catch (error) {
  if (error?.code !== 'MODULE_NOT_FOUND' || !String(error.message).includes('adminLoginRoutePolicy')) {
    throw error
  }
}

const apiSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8')

function sourceBetween(startMarker, endMarker) {
  const start = apiSource.indexOf(startMarker)
  const end = apiSource.indexOf(endMarker, start + startMarker.length)
  assert.ok(start >= 0, `missing source marker: ${startMarker}`)
  assert.ok(end > start, `missing source boundary: ${endMarker}`)
  return apiSource.slice(start, end)
}

function loadAdminSessionGateway(service) {
  const sourceWithMount = sourceBetween('async function enforceAdminLoginSession(ctx, next)', 'function isManagedApiPath(pathValue)')
  const functionEnd = sourceWithMount.indexOf('\n}\n\napp.use(enforceAdminLoginSession)')
  assert.ok(functionEnd > 0, 'gateway function must have a bounded body')
  const functionSource = sourceWithMount.slice(0, functionEnd + 2)
  const fail = (ctx, msg, status = 400, responseCode = status) => {
    ctx.status = status
    ctx.body = { success: false, code: responseCode, msg, data: null }
  }
  return Function(
    'isAdminProtectedRequest',
    'isAdminLoginPublicRequest',
    'isAdminOptionalSessionRequest',
    'readBearer',
    'adminLoginSecurityService',
    'resolveTenantIdFromRequest',
    'resolveAccountForAdminSession',
    'fail',
    'handleAdminLoginSecurityError',
    'console',
    `return (${functionSource})`,
  )(
    routePolicy.isAdminProtectedRequest,
    routePolicy.isAdminLoginPublicRequest,
    routePolicy.isAdminOptionalSessionRequest,
    ctx => String(ctx.headers.authorization || '').replace(/^Bearer\s+/i, ''),
    service,
    ctx => String(ctx.headers['x-tenant-id'] || ctx.query.tenantId || 'default'),
    async () => null,
    fail,
    (ctx, error) => {
      if (!(error instanceof AdminLoginSecurityError)) return false
      fail(ctx, error.message, error.status, error.code)
      return true
    },
    { error() {} },
  )
}

function loadCsAgentNameResolver() {
  const source = sourceBetween('function resolveCsAgentName(ctx, db)', 'function csUserOnline(session)')
  return Function(
    'ensureAdminAccounts',
    'normalizePhone',
    'parsePhoneFromToken',
    `return (${source.trim()})`,
  )(
    () => {},
    value => String(value || '').trim(),
    authorization => String(authorization || '').replace(/^Bearer\s+mock-token-/i, ''),
  )
}

test('route catalog protects the existing admin API surface', () => {
  assert.equal(typeof routePolicy.isAdminProtectedRequest, 'function')
  if (typeof routePolicy.isAdminProtectedRequest !== 'function') return

  const protectedCases = [
    ['GET', '/api/admin/profile'],
    ['GET', '/api/platform/tenants'],
    ['GET', '/api/users'],
    ['GET', '/api/orders'],
    ['PATCH', '/api/orders/o1'],
    ['DELETE', '/api/orders/o1'],
    ['POST', '/api/products'],
    ['POST', '/api/uploads/public-image'],
  ]
  for (const [method, requestPath] of protectedCases) {
    assert.equal(routePolicy.isAdminProtectedRequest(method, requestPath), true, `${method} ${requestPath}`)
  }
})

test('route catalog preserves storefront, callback, partner, and risk APIs', () => {
  assert.equal(typeof routePolicy.isAdminProtectedRequest, 'function')
  assert.equal(typeof routePolicy.isAdminLoginPublicRequest, 'function')
  if (typeof routePolicy.isAdminProtectedRequest !== 'function'
    || typeof routePolicy.isAdminLoginPublicRequest !== 'function') return

  const publicCases = [
    ['POST', '/api/admin/login'],
    ['POST', '/api/admin/login/verify'],
    ['POST', '/api/login'],
    ['POST', '/api/login/verify'],
    ['GET', '/api/users/by-phone'],
    ['POST', '/api/orders'],
    ['GET', '/api/products'],
    ['GET', '/api/products/1'],
    ['POST', '/api/payment/lakala/notify'],
    ['POST', '/api/bill-risk/callback'],
    ['POST', '/api/traffic-partner/login'],
    ['POST', '/risk-api/risk.v4/courtDetailPro'],
  ]
  for (const [method, requestPath] of publicCases) {
    assert.equal(routePolicy.isAdminProtectedRequest(method, requestPath), false, `${method} ${requestPath}`)
  }
  for (const [method, requestPath] of publicCases.slice(0, 4)) {
    assert.equal(routePolicy.isAdminLoginPublicRequest(method, requestPath), true, `${method} ${requestPath}`)
  }
  assert.equal(routePolicy.isAdminLoginPublicRequest('GET', '/api/admin/profile'), false)
})

test('optional admin sessions are scoped only to public product GET requests', () => {
  assert.equal(typeof routePolicy.isAdminOptionalSessionRequest, 'function')
  if (typeof routePolicy.isAdminOptionalSessionRequest !== 'function') return

  assert.equal(routePolicy.isAdminOptionalSessionRequest('GET', '/api/products'), true)
  assert.equal(routePolicy.isAdminOptionalSessionRequest('GET', '/api/products/1'), true)
  const ignoredCases = [
    ['POST', '/api/orders'],
    ['POST', '/api/payment/lakala/notify'],
    ['POST', '/api/traffic-partner/login'],
    ['POST', '/api/bill-risk/callback'],
    ['POST', '/risk-api/risk.v4/courtDetailPro'],
  ]
  for (const [method, requestPath] of ignoredCases) {
    assert.equal(routePolicy.isAdminOptionalSessionRequest(method, requestPath), false, `${method} ${requestPath}`)
  }
})

test('opaque session resolver rejects every legacy admin credential shape', async () => {
  const service = createAdminLoginSecurityService({
    store: createMemoryAdminLoginSecurityStore(),
    secret: 'integration-admin-login-secret-with-enough-entropy',
    sendSms: async () => {},
    smsReady: () => true,
    otpTtlMs: 300_000,
    resendMs: 60_000,
    hourlySendLimit: 10,
    maxAttempts: 5,
    sessionTtlMs: 43_200_000,
  })
  const legacyCredentials = [
    { authorization: 'Bearer mock-token-13800138000' },
    { authorization: 'Bearer mock-token-13800138000', 'x-admin-role': 'super_admin' },
    { authorization: 'Bearer mock-token-13800138000', 'x-admin-phone': '13800138000' },
    { authorization: 'Bearer mock-token-13800138000', query: { adminRole: 'super_admin' } },
  ]

  for (const credential of legacyCredentials) {
    const authorization = credential.authorization || ''
    const token = authorization.replace(/^Bearer\s+/i, '')
    await assert.rejects(
      () => service.resolveSession(token),
      { code: 'ADMIN_LOGIN_SESSION_INVALID' },
    )
  }
})

test('the installed gateway rejects legacy token, role, phone, and query hints on a protected request', async () => {
  const service = createAdminLoginSecurityService({
    store: createMemoryAdminLoginSecurityStore(),
    secret: 'integration-admin-login-secret-with-enough-entropy',
    sendSms: async () => {},
    smsReady: () => true,
    otpTtlMs: 300_000,
    resendMs: 60_000,
    hourlySendLimit: 10,
    maxAttempts: 5,
    sessionTtlMs: 43_200_000,
  })
  const gateway = loadAdminSessionGateway(service)
  const legacyCredentials = [
    { authorization: 'Bearer mock-token-13800138000' },
    { authorization: 'Bearer mock-token-13800138000', 'x-admin-role': 'super_admin' },
    { authorization: 'Bearer mock-token-13800138000', 'x-admin-phone': '13800138000' },
    { authorization: 'Bearer mock-token-13800138000', query: { adminRole: 'super_admin' } },
  ]

  for (const credential of legacyCredentials) {
    let reachedRoute = false
    const ctx = {
      method: 'GET',
      path: '/api/admin/profile',
      headers: { ...(credential.query ? {} : credential), authorization: credential.authorization },
      query: credential.query || {},
      state: {},
    }
    await gateway(ctx, async () => { reachedRoute = true })
    assert.equal(ctx.status, 401)
    assert.equal(ctx.body.code, 'ADMIN_LOGIN_SESSION_INVALID')
    assert.equal(ctx.state.adminAccount, undefined)
    assert.equal(reachedRoute, false)
  }
})

test('malformed admin-like tokens are ignored outside public product GET routes', async () => {
  const service = createAdminLoginSecurityService({
    store: createMemoryAdminLoginSecurityStore(),
    secret: 'integration-admin-login-secret-with-enough-entropy',
    sendSms: async () => {},
    smsReady: () => true,
    otpTtlMs: 300_000,
    resendMs: 60_000,
    hourlySendLimit: 10,
    maxAttempts: 5,
    sessionTtlMs: 43_200_000,
  })
  const gateway = loadAdminSessionGateway(service)
  const publicCases = [
    ['POST', '/api/orders'],
    ['POST', '/api/payment/lakala/notify'],
    ['POST', '/api/traffic-partner/login'],
    ['POST', '/api/bill-risk/callback'],
    ['POST', '/risk-api/risk.v4/courtDetailPro'],
  ]

  for (const [method, requestPath] of publicCases) {
    let reachedRoute = false
    const ctx = {
      method,
      path: requestPath,
      headers: { authorization: 'Bearer admin-session-v1.malformed' },
      query: {},
      state: {},
    }
    await gateway(ctx, async () => { reachedRoute = true })
    assert.equal(reachedRoute, true, `${method} ${requestPath}`)
    assert.equal(ctx.status, undefined, `${method} ${requestPath}`)
  }

  let reachedProduct = false
  const productCtx = {
    method: 'GET',
    path: '/api/products',
    headers: { authorization: 'Bearer admin-session-v1.malformed' },
    query: {},
    state: {},
  }
  await gateway(productCtx, async () => { reachedProduct = true })
  assert.equal(reachedProduct, false)
  assert.equal(productCtx.status, 401)
})

test('CS agent display name only uses the gateway-established account', () => {
  const resolveCsAgentName = loadCsAgentNameResolver()
  const db = {
    adminAccounts: [
      { phone: '13900139000', status: 'active', name: 'Forged Agent' },
    ],
  }
  const trustedState = {
    adminLoginSession: { accountId: 'A1' },
    adminAccount: { id: 'A1', status: 'active', name: 'Trusted Agent', username: 'trusted' },
  }
  const forgedRequests = [
    { 'x-admin-phone': '13900139000' },
    { authorization: 'Bearer mock-token-13900139000' },
  ]
  for (const headers of forgedRequests) {
    assert.equal(resolveCsAgentName({ headers, state: trustedState }, db), 'Trusted Agent')
  }

  const resolverSource = sourceBetween('function resolveCsAgentName(ctx, db)', 'function csUserOnline(session)')
  assert.match(resolverSource, /ctx\.state\??\.adminAccount/)
  assert.doesNotMatch(resolverSource, /x-admin-phone|parsePhoneFromToken|authorization|adminAccounts/)
})

test('Koa wiring creates challenges first and returns a token only after verification', () => {
  assert.match(apiSource, /createAdminLoginSecurityService/)
  assert.match(apiSource, /createMongoAdminLoginSecurityStore/)
  assert.match(apiSource, /ADMIN_LOGIN_SMS_MSG_TEMPLATE/)
  assert.doesNotMatch(apiSource, /process\.env\.ADMIN_LOGIN_[A-Z_]+\s*\|\|/)

  const challengeHandler = sourceBetween('async function handleAdminLogin(ctx)', 'async function handleAdminLoginVerify(ctx)')
  assert.match(challengeHandler, /account\.password !== password/)
  assert.match(challengeHandler, /account\.status !== 'active'/)
  assert.match(challengeHandler, /\^1\\d\{10\}\$/)
  assert.match(challengeHandler, /accountCanAccessTenant/)
  assert.match(challengeHandler, /createChallenge\(\{[\s\S]*passwordVerified: true/)
  assert.match(challengeHandler, /verificationRequired: true/)
  assert.match(challengeHandler, /challengeId: challenge\.challengeId/)
  assert.doesNotMatch(challengeHandler, /mock-token-/)
  assert.doesNotMatch(challengeHandler, /token:/)

  const verifyHandler = sourceBetween('async function handleAdminLoginVerify(ctx)', "router.post('/admin/login'")
  assert.match(verifyHandler, /verifyChallenge/)
  assert.match(verifyHandler, /resolveSession\(verified\.token\)/)
  assert.match(verifyHandler, /resolveAccountForAdminSession/)
  assert.match(verifyHandler, /token: verified\.token/)
  assert.match(verifyHandler, /expiresAt: verified\.expiresAt/)
  assert.match(apiSource, /router\.post\('\/admin\/login\/verify'/)
  assert.match(apiSource, /router\.post\('\/login\/verify'/)
})

test('admin session gateway is installed before tenant selection and trusts no legacy hints', () => {
  const gatewayStart = apiSource.indexOf('async function enforceAdminLoginSession(ctx, next)')
  const tenantMiddleware = apiSource.indexOf('const tenantId = resolveTenantIdFromRequest(ctx)', gatewayStart)
  assert.ok(gatewayStart >= 0, 'admin session gateway must exist')
  assert.ok(tenantMiddleware > gatewayStart, 'admin session gateway must run before tenant resolution')

  const gateway = sourceBetween('async function enforceAdminLoginSession(ctx, next)', 'function isManagedApiPath(pathValue)')
  assert.match(gateway, /isAdminProtectedRequest\(ctx\.method, ctx\.path\)/)
  assert.match(gateway, /isAdminLoginPublicRequest\(ctx\.method, ctx\.path\)/)
  assert.match(gateway, /const bearer = readBearer\(ctx\)/)
  assert.match(gateway, /adminLoginSecurityService\.resolveSession\(bearer\)/)
  assert.match(gateway, /resolveAccountForAdminSession\(session, requestedTenantId\)/)
  assert.match(gateway, /ctx\.state\.adminLoginSession = session/)
  assert.match(gateway, /ctx\.state\._resolvedAdminRole = true/)
  assert.match(gateway, /ctx\.state\._resolvedAdminAccount = true/)
  assert.doesNotMatch(gateway, /mock-token|x-admin-role|x-admin-phone|x-user-role|x-user-phone|ctx\.query[^\n]*adminRole/)

  const workspaceClamp = sourceBetween('async function clampIncomingWorkspaceType', 'function effectiveScopeTenantIds')
  assert.match(workspaceClamp, /ctx\.state\??\.adminLoginSession/)
  assert.match(workspaceClamp, /ctx\.state\??\.adminAccount/)
  assert.doesNotMatch(workspaceClamp, /parsePhoneFromToken|x-admin|x-user|adminRole/)
})

test('public product reads use optional opaque admin sessions without legacy identity fallback', () => {
  const gateway = sourceBetween('async function enforceAdminLoginSession(ctx, next)', 'function isManagedApiPath(pathValue)')
  assert.match(gateway, /startsWith\('admin-session-v1\.'\)/)

  const productList = sourceBetween("router.get('/products'", "router.post('/products'")
  const productDetail = sourceBetween("router.get('/products/:id'", "router.post('/auth/register/sms/send'")
  assert.match(productList, /const showAll = includeAll === '1'\s*&& Boolean\(ctx\.state\.adminLoginSession\)/)
  for (const routeSource of [productList, productDetail]) {
    assert.match(routeSource, /ctx\.state\.adminLoginSession/)
    assert.doesNotMatch(routeSource, /ctx\.headers\.authorization|x-admin-role|parsePhoneFromToken/)
  }
})

test('session account validation checks requested tenant and bypasses the account cache', () => {
  const resolver = sourceBetween('async function resolveAccountForAdminSession', 'function lookupActiveAdminAccountInCurrentScope')
  assert.match(resolver, /bypassCache: true/)
  assert.match(resolver, /accountCanAccessTenant\(account, requestedTenantId\)/)

  const gateway = sourceBetween('async function enforceAdminLoginSession(ctx, next)', 'function isManagedApiPath(pathValue)')
  assert.match(gateway, /const requestedTenantId = resolveTenantIdFromRequest\(ctx\)/)
  assert.match(gateway, /resolveAccountForAdminSession\(session, requestedTenantId\)/)
})

test('logout revokes the current token and startup initializes security indexes', () => {
  assert.match(apiSource, /router\.post\('\/admin\/logout'[\s\S]*revokeSession\(readBearer\(ctx\)\)/)
  const connect = apiSource.indexOf('await mongo.connectMongo()')
  const indexes = apiSource.indexOf('await adminLoginSecurityService.ensureIndexes()', connect)
  const listen = apiSource.indexOf('app.listen(PORT', connect)
  assert.ok(connect >= 0)
  assert.ok(indexes > connect, 'indexes must initialize after Mongo connects')
  assert.ok(listen > indexes, 'indexes must initialize before listening')
})
