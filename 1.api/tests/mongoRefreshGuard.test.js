const assert = require('node:assert/strict')
const test = require('node:test')

const { shouldBlockRequestOnMongoRefreshError } = require('../src/mongoRefreshGuard')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8')
const { resolveCoreApiMongoRefreshPlan } = require('../src/apiMongoRefreshPlan')
const mongo = require('../src/mongo')

function loadFunction(name, dependencies) {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))
  assert.ok(match, `${name} must be present`)
  return vm.runInNewContext(`(${match[0]})`, dependencies)
}

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
