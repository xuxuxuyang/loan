const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const test = require('node:test')
const Koa = require('koa')
const Router = require('@koa/router')
const bodyParser = require('koa-bodyparser')

const { createAdminLoginSecurityService } = require('../src/adminLoginSecurity')
const { createMemoryAdminLoginSecurityStore } = require('../src/adminLoginSecurityStore')
const {
  createAdminLoginHttpHandlers,
  createAdminLoginSessionMiddleware,
} = require('../src/adminLoginHttp')
const {
  isAdminLoginPublicRequest,
  isAdminOptionalSessionRequest,
  isAdminProtectedRequest,
  isPublicBusinessRequest,
} = require('../src/adminLoginRoutePolicy')
const {
  duodiandianPublicRouter,
  riskControlRouter,
  resolveAdminRole,
  router: productionRouter,
} = require('../src/index')
const {
  INDEPENDENT_PUBLIC_EXPECTATIONS,
  isExpectedPublicBusinessPath,
  routeRequests: expectedRouteRequests,
} = require('./adminLoginRouteExpectations')

const SESSION_TTL_MS = 43_200_000

function requestJson(server, method, requestPath, options = {}) {
  const address = server.address()
  const payload = options.body === undefined ? null : JSON.stringify(options.body)
  const headers = { ...(options.headers || {}) }
  if (payload != null) {
    headers['content-type'] = 'application/json'
    headers['content-length'] = Buffer.byteLength(payload)
  }
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port: address.port,
      method,
      path: requestPath,
      headers,
    }, (response) => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let body = null
        try {
          body = text ? JSON.parse(text) : null
        }
        catch {
          body = text
        }
        resolve({ status: response.statusCode, headers: response.headers, body })
      })
    })
    request.on('error', reject)
    if (payload != null) request.write(payload)
    request.end()
  })
}

async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  try {
    return await run(server)
  }
  finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

function createFixture() {
  let nowMs = Date.parse('2026-08-27T08:00:00.000Z')
  let randomByte = 1
  const sentCodes = []
  const account = {
    id: 'A1',
    username: 'boss1',
    password: 'correct-password',
    phone: '13800138000',
    name: 'Boss One',
    role: 'super_admin',
    status: 'active',
    scopeType: 'tenant',
    tenantId: 'tenant-a',
  }
  const store = createMemoryAdminLoginSecurityStore()
  const service = createAdminLoginSecurityService({
    store,
    secret: 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXphYmNkZWY',
    now: () => nowMs,
    randomInt: () => 123456,
    randomBytes: size => Buffer.alloc(size, randomByte++),
    sendSms: async (_phone, message) => sentCodes.push(String(message).match(/\d{6}/)?.[0] || '123456'),
    smsReady: () => true,
    formatSmsMessage: code => `code:${code}`,
    otpTtlMs: 300_000,
    resendMs: 60_000,
    hourlySendLimit: 10,
    maxAttempts: 5,
    sessionTtlMs: SESSION_TTL_MS,
  })

  const resolveTenantId = ctx => String(ctx.headers['x-tenant-id'] || 'tenant-a')
  const resolveAccountForSession = async (session, requestedTenant) => {
    if (account.status !== 'active') return null
    if (String(session.accountId) !== account.id || String(session.username) !== account.username) return null
    if (String(session.tenantId) !== account.tenantId || requestedTenant !== account.tenantId) return null
    return { ...account }
  }
  const handlers = createAdminLoginHttpHandlers({
    securityService: service,
    findAccount: async username => username === account.username ? { ...account } : null,
    resolveAccountForSession,
    resolveTenantId,
    accountCanAccessTenant: (candidate, tenantId) => candidate.tenantId === tenantId,
    resolveClientIp: ctx => ctx.ip,
    buildProfile: candidate => ({
      username: candidate.username,
      name: candidate.name,
      adminRole: candidate.role,
      roleLabel: '超级管理员',
      scopeType: candidate.scopeType,
      tenantId: candidate.tenantId,
      scopeTenantIds: [candidate.tenantId],
    }),
  })
  const gateway = createAdminLoginSessionMiddleware({
    securityService: service,
    resolveTenantId,
    resolveAccountForSession,
    routePolicy: {
      isAdminLoginPublicRequest,
      isAdminOptionalSessionRequest,
      isAdminProtectedRequest,
    },
  })

  const app = new Koa()
  const router = new Router({ prefix: '/api' })
  app.use(bodyParser())
  app.use(gateway)
  router.post('/admin/login', handlers.login)
  router.post('/admin/login/verify', handlers.verify)
  router.post('/login', handlers.login)
  router.post('/login/verify', handlers.verify)
  router.post('/admin/logout', handlers.logout)
  router.get('/admin/profile', (ctx) => {
    ctx.body = { success: true, data: { username: ctx.state.adminAccount.username } }
  })
  router.get('/products', (ctx) => {
    ctx.body = { success: true, data: { shopperToken: ctx.headers.authorization || '' } }
  })
  app.use(router.routes())
  app.use(router.allowedMethods())

  return {
    account,
    app,
    service,
    sentCodes,
    advance(ms) {
      nowMs += ms
    },
  }
}

