const assert = require('node:assert/strict')
const test = require('node:test')

const { persistEntityItem } = require('../src/store')

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
