# API Mongo 读取一致性、性能与支付落库安全修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 Mongo 刷新导致的接口卡顿和 HTTP 200 空数据，并确保支付成功只有在订单与支付流水真实落库后才对外确认。

**Architecture:** 保留现有内存快照架构，但将 scope 级单版本改为按实体集合跟踪版本和可用性；刷新先构造候选快照再原子发布，相同刷新共享进行中 Promise。持久化队列向当前调用方传播真实错误，支付改用精确实体 upsert 和可重试结算，不扫描、删除或批量改写历史线上数据。

**Tech Stack:** Node.js CommonJS、Koa、MongoDB Node Driver、AsyncLocalStorage、Node test runner、Vue 3/Vite 构建验证。

## Global Constraints

- 不连接、不迁移、不补写、不清理、不重置任何线上 Mongo 数据。
- 不新增需要历史数据迁移的集合、字段或索引；可选兼容字段只随新支付流水自然写入。
- 支付只精确 upsert 当前流水和本次实际变化的订单，不对 `orders` 或 `lakalaPayments` 做集合删除。
- 正常成功响应结构、金额计算、订单归属、分期规则和后台鉴权安全语义保持不变。
- 本期不修改 `2.shop` 和 `3.admin` 前端源文件。
- 所有新测试使用内存 fake Mongo 和依赖注入，不访问生产网络或数据库。
- 每次修改后从项目根运行 `node scripts/check-mojibake.js .`；最终还要运行 API 全量测试和两个前端构建。

---

### Task 1: 按集合跟踪快照版本并原子刷新

**Files:**
- Modify: `1.api/src/store.js`
- Modify: `1.api/src/mongoConfig.js`
- Create: `1.api/tests/storeMongoRefresh.test.js`
- Create: `1.api/tests/mongoConfig.test.js`

**Interfaces:**
- Produces: `getScopeCacheReadiness(workspaceType, tenantId, entityKeys)`，返回 `{ exists, usable, complete, coveredKeys, dirtyKeys }`。
- Produces: `refreshScopeCacheFromMongo()` 与 `refreshScopePartialFromMongo()` 按本次所需集合版本判断是否跳过。
- Preserves: `readDb()`、`writeDb*()` 现有调用方式，持久化 Promise 语义在 Task 3 完成。

- [ ] **Step 1: 写入缓存一致性的失败测试**

在 `storeMongoRefresh.test.js` 使用唯一 tenant 和 fake Mongo，先调用 `hydrateFromMongoAfterConnect()` 启用 Mongo 模式。至少加入：

```js
test('cold multi-entity partial does not make missing entities current', async () => {
  await store.refreshScopePartialFromMongo('tenant', tenantId, ['users', 'orders'], { allowColdPartial: true })
  await store.refreshScopeCacheFromMongo('tenant', tenantId)
  const refreshed = await runWithTenant(tenantId, () => store.readDb())
  assert.equal(refreshed.lakalaPayments.length, 1)
})

test('partial refresh advances only the refreshed entity versions', async () => {
  const fixture = await createMongoFixture({ tenantId, version: 1 })
  await fixture.fullRefresh()
  fixture.replace('orders', [{ id: 'O-v2' }])
  fixture.setVersion(2)
  await fixture.partialRefresh(['addresses'])
  await fixture.partialRefresh(['orders'])
  assert.equal(fixture.read().orders[0].id, 'O-v2')
  assert.equal(fixture.readCount('orders'), 2)
})

test('failed full hydrate preserves the last committed snapshot', async () => {
  const fixture = await createMongoFixture({ tenantId, orders: [{ id: 'O-old' }] })
  await fixture.fullRefresh()
  fixture.setVersion(2)
  fixture.failNextRead('users', new Error('read outage'))
  await assert.rejects(() => fixture.fullRefresh(), /read outage/)
  assert.deepEqual(fixture.read().orders, [{ id: 'O-old' }])
})

test('concurrent identical full refreshes share one Mongo read', async () => {
  const fixture = await createMongoFixture({ tenantId })
  const gate = fixture.deferNextRead('orders')
  const first = fixture.fullRefresh()
  const second = fixture.fullRefresh()
  gate.resolve()
  await Promise.all([first, second])
  assert.equal(fixture.readCount('orders'), 1)
})
```

