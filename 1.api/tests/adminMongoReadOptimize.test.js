const assert = require('node:assert/strict')
const test = require('node:test')

const opt = require('../src/adminMongoReadOptimize')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

for (const name of ['readAdminAccountsFromMongoScoped', 'readOrdersFromMongoScoped', 'readProductsFromMongoScoped', 'buildAdminOrderMongoEnrichDb']) {
  test(`${name} propagates actual query failures without reading fallback data`, async () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8')
    const match = source.match(new RegExp(`async function ${name}\\([^]*?\\n\\}`))
    assert.ok(match)
    const collection = { find() { return this }, toArray: async () => { throw new Error('fake query failure') } }
    const mongo = { getMongoClient: () => ({ db: () => ({ collection: () => collection }) }), COLLECTIONS: {} }
    const read = vm.runInNewContext(`(${match[0]})`, {
      mongo, MongoDirectReadError: opt.MongoDirectReadError,
      resolveMongoScopedDbName: () => 'fake', mapMongoEntityDoc: d => d, normalizeAdminAccount: d => d,
      getMongoScopedCollection: () => collection,
      readMongoEntityDocsByIds: async () => { throw new Error('fake query failure') },
    })
    await assert.rejects(() => read('tenant', 'fake', {}, [{ mallUserId: 'u1' }]), {
      code: 'MONGO_DIRECT_READ_FAILED', statusCode: 503,
    })
  })
}

test('entrypoint direct helpers return null when their collection is unavailable', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8')
  for (const name of ['readAdminAccountsFromMongoScoped', 'readOrdersFromMongoScoped', 'readProductsFromMongoScoped']) {
    const match = source.match(new RegExp(`async function ${name}\\([^]*?\\n\\}`))
    const read = vm.runInNewContext(`(${match[0]})`, {
      mongo: { getMongoClient: () => ({ db: () => ({ collection: () => null }) }), COLLECTIONS: {} },
      MongoDirectReadError: opt.MongoDirectReadError, resolveMongoScopedDbName: () => 'fake',
    })
    assert.equal(await read('tenant', 'fake'), null, name)
  }
})

for (const operation of ['orders count', 'orders list', 'sidebar count', 'users count', 'users list', 'register channel users']) {
  test(`propagates ${operation} query failure as a MongoDirectReadError`, async () => {
    const cause = new Error('fake query unavailable')
    const broken = {
      countDocuments: async () => { if (operation.includes('count')) throw cause; return 0 },
      find() { return this }, sort() { return this }, skip() { return this }, limit() { return this },
      toArray: async () => { throw cause },
    }
    const run = operation.startsWith('sidebar')
      ? () => opt.countAdminOrderSidebarCountsFromMongoScoped(() => broken)
      : operation.startsWith('users')
        ? () => opt.readAdminUsersPageFromMongoScoped(() => broken, {})
        : () => opt.readAdminOrdersPageFromMongoScoped(() => broken,
          operation === 'register channel users' ? { registerChannel: 'fake-channel' } : {}, 1, 20)
    await assert.rejects(run, (error) => {
      assert.equal(error.code, 'MONGO_DIRECT_READ_FAILED')
      assert.equal(error.statusCode, 503)
      assert.equal(error.name, 'MongoDirectReadError')
      assert.equal(error.cause, cause)
      return true
    })
  })
}

test('unavailable collections and unsupported filters still permit fallback', async () => {
  assert.equal(await opt.readAdminOrdersPageFromMongoScoped(() => null, {}, 1, 20), null)
  assert.equal(await opt.countAdminOrderSidebarCountsFromMongoScoped(() => null), null)
  assert.equal(await opt.readAdminUsersPageFromMongoScoped(() => null), null)
  const unexpected = () => { throw new Error('unsupported filters must not query') }
  assert.equal(await opt.readAdminOrdersPageFromMongoScoped(unexpected, { keyword: 'complex' }, 1, 20), null)
  assert.equal(await opt.readAdminUsersPageFromMongoScoped(unexpected, { key: 'complex' }), null)
})

