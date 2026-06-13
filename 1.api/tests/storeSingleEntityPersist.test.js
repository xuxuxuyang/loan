const assert = require('node:assert/strict')
const test = require('node:test')

const { persistEntityItem, persistShardedSnapshotPartial } = require('../src/store')

function createFakeDb() {
  const calls = {
    orders: [],
    meta: [],
  }
  const ordersCollection = {
    replaceOne(...args) {
      calls.orders.push({ method: 'replaceOne', args })
      return Promise.resolve({ matchedCount: 1, modifiedCount: 1, upsertedCount: 0 })
    },
    find() {
      calls.orders.push({ method: 'find', args: [] })
      return { toArray: async () => [] }
    },
    bulkWrite(...args) {
      calls.orders.push({ method: 'bulkWrite', args })
      return Promise.resolve({})
    },
    deleteMany(...args) {
      calls.orders.push({ method: 'deleteMany', args })
      return Promise.resolve({})
    },
  }
  const metaCollection = {
    replaceOne(...args) {
      calls.meta.push({ method: 'replaceOne', args })
      return Promise.resolve({ acknowledged: true })
    },
  }
  return {
    calls,
    db: {
      collection(name) {
        if (name === 'orders') return ordersCollection
        if (name === 'app_meta') return metaCollection
        throw new Error(`unexpected collection ${name}`)
      },
    },
  }
}

test('persistEntityItem updates only one order document and app meta', async () => {
  const { db, calls } = createFakeDb()
  const order = {
    _id: 'stale-id-from-mongo',
    id: 'OD-review-1',
    status: 'shipping',
    riskStatus: 'passed',
  }
  const snapshot = {
    _meta: { source: 'unit-test' },
    orders: [order],
  }

  await persistEntityItem(db, 'orders', order, snapshot, new Date('2026-06-11T08:00:00.000Z'))

  assert.deepEqual(calls.orders.map(call => call.method), ['replaceOne'])
  assert.deepEqual(calls.orders[0].args, [
    { _id: 'OD-review-1' },
    {
      id: 'OD-review-1',
      status: 'shipping',
      riskStatus: 'passed',
      _id: 'OD-review-1',
    },
    { upsert: true },
  ])
  assert.equal(calls.meta.length, 1)
  assert.equal(calls.meta[0].method, 'replaceOne')
})

test('persistShardedSnapshotPartial refuses to shrink users from a tiny stale snapshot', async () => {
  const calls = {
    users: [],
    meta: [],
  }
  const existingUsers = Array.from({ length: 120 }, (_, i) => ({ _id: `U${i + 1}` }))
  const usersCollection = {
    find() {
      calls.users.push({ method: 'find', args: [] })
      return { toArray: async () => existingUsers }
    },
    deleteMany(...args) {
      calls.users.push({ method: 'deleteMany', args })
      return Promise.resolve({})
    },
    bulkWrite(...args) {
      calls.users.push({ method: 'bulkWrite', args })
      return Promise.resolve({})
    },
  }
  const metaCollection = {
    replaceOne(...args) {
      calls.meta.push({ method: 'replaceOne', args })
      return Promise.resolve({ acknowledged: true })
    },
  }
  const db = {
    collection(name) {
      if (name === 'users') return usersCollection
      if (name === 'app_meta') return metaCollection
      throw new Error(`unexpected collection ${name}`)
    },
  }

  await assert.rejects(
    () => persistShardedSnapshotPartial(db, {
      _meta: { source: 'stale-cache' },
      users: [
        { id: 'U-new-1', phone: '13000000001' },
        { id: 'U-new-2', phone: '13000000002' },
      ],
    }, ['users']),
    /refusing to shrink users/,
  )

  assert.deepEqual(calls.users.map(call => call.method), ['find'])
  assert.equal(calls.meta.length, 0)
})

test('persistShardedSnapshotPartial refuses to wipe other critical collections from a stale snapshot', async () => {
  const calls = {
    orders: [],
    meta: [],
  }
  const existingOrders = Array.from({ length: 80 }, (_, i) => ({ _id: `OD${i + 1}` }))
  const ordersCollection = {
    find() {
      calls.orders.push({ method: 'find', args: [] })
      return { toArray: async () => existingOrders }
    },
    deleteMany(...args) {
      calls.orders.push({ method: 'deleteMany', args })
      return Promise.resolve({})
    },
    bulkWrite(...args) {
      calls.orders.push({ method: 'bulkWrite', args })
      return Promise.resolve({})
    },
  }
  const metaCollection = {
    replaceOne(...args) {
      calls.meta.push({ method: 'replaceOne', args })
      return Promise.resolve({ acknowledged: true })
    },
  }
  const db = {
    collection(name) {
      if (name === 'orders') return ordersCollection
      if (name === 'app_meta') return metaCollection
      throw new Error(`unexpected collection ${name}`)
    },
  }

  await assert.rejects(
    () => persistShardedSnapshotPartial(db, {
      _meta: { source: 'stale-cache' },
      orders: [],
    }, ['orders']),
    /refusing to shrink orders/,
  )

  assert.deepEqual(calls.orders.map(call => call.method), ['find'])
  assert.equal(calls.meta.length, 0)
})
