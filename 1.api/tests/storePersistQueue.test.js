const assert = require('node:assert/strict')
const test = require('node:test')
const mongo = require('../src/mongo')
const store = require('../src/store')
const { getCurrentTenantId, runWithTenant } = require('../src/tenantContext')

const fixtures = new Map()
let sequence = 0
const originalMode = process.env.MONGO_REFRESH_MODE

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

async function fixture() {
  const tenantId = `persist-test-${++sequence}`
  const data = new Map(mongo.SHARDED_ENTITY_KEYS.map(key => [mongo.COLLECTIONS[key], []]))
  data.set('orders', [{ _id: 'O1', id: 'O1', status: 'old' }])
  const calls = []
  let failNext = false
  let gate
  let readGate
  let disconnected = false
  let meta = { _id: 'main', updatedAt: new Date(1), meta: { fixture: tenantId } }
  const dbm = {
    collection(name) {
      return {
        find() {
          calls.push({ name, method: 'find' })
          return { toArray: async () => {
            const rows = structuredClone(data.get(name) || [])
            if (readGate && name === 'orders') {
              const current = readGate
              readGate = null
              current.started.resolve()
              await current.promise
            }
            return rows
          } }
        },
        async findOne() {
          calls.push({ name, method: 'findOne' })
          return name === mongo.APP_META ? structuredClone(meta) : null
        },
        async deleteMany({ _id }) {
          data.set(name, data.get(name).filter(item => !_id.$in.includes(item._id)))
        },
        async bulkWrite(ops) {
          calls.push({ name, method: 'bulkWrite', ops: structuredClone(ops) })
          if (gate) {
            const current = gate
            gate = null
            current.started.resolve()
            await current.promise
          }
          if (failNext) {
            failNext = false
            throw new Error('simulated write outage')
          }
          for (const { replaceOne: op } of ops) {
            const rows = data.get(name).filter(item => item._id !== op.filter._id)
            data.set(name, [...rows, structuredClone(op.replacement)])
          }
        },
        async replaceOne(filter, replacement) {
          calls.push({ name, method: 'replaceOne', replacement: structuredClone(replacement) })
          if (failNext) {
            failNext = false
            throw new Error('simulated write outage')
          }
          if (name === mongo.APP_META) meta = structuredClone(replacement)
          else data.set(name, [...data.get(name).filter(item => item._id !== filter._id), structuredClone(replacement)])
        },
      }
    },
  }
  fixtures.set(tenantId, () => disconnected ? null : dbm)
  const run = fn => runWithTenant(tenantId, fn)
  await run(() => store.hydrateFromMongoAfterConnect())
  calls.length = 0
  return {
    run, calls,
    read: () => run(() => store.readDb()),
    snapshot: status => ({ ...structuredClone(run(() => store.readDb())), orders: [{ id: 'O1', status }] }),
    readiness: () => store.getScopeCacheReadiness('tenant', tenantId, ['orders']),
    refresh: () => store.refreshScopePartialFromMongo('tenant', tenantId, ['orders']),
    fail: () => { failNext = true },
    disconnect: () => { disconnected = true },
    block: () => { gate = { ...deferred(), started: deferred() }; return gate },
    blockRead: () => { readGate = { ...deferred(), started: deferred() }; return readGate },
  }
}

test.before(() => {
  process.env.MONGO_REFRESH_MODE = 'every_request'
  test.mock.method(mongo, 'getMongoDb', () => {
    const get = fixtures.get(getCurrentTenantId())
    assert.ok(get, 'Mongo access must use an in-memory fixture')
    return get()
  })
})
test.after(() => {
  test.mock.restoreAll()
  if (originalMode === undefined) delete process.env.MONGO_REFRESH_MODE
  else process.env.MONGO_REFRESH_MODE = originalMode
})

test('the scheduled persist job rejects but the next job still runs', async () => {
  const f = await fixture()
  await f.run(async () => {
    f.fail()
    const first = store.writeDbPartial(f.snapshot('first'), ['orders'])
    await assert.rejects(first, /simulated write outage/)
    await assert.rejects(store.flushMongoPersist(), /simulated write outage/)
    assert.equal(f.readiness().usable, false)
    const second = store.writeDbPartial(f.snapshot('second'), ['orders'])
    await assert.doesNotReject(second)
    assert.equal(f.calls.filter(call => call.method === 'bulkWrite').at(-1).ops[0].replaceOne.replacement.status, 'second')
  })
})

test('flush observes failures scheduled by the current request even after a later success', async () => {
  const f = await fixture()
  await assert.rejects(() => f.run(() => store.runWithMongoRequestDedup(async () => {
    f.fail()
    store.writeDbPartial(f.snapshot('first'), ['orders'])
    store.writeDbPartial(f.snapshot('second'), ['orders'])
    await store.flushMongoPersist()
  })), /simulated write outage/)
  await f.run(() => store.flushMongoPersist())
})