class FakeCursor {
  constructor(docs) {
    this.docs = docs
    this.sorted = docs
  }
  sort(spec) {
    const entries = Object.entries(spec || {})
    this.sorted = [...this.sorted].sort((a, b) => {
      for (const [key, dir] of entries) {
        const av = a[key] || ''
        const bv = b[key] || ''
        const cmp = String(av).localeCompare(String(bv))
        if (cmp !== 0) return dir < 0 ? -cmp : cmp
      }
      return 0
    })
    return this
  }
  skip(n) {
    this.sorted = this.sorted.slice(n)
    return this
  }
  limit(n) {
    this.sorted = this.sorted.slice(0, n)
    return this
  }
  toArray() {
    return Promise.resolve(this.sorted)
  }
}

function matches(doc, filter) {
  if (!filter || Object.keys(filter).length === 0) return true
  for (const [key, expected] of Object.entries(filter)) {
    if (key === '$and') {
      if (!expected.every(f => matches(doc, f))) return false
      continue
    }
    if (key === '$or') {
      if (!expected.some(f => matches(doc, f))) return false
      continue
    }
    const actual = doc[key]
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('$ne' in expected && actual === expected.$ne) return false
      if ('$in' in expected && !expected.$in.includes(actual)) return false
      if ('$gte' in expected && !(String(actual || '') >= expected.$gte)) return false
      if ('$lt' in expected && !(String(actual || '') < expected.$lt)) return false
      if ('$exists' in expected) {
        const exists = Object.prototype.hasOwnProperty.call(doc, key)
        if (Boolean(expected.$exists) !== exists) return false
      }
      continue
    }
    if (actual !== expected) return false
  }
  return true
}

function fakeCollection(docs) {
  return {
    lastFind: null,
    lastCount: null,
    find(filter) {
      this.lastFind = filter
      return new FakeCursor(docs.filter(d => matches(d, filter)))
    },
    countDocuments(filter) {
      this.lastCount = filter
      return Promise.resolve(docs.filter(d => matches(d, filter)).length)
    },
  }
}

test('builds safe pending order filters for Mongo pagination', () => {
  assert.deepEqual(opt.buildAdminOrderMongoFilter({ scope: 'pending', risk: '' }), {
    status: 'reviewing',
    payType: 'installment',
    riskStatus: { $ne: 'failed' },
  })
  assert.deepEqual(opt.buildAdminOrderMongoFilter({ scope: 'pending', risk: 'failed' }), {
    status: 'reviewing',
    payType: 'installment',
    riskStatus: 'failed',
  })
})

test('declines complex order filters so callers can fallback safely', () => {
  assert.equal(opt.buildAdminOrderMongoFilter({ keyword: '13800138000' }), null)
  assert.equal(opt.buildAdminOrderMongoFilter({ repay: 'overdue' }), null)
})

test('reads a paginated pending order page from Mongo without loading all orders', async () => {
  const orders = fakeCollection([
    { id: 'old', status: 'reviewing', payType: 'installment', riskStatus: 'passed', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'new', status: 'reviewing', payType: 'installment', riskStatus: 'passed', createdAt: '2026-01-02T00:00:00.000Z' },
    { id: 'failed', status: 'reviewing', payType: 'installment', riskStatus: 'failed', createdAt: '2026-01-03T00:00:00.000Z' },
  ])
  const result = await opt.readAdminOrdersPageFromMongoScoped(() => orders, { scope: 'pending' }, 1, 1)
  assert.equal(result.total, 2)
  assert.deepEqual(result.orders.map(o => o.id), ['new'])
  assert.deepEqual(orders.lastFind, { status: 'reviewing', payType: 'installment', riskStatus: { $ne: 'failed' } })
})

test('reads paginated orders from Mongo filtered by register channel code', async () => {
  const orders = fakeCollection([
    { id: 'channel-old', mallUserId: 'u-channel-1', status: 'reviewing', payType: 'installment', riskStatus: 'failed', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'channel-new', mallUserId: 'u-channel-2', status: 'reviewing', payType: 'installment', riskStatus: 'failed', createdAt: '2026-01-02T00:00:00.000Z' },
    { id: 'other', mallUserId: 'u-other', status: 'reviewing', payType: 'installment', riskStatus: 'failed', createdAt: '2026-01-03T00:00:00.000Z' },
  ])
  const users = fakeCollection([
    { id: 'u-channel-1', registerChannelCode: 'traffic-a' },
    { id: 'u-channel-2', registerChannelCode: 'traffic-a' },
    { id: 'u-other', registerChannelCode: 'traffic-b' },
  ])
  const result = await opt.readAdminOrdersPageFromMongoScoped(
    name => (name === 'users' ? users : orders),
    { scope: 'pending', risk: 'failed', registerChannel: 'traffic-a' },
    1,
    1,
  )
  assert.equal(result.total, 2)
  assert.deepEqual(result.orders.map(o => o.id), ['channel-new'])
  assert.deepEqual(users.lastFind, { registerChannelCode: 'traffic-a' })
  assert.deepEqual(orders.lastFind, {
    status: 'reviewing',
    payType: 'installment',
    riskStatus: 'failed',
    mallUserId: { $in: ['u-channel-1', 'u-channel-2'] },
  })
})

