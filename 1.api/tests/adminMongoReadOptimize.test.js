const assert = require('node:assert/strict')
const test = require('node:test')

const opt = require('../src/adminMongoReadOptimize')

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
      if ('$gte' in expected && !(String(actual || '') >= expected.$gte)) return false
      if ('$lt' in expected && !(String(actual || '') < expected.$lt)) return false
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
