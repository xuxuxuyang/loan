const assert = require('node:assert/strict')
const test = require('node:test')

const { shouldBlockRequestOnMongoRefreshError } = require('../src/mongoRefreshGuard')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8')
const { resolveCoreApiMongoRefreshPlan } = require('../src/apiMongoRefreshPlan')
const mongo = require('../src/mongo')
const Koa = require('koa')
const Router = require('@koa/router')

for (const [route, requestPath, query, param] of [
  ['/payment/lakala/status/:outTradeNo', '/api/payment/lakala/status/LP1/', {}, ['outTradeNo', 'LP1']],
  ['/payment/lakala/status/:outTradeNo', '/api/Payment/Lakala/status/LP1', {}, ['outTradeNo', 'LP1']],
  ['/card-packages/:orderId/contract-view', '/api/card-packages/O1/contract-view/', {}, ['orderId', 'O1']],
  ['/card-packages/:orderId/contract-flow', '/API/CARD-PACKAGES/O1/CONTRACT-FLOW/', {}, ['orderId', 'O1']],
  ['/mall/cs/session', '/api/mall/cs/session/', {}, null],
  ['/admin/cs/sessions/:sessionId', '/API/ADMIN/CS/SESSIONS/S1/', {}, ['sessionId', 'S1']],
  ['/orders', '/api/orders/', { listScope: 'card-data', page: '1' }, null],
  ['/platform/accounts', '/API/PLATFORM/ACCOUNTS/', {}, null],
]) {
  test(`real Router keeps ${requestPath} behind strict refresh and preserves parameters`, async () => {
    let calls = 0
    const router = new Router({ prefix: '/api' })
    router.get(route, ctx => {
      calls++
      assert.equal(ctx.path, requestPath)
      assert.deepEqual(ctx.query, query)
      if (param) assert.equal(ctx.params[param[0]], param[1])
      ctx.body = { ok: true }
    })
    const zheyinTrafficGateway = null
    const halfFlowTrafficGateway = null
    const isManagedApiPath = loadFunction('isManagedApiPath', {
      zheyinTrafficGateway, halfFlowTrafficGateway, isDuodiandianPublicPath: () => false,
    })
    const resolveApiMongoRefreshPlan = loadFunction('resolveApiMongoRefreshPlan', {
      zheyinTrafficGateway, halfFlowTrafficGateway, resolveDuodiandianMongoRefreshPlan: () => null,
      isAdminReadOptimizeEnabled: () => true, adminMongoReadOptimize: require('../src/adminMongoReadOptimize'),
      resolveCoreApiMongoRefreshPlan,
    })
    for (const refreshFails of [false, true]) {
      const app = new Koa()
      const headers = {}
      const response = { statusCode: 404, getHeader: key => headers[key], setHeader: (key, value) => { headers[key] = value }, removeHeader: key => { delete headers[key] } }
      const ctx = app.createContext({ method: 'GET', url: requestPath + '?' + new URLSearchParams(query), headers: {} }, response)
      const refresh = async () => { if (refreshFails) throw new Error('fake refresh failure') }
      const middleware = loadFunction('refreshMongoForRequest', {
        isManagedApiPath, resolveApiMongoRefreshPlan, isMongoPersistenceEnabled: () => true,
        normalizeTenantId: v => v, normalizeWorkspaceType: v => v, DEFAULT_TENANT_ID: 'default',
        refreshScopePartialFromMongo: refresh, refreshScopeCacheFromMongo: refresh,
        getScopeCacheReadiness: () => ({ usable: true }), shouldBlockRequestOnMongoRefreshError,
        fail: (context, message, status) => { context.status = status; context.body = { message } },
        console: { error() {}, warn() {} },
      })
      await middleware(ctx, () => router.routes()(ctx, async () => {}))
      assert.equal(ctx.status, refreshFails ? 503 : 200)
      assert.equal(calls, 1, 'failed refresh must not reach the matched handler')
      assert.equal(headers['X-Data-Stale'], undefined)
    }
  })
}

function loadFunction(name, dependencies) {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))
  assert.ok(match, `${name} must be present`)
  return vm.runInNewContext(`(${match[0]})`, dependencies)
}

function loadHandler(route, dependencies) {
  const start = source.indexOf(`router.get('${route}', `)
  assert.ok(start >= 0)
  const body = source.slice(start + `router.get('${route}', `.length)
  return vm.runInNewContext(`(${body.slice(0, body.indexOf('\n})') + 2)})`, dependencies)
}