test('request flush does not inherit a different request failure', async () => {
  const f = await fixture()
  await f.run(async () => {
    await store.runWithMongoRequestDedup(async () => {
      f.fail()
      store.writeDbPartial(f.snapshot('failed'), ['orders'])
      await assert.rejects(store.flushMongoPersist(), /simulated write outage/)
    })
    await store.runWithMongoRequestDedup(async () => {
      await assert.doesNotReject(store.flushMongoPersist())
      await store.writeDbPartial(f.snapshot('success'), ['orders'])
      await assert.doesNotReject(store.flushMongoPersist())
    })
  })
})

test('script flush and refresh waits are scoped and ignored write results do not become unhandled', async () => {
  const f = await fixture()
  const unhandled = []
  const onUnhandled = error => unhandled.push(error)
  process.on('unhandledRejection', onUnhandled)
  try {
    f.fail()
    f.run(() => { store.writeDbPartial(f.snapshot('failed'), ['orders']) })
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(unhandled, [])
    await assert.rejects(f.run(() => store.flushMongoPersist()), /simulated write outage/)
    await assert.doesNotReject(runWithTenant('unrelated-scope', () => store.flushMongoPersist()))
    await assert.doesNotReject(store.waitForMongoPersistBeforeRefresh('tenant:unrelated-scope'))
  }
  finally { process.removeListener('unhandledRejection', onUnhandled) }
})

test('all Mongo write APIs reject a disconnected database and keep their keys dirty', async () => {
  for (const write of [
    db => store.writeDb(db),
    db => store.writeDbPartial(db, ['orders']),
    db => store.writeDbEntity(db, 'orders', db.orders[0]),
  ]) {
    const f = await fixture()
    const db = f.snapshot('unconfirmed')
    f.disconnect()
    await f.run(async () => {
      await assert.rejects(write(db), /Mongo.*(unavailable|connected)/)
      await assert.rejects(store.flushMongoPersist(), /Mongo.*(unavailable|connected)/)
    })
    assert.deepEqual(f.readiness().dirtyKeys, ['orders'])
    assert.equal(f.readiness().usable, false)
  }
})

test('queued snapshots capture each call instead of shared latest memory', async () => {
  for (const write of [db => store.writeDb(db), db => store.writeDbPartial(db, ['orders'])]) {
    const f = await fixture()
    await f.run(async () => {
      const firstDb = f.snapshot('first')
      const secondDb = f.snapshot('second')
      const first = write(firstDb)
      const second = write(secondDb)
      firstDb.orders[0].status = 'mutated-first'
      secondDb.orders[0].status = 'mutated-second'
      await Promise.all([first, second, store.flushMongoPersist()])
      assert.deepEqual(f.calls.filter(call => call.name === 'orders' && call.method === 'bulkWrite')
        .map(call => call.ops[0].replaceOne.replacement.status), ['first', 'second'])
    })
  }
})

test('refresh waits for the scope persistence tail and hydrates durable state after failure', async () => {
  const f = await fixture()
  const gate = f.block()
  const write = f.run(() => store.writeDbPartial(f.snapshot('unconfirmed'), ['orders']))
  await gate.started.promise
  f.fail()
  const readsBefore = f.calls.filter(call => call.method === 'find').length
  const refresh = f.refresh()
  await new Promise(resolve => setImmediate(resolve))
  try {
    assert.equal(f.calls.filter(call => call.method === 'find').length, readsBefore)
    assert.equal(f.readiness().usable, false)
  }
  finally {
    gate.resolve()
    await Promise.allSettled([write, refresh])
  }
  await assert.rejects(write, /simulated write outage/)
  await refresh
  assert.equal(f.read().orders[0].status, 'old')
  assert.deepEqual(f.readiness().dirtyKeys, [])
  assert.equal(f.readiness().usable, true)
})

test('a completed write cannot clear dirtiness for a later pending write', async () => {
  const f = await fixture()
  await f.run(async () => {
    const first = store.writeDbPartial(f.snapshot('first'), ['orders'])
    await first
    const gate = f.block()
    const second = store.writeDbPartial(f.snapshot('second'), ['orders'])
    await gate.started.promise
    try { assert.equal(f.readiness().usable, false) }
    finally { gate.resolve(); await second }
    assert.equal(f.readiness().usable, true)
  })
})

test('a hydrate already reading cannot clear a newer pending write or publish over its memory', async () => {
  const f = await fixture()
  const readGate = f.blockRead()
  const refresh = f.refresh()
  await readGate.started.promise
  const writeGate = f.block()
  const job = f.run(() => store.writeDbPartial(f.snapshot('newer'), ['orders']))
  await writeGate.started.promise
  readGate.resolve()
  await refresh
  try {
    assert.deepEqual(f.readiness().dirtyKeys, ['orders'])
    assert.equal(f.read().orders[0].status, 'newer')
  }
  finally {
    writeGate.resolve()
    await job
  }
  assert.equal(f.read().orders[0].status, 'newer')
  assert.equal(f.readiness().usable, true)
})