async function loginAndVerify(server, fixture, prefix = '/api/admin') {
  const challenge = await requestJson(server, 'POST', `${prefix}/login`, {
    body: { username: fixture.account.username, password: fixture.account.password },
  })
  assert.equal(challenge.status, 200)
  assert.equal(challenge.body.data.verificationRequired, true)
  assert.equal(challenge.body.data.token, undefined)
  const verified = await requestJson(server, 'POST', `${prefix}/login/verify`, {
    body: {
      challengeId: challenge.body.data.challengeId,
      code: fixture.sentCodes.at(-1),
    },
  })
  assert.equal(verified.status, 200)
  assert.match(verified.body.data.token, /^admin-session-v1\.[A-Za-z0-9_-]{43}$/)
  return verified.body.data.token
}

function assertSingleExpectation(requests) {
  for (const request of requests) {
    assert.equal(
      request.matches.length,
      1,
      `${request.method} ${request.routePath} must match exactly one independent expectation; matched ${request.matches.map(item => item.name).join(', ') || 'none'}`,
    )
  }
}

function createInventoryHarness(service) {
  const app = new Koa()
  app.use(createAdminLoginSessionMiddleware({
    securityService: service,
    resolveTenantId: () => 'tenant-a',
    resolveAccountForSession: async () => null,
    routePolicy: {
      isAdminLoginPublicRequest,
      isAdminOptionalSessionRequest,
      isAdminProtectedRequest,
    },
  }))
  app.use((ctx) => {
    ctx.body = { reached: true, path: ctx.path }
  })
  return app
}

test('real Koa login routes issue a challenge first and a usable session only after verification', async () => {
  const fixture = createFixture()
  await withServer(fixture.app, async (server) => {
    const token = await loginAndVerify(server, fixture)
    const profile = await requestJson(server, 'GET', '/api/admin/profile', {
      headers: { authorization: `Bearer ${token}` },
    })
    assert.equal(profile.status, 200)
    assert.equal(profile.body.data.username, 'boss1')
  })
})

test('real Koa gateway rejects missing, legacy, revoked, and expired sessions', async () => {
  const fixture = createFixture()
  await withServer(fixture.app, async (server) => {
    for (const headers of [
      {},
      { authorization: 'Bearer mock-token-13800138000' },
      { 'x-admin-role': 'super_admin' },
      { 'x-admin-phone': '13800138000' },
    ]) {
      const denied = await requestJson(server, 'GET', '/api/admin/profile?adminRole=super_admin', { headers })
      assert.equal(denied.status, 401)
      assert.equal(denied.body.code, 'ADMIN_LOGIN_SESSION_INVALID')
    }

    const revokedToken = await loginAndVerify(server, fixture)
    await fixture.service.revokeSession(revokedToken)
    const revoked = await requestJson(server, 'GET', '/api/admin/profile', {
      headers: { authorization: `Bearer ${revokedToken}` },
    })
    assert.equal(revoked.status, 401)
    assert.equal(revoked.body.code, 'ADMIN_LOGIN_SESSION_INVALID')

    fixture.advance(60_000)
    const expiredToken = await loginAndVerify(server, fixture)
    fixture.advance(SESSION_TTL_MS + 1)
    const expired = await requestJson(server, 'GET', '/api/admin/profile', {
      headers: { authorization: `Bearer ${expiredToken}` },
    })
    assert.equal(expired.status, 401)
    assert.equal(expired.body.code, 'ADMIN_LOGIN_SESSION_EXPIRED')
  })
})

