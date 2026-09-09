const assert = require('node:assert/strict')
const test = require('node:test')
const mongo = require('../src/mongo')
const store = require('../src/store')
const { getCurrentTenantId, getCurrentWorkspaceType, runWithTenant, runWithWorkspace } = require('../src/tenantContext')

const fixtures = new Map()
let sequence = 0
let mutationCount = 0
const originalMode = process.env.MONGO_REFRESH_MODE

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function createMongoFixture({ workspaceType = 'tenant', version = 1, orders = [{ id: 'O-v1' }] } = {}) {
  const tenantId = `refresh-test-${++sequence}`
  const key = workspaceType === 'tenant' ? tenantId : workspaceType
  const data = new Map(mongo.SHARDED_ENTITY_KEYS.map(entity => [mongo.COLLECTIONS[entity], []]))
  data.set(mongo.COLLECTIONS.orders, orders)
  data.set(mongo.COLLECTIONS.lakalaPayments, [{ id: 'P-v1' }])
  const counts = new Map()
  const failures = new Map()
  const gates = new Map()
  const denyMutation = () => {
    mutationCount++
    throw new Error('Refresh tests must never mutate Mongo')
  }
  const db = {
    collection(name) {
      return {
        find() {
          return { toArray: async () => {
            counts.set(name, (counts.get(name) || 0) + 1)
            const gate = gates.get(name)
            if (gate) {
              gates.delete(name)
              gate.started.resolve()
              await gate.promise
            }
            if (failures.has(name)) {
              const error = failures.get(name)
              failures.delete(name)
              throw error
            }
            return structuredClone(data.get(name) || [])
          } }
        },
        async findOne() {
          if (failures.has(name)) {
            const error = failures.get(name)
            failures.delete(name)
            throw error
          }
          if (name === mongo.APP_STATE) return null
          if (name === mongo.APP_META) return { _id: 'main', updatedAt: new Date(version), meta: { fixture: key } }
          throw new Error(`Unexpected findOne: ${name}`)
        },
        deleteMany: denyMutation,
        deleteOne: denyMutation,
        replaceOne: denyMutation,
        bulkWrite: denyMutation,
        drop: denyMutation,
      }
    },
  }
  fixtures.set(key, db)
  const run = fn => runWithWorkspace(workspaceType, tenantId, fn)
  return {
    tenantId,
    fullRefresh: () => store.refreshScopeCacheFromMongo(workspaceType, tenantId),
    partialRefresh: (keys, options) => store.refreshScopePartialFromMongo(workspaceType, tenantId, keys, options),
    read: () => run(() => store.readDb()),
    readiness: keys => store.getScopeCacheReadiness(workspaceType, tenantId, keys),
    replace: (entity, rows) => data.set(mongo.COLLECTIONS[entity], rows),
    setVersion: value => { version = value },
    readCount: entity => counts.get(mongo.COLLECTIONS[entity]) || 0,
    failNextRead: (entity, error) => failures.set(mongo.COLLECTIONS[entity] || entity, error),
    deferNextRead(entity) {
      const gate = { ...deferred(), started: deferred() }
      gates.set(mongo.COLLECTIONS[entity], gate)
      return gate
    },
    run,
    db,
  }
}

test.before(async () => {
  test.mock.method(mongo, 'getMongoDb', () => {
    const workspace = getCurrentWorkspaceType()
    const key = workspace === 'tenant' ? getCurrentTenantId() : workspace
    assert.ok(fixtures.has(key), `No fake Mongo fixture for ${key}`)
    return fixtures.get(key)
  })
  const bootstrap = createMongoFixture()
  fixtures.set('default', bootstrap.db)
  await runWithTenant('default', () => store.hydrateFromMongoAfterConnect())
})

test.beforeEach(() => { process.env.MONGO_REFRESH_MODE = 'version' })
test.after(() => {
  test.mock.restoreAll()
  if (originalMode === undefined) delete process.env.MONGO_REFRESH_MODE
  else process.env.MONGO_REFRESH_MODE = originalMode
  assert.equal(mutationCount, 0, 'Hydration must not delete or write fixture collections')
})