补充用例：cold full 失败时 readiness 不可用；partial 失败不发布半成品；不同 partial 串行后结果合并；`single_instance` 不得跳过从未加载的 key。

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```powershell
cd C:\Users\xu\Desktop\loan\1.api
node --test tests/storeMongoRefresh.test.js tests/mongoConfig.test.js
```

Expected: FAIL，分别暴露 cold partial 误判完整、全局版本污染、失败删除旧快照、并发重复读取和缺省刷新模式为空。

- [ ] **Step 3: 实现按集合覆盖和原子发布**

在 `store.js` 用以下状态替换 `mongoScopeHydrateIncomplete`：

```js
const ALL_ENTITY_KEYS = ENTITY_SPECS.map(spec => spec.key)
const mongoScopeEntityVersionByKey = new Map()
const mongoScopeDirtyEntityKeysByKey = new Map()

function getScopeCacheReadiness(workspaceType, tenantId, entityKeys = ALL_ENTITY_KEYS) {
  const cacheKey = buildScopeKey(workspaceType, tenantId)
  const versions = mongoScopeEntityVersionByKey.get(cacheKey) || new Map()
  const dirty = mongoScopeDirtyEntityKeysByKey.get(cacheKey) || new Set()
  const keys = [...new Set(entityKeys.filter(key => ALL_ENTITY_KEYS.includes(key)))]
  const coveredKeys = keys.filter(key => versions.has(key) && !dirty.has(key))
  return {
    exists: mongoMemoryDbByTenant.has(cacheKey),
    usable: mongoMemoryDbByTenant.has(cacheKey) && coveredKeys.length === keys.length,
    complete: ALL_ENTITY_KEYS.every(key => versions.has(key) && !dirty.has(key)),
    coveredKeys,
    dirtyKeys: keys.filter(key => dirty.has(key)),
  }
}
```

full/partial hydrate 都先读取集合和 `app_meta.updatedAt`，构造 `nextDb`，全部成功后才 set 内存和对应 key 的版本。删除 full hydrate 前的 `mongoMemoryDbByTenant.delete(cacheKey)`。同 scope、相同 sorted keys 签名复用一个 in-flight Promise；不同签名沿 scope tail 串行，并在真正执行前重新检查版本。

Mongo 模式下若当前 scope 没有成功发布的快照，`readDb()` 抛出带 `code='MONGO_SNAPSHOT_UNAVAILABLE'` 的错误；只有未启用 Mongo 的 JSON fallback 模式才允许构造文件种子数据。

- [ ] **Step 4: 修正刷新模式缺省值**

在 `mongoConfig.js` 将缺失或非法 `MONGO_REFRESH_MODE` 明确回退：

```js
function getMongoRefreshMode() {
  const raw = readEnv('MONGO_REFRESH_MODE').toLowerCase()
  return ['version', 'every_request', 'single_instance'].includes(raw) ? raw : 'version'
}
```

- [ ] **Step 5: 运行局部测试并确认 GREEN**

Run: `cd C:\Users\xu\Desktop\loan\1.api; node --test tests/storeMongoRefresh.test.js tests/mongoConfig.test.js`

Expected: 全部 PASS，且 fake Mongo 断言无集合删除、无重复 full 读取。

- [ ] **Step 6: 运行乱码检查并提交**

```powershell
cd C:\Users\xu\Desktop\loan
node scripts/check-mojibake.js .
git add 1.api/src/store.js 1.api/src/mongoConfig.js 1.api/tests/storeMongoRefresh.test.js 1.api/tests/mongoConfig.test.js
git commit -m "fix: make Mongo refresh snapshots consistent"
```

---

### Task 2: 路由刷新计划、失败降级和直连查询保护

**Files:**
- Create: `1.api/src/apiMongoRefreshPlan.js`
- Modify: `1.api/src/mongoRefreshGuard.js`
- Modify: `1.api/src/adminMongoReadOptimize.js`
- Modify: `1.api/src/index.js`
- Modify: `1.api/tests/mongoRefreshGuard.test.js`
- Create: `1.api/tests/apiMongoRefreshPlan.test.js`
- Modify: `1.api/tests/adminMongoReadOptimize.test.js`