test('real Koa gateway rechecks account status, tenant scope, and logout revocation', async () => {
  const fixture = createFixture()
  await withServer(fixture.app, async (server) => {
    const crossTenantToken = await loginAndVerify(server, fixture)
    const crossTenant = await requestJson(server, 'GET', '/api/admin/profile', {
      headers: {
        authorization: `Bearer ${crossTenantToken}`,
        'x-tenant-id': 'tenant-b',
      },
    })
    assert.equal(crossTenant.status, 401)
    assert.equal(crossTenant.body.code, 'ADMIN_LOGIN_SESSION_INVALID')

    fixture.account.status = 'disabled'
    const disabled = await requestJson(server, 'GET', '/api/admin/profile', {
      headers: { authorization: `Bearer ${crossTenantToken}` },
    })
    assert.equal(disabled.status, 401)
    fixture.account.status = 'active'

    fixture.advance(60_000)
    const logoutToken = await loginAndVerify(server, fixture)
    const logout = await requestJson(server, 'POST', '/api/admin/logout', {
      headers: { authorization: `Bearer ${logoutToken}` },
    })
    assert.equal(logout.status, 200)
    assert.equal(logout.body.data.revoked, true)
    const afterLogout = await requestJson(server, 'GET', '/api/admin/profile', {
      headers: { authorization: `Bearer ${logoutToken}` },
    })
    assert.equal(afterLogout.status, 401)
  })
})

test('shopper mock tokens still reach every explicitly public storefront route', async () => {
  const fixture = createFixture()
  const inventory = expectedRouteRequests(productionRouter)
  assertSingleExpectation(inventory)
  const requests = inventory
    .filter(request => request.matches[0].category === 'business-public')
  assert.ok(requests.length > 30, 'the real storefront route inventory must be substantial')

  await withServer(createInventoryHarness(fixture.service), async (server) => {
    for (const request of requests) {
      const response = await requestJson(server, request.method, request.path, {
        headers: { authorization: 'Bearer mock-token-13800138000' },
      })
      assert.equal(response.status, 200, `${request.method} ${request.path}`)
      assert.equal(response.body.reached, true, `${request.method} ${request.path}`)
    }
  })
})