for (const [route, keys] of [
  ['/products', ['products']], ['/admin/accounts', ['adminAccounts']], ['/platform/accounts', ['adminAccounts']],
  ['/admin/orders/sidebar-counts', ['orders']],
  ['/orders', ['orders', 'users', 'trafficChannels']], ['/users', ['orders', 'users', 'trafficChannels']],
]) {
  const scenarios = ['never-loaded', 'dirty', 'covered', 'genuine-empty', 'json']
  if (route === '/orders' || route === '/users') scenarios.push('unsupported')
  for (const scenario of scenarios) {
    test(`actual ${route} handler direct fallback ${scenario}`, async () => {
      const mongoEnabled = scenario !== 'json'
      const unavailable = scenario !== 'genuine-empty'
      const headers = {}
      const durableRows = scenario === 'covered' ? [{ id: 'durable-record' }] : []
      const snapshot = { products: durableRows, adminAccounts: durableRows, users: durableRows, orders: durableRows, trafficChannels: [] }
      const query = { page: '1', ...(scenario === 'unsupported' ? { keyword: 'complex-filter' } : {}) }
      const app = new Koa()
      const response = { statusCode: 404, getHeader: key => headers[key], setHeader: (key, value) => { headers[key] = value }, removeHeader: key => { delete headers[key] } }
      const ctx = app.createContext({ method: 'GET', url: route + '?' + new URLSearchParams(query), headers: {} }, response)
      ctx.state = { workspaceType: 'tenant', tenantId: 'fake' }
      let readinessCalls = 0
      const dependencies = {
        isMongoPersistenceEnabled: () => mongoEnabled,
        getScopeCacheReadiness: (workspace, tenant, needed) => {
          assert.equal(workspace, route === '/platform/accounts' ? 'core' : 'tenant')
          assert.equal(tenant, route === '/platform/accounts' ? 'default' : 'fake')
          assert.deepEqual(Array.from(needed), keys)
          readinessCalls++
          return { usable: scenario === 'covered' || scenario === 'unsupported', dirtyKeys: scenario === 'dirty' ? [keys[0]] : [] }
        },
        isAdminReadOptimizeEnabled: () => true, normalizeTenantId: value => value, normalizeWorkspaceType: value => value,
        DEFAULT_TENANT_ID: 'default', ADMIN_ROLES: {},
        requireAdminPermission: async () => true, requireAdminPermissionOnAny: async () => true,
        requireAdminUsersListView: async () => true, resolveAdminAccount: async () => ({}),
        requirePlatformScope: async () => ({}), migrateLegacyMainAccountsToCore: async () => {},
        readCoreDb: async () => snapshot, buildPlatformAccountsListView: rows => rows, platformAuditRecord: async () => {},
        readDb: () => { assert.notEqual(scenario, 'genuine-empty', 'direct empty results must not need a snapshot'); return snapshot },
        withAdminReadCacheAsync: (context, key, compute) => compute(), success: data => ({ data }),
        readProductsFromMongoScoped: async () => unavailable ? null : [], filterProductListForQuery: rows => rows,
        readAdminAccountsFromMongoScoped: async () => unavailable ? null : [],
        normalizeAdminAccountsListInTenantContext: (tenant, rows) => rows, ensureAdminAccounts() {}, buildAdminAccountsListView: rows => rows,
        computeAdminOrderSidebarCountsFromDb: db => ({ pendingReview: db.orders.length, reviewedOrdersList: 0 }),
        adminOrderPermissionKeyForListScope: () => 'orders', normalizeRegisteredWhitelistStatus: () => '',
        getMongoScopedCollection: () => unavailable ? null : {
          countDocuments: async () => 0,
          find() { return this }, sort() { return this }, skip() { return this }, limit() { return this }, toArray: async () => [],
        },
        buildAdminOrderMongoEnrichDb: async () => snapshot,
        listAdminOrdersPaginatedBeforeEnrich: db => ({ list: db.orders, total: db.orders.length, page: 1, pageSize: 20 }),
        listAdminUsersPaginatedBeforeEnrich: db => ({ list: db.users, total: db.users.length, page: 1, pageSize: 20 }),
        adminMongoReadOptimize: require('../src/adminMongoReadOptimize'),
      }
      if (source.includes('function requireMongoFallbackSnapshot(')) {
        dependencies.requireMongoFallbackSnapshot = loadFunction('requireMongoFallbackSnapshot', dependencies)
      }
      const handler = loadHandler(route, dependencies)
      const boundary = loadFunction('mongoReadErrorBoundary', {
        fail: (context, message, status) => { context.status = status; context.body = { message } },
      })
      await boundary(ctx, () => handler(ctx))
      const blocked = scenario === 'never-loaded' || scenario === 'dirty'
      assert.equal(ctx.status, blocked ? 503 : 200)
      assert.equal(headers['X-Data-Stale'], scenario === 'covered' ? '1' : undefined)
      assert.equal(readinessCalls > 0, mongoEnabled && unavailable)
      if (!blocked) assert.ok(ctx.body.data)
      if (scenario === 'covered') {
        if (route === '/admin/orders/sidebar-counts') assert.equal(ctx.body.data.pendingReview, 1)
        else assert.equal((ctx.body.data.list || ctx.body.data)[0].id, 'durable-record')
      }
    })
  }
}