test('cold multi-entity partial does not make missing entities current', async () => {
  const fixture = createMongoFixture()
  await fixture.partialRefresh(['users', 'orders'], { allowColdPartial: true })
  assert.deepEqual(fixture.readiness(['orders', 'users', 'orders', 'unknown']), {
    exists: true, usable: true, complete: false, coveredKeys: ['orders', 'users'], dirtyKeys: [],
  })
  assert.deepEqual(fixture.readiness(['lakalaPayments']), {
    exists: true, usable: false, complete: false, coveredKeys: [], dirtyKeys: [],
  })
  await fixture.fullRefresh()
  assert.equal(fixture.read().lakalaPayments.length, 1)
})

test('partial refresh advances only the refreshed entity versions', async () => {
  const fixture = createMongoFixture()
  await fixture.fullRefresh()
  fixture.replace('orders', [{ id: 'O-v2' }])
  fixture.setVersion(2)
  await fixture.partialRefresh(['addresses'])
  await fixture.partialRefresh(['orders'])
  assert.equal(fixture.read().orders[0].id, 'O-v2')
  assert.equal(fixture.readCount('orders'), 2)
})

test('failed full hydrate preserves the last committed snapshot', async () => {
  process.env.MONGO_REFRESH_MODE = 'every_request'
  const fixture = createMongoFixture({ orders: [{ id: 'O-old' }] })
  await fixture.fullRefresh()
  fixture.setVersion(2)
  fixture.failNextRead('users', new Error('read outage'))
  await assert.rejects(fixture.fullRefresh, /read outage/)
  assert.deepEqual(fixture.read().orders, [{ id: 'O-old' }])
})

test('concurrent identical full refreshes share one Mongo read and Promise', async () => {
  process.env.MONGO_REFRESH_MODE = 'every_request'
  const fixture = createMongoFixture()
  const gate = fixture.deferNextRead('orders')
  const first = fixture.fullRefresh()
  const second = fixture.fullRefresh()
  gate.resolve()
  await Promise.all([first, second])
  assert.equal(fixture.readCount('orders'), 1)
  assert.strictEqual(first, second)
})

test('cold full failure leaves readiness unusable and readDb fails closed', async () => {
  const fixture = createMongoFixture()
  fixture.failNextRead('users', new Error('cold outage'))
  await assert.rejects(fixture.fullRefresh, /cold outage/)
  assert.throws(fixture.read, { code: 'MONGO_SNAPSHOT_UNAVAILABLE' })
  assert.deepEqual(fixture.readiness(['users', 'orders']), {
    exists: false, usable: false, complete: false, coveredKeys: [], dirtyKeys: [],
  })
})

test('partial failure does not publish any refreshed entities', async () => {
  process.env.MONGO_REFRESH_MODE = 'every_request'
  const fixture = createMongoFixture()
  await fixture.fullRefresh()
  const previous = fixture.read()
  fixture.replace('orders', [{ id: 'O-v2' }])
  fixture.setVersion(2)
  fixture.failNextRead('users', new Error('partial outage'))
  await assert.rejects(() => fixture.partialRefresh(['orders', 'users']), /partial outage/)
  assert.strictEqual(fixture.read(), previous)
  await fixture.partialRefresh(['orders', 'users'])
  assert.equal(fixture.read().orders[0].id, 'O-v2')
})

test('metadata read failure never publishes a full or partial snapshot', async () => {
  process.env.MONGO_REFRESH_MODE = 'every_request'
  const fixture = createMongoFixture()
  await fixture.fullRefresh()
  const previous = fixture.read()
  for (const refresh of [fixture.fullRefresh, () => fixture.partialRefresh(['orders'])]) {
    fixture.replace('orders', [{ id: 'uncommitted' }])
    fixture.failNextRead(mongo.APP_META, new Error('meta outage'))
    await assert.rejects(refresh, /meta outage/)
    assert.strictEqual(fixture.read(), previous)
  }
})

