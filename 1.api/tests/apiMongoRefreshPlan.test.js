const assert = require('node:assert/strict')
const test = require('node:test')
const { resolveCoreApiMongoRefreshPlan: resolve } = require('../src/apiMongoRefreshPlan')
const { SHARDED_ENTITY_KEYS } = require('../src/mongo')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const cases = [
  ['GET', '/api/payment/lakala/config', {}, 'skip', [], false],
  ['GET', '/api/admin/orders/repayment-records', {}, 'partial', ['lakalaPayments', 'users', 'orders', 'trafficChannels'], false],
  ['POST', '/api/payment/lakala/preorder', {}, 'partial', ['products', 'users', 'orders', 'lakalaPayments'], true],
  ['POST', '/api/payment/lakala/notify', {}, 'partial', ['users', 'orders', 'lakalaPayments'], true],
  ['POST', '/api/payment/lakala/sync-pending', {}, 'partial', ['users', 'orders', 'lakalaPayments'], true],
  ['POST', '/api/payment/lakala/mock-complete/LP1', {}, 'partial', ['users', 'orders', 'lakalaPayments'], true],
  ['GET', '/api/payment/lakala/status/LP1', {}, 'partial', ['users', 'orders', 'lakalaPayments'], true],
  ['GET', '/api/card-packages/O1/contract-flow', {}, 'partial', ['users', 'orders'], true],
  ['GET', '/api/card-packages/O1/contract-view', {}, 'partial', ['users', 'orders'], true],
  ['GET', '/api/mall/cs/session', {}, 'partial', ['users', 'csSessions'], true],
  ['GET', '/api/orders', { listScope: 'card-data', page: '1' }, 'partial', ['orders', 'users', 'trafficChannels'], true],
  ['POST', '/api/unknown', {}, 'full', SHARDED_ENTITY_KEYS, true],
  ['HEAD', '/api/products', {}, 'full', SHARDED_ENTITY_KEYS, true],
  ['GET', '/api/unknown', {}, 'full', SHARDED_ENTITY_KEYS, false],
  ['GET', '/api/my/orders', {}, 'partial', ['users', 'orders', 'trafficChannels'], false],
  ['GET', '/api/orders', {}, 'partial', ['orders', 'users', 'trafficChannels'], false],
  ['GET', '/api/orders', { page: '1' }, 'partial', ['orders', 'users', 'trafficChannels'], false],
  ['GET', '/api/admin/dashboard/kpis', {}, 'partial', ['orders'], false],
  ['GET', '/api/products', {}, 'skip', [], false],
  ['GET', '/api/users/U1', {}, 'partial', ['adminAccounts', 'users', 'orders', 'trafficChannels'], false],
  ['GET', '/api/orders/O1', {}, 'partial', ['adminAccounts', 'orders', 'users', 'trafficChannels'], false],
  ['GET', '/api/orders/pending-receivable', {}, 'partial', ['adminAccounts', 'orders', 'users', 'trafficChannels'], false],
  ['GET', '/api/users', { page: '1' }, 'partial', ['orders', 'users', 'trafficChannels'], false],
]

for (const [method, path, query, mode, keys, requiresFresh] of cases) {
  test(`${method} ${path} ${JSON.stringify(query)} has the required refresh plan`, () => {
    const actual = resolve({ method, path, query, optimizeEnabled: true, safeOrderFilter: null })
    assert.equal(actual.mode, mode)
    assert.deepEqual(actual.keys, keys)
    assert.equal(actual.requiresFresh, requiresFresh)
    if (mode === 'partial') assert.equal(actual.allowColdPartial, true)
  })
}

test('planning matches Router case and optional trailing slash without mutating input', () => {
  for (const [method, path, query] of cases) {
    const expected = resolve({ method, path, query, optimizeEnabled: true })
    for (const variant of [path + '/', path.toUpperCase(), path.toUpperCase() + '/']) {
      const input = Object.freeze({ method, path: variant, query: Object.freeze({ ...query }), optimizeEnabled: true })
      assert.deepEqual(resolve(input), expected, variant)
      assert.equal(input.path, variant)
      assert.deepEqual(input.query, query)
    }
  }
})