test('order enrichment cannot use uncovered fallback entities and marks covered fallback stale', async () => {
  for (const usable of [false, true]) {
    const headers = {}
    const ctx = { state: {}, set: (key, value) => { headers[key] = value } }
    const snapshot = { users: [], orders: [], trafficChannels: [] }
    const dependencies = {
      mongo, MongoDirectReadError: require('../src/adminMongoReadOptimize').MongoDirectReadError,
      readMongoEntityDocsByIds: async () => null, getMongoScopedCollection: () => null,
      isMongoPersistenceEnabled: () => true,
      getScopeCacheReadiness: (workspace, tenant, keys) => {
        assert.deepEqual(Array.from(keys), ['orders', 'users', 'trafficChannels'])
        return { usable }
      },
    }
    if (source.includes('function requireMongoFallbackSnapshot(')) {
      dependencies.requireMongoFallbackSnapshot = loadFunction('requireMongoFallbackSnapshot', dependencies)
    }
    const enrich = loadFunction('buildAdminOrderMongoEnrichDb', dependencies)
    if (usable) {
      assert.equal(await enrich('tenant', 'fake', snapshot, [{ mallUserId: 'U1' }], ctx), snapshot)
      assert.equal(headers['X-Data-Stale'], '1')
    }
    else {
      await assert.rejects(() => enrich('tenant', 'fake', snapshot, [{ mallUserId: 'U1' }], ctx))
    }
  }
})

test('empty direct order pages do not require an enrichment fallback', async () => {
  const enrich = loadFunction('buildAdminOrderMongoEnrichDb', {
    mongo, MongoDirectReadError: require('../src/adminMongoReadOptimize').MongoDirectReadError,
    readMongoEntityDocsByIds: async () => { assert.fail('empty pages need no reads') },
  })
  const result = await enrich('tenant', 'fake', null, [], { state: {}, set() {} })
  assert.deepEqual(Array.from(result.users), [])
  assert.deepEqual(Array.from(result.orders), [])
})

test('async read cache does not retain data served with a stale fallback header', async () => {
  const cache = loadFunction('withAdminReadCacheAsync', {
    adminReadCacheTtlMs: () => 45000, adminReadCacheScopeKey: () => 'tenant:fake', adminReadCacheStore: new Map(),
  })
  let reads = 0
  const staleCtx = { response: { get: () => '1' } }
  await cache(staleCtx, 'products', async () => { reads++; return ['old'] })
  const result = await cache({ response: { get: () => '' } }, 'products', async () => { reads++; return ['new'] })
  assert.equal(reads, 2)
  assert.deepEqual(result, ['new'])
})

test('successful direct order enrichment still requires covered channel snapshot data', async () => {
  const dependencies = {
    mongo, MongoDirectReadError: require('../src/adminMongoReadOptimize').MongoDirectReadError,
    readMongoEntityDocsByIds: async () => [{ id: 'U1', registerChannelCode: 'legacy' }],
    getMongoScopedCollection: () => ({ find: () => ({ toArray: async () => [] }) }), mapMongoEntityDoc: value => value,
    isMongoPersistenceEnabled: () => true,
    getScopeCacheReadiness: (workspace, tenant, keys) => {
      assert.deepEqual(Array.from(keys), ['trafficChannels'])
      return { usable: false }
    },
  }
  if (source.includes('function requireMongoFallbackSnapshot(')) {
    dependencies.requireMongoFallbackSnapshot = loadFunction('requireMongoFallbackSnapshot', dependencies)
  }
  const enrich = loadFunction('buildAdminOrderMongoEnrichDb', dependencies)
  await assert.rejects(() => enrich('tenant', 'fake', { trafficChannels: [] }, [{ mallUserId: 'U1' }], { set() {} }))
})

