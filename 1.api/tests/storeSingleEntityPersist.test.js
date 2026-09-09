const assert = require('node:assert/strict')
const test = require('node:test')

const { persistEntityItem, persistShardedSnapshotPartial } = require('../src/store')
const store = require('../src/store')
const mongo = require('../src/mongo')
const { runWithTenant } = require('../src/tenantContext')

test('JSON fallback keeps synchronous full-file writes and supports awaiting every write API', async (t) => {
  const fs = require('node:fs')
  const config = require('../src/mongoConfig')
  const writes = []
  t.mock.method(config, 'isJsonFallbackAllowed', () => true)
  t.mock.method(fs, 'existsSync', () => true)
  t.mock.method(fs, 'writeFileSync', (file, content, encoding) => writes.push({ file, content, encoding }))
  const db = { _meta: { source: 'json' }, orders: [{ id: 'O1', paid: true }], users: [{ id: 'U1' }] }
  for (const write of [
    () => store.writeDb(db),
    () => store.writeDbPartial(db, ['orders']),
    () => store.writeDbEntity(db, 'orders', db.orders[0]),
    () => store.writeDbEntities(db, [{ entityKey: 'orders', item: db.orders[0] }]),
  ]) {
    const before = writes.length
    const result = write()
    assert.equal(writes.length, before + 1)
    assert.deepEqual(JSON.parse(writes.at(-1).content), db)
    assert.equal(writes.at(-1).encoding, 'utf-8')
    await assert.doesNotReject(result)
  }
})

async function withEntityFixture(t, fn) {
  const calls = []
  let failAt = Infinity
  let gate = Promise.resolve()
  const data = new Map(mongo.SHARDED_ENTITY_KEYS.map(key => [mongo.COLLECTIONS[key], []]))
  data.set('orders', [{ _id: 'O1', id: 'O1', paid: false }, { _id: 'O2', id: 'O2', paid: false }])
  data.set(mongo.COLLECTIONS.lakalaPayments, [{ _id: 'LP1', outTradeNo: 'LP1', status: 'pending' }])
  const dbm = { collection: name => ({
    find: () => {
      calls.push({ collection: name, method: 'find' })
      return { toArray: async () => structuredClone(data.get(name) || []) }
    },
    findOne: async () => name === mongo.APP_META ? { updatedAt: new Date(1), meta: { fixture: true } } : null,
    replaceOne: async (...args) => {
      calls.push({ collection: name, method: 'replaceOne', args })
      await gate
      if (calls.length === failAt) throw new Error('entity write outage')
      if (name !== mongo.APP_META) {
        data.set(name, [...(data.get(name) || []).filter(row => row._id !== args[0]._id), structuredClone(args[1])])
      }
    },
    deleteMany: () => { throw new Error('unexpected deleteMany') },
    bulkWrite: () => { throw new Error('unexpected bulkWrite') },
  }) }
  t.mock.method(mongo, 'getMongoDb', () => dbm)
  await runWithTenant('entity-fixture', async () => {
    await store.hydrateFromMongoAfterConnect()
    calls.length = 0
    await fn({ calls, fail: index => { failAt = index }, block: promise => { gate = promise } })
  })
}

test('writeDbEntities upserts only deduplicated target documents and publishes after success', async (t) => {
  await withEntityFixture(t, async ({ calls, block }) => {
    const previous = store.readDb()
    const snapshot = structuredClone(previous)
    snapshot.orders = [{ id: 'unrelated-snapshot-order' }]
    snapshot._meta = { source: 'captured' }
    const entries = [
      { entityKey: 'orders', item: { id: 'O1', paid: true } },
      { entityKey: 'orders', item: { id: 'O1', paid: true, status: 'done' } },
      { entityKey: 'lakalaPayments', item: { outTradeNo: 'LP1', status: 'success' } },
    ]
    let release
    block(new Promise(resolve => { release = resolve }))
    const job = store.writeDbEntities(snapshot, entries)
    assert.strictEqual(store.readDb(), previous)
    entries[1].item.status = 'mutated'
    snapshot._meta.source = 'mutated'
    release()
    await job
    assert.deepEqual(calls.map(call => [call.collection, call.method]), [
      [mongo.COLLECTIONS.orders, 'replaceOne'],
      [mongo.COLLECTIONS.lakalaPayments, 'replaceOne'],
      [mongo.APP_META, 'replaceOne'],
    ])
    assert.deepEqual(calls[0].args, [{ _id: 'O1' }, { id: 'O1', paid: true, status: 'done', _id: 'O1' }, { upsert: true }])
    assert.equal(calls[2].args[1].meta.source, 'captured')
    assert.deepEqual(store.readDb().orders, [{ id: 'O1', paid: true, status: 'done' }, { id: 'O2', paid: false }])
    assert.equal(store.readDb().lakalaPayments.find(item => item.outTradeNo === 'LP1').status, 'success')
  })
})

test('writeDbEntities keeps the previous memory snapshot on an entity or metadata failure', async (t) => {
  for (const failAt of [2, 3]) {
    await withEntityFixture(t, async ({ calls, fail }) => {
      const previous = store.readDb()
      fail(failAt)
      await assert.rejects(store.writeDbEntities(structuredClone(previous), [
        { entityKey: 'orders', item: { id: 'O1', paid: true } },
        { entityKey: 'lakalaPayments', item: { outTradeNo: 'LP1', status: 'success' } },
      ]), /entity write outage/)
      assert.strictEqual(store.readDb(), previous)
      assert.equal(store.readDb().orders[0].paid, false)
      assert.equal(calls.length, failAt)
    })
  }
})

test('writeDbEntities validates every entry before performing any write', async (t) => {
  await withEntityFixture(t, async ({ calls }) => {
    for (const entry of [{ entityKey: 'unknown', item: { id: 'bad' } }, { entityKey: 'orders', item: {} }]) {
      await assert.rejects(store.writeDbEntities(store.readDb(), [
        { entityKey: 'orders', item: { id: 'O1', paid: true } }, entry,
      ]), /unknown entity key|missing primary key/)
    }
    assert.equal(calls.length, 0)
  })
})

test('an earlier exact write cannot overwrite the memory of a later queued single-entity write', async (t) => {
  await withEntityFixture(t, async ({ block }) => {
    let release
    block(new Promise(resolve => { release = resolve }))
    const first = store.writeDbEntities(store.readDb(), [{ entityKey: 'orders', item: { id: 'O1', status: 'first' } }])
    const laterDb = structuredClone(store.readDb())
    laterDb.orders[0] = { id: 'O1', status: 'later' }
    const later = store.writeDbEntity(laterDb, 'orders', laterDb.orders[0])
    release()
    await Promise.all([first, later])
    assert.equal(store.readDb().orders[0].status, 'later')
  })
})

test('writeDbEntities rejects when Mongo is disconnected without publishing the work copy', async (t) => {
  await withEntityFixture(t, async () => {
    const previous = store.readDb()
    t.mock.method(mongo, 'getMongoDb', () => null)
    await assert.rejects(store.writeDbEntities(previous, [
      { entityKey: 'orders', item: { id: 'O1', paid: true } },
    ]), /Mongo.*unavailable/)
    assert.strictEqual(store.readDb(), previous)
  })
})

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