test('partial read snapshots retain historical channel labels for order and user views', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8')
  const load = (name, dependencies) => {
    const match = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))
    assert.ok(match)
    return vm.runInNewContext(`(${match[0]})`, dependencies)
  }
  const ensureTrafficChannels = load('ensureTrafficChannels', {})
  const resolveUserRegisterChannelLabel = load('resolveUserRegisterChannelLabel', { ensureTrafficChannels })
  const resolveOrderRegisterChannelView = load('resolveOrderRegisterChannelView', { resolveUserRegisterChannelLabel })
  const user = { id: 'U1', registerChannelCode: 'legacy-channel' }
  const durable = { users: [user], orders: [{ id: 'O1', mallUserId: 'U1' }], trafficChannels: [{ code: 'legacy-channel', name: 'Historical Channel' }] }
  for (const [path, query] of [['/api/orders/O1', {}], ['/api/orders/pending-receivable', {}], ['/api/users', { page: '1' }]]) {
    const plan = resolve({ method: 'GET', path, query, optimizeEnabled: true })
    const snapshot = Object.fromEntries(plan.keys.map(key => [key, durable[key] || []]))
    assert.equal(resolveUserRegisterChannelLabel(snapshot, user), 'Historical Channel', path)
    assert.equal(resolveOrderRegisterChannelView(snapshot, user).registerChannelLabel, 'Historical Channel', path)
  }
})

test('payment and side-effect routes take precedence even when optimization is disabled', () => {
  for (const [method, path, query, mode, keys, requiresFresh] of cases.slice(0, 11)) {
    const actual = resolve({ method, path, query, optimizeEnabled: false, safeOrderFilter: {} })
    assert.equal(actual.mode, mode, path)
    assert.deepEqual(actual.keys, keys, path)
    assert.equal(actual.requiresFresh, requiresFresh, path)
  }
})

test('ordinary reads use full snapshots when optimization is disabled', () => {
  assert.deepEqual(resolve({ method: 'GET', path: '/api/products', optimizeEnabled: false }), {
    mode: 'full', keys: SHARDED_ENTITY_KEYS, requiresFresh: false,
  })
})

test('safe paginated orders skip refresh but card-data always refreshes first', () => {
  const input = { method: 'GET', path: '/api/orders', query: { page: '1' }, optimizeEnabled: true, safeOrderFilter: {} }
  assert.equal(resolve(input).mode, 'skip')
  const card = resolve({ ...input, query: { page: '1', listScope: ' card-data ' } })
  assert.equal(card.mode, 'partial')
  assert.equal(card.requiresFresh, true)
  assert.ok(card.keys.includes('trafficChannels'))
})

test('admin session marking and platform audit GETs always refresh before side effects', () => {
  for (const optimizeEnabled of [true, false]) {
    for (const path of ['/api/platform/accounts', '/api/platform/tenants', '/api/platform/dashboard/summary', '/api/platform/audit-logs']) {
      assert.deepEqual(resolve({ method: 'GET', path, optimizeEnabled }), {
        mode: 'full', keys: SHARDED_ENTITY_KEYS, requiresFresh: true,
      })
    }
    for (const read of [undefined, '1', 'true']) {
      const actual = resolve({ method: 'GET', path: '/api/admin/cs/sessions/S1', query: { read }, optimizeEnabled })
      assert.equal(actual.mode, 'partial')
      assert.equal(actual.requiresFresh, true)
      assert.deepEqual(actual.keys, ['csSessions', 'users'])
    }
  }
  for (const read of ['0', 'false', 'no']) {
    assert.equal(resolve({ method: 'GET', path: '/api/admin/cs/sessions/S1', query: { read }, optimizeEnabled: true }).requiresFresh, false)
  }
})