**Interfaces:**
- Produces: `resolveCoreApiMongoRefreshPlan({ method, path, query, optimizeEnabled, safeOrderFilter })`。
- Every plan: `{ mode: 'skip'|'partial'|'full', keys: string[], allowColdPartial?: boolean, requiresFresh: boolean }`。
- Produces: `shouldBlockRequestOnMongoRefreshError(method, { requiresFresh, hasUsableSnapshot })`，参数缺失时 fail closed。
- Produces: `MongoDirectReadError`，直连 Mongo 查询异常时携带 `code='MONGO_DIRECT_READ_FAILED'` 和 `statusCode=503`。

- [ ] **Step 1: 写路由表和刷新失败策略的 RED 测试**

`apiMongoRefreshPlan.test.js` 使用表驱动断言：

```js
const cases = [
  ['GET', '/api/payment/lakala/config', {}, 'skip', [], false],
  ['GET', '/api/admin/orders/repayment-records', {}, 'partial',
    ['lakalaPayments', 'users', 'orders', 'trafficChannels'], false],
  ['POST', '/api/payment/lakala/preorder', {}, 'partial',
    ['products', 'users', 'orders', 'lakalaPayments'], true],
  ['POST', '/api/payment/lakala/notify', {}, 'partial',
    ['users', 'orders', 'lakalaPayments'], true],
  ['GET', '/api/payment/lakala/status/LP1', {}, 'partial',
    ['users', 'orders', 'lakalaPayments'], true],
  ['GET', '/api/card-packages/O1/contract-flow', {}, 'partial',
    ['users', 'orders'], true],
  ['GET', '/api/mall/cs/session', {}, 'partial',
    ['users', 'csSessions'], true],
]
```

另断言 `/api/my/orders` 和普通 `/api/orders` 包含 `trafficChannels`，未知 POST 保持 full + requiresFresh，`GET /api/orders?listScope=card-data` requiresFresh。

`mongoRefreshGuard.test.js` 改为：

```js
assert.equal(shouldBlockRequestOnMongoRefreshError('GET', {
  requiresFresh: false,
  hasUsableSnapshot: true,
}), false)
assert.equal(shouldBlockRequestOnMongoRefreshError('GET', {
  requiresFresh: false,
  hasUsableSnapshot: false,
}), true)
assert.equal(shouldBlockRequestOnMongoRefreshError('GET', {
  requiresFresh: true,
  hasUsableSnapshot: true,
}), true)
```

- [ ] **Step 2: 写直连查询异常不能返回 null 的 RED 测试**

在 `adminMongoReadOptimize.test.js` 让 `countDocuments()` 或 `toArray()` reject，断言：

```js
await assert.rejects(
  () => opt.readAdminOrdersPageFromMongoScoped(getCollection, {}, 1, 20),
  { code: 'MONGO_DIRECT_READ_FAILED', statusCode: 503 },
)
```

同样覆盖 sidebar counts 和 users page；“复杂筛选不适用优化”仍返回 `null`。

- [ ] **Step 3: 运行测试并确认 RED**

Run: `cd C:\Users\xu\Desktop\loan\1.api; node --test tests/apiMongoRefreshPlan.test.js tests/mongoRefreshGuard.test.js tests/adminMongoReadOptimize.test.js`

Expected: FAIL，因为纯路由模块和错误类型尚不存在，GET 无快照仍被放行，直连查询仍吞异常。

- [ ] **Step 4: 实现纯路由计划模块**

把通用 API 路由表从 `index.js` 提取到 `apiMongoRefreshPlan.js`。规则顺序固定：

```js
if (isIndependentSkip(method, path)) return plan('skip', [], false)
if (isLakalaPath(method, path)) return lakalaPlan(method, path)
if (isSideEffectGet(method, path, query)) return sideEffectPlan(path)
if (method !== 'GET') return plan('full', ALL_ENTITY_KEYS, true)
if (!optimizeEnabled) return plan('full', ALL_ENTITY_KEYS, false)
return matchedReadPlan || plan('full', ALL_ENTITY_KEYS, false)
```

保留多点点、浙银和 half-flow gateway 各自 resolver 的优先级；它们返回后统一补全 `keys` 与 `requiresFresh`，非 GET 默认 strict。

- [ ] **Step 5: 在刷新中间件实施 fail-closed 降级**

