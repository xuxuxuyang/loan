const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
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

async function fixture({ orders = [{ id: 'O1', status: 'old' }] } = {}) {
  const tenantId = `persist-test-${++sequence}`
  const data = new Map(mongo.SHARDED_ENTITY_KEYS.map(key => [mongo.COLLECTIONS[key], []]))
  data.set('orders', orders.map(item => ({ ...item, _id: item.id })))
  const calls = []
  let failAfter = Infinity
  let gate
  let readGate
  let disconnected = false
  let meta = { _id: 'main', updatedAt: new Date(1), meta: { fixture: tenantId } }
  async function beforeWrite() {
    if (gate) {
      const current = gate
      gate = null
      current.started.resolve()
      await current.promise
    }
    if (--failAfter === 0) throw new Error('simulated write outage')
  }
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
          await beforeWrite()
          for (const { replaceOne: op } of ops) {
            const rows = data.get(name).filter(item => item._id !== op.filter._id)
            data.set(name, [...rows, structuredClone(op.replacement)])
          }
        },
        async replaceOne(filter, replacement) {
          calls.push({ name, method: 'replaceOne', replacement: structuredClone(replacement) })
          await beforeWrite()
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
    run, calls, tenantId,
    read: () => run(() => store.readDb()),
    durable: (entityKey = 'orders') => structuredClone(data.get(mongo.COLLECTIONS[entityKey])).map(({ _id, ...item }) => item),
    snapshot: status => ({ ...structuredClone(run(() => store.readDb())), orders: [{ id: 'O1', status }] }),
    readiness: () => store.getScopeCacheReadiness('tenant', tenantId, ['orders']),
    refresh: () => store.refreshScopePartialFromMongo('tenant', tenantId, ['orders']),
    fullRefresh: () => store.refreshScopeCacheFromMongo('tenant', tenantId),
    fail: (after = 1) => { failAfter = after },
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
    await assert.rejects(first, { code: 'MONGO_PERSIST_FAILED', statusCode: 503 })
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

test('a hydrate already reading rejects if a newer pending write leaves required keys unusable', async () => {
  const f = await fixture()
  const readGate = f.blockRead()
  const refresh = f.refresh()
  await readGate.started.promise
  const writeGate = f.block()
  const job = f.run(() => store.writeDbPartial(f.snapshot('newer'), ['orders']))
  await writeGate.started.promise
  readGate.resolve()
  try {
    await assert.rejects(refresh, { code: 'MONGO_SNAPSHOT_UNAVAILABLE' })
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

function loadRequestMiddleware(name, overrides = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8')
  let body = source.match(new RegExp(`async function ${name}\\([^]*?\\n\\}`))?.[0]
  if (!body && name === 'flushMongoForRequest') {
    const start = source.indexOf('app.use(async (ctx, next) => {', source.indexOf(' * Mongo 一致性：'))
    const tail = source.slice(start + 'app.use('.length)
    body = tail.slice(0, tail.indexOf('\n})') + 2)
  }
  assert.ok(body, `${name} must exist`)
  return vm.runInNewContext(`(${body})`, {
    ...store, normalizeTenantId: value => value, normalizeWorkspaceType: value => value,
    isManagedApiPath: () => true, DEFAULT_TENANT_ID: 'default',
    shouldBlockRequestOnMongoRefreshError: require('../src/mongoRefreshGuard').shouldBlockRequestOnMongoRefreshError,
    mongoConfig: { isMongoAwaitPersistEnabled: () => false, isMongoMutationPersistFlushSkipped: () => false },
    fail: (ctx, message, status) => { ctx.status = status; ctx.body = { code: status, message } },
    console: { error() {}, warn() {} }, ...overrides,
  })
}

for (const mode of ['partial', 'full']) {
  test(`${mode} refresh blocks the handler when a write starts during hydration and later fails`, async () => {
    const f = await fixture()
    const middleware = loadRequestMiddleware('refreshMongoForRequest', {
      resolveApiMongoRefreshPlan: () => ({ mode, keys: ['orders'], requiresFresh: true }),
    })
    const ctx = { method: 'POST', path: '/api/orders', state: { tenantId: f.tenantId }, set() {} }
    let handled = false
    const readGate = f.blockRead()
    const request = f.run(() => middleware(ctx, async () => { handled = true; ctx.status = 200 }))
    await readGate.started.promise
    const writeGate = f.block()
    f.fail()
    const job = f.run(() => store.writeDbPartial(f.snapshot('unconfirmed'), ['orders']))
    await writeGate.started.promise
    readGate.resolve()
    try {
      await request
      assert.equal(ctx.status, 503)
      assert.equal(handled, false)
    }
    finally {
      writeGate.resolve()
      await assert.rejects(job, /simulated write outage/)
    }
    assert.equal(f.readiness().usable, false)
    await f.refresh()
    assert.equal(f.readiness().usable, true)
    assert.equal(f.read().orders[0].status, 'old')
  })
}

for (const failure of ['persist', 'conflict', 'side-effect-get']) {
  test(`generic middleware replaces a false success after ${failure}`, async () => {
    const f = await fixture()
    const old = f.read()
    if (failure === 'conflict') {
      await f.run(() => store.writeDbEntities(old, [{ entityKey: 'orders', item: { id: 'O1', status: 'paid' } }]))
    }
    else f.fail()
    const ctx = { method: failure === 'side-effect-get' ? 'GET' : 'POST', path: '/api/orders', state: {} }
    const middleware = loadRequestMiddleware('flushMongoForRequest')
    await f.run(() => store.runWithMongoRequestDedup(() => middleware(ctx, async () => {
      const job = store.writeDbPartial(old, ['orders'])
      if (failure === 'conflict') await job.catch(() => {})
      ctx.status = 200
      ctx.body = { code: 0, data: { saved: true } }
    })))
    assert.equal(ctx.status, 503)
    assert.equal(ctx.body.code, 503)
    assert.equal(ctx.body.data, undefined)
    assert.equal(f.readiness().usable, false)
  })
}

test('explicit optional exact metadata failure stays observable without failing the response flush', async () => {
  const f = await fixture()
  await f.run(() => store.runWithMongoRequestDedup(async () => {
    f.fail()
    await assert.rejects(store.writeDbEntities(f.read(), [
      { entityKey: 'orders', item: { id: 'O1', status: 'optional' } },
    ], { requiredForResponse: false }), /simulated write outage/)
    await assert.doesNotReject(store.flushMongoPersist())
    assert.equal(f.readiness().usable, false)
    f.fail()
    await assert.rejects(store.writeDbEntities(f.read(), [
      { entityKey: 'orders', item: { id: 'O1', status: 'required' } },
    ]), /simulated write outage/)
    await assert.rejects(store.flushMongoPersist(), /simulated write outage/)
  }))
})

for (const laterKind of ['different-target', 'same-target', 'collection-snapshot']) {
  test(`exact publication respects ${laterKind} overlap including single_instance refresh`, async () => {
    const f = await fixture({ orders: [{ id: 'O1', status: 'old' }, { id: 'O2', status: 'old' }] })
    await f.run(async () => {
      const gate = f.block()
      const exact = store.writeDbEntities(f.read(), [{ entityKey: 'orders', item: { id: 'O1', status: 'exact' } }])
      await gate.started.promise
      const laterDb = structuredClone(f.read())
      const target = laterDb.orders[laterKind === 'same-target' ? 0 : 1]
      target.status = 'later'
      const later = laterKind === 'collection-snapshot'
        ? store.writeDbPartial(laterDb, ['orders'])
        : store.writeDbEntity(laterDb, 'orders', target)
      gate.resolve()
      const outcomes = await Promise.allSettled([exact, later])
      assert.equal(outcomes[0].status, 'fulfilled')
      assert.equal(outcomes[1].status, laterKind === 'different-target' ? 'fulfilled' : 'rejected')
      if (laterKind !== 'different-target') assert.equal(outcomes[1].reason.code, 'MONGO_WRITE_CONFLICT')
      const expected = [
        { id: 'O1', status: 'exact' },
        { id: 'O2', status: laterKind === 'different-target' ? 'later' : 'old' },
      ]
      const byId = rows => [...rows].sort((a, b) => a.id.localeCompare(b.id))
      assert.deepEqual(byId(f.durable()), expected)
      assert.deepEqual(byId(f.read().orders), expected)
      assert.equal(f.readiness().usable, laterKind === 'different-target')
      process.env.MONGO_REFRESH_MODE = 'single_instance'
      try { await f.refresh() }
      finally { process.env.MONGO_REFRESH_MODE = 'every_request' }
      assert.deepEqual(byId(f.read().orders), expected)
      assert.deepEqual(f.readiness().dirtyKeys, [])
    })
  })
}

for (const sourceKind of ['original', 'unknown-clone']) {
  test(`late ${sourceKind} collection snapshot cannot revert a confirmed exact payment`, async () => {
    const f = await fixture({ orders: [{ id: 'O1', paid: false }, { id: 'O2', paid: false }] })
    await f.run(async () => {
      const old = sourceKind === 'original' ? f.read() : structuredClone(f.read())
      await store.writeDbEntities(f.read(), [
        { entityKey: 'orders', item: { id: 'O1', paid: true } },
        { entityKey: 'lakalaPayments', item: { outTradeNo: 'LP1', status: 'success' } },
      ])
      old.orders.find(item => item.id === 'O2').note = 'unrelated request completed'
      const before = f.calls.length
      await assert.rejects(store.writeDbPartial(old, ['orders']), { code: 'MONGO_WRITE_CONFLICT', statusCode: 503 })
      assert.equal(f.calls.length, before, 'conflict must reject before any Mongo operation')
      assert.equal(f.durable().find(item => item.id === 'O1').paid, true)
      assert.equal(f.durable('lakalaPayments')[0].status, 'success')
      assert.equal(f.read().orders.find(item => item.id === 'O1').paid, true)
      assert.equal(f.readiness().usable, false)
      await assert.rejects(store.flushMongoPersist(), { code: 'MONGO_WRITE_CONFLICT' })
    })
  })
}

test('a legacy snapshot queued before an exact write remains valid in FIFO order', async () => {
  const f = await fixture({ orders: [{ id: 'O1', paid: false }, { id: 'O2', paid: false }] })
  await f.run(async () => {
    const gate = f.block()
    const db = f.read()
    db.orders[1].note = 'legacy first'
    const legacy = store.writeDbPartial(db, ['orders'])
    await gate.started.promise
    const exact = store.writeDbEntities(f.read(), [{ entityKey: 'orders', item: { id: 'O1', paid: true } }])
    gate.resolve()
    await Promise.all([legacy, exact])
    assert.equal(f.durable().find(item => item.id === 'O1').paid, true)
    assert.equal(f.durable().find(item => item.id === 'O2').note, 'legacy first')
    assert.equal(f.readiness().usable, true)
  })
})

for (const writeKind of ['partial-other-collection', 'single-other-target']) {
  test(`a stale ${writeKind} only publishes its own changes to memory`, async () => {
    const f = await fixture({ orders: [{ id: 'O1', paid: false }, { id: 'O2', paid: false }] })
    await f.run(async () => {
      const old = f.read()
      await store.writeDbEntities(f.read(), [{ entityKey: 'orders', item: { id: 'O1', paid: true } }])
      if (writeKind === 'partial-other-collection') {
        old.users.push({ id: 'U1' })
        await store.writeDbPartial(old, ['users'])
      }
      else {
        old.orders[1].note = 'unrelated single update'
        await store.writeDbEntity(old, 'orders', old.orders[1])
      }
      assert.equal(f.read().orders.find(item => item.id === 'O1').paid, true)
      assert.equal(f.durable().find(item => item.id === 'O1').paid, true)
      assert.equal(f.readiness().usable, true)
    })
  })
}

test('a freshly read legacy update after exact confirmation is permitted', async () => {
  const f = await fixture()
  await f.run(async () => {
    await store.writeDbEntities(f.read(), [{ entityKey: 'orders', item: { id: 'O1', status: 'paid' } }])
    const fresh = f.read()
    fresh.orders[0].note = 'audited after payment'
    await store.writeDbPartial(fresh, ['orders'])
    assert.equal(f.durable()[0].status, 'paid')
    assert.equal(f.durable()[0].note, 'audited after payment')
  })
})

test('an untracked single write cannot hide a conflicting item behind a current database clone', async () => {
  const f = await fixture()
  await f.run(async () => {
    await store.writeDbEntities(f.read(), [{ entityKey: 'orders', item: { id: 'O1', status: 'paid' } }])
    const clone = structuredClone(f.read())
    await assert.rejects(store.writeDbEntity(clone, 'orders', { id: 'O1', status: 'old' }), { code: 'MONGO_WRITE_CONFLICT' })
    assert.equal(f.durable()[0].status, 'paid')
  })
})

test('single writes track the actual committed item for subsequent untracked snapshots', async () => {
  const f = await fixture()
  await f.run(async () => {
    await store.writeDbEntities(f.read(), [{ entityKey: 'orders', item: { id: 'O1', status: 'paid' } }])
    await store.writeDbEntity(f.read(), 'orders', { id: 'O1', status: 'paid', note: 'confirmed' })
    const clone = structuredClone(f.read())
    delete clone.orders[0].note
    await assert.rejects(store.writeDbPartial(clone, ['orders']), { code: 'MONGO_WRITE_CONFLICT' })
    assert.equal(f.durable()[0].note, 'confirmed')
  })
})

test('snapshot provenance never crosses tenant scopes', async () => {
  const first = await fixture()
  const second = await fixture()
  await second.run(async () => {
    await assert.rejects(store.writeDbPartial(first.read(), ['orders']), { code: 'MONGO_WRITE_CONFLICT' })
    assert.equal(second.calls.length, 0)
    assert.equal(first.readiness().usable, true)
    assert.equal(second.readiness().usable, false)
  })
})

test('identical exact retry recovers its target without hydration', async () => {
  const f = await fixture()
  await f.run(async () => {
    const entries = [{ entityKey: 'orders', item: { id: 'O1', status: 'retried' } }]
    f.fail()
    await assert.rejects(store.writeDbEntities(f.read(), entries), /simulated write outage/)
    assert.deepEqual(f.readiness().dirtyKeys, ['orders'])
    await store.writeDbEntities(f.read(), entries)
    assert.deepEqual(f.read().orders, entries.map(entry => entry.item))
    assert.deepEqual(f.durable(), f.read().orders)
    assert.deepEqual(f.readiness().dirtyKeys, [])
    assert.equal(f.readiness().usable, true)
  })
})

test('exact recovery clears only confirmed typed targets and retains any other target failure', async () => {
  const f = await fixture({ orders: [{ id: 1, status: 'old' }, { id: '1', status: 'old' }] })
  await f.run(async () => {
    const entries = [1, '1'].map(id => ({ entityKey: 'orders', item: { id, status: 'retried' } }))
    for (const entry of entries) {
      f.fail()
      await assert.rejects(store.writeDbEntities(f.read(), [entry]), /simulated write outage/)
    }
    await store.writeDbEntities(f.read(), [entries[0]])
    assert.deepEqual(f.readiness().dirtyKeys, ['orders'])
    assert.equal(f.readiness().usable, false)
    await store.writeDbEntities(f.read(), [entries[1]])
    assert.deepEqual(f.readiness().dirtyKeys, [])
    assert.equal(f.readiness().usable, true)
    assert.deepEqual(f.durable(), entries.map(entry => entry.item))
  })
})

test('a partially durable exact batch recovers after the whole target batch retries', async () => {
  const f = await fixture({ orders: [{ id: 'O1', status: 'old' }, { id: 'O2', status: 'old' }] })
  await f.run(async () => {
    const entries = ['O1', 'O2'].map(id => ({ entityKey: 'orders', item: { id, status: 'retried' } }))
    const previous = f.read()
    f.fail(2)
    await assert.rejects(store.writeDbEntities(previous, entries), /simulated write outage/)
    assert.equal(f.durable().find(item => item.id === 'O1').status, 'retried')
    assert.strictEqual(f.read(), previous)
    assert.deepEqual(f.readiness().dirtyKeys, ['orders'])
    await store.writeDbEntities(previous, entries)
    assert.deepEqual(f.read().orders, entries.map(entry => entry.item))
    assert.deepEqual(f.durable(), f.read().orders)
    assert.deepEqual(f.readiness().dirtyKeys, [])
    assert.equal(f.readiness().usable, true)
  })
})

test('collection recovery requires hydration after an exact failure and single success cannot clear collection failure', async () => {
  for (const failureKind of ['exact', 'collection']) {
    const f = await fixture()
    await f.run(async () => {
      f.fail()
      const failed = failureKind === 'exact'
        ? store.writeDbEntities(f.read(), [{ entityKey: 'orders', item: { id: 'O1', status: 'failed' } }])
        : store.writeDbPartial(f.snapshot('failed'), ['orders'])
      await assert.rejects(failed, /simulated write outage/)
      if (failureKind === 'exact') {
        await assert.rejects(store.writeDbPartial(f.snapshot('recovered'), ['orders']), { code: 'MONGO_WRITE_CONFLICT' })
        await f.refresh()
      }
      if (failureKind === 'collection') {
        const single = f.snapshot('single')
        await store.writeDbEntity(single, 'orders', single.orders[0])
        assert.deepEqual(f.readiness().dirtyKeys, ['orders'])
      }
      const recovered = f.read()
      recovered.orders[0].status = 'recovered'
      await store.writeDbPartial(recovered, ['orders'])
      assert.deepEqual(f.readiness().dirtyKeys, [])
      assert.equal(f.readiness().usable, true)
      assert.deepEqual(f.read().orders, f.durable())
    })
  }
})

test('request flush includes jobs appended while waiting and settles all before rejecting', async () => {
  const f = await fixture()
  await f.run(() => store.runWithMongoRequestDedup(async () => {
    const firstGate = f.block()
    store.writeDbPartial(f.snapshot('first'), ['orders'])
    await firstGate.started.promise
    let settled = false
    const flush = store.flushMongoPersist().then(() => { settled = true }, error => { settled = true; return error })
    const secondGate = f.block()
    store.writeDbPartial(f.snapshot('second'), ['orders'])
    f.fail()
    firstGate.resolve()
    await secondGate.started.promise
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(settled, false)
    secondGate.resolve()
    assert.match((await flush).message, /simulated write outage/)
    assert.equal(f.durable()[0].status, 'second')
  }))
})

test('simultaneous request scopes wait only for their own gated jobs and failures', async () => {
  const first = await fixture()
  const second = await fixture()
  const firstGate = first.block()
  const secondGate = second.block()
  first.fail()
  const failedRequest = first.run(() => store.runWithMongoRequestDedup(async () => {
    store.writeDbPartial(first.snapshot('failed'), ['orders'])
    return store.flushMongoPersist().catch(error => error)
  }))
  let secondSettled = false
  const goodRequest = second.run(() => store.runWithMongoRequestDedup(async () => {
    store.writeDbPartial(second.snapshot('success'), ['orders'])
    await store.flushMongoPersist()
    secondSettled = true
  }))
  await Promise.all([firstGate.started.promise, secondGate.started.promise])
  firstGate.resolve()
  assert.match((await failedRequest).message, /simulated write outage/)
  assert.equal(secondSettled, false)
  secondGate.resolve()
  await goodRequest
  assert.equal(secondSettled, true)
  assert.equal(second.durable()[0].status, 'success')
})