test('legacy tenant account merge still falls back for a genuinely empty Mongo account list', async () => {
  const accounts = [{ id: 'legacy-account' }]
  let legacyReads = 0
  const resolve = loadFunction('resolveTenantAdminAccountsList', {
    readTenantAdminAccountsFromMongo: async () => [],
    readDbByTenantId: async () => { legacyReads++; return { adminAccounts: accounts } },
    ensureAdminAccounts() {},
  })
  assert.equal(await resolve('fake'), accounts)
  assert.equal(legacyReads, 1)
})

test('entrypoint uses safe pagination plans for every accepted orders path variant', () => {
  const resolve = loadFunction('resolveApiMongoRefreshPlan', {
    zheyinTrafficGateway: null, halfFlowTrafficGateway: null, resolveDuodiandianMongoRefreshPlan: () => null,
    isAdminReadOptimizeEnabled: () => true, adminMongoReadOptimize: require('../src/adminMongoReadOptimize'),
    resolveCoreApiMongoRefreshPlan,
  })
  for (const path of ['/api/orders', '/api/orders/', '/API/ORDERS/']) {
    const ctx = { method: 'GET', path, query: { page: '1' } }
    assert.equal(resolve(ctx).mode, 'skip', path)
    assert.equal(ctx.path, path)
  }
})

for (const [method, requiresFresh, usable, blocked] of [
  ['GET', false, true, false], ['GET', false, false, true],
  ['GET', true, true, true], ['POST', true, true, true],
]) {
  test(`refresh middleware ${method} fresh=${requiresFresh} snapshot=${usable}`, async () => {
    const plan = { mode: 'partial', keys: ['orders', 'users'], requiresFresh, allowColdPartial: true }
    const headers = {}
    const ctx = { method, path: '/api/test', state: { workspaceType: 'tenant', tenantId: 'fake' }, set: (k, v) => { headers[k] = v } }
    let continued = false
    let readinessChecked = false
    const middleware = loadFunction('refreshMongoForRequest', {
      isManagedApiPath: () => true, isMongoPersistenceEnabled: () => true,
      normalizeTenantId: v => v, normalizeWorkspaceType: v => v, DEFAULT_TENANT_ID: 'default',
      resolveApiMongoRefreshPlan: () => plan,
      refreshScopePartialFromMongo: async () => { throw new Error('fake refresh failure') },
      getScopeCacheReadiness: (workspace, tenant, keys) => {
        assert.equal(workspace, 'tenant'); assert.equal(tenant, 'fake'); assert.equal(keys, plan.keys)
        readinessChecked = true
        return { usable }
      },
      shouldBlockRequestOnMongoRefreshError,
      fail: (context, message, status) => { context.status = status; context.body = { code: status, message } },
      console: { warn() {}, error() {} },
    })
    await middleware(ctx, async () => { continued = true })
    assert.equal(readinessChecked, true)
    assert.equal(continued, !blocked)
    assert.equal(ctx.status, blocked ? 503 : undefined)
    assert.equal(headers['X-Data-Stale'], blocked ? undefined : '1')
  })
}

test('Mongo read error boundary maps known storage errors to 503 and preserves unrelated errors', async () => {
  const boundary = loadFunction('mongoReadErrorBoundary', {
    fail: (ctx, message, status) => { ctx.status = status; ctx.body = { code: status, message } },
  })
  for (const code of ['MONGO_DIRECT_READ_FAILED', 'MONGO_SNAPSHOT_UNAVAILABLE']) {
    const ctx = {}
    await boundary(ctx, async () => { throw Object.assign(new Error('private query detail'), { code }) })
    assert.equal(ctx.status, 503)
    assert.equal(ctx.body.code, 503)
    assert.ok(!ctx.body.message.includes('private query'))
  }
  const cause = new Error('unrelated')
  await assert.rejects(() => boundary({}, async () => { throw cause }), error => error === cause)
  assert.ok(source.indexOf('app.use(mongoReadErrorBoundary)') < source.indexOf('app.use(enforceAdminLoginSession)'))
  assert.match(source, /app\.use\(refreshMongoForRequest\)/)
})