计划在 try 外计算。catch 中按 `getScopeCacheReadiness(..., plan.keys)` 决策：

```js
const readiness = getScopeCacheReadiness(workspaceType, tenantId, plan.keys)
const blocked = shouldBlockRequestOnMongoRefreshError(ctx.method, {
  requiresFresh: plan.requiresFresh,
  hasUsableSnapshot: readiness.usable,
})
if (blocked) {
  fail(ctx, '数据库读取暂时不可用，请稍后重试', 503)
  return
}
ctx.set('X-Data-Stale', '1')
console.warn('[mongo] refresh failed; serving last durable snapshot', safeFields)
```

依赖 Task 1 的 `readDb()` fail-closed 保护，确保中间件或 direct helper 即使遗漏分支也不能生成 HTTP 200 空 seed。

- [ ] **Step 6: 让 direct Mongo 错误明确失败**

`adminMongoReadOptimize.js` 只在筛选不支持或 collection 不可用时返回 `null`；实际 query reject 时抛 `MongoDirectReadError`。在 `index.js` 的产品、账号、订单和侧栏直查 helper 应用同一规则，并在 routes 前安装错误边界，将该错误转成标准 503。直查失败不读取空 seed。

- [ ] **Step 7: 运行局部测试和原有优化测试**

Run:

```powershell
cd C:\Users\xu\Desktop\loan\1.api
node --test tests/apiMongoRefreshPlan.test.js tests/mongoRefreshGuard.test.js tests/adminMongoReadOptimize.test.js tests/zheyinTrafficGateway.test.js tests/duodiandianGateway.test.js
```

Expected: 全部 PASS。

- [ ] **Step 8: 运行乱码检查并提交**

```powershell
cd C:\Users\xu\Desktop\loan
node scripts/check-mojibake.js .
git add 1.api/src/apiMongoRefreshPlan.js 1.api/src/mongoRefreshGuard.js 1.api/src/adminMongoReadOptimize.js 1.api/src/index.js 1.api/tests/apiMongoRefreshPlan.test.js 1.api/tests/mongoRefreshGuard.test.js 1.api/tests/adminMongoReadOptimize.test.js
git commit -m "fix: fail safely on Mongo refresh errors"
```

---

### Task 3: 传播持久化错误并提供精确实体批量写

**Files:**
- Modify: `1.api/src/store.js`
- Create: `1.api/tests/storePersistQueue.test.js`
- Modify: `1.api/tests/storeSingleEntityPersist.test.js`

**Interfaces:**
- `writeDb()`、`writeDbPartial()`、`writeDbEntity()` 返回当前调度 job 的 Promise。
- Produces: `writeDbEntities(db, entries)`，其中 `entries` 为 `Array<{ entityKey: string, item: object }>`。
- `flushMongoPersist()` 在 HTTP request context 内等待该请求调度的全部 jobs，并传播任一失败。
- Produces: `waitForMongoPersistBeforeRefresh(scopeKey)`，refresh 读取 Mongo 前等待同 scope tail settle。

- [ ] **Step 1: 写队列错误传播的 RED 测试**

`storePersistQueue.test.js` 用 fake collection 第一次 reject、第二次 resolve，断言：

```js
test('the scheduled persist job rejects but the next job still runs', async () => {
  const first = store.writeDbPartial(firstDb, ['orders'])
  await assert.rejects(first, /simulated write outage/)
  const second = store.writeDbPartial(secondDb, ['orders'])
  await assert.doesNotReject(second)
  assert.equal(secondWasPersisted, true)
})

test('flush observes failures scheduled by the current request', async () => {
  await assert.rejects(
    () => store.runWithMongoRequestDedup(async () => {
      store.writeDbPartial(db, ['orders'])
      await store.flushMongoPersist()
    }),
    /simulated write outage/,
  )
})
```

补充用例：`mongoBacked=true` 但 `getMongoDb()==null` 必须 reject；失败 key 被标 dirty，不能作为 readiness fallback。

- [ ] **Step 2: 写精确实体写入的 RED 测试**

在 `storeSingleEntityPersist.test.js` 添加：