test('production Router layers match exactly one policy-independent expectation', () => {
  const source = fs.readFileSync(__filename, 'utf8')
  assert.doesNotMatch(
    source,
    /\.filter\(request => is(?:PublicBusiness|AdminProtected)Request\(/,
    'real Router expectations must not be selected by the production policy under test',
  )

  const requests = expectedRouteRequests(productionRouter)
  assertSingleExpectation(requests)
  assert.ok(requests.length > 100, 'the real production Router inventory must be substantial')
  for (const request of requests) {
    const category = request.matches[0].category
    assert.equal(
      isAdminLoginPublicRequest(request.method, request.path),
      category === 'admin-login-public',
      `${request.method} ${request.routePath} admin-login classification`,
    )
    assert.equal(
      isPublicBusinessRequest(request.method, request.path),
      category === 'business-public',
      `${request.method} ${request.routePath} business classification`,
    )
    assert.equal(
      isAdminProtectedRequest(request.method, request.path),
      category === 'admin-protected',
      `${request.method} ${request.routePath} protected classification`,
    )
  }

  const adminNamespace = requests.filter(request => request.routePath.startsWith('/api/admin/'))
  assert.ok(adminNamespace.length > 20)
  assert.ok(adminNamespace.every(request => request.matches[0].category === 'admin-protected'
    || request.matches[0].category === 'admin-login-public'))
})

test('independent public expectations do not auto-approve future sensitive routes inside public policy prefixes', () => {
  const syntheticRouter = {
    stack: [
      { methods: ['GET'], path: '/api/ios/admin/export' },
      { methods: ['POST'], path: '/api/payment/lakala/admin/refund-all' },
    ],
  }
  const requests = expectedRouteRequests(syntheticRouter)
  for (const request of requests) {
    assert.equal(request.matches.length, 0)
    assert.equal(isPublicBusinessRequest(request.method, request.path), false, `${request.method} ${request.path}`)
    assert.equal(isPublicBusinessRequest('OPTIONS', request.path), false, `OPTIONS ${request.path}`)
    assert.equal(isAdminProtectedRequest(request.method, request.path), true, `${request.method} ${request.path}`)
    assert.equal(isAdminProtectedRequest('OPTIONS', request.path), true, `OPTIONS ${request.path}`)
  }
})

test('policy-independent public route inventory allows preflight while admin and unknown preflight fail closed', async () => {
  const fixture = createFixture()
  const publicRequests = expectedRouteRequests(productionRouter)
    .filter(request => request.matches.length === 1 && request.matches[0].category === 'business-public')
  assert.ok(publicRequests.length > 30)

  await withServer(createInventoryHarness(fixture.service), async (server) => {
    for (const request of publicRequests) {
      assert.equal(isExpectedPublicBusinessPath(request.routePath), true)
      const response = await requestJson(server, 'OPTIONS', request.path)
      assert.equal(response.status, 200, `OPTIONS ${request.path}`)
      assert.equal(response.body.reached, true, `OPTIONS ${request.path}`)
    }
    for (const requestPath of ['/api/admin/profile', '/api/admin/login', '/api/future-admin-report']) {
      const response = await requestJson(server, 'OPTIONS', requestPath)
      assert.equal(response.status, 401, `OPTIONS ${requestPath}`)
      assert.equal(response.body.code, 'ADMIN_LOGIN_SESSION_INVALID', `OPTIONS ${requestPath}`)
    }
  })
})

test('every non-public route from the real Koa API stack rejects all legacy admin credentials', async () => {
  const fixture = createFixture()
  const inventory = expectedRouteRequests(productionRouter)
  assertSingleExpectation(inventory)
  const requests = inventory
    .filter(request => request.matches[0].category === 'admin-protected')
  assert.ok(requests.length > 50, 'the real protected route inventory must be substantial')
  const legacyCredentials = [
    { authorization: 'Bearer mock-token-13800138000' },
    { 'x-admin-role': 'super_admin' },
    { 'x-admin-phone': '13800138000' },
    {},
  ]

  await withServer(createInventoryHarness(fixture.service), async (server) => {
    for (const request of requests) {
      for (const headers of legacyCredentials) {
        const separator = request.path.includes('?') ? '&' : '?'
        const response = await requestJson(server, request.method, `${request.path}${separator}adminRole=super_admin`, { headers })
        assert.equal(response.status, 401, `${request.method} ${request.path}`)
        assert.equal(response.body.code, 'ADMIN_LOGIN_SESSION_INVALID', `${request.method} ${request.path}`)
      }
    }
  })
})

test('independent partner and risk Koa router stacks remain outside admin session enforcement', async () => {
  const fixture = createFixture()
  const publicRequests = [
    ...expectedRouteRequests(duodiandianPublicRouter, INDEPENDENT_PUBLIC_EXPECTATIONS),
    ...expectedRouteRequests(riskControlRouter, INDEPENDENT_PUBLIC_EXPECTATIONS),
  ]
  assert.ok(publicRequests.length > 20)
  assertSingleExpectation(publicRequests)
  await withServer(createInventoryHarness(fixture.service), async (server) => {
    for (const request of publicRequests) {
      const response = await requestJson(server, request.method, request.path, {
        headers: { authorization: 'Bearer mock-token-13800138000' },
      })
      assert.equal(response.status, 200, `${request.method} ${request.path}`)
    }
  })
})

test('unknown API routes fail closed while explicit admin login routes remain public', () => {
  assert.equal(isAdminProtectedRequest('GET', '/api/future-admin-report'), true)
  assert.equal(isAdminProtectedRequest('POST', '/api/future-admin-action'), true)
  assert.equal(isAdminLoginPublicRequest('POST', '/api/admin/login'), true)
  assert.equal(isAdminLoginPublicRequest('POST', '/api/admin/login/verify'), true)
  assert.equal(isAdminLoginPublicRequest('POST', '/api/login'), true)
  assert.equal(isAdminLoginPublicRequest('POST', '/api/login/verify'), true)
  assert.equal(isPublicBusinessRequest('GET', '/api/static/contracts/example.pdf'), true)
})

test('admin role resolution never accepts legacy identity hints, even on an explicitly public route', async () => {
  assert.equal(typeof resolveAdminRole, 'function')
  const ctx = {
    method: 'GET',
    path: '/api/products',
    headers: {
      authorization: 'Bearer mock-token-13800138000',
      'x-admin-phone': '13800138000',
      'x-admin-role': 'super_admin',
    },
    query: { adminRole: 'super_admin' },
    state: { tenantId: 'tenant-a', workspaceType: 'tenant' },
  }
  assert.equal(await resolveAdminRole(ctx), '')
  assert.equal(ctx.state.adminAccount, null)
})