test('different concurrent partial signatures serialize and merge results', async () => {
  const fixture = createMongoFixture()
  const gate = fixture.deferNextRead('orders')
  const first = fixture.partialRefresh(['orders'], { allowColdPartial: true })
  await gate.started.promise
  const second = fixture.partialRefresh(['lakalaPayments'], { allowColdPartial: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fixture.readCount('lakalaPayments'), 0)
  gate.resolve()
  await Promise.all([first, second])
  assert.equal(fixture.read().orders[0].id, 'O-v1')
  assert.equal(fixture.read().lakalaPayments[0].id, 'P-v1')
})

test('identical partial key sets share a Promise regardless of order or duplicates', async () => {
  process.env.MONGO_REFRESH_MODE = 'every_request'
  const fixture = createMongoFixture()
  const first = fixture.partialRefresh(['users', 'orders', 'users'], { allowColdPartial: true })
  const second = fixture.partialRefresh(['orders', 'users'], { allowColdPartial: true })
  await Promise.all([first, second])
  assert.equal(fixture.readCount('orders'), 1)
  assert.strictEqual(first, second)
})

test('single_instance cannot skip a key that has never been loaded', async () => {
  process.env.MONGO_REFRESH_MODE = 'single_instance'
  const fixture = createMongoFixture()
  await fixture.partialRefresh(['users', 'orders'], { allowColdPartial: true })
  await fixture.partialRefresh(['lakalaPayments'])
  assert.equal(fixture.read().lakalaPayments.length, 1)
  assert.equal(fixture.readiness(['lakalaPayments']).usable, true)
  assert.equal(fixture.readiness().complete, false)
})

test('request dedup does not suppress different keys or a later full refresh', async () => {
  const fixture = createMongoFixture()
  await store.runWithMongoRequestDedup(async () => {
    await fixture.partialRefresh(['orders'], { allowColdPartial: true })
    await fixture.partialRefresh(['lakalaPayments'])
    assert.equal(fixture.read().lakalaPayments.length, 1)
    await fixture.fullRefresh()
    assert.equal(fixture.readiness().complete, true)
  })
})

test('version refresh uses the target workspace and requested entity coverage', async () => {
  for (const workspaceType of ['tenant', 'core', 'self']) {
    const fixture = createMongoFixture({ workspaceType })
    await fixture.fullRefresh()
    await fixture.fullRefresh()
    assert.equal(fixture.readCount('orders'), 1)
    assert.equal(fixture.readiness().complete, true)
    fixture.replace('orders', [{ id: `${workspaceType}-v2` }])
    fixture.setVersion(2)
    await fixture.partialRefresh(['orders'])
    assert.equal(fixture.read().orders[0].id, `${workspaceType}-v2`)
  }
})

test('full refresh exposes the committed snapshot while a collection read is pending', async () => {
  process.env.MONGO_REFRESH_MODE = 'every_request'
  const fixture = createMongoFixture()
  await fixture.fullRefresh()
  const previous = fixture.read()
  fixture.replace('orders', [{ id: 'O-v2' }])
  const gate = fixture.deferNextRead('orders')
  const refresh = fixture.fullRefresh()
  await gate.started.promise
  try {
    assert.strictEqual(fixture.read(), previous)
    assert.equal(fixture.readiness().usable, true)
  }
  finally {
    gate.resolve()
    await refresh
  }
  assert.equal(fixture.read().orders[0].id, 'O-v2')
})

test('queued overlapping partial refresh rechecks versions before reading', async () => {
  const fixture = createMongoFixture()
  const gate = fixture.deferNextRead('orders')
  const first = fixture.partialRefresh(['users', 'orders'], { allowColdPartial: true })
  await gate.started.promise
  const second = fixture.partialRefresh(['orders'], { allowColdPartial: true })
  gate.resolve()
  await Promise.all([first, second])
  assert.equal(fixture.readCount('orders'), 1)
  assert.equal(fixture.readiness(['orders']).usable, true)
})