```js
test('writeDbEntities upserts only deduplicated target documents', async () => {
  await store.writeDbEntities(snapshot, [
    { entityKey: 'orders', item: { id: 'O1', paid: true } },
    { entityKey: 'orders', item: { id: 'O1', paid: true, status: 'done' } },
    { entityKey: 'lakalaPayments', item: { outTradeNo: 'LP1', status: 'success' } },
  ])
  assert.equal(calls.filter(call => call.collection === 'orders').length, 1)
  assert.equal(calls.filter(call => call.collection === 'lakalaPayments').length, 1)
  assert.equal(calls.filter(call => call.collection === 'app_meta').length, 1)
  assert.equal(calls.some(call => ['find', 'deleteMany', 'bulkWrite'].includes(call.method)), false)
})
```

再让第二个 `replaceOne` reject，断言内存仍是调用前实体且返回 Promise reject。

- [ ] **Step 3: 运行测试并确认 RED**

Run: `cd C:\Users\xu\Desktop\loan\1.api; node --test tests/storePersistQueue.test.js tests/storeSingleEntityPersist.test.js`

Expected: FAIL，证明当前任务错误被吞、write 方法不返回 Promise、精确批量 API 不存在。

- [ ] **Step 4: 重写队列为“结果 Promise + 可恢复 tail”**

实现 `scheduleMongoPersistJob(scopeKey, entityKeys, job, options = {})`：

```js
const markDirty = options.markDirty !== false
if (markDirty) markScopeEntitiesDirty(scopeKey, entityKeys)
const previousTail = persistTailByTenant.get(scopeKey) || Promise.resolve()
const result = previousTail.catch(() => undefined).then(() => job())
const continuation = result.then(
  value => {
    if (markDirty) {
      markScopeEntitiesPersisted(scopeKey, entityKeys, value && value.updatedAtMs)
    }
  },
  err => {
    console.error('[store] MongoDB 分集合持久化失败:', err?.message || err)
  },
)
persistTailByTenant.set(scopeKey, continuation)
registerRequestPersistJob(result)
return result
```

`runWithMongoRequestDedup` 的 context 同时保存 refresh dedup set 和 `persistJobs`；`flushMongoPersist()` 优先等待当前 request 的 `Promise.all(persistJobs)`。没有 HTTP context 的脚本等待当前 scope 最近 job。Mongo 模式下 `getMongoDb()==null` 必须 throw。

- [ ] **Step 5: 实现精确批量 upsert 并成功后发布内存**

```js
async function persistEntityItems(dbm, entries, snapshot, updatedAt = new Date()) {
  const unique = dedupeEntityEntries(entries)
  for (const { entityKey, item } of unique) {
    await persistEntityItemDocument(dbm, entityKey, item)
  }
  await persistAppMeta(dbm, snapshot, updatedAt)
  return { updatedAtMs: updatedAt.getTime(), entries: unique }
}

function writeDbEntities(db, entries) {
  const scope = getScopeState()
  const captured = cloneEntityEntries(entries)
  return scheduleMongoPersistJob(scope.key, captured.map(x => x.entityKey), async () => {
    const dbm = requireConnectedMongoDb()
    const result = await persistEntityItems(dbm, captured, { _meta: db && db._meta })
    publishEntityEntriesToMemory(scope.key, captured, db && db._meta)
    return result
  }, { markDirty: false })
}
```

精确批量路径不预先替换内存、不执行集合扫描或删除。普通 snapshot 写保持兼容，但调度时捕获不可变 snapshot，不再在 job 执行时读取 `latest`。

- [ ] **Step 6: refresh 与持久化队列对齐**

refresh 在查询 Mongo 前等待 scope continuation settle；失败结果把相关 keys 留在 dirty 状态，随后仍尝试从 Mongo 加载 durable 状态。对应实体成功 hydrate 后清除 dirty。

- [ ] **Step 7: 运行局部测试并确认 GREEN**

```powershell
cd C:\Users\xu\Desktop\loan\1.api
node --test tests/storePersistQueue.test.js tests/storeSingleEntityPersist.test.js tests/storeMongoRefresh.test.js
```

Expected: 全部 PASS；控制台没有未处理 Promise rejection。

- [ ] **Step 8: 运行乱码检查并提交**

```powershell
cd C:\Users\xu\Desktop\loan
node scripts/check-mojibake.js .
git add 1.api/src/store.js 1.api/tests/storePersistQueue.test.js 1.api/tests/storeSingleEntityPersist.test.js
git commit -m "fix: propagate Mongo persistence failures"
```