test('reads paginated orders from Mongo filtered to mall self registrations', async () => {
  const orders = fakeCollection([
    { id: 'mall-a', mallUserId: 'u-mall-a', status: 'reviewing', payType: 'installment', riskStatus: 'passed', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'mall-b', mallUserId: 'u-mall-b', status: 'reviewing', payType: 'installment', riskStatus: 'passed', createdAt: '2026-01-02T00:00:00.000Z' },
    { id: 'traffic', mallUserId: 'u-traffic', status: 'reviewing', payType: 'installment', riskStatus: 'passed', createdAt: '2026-01-03T00:00:00.000Z' },
  ])
  const users = fakeCollection([
    { id: 'u-mall-a' },
    { id: 'u-mall-b', registerChannelCode: '' },
    { id: 'u-traffic', registerChannelCode: 'traffic-a' },
  ])
  const result = await opt.readAdminOrdersPageFromMongoScoped(
    name => (name === 'users' ? users : orders),
    { scope: 'pending', registerChannel: '__none__' },
    1,
    10,
  )
  assert.equal(result.total, 2)
  assert.deepEqual(result.orders.map(o => o.id), ['mall-b', 'mall-a'])
  assert.deepEqual(users.lastFind, {
    $or: [
      { registerChannelCode: { $exists: false } },
      { registerChannelCode: '' },
      { registerChannelCode: null },
    ],
  })
})

test('returns an empty Mongo page when register channel has no matching users', async () => {
  const orders = fakeCollection([
    { id: 'order-a', mallUserId: 'u-a', status: 'reviewing', payType: 'installment', riskStatus: 'passed', createdAt: '2026-01-01T00:00:00.000Z' },
  ])
  const users = fakeCollection([{ id: 'u-a', registerChannelCode: 'traffic-a' }])
  const result = await opt.readAdminOrdersPageFromMongoScoped(
    name => (name === 'users' ? users : orders),
    { scope: 'pending', registerChannel: 'missing-channel' },
    3,
    20,
  )
  assert.deepEqual(result, { orders: [], total: 0, page: 3, pageSize: 20 })
  assert.equal(orders.lastFind, null)
})

test('counts sidebar badges in Mongo', async () => {
  const orders = fakeCollection([
    { id: 'pending', status: 'reviewing', payType: 'installment', riskStatus: 'passed', cardPackageIssued: false },
    { id: 'failed', status: 'reviewing', payType: 'installment', riskStatus: 'failed', cardPackageIssued: false },
    { id: 'reviewed', status: 'shipping', payType: 'installment', cardPackageIssued: false },
    { id: 'issued', status: 'shipping', payType: 'installment', cardPackageIssued: true },
  ])
  const result = await opt.countAdminOrderSidebarCountsFromMongoScoped(() => orders)
  assert.deepEqual(result, { pendingReview: 1, reviewedOrdersList: 1 })
})

test('reads registered users with safe Mongo pagination and leaves complex views to fallback', async () => {
  const users = fakeCollection([
    { id: 'u1', phone: '13800138000', registerAt: '2026-01-01T00:00:00.000Z' },
    { id: 'u2', phone: '13900139000', registerAt: '2026-01-02T00:00:00.000Z' },
  ])
  const result = await opt.readAdminUsersPageFromMongoScoped(() => users, { view: 'registered', page: 1, pageSize: 1 })
  assert.equal(result.total, 2)
  assert.deepEqual(result.users.map(u => u.id), ['u2'])
  assert.equal(await opt.readAdminUsersPageFromMongoScoped(() => users, { view: 'registered', key: '138', page: 1, pageSize: 1 }), null)
  assert.equal(await opt.readAdminUsersPageFromMongoScoped(() => users, { view: 'ordering', page: 1, pageSize: 1 }), null)
})