test('all audited side-effect routes stop before handlers on refresh rejection', async () => {
  for (const [method, path, query = {}] of [
    ['GET', '/api/card-packages/O1/contract-flow'], ['GET', '/api/card-packages/O1/contract-view'],
    ['GET', '/api/payment/lakala/status/LP1'], ['POST', '/api/payment/lakala/preorder'],
    ['POST', '/api/payment/lakala/notify'], ['GET', '/api/orders', { listScope: 'card-data', page: '1' }],
    ['GET', '/api/mall/cs/session'], ['GET', '/api/admin/cs/sessions/S1'],
    ['GET', '/api/platform/accounts'], ['GET', '/api/platform/tenants'], ['POST', '/api/unknown'],
  ]) {
    const ctx = { method, path, query, state: {}, set() { assert.fail('blocked routes cannot be stale') } }
    const reject = async () => { throw new Error('fake refresh failure') }
    const middleware = loadFunction('refreshMongoForRequest', {
      isManagedApiPath: () => true, isMongoPersistenceEnabled: () => true,
      normalizeTenantId: v => v, normalizeWorkspaceType: v => v, DEFAULT_TENANT_ID: 'default',
      resolveApiMongoRefreshPlan: context => resolveCoreApiMongoRefreshPlan({ ...context, optimizeEnabled: true, safeOrderFilter: {} }),
      refreshScopePartialFromMongo: reject, refreshScopeCacheFromMongo: reject,
      getScopeCacheReadiness: () => ({ usable: true }), shouldBlockRequestOnMongoRefreshError,
      fail: (context, message, status) => { context.status = status }, console: { error() {}, warn() {} },
    })
    await middleware(ctx, async () => { assert.fail(`${path} must not execute a handler, external service or persistence`) })
    assert.equal(ctx.status, 503, path)
  }
})

test('gateway plans preserve resolver priority and normalize strictness and full keys', () => {
  const normalizeApiMongoRefreshPlan = loadFunction('normalizeApiMongoRefreshPlan', { mongo })
  for (const winner of [0, 1, 2]) {
    const calls = []
    const gateway = index => () => { calls.push(index); return index === winner ? { mode: 'partial', keys: ['users'], allowColdPartial: true } : null }
    const resolve = loadFunction('resolveApiMongoRefreshPlan', {
      normalizeApiMongoRefreshPlan,
      resolveDuodiandianMongoRefreshPlan: gateway(0),
      zheyinTrafficGateway: { resolveZheyinTrafficMongoRefreshPlan: gateway(1) },
      halfFlowTrafficGateway: { resolveHalfFlowTrafficMongoRefreshPlan: gateway(2) },
    })
    const result = resolve({ method: 'POST', path: '/gateway/test' })
    assert.equal(result.requiresFresh, true)
    assert.deepEqual(Array.from(result.keys), ['users'])
    assert.equal(result.allowColdPartial, true)
    assert.deepEqual(calls, [0, 1, 2].slice(0, winner + 1))
  }
  const full = normalizeApiMongoRefreshPlan({ mode: 'full' }, 'POST')
  assert.deepEqual(Array.from(full.keys), mongo.SHARDED_ENTITY_KEYS)
  const skip = normalizeApiMongoRefreshPlan({ mode: 'skip' }, 'POST')
  assert.equal(skip.requiresFresh, true)
  assert.deepEqual(Array.from(skip.keys), [])
})

test('blocks write requests when Mongo refresh fails', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(shouldBlockRequestOnMongoRefreshError(method), true)
  }
})

test('only explicit ordinary GET with usable durable snapshot may continue', () => {
  assert.equal(shouldBlockRequestOnMongoRefreshError('GET', { requiresFresh: false, hasUsableSnapshot: true }), false)
  assert.equal(shouldBlockRequestOnMongoRefreshError('GET', { requiresFresh: false, hasUsableSnapshot: false }), true)
  assert.equal(shouldBlockRequestOnMongoRefreshError('GET', { requiresFresh: true, hasUsableSnapshot: true }), true)
  for (const method of ['GET', 'HEAD', 'OPTIONS', '', undefined]) {
    assert.equal(shouldBlockRequestOnMongoRefreshError(method), true)
  }
  for (const options of [{}, { requiresFresh: false }, { hasUsableSnapshot: true }, null]) {
    assert.equal(shouldBlockRequestOnMongoRefreshError('GET', options), true)
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    assert.equal(shouldBlockRequestOnMongoRefreshError(method, { requiresFresh: false, hasUsableSnapshot: true }), true)
  }
})