---

### Task 4: 让拉卡拉结算可持久化确认、幂等重试

**Files:**
- Modify: `1.api/src/payment/lakalaPaymentService.js`
- Modify: `1.api/src/payment/registerLakalaRoutes.js`
- Modify: `1.api/src/index.js`
- Create: `1.api/tests/lakalaPaymentConsistency.test.js`

**Interfaces:**
- Consumes: Task 3 的 `writeDbEntities(db, entries)`。
- Produces: 三个 `applyBill*InDb` 函数返回本次实际变化的订单数组。
- 新支付流水可带 `settlementTargets: Array<{ orderId: string, period: number }>`；历史流水不迁移。
- 同一 `outTradeNo` 的并发结算共享内部 in-flight Promise。

- [ ] **Step 1: 写支付顺序和未知单的 RED 测试**

```js
test('business validation failure leaves payment pending and does not persist', async () => {
  const fixture = createFixture({ orderId: 'missing' })
  await assert.rejects(() => fixture.notify(), /关联订单不存在/)
  assert.equal(fixture.payment().status, 'pending')
  assert.equal(fixture.persistCalls.length, 0)
})

test('unknown payment notification rejects instead of acknowledging success', async () => {
  const fixture = createFixture({ payments: [] })
  await assert.rejects(() => fixture.notify('LP-missing'), /未知支付单/)
})
```

- [ ] **Step 2: 写持久化失败、重试和并发的 RED 测试**

```js
test('persist failure rejects notify and a later notify can settle', async () => {
  const fixture = createFixture({ persistOutcomes: ['reject', 'resolve'] })
  await assert.rejects(() => fixture.notify(), /write outage/)
  await assert.doesNotReject(() => fixture.notify())
  assert.equal(fixture.durablePayment().status, 'success')
  assert.equal(fixture.durableOrder().installmentPlan[0].paid, true)
})

test('concurrent duplicate notifications share one failed settlement', async () => {
  const fixture = createDeferredPersistFixture()
  const first = fixture.notify()
  const second = fixture.notify()
  fixture.rejectPersist(new Error('write outage'))
  await assert.rejects(first, /write outage/)
  await assert.rejects(second, /write outage/)
  assert.equal(fixture.persistCalls.length, 1)
})
```

补充测试：pending 流水持久化失败时不调用拉卡拉；支付状态同步写失败时不返回 success；四种 bizType 重复通知幂等；协商还款已应用状态可重试；一键还款只处理创建时保存的 targets；渠道补全失败不推翻核心结算。

- [ ] **Step 3: 运行支付测试并确认 RED**

Run: `cd C:\Users\xu\Desktop\loan\1.api; node --test tests/lakalaPaymentConsistency.test.js`

Expected: FAIL，暴露 success 提前设置、未知单 ACK、持久化错误不可见和重复通知竞态。

- [ ] **Step 4: 先持久化本地 pending 再创建外部支付单**

`createMallPayment()` 先构造记录并通过 `writeDbEntities` 精确持久化；成功后才调用 `createCounterOrder`，再精确更新返回的交易号和收银台地址。任一持久化失败均向上抛，不返回收银台地址。新的一键还款记录保存计算金额时对应的固定 `settlementTargets`。

- [ ] **Step 5: 重排结算并返回 touched orders**

三个账单应用函数和整单支付分支先完成目标校验，再幂等更新 working copy，并返回本次涉及的订单。之后才设置：

```js
record.tradeState = tradeState || record.tradeState || 'SUCCESS'
record.status = 'success'
record.paidAt = record.paidAt || new Date().toISOString()
```

随后只提交：

```js
await deps.writeDbEntities(workingDb, [
  ...touchedOrders.map(item => ({ entityKey: 'orders', item })),
  { entityKey: 'lakalaPayments', item: record },
])
```

即使记录已为 success，重复通知也要对相同精确实体执行安全 upsert 并等待结果后才能 ACK。

- [ ] **Step 6: 合并同一流水的并发结算**

```js
const settlementInflight = new Map()

function runSettlementOnce(outTradeNo, work) {
  const key = String(outTradeNo)
  if (settlementInflight.has(key)) return settlementInflight.get(key)
  const job = Promise.resolve().then(work)
  settlementInflight.set(key, job)
  return job.finally(() => {
    if (settlementInflight.get(key) === job) settlementInflight.delete(key)
  })
}
```

未知单抛出带 `statusCode=500` 的错误，由现有 notify route 返回 `{ code: 'FAIL' }`。核心结算成功后，渠道补全单独 try/catch 为 best-effort。明确持久化错误在 `syncAllPendingPayments` 中不得被吞。

- [ ] **Step 7: 运行支付及相关回归测试并确认 GREEN**

Run:

```powershell
cd C:\Users\xu\Desktop\loan\1.api
node --test tests/lakalaPaymentConsistency.test.js tests/orderRepaymentSettlement.test.js tests/storePersistQueue.test.js
```

Expected: 全部 PASS；持久化失败用例明确 reject，重复回调最终只形成一份业务结果。

- [ ] **Step 8: 运行乱码检查并提交**

```powershell
cd C:\Users\xu\Desktop\loan
node scripts/check-mojibake.js .
git add 1.api/src/payment/lakalaPaymentService.js 1.api/src/payment/registerLakalaRoutes.js 1.api/src/index.js 1.api/tests/lakalaPaymentConsistency.test.js
git commit -m "fix: make Lakala settlement durable and retryable"
```

---

### Task 5: 全量回归、构建和部署前核单

**Files:**
- Create: `docs/deployment/2026-09-09-api-mongo-consistency-deploy-checklist.md`
- Test: `1.api/tests/*.test.js`
- Verify only: `2.shop`
- Verify only: `3.admin`

**Interfaces:**
- Produces: 只包含代码部署、健康检查、只读验证和代码回滚步骤的部署清单。
- Does not produce: 数据迁移、数据回填、Mongo 更新或删除命令。

- [ ] **Step 1: 写部署前清单**

清单明确：

1. 记录待部署 Git SHA。
2. 确认服务器仍为单 PM2 实例；若不是，停止部署并先评估跨实例写模型。
3. 确认 `MONGO_REFRESH_MODE=version`、`MONGODB_REQUIRED=true`、`ALLOW_JSON_FALLBACK=false`，只核对不在本任务中修改。
4. 部署代码并重启 API，不执行任何 Mongo shell、导入、迁移或修复脚本。
5. 先访问 health、拉卡拉 config、products，再验证 shop 账单、admin 还款记录。
6. 由业务方控制测试支付；确认 API 日志没有 refresh/persist error 后再开放完整流量。
7. 回滚只回滚应用代码并重启，不回滚、覆盖或删除 Mongo 数据。
8. 历史异常仅输出 `outTradeNo/orderId/当前状态` 的只读核对清单，任何补记另行授权。

- [ ] **Step 2: 运行 API 全量测试**

Run:

```powershell
cd C:\Users\xu\Desktop\loan\1.api
npm test
```

Expected: 乱码检查通过，所有 `tests/*.test.js` PASS，0 failed。

- [ ] **Step 3: 构建 admin 和 shop**

Run:

```powershell
cd C:\Users\xu\Desktop\loan\3.admin
npm run build

cd C:\Users\xu\Desktop\loan\2.shop
npm run build
```

Expected: 两个构建命令 exit 0。

- [ ] **Step 4: 最终仓库检查**

Run:

```powershell
cd C:\Users\xu\Desktop\loan
node scripts/check-mojibake.js .
git diff --check
git status --short
```

Expected: mojibake PASS、`git diff --check` 无输出，只包含本计划明确列出的修改。

- [ ] **Step 5: 独立代码审查**

按 `superpowers:requesting-code-review` 派发独立 reviewer，重点检查：

- 是否存在任何集合删除、历史数据扫描或隐式迁移。
- refresh 失败是否仍有 200 空 seed 路径。
- Promise rejection 是否会被吞或产生 unhandled rejection。
- 重复支付通知是否可能提前 ACK 或重复扩展还款范围。
- 路由最小集合是否遗漏业务依赖。

Critical 和 Important 问题必须修复并重跑 Task 2 至 Task 4 的相关测试。

- [ ] **Step 6: 提交部署清单**

```powershell
git add docs/deployment/2026-09-09-api-mongo-consistency-deploy-checklist.md
git commit -m "docs: add safe API deployment checklist"
```
