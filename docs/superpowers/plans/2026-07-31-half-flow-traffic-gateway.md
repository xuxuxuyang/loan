# Half-Flow 独立流量渠道实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个业务时序对齐上海企浩、但协议、代码、配置、路由、集合、回调和票据完全独立的 Half-Flow 半流程流量渠道。

**Architecture:** 新建 `1.api/src/halfFlowTrafficGateway/`，按配置、加密、字段校验、仓储、业务、回调和路由拆分；生产仓储只访问 `halfFlowTrafficApplications`，共享 `users` 只在首次获取 H5 且确认身份不存在时新增用户。主服务仅增加可选模块加载、Mongo 刷新策略和路由注册三处接线，默认关闭时不注册路由、不读取或写入新集合。

**Tech Stack:** Node.js CommonJS、Koa 3、`@koa/router`、Node `crypto`、MongoDB 7、Node test runner。

## Global Constraints

- 方案 A：业务节点对齐上海企浩；不导入、不调用、不修改 `zheyinTrafficGateway` 或 `duodiandianGateway`。
- 新模块固定目录 `1.api/src/halfFlowTrafficGateway/`，固定集合 `halfFlowTrafficApplications`，固定环境变量前缀 `HALF_FLOW_TRAFFIC_`。
- 不执行数据库迁移、索引变更、历史脚本、删除、覆盖、批量更新或历史数据绑定。
- 新集合只保存本渠道申请；共享 `users` 只允许新增经 H5 流程确认不存在的用户，手机号或身份证命中历史用户时直接拒绝且不得修改该用户。
- 不修改公共下单、订单审核、卡包、还款、商城前端、管理后台、Nginx 或共享 `store.js` 集合映射。
- 所有可变运行参数只从 `1.api/.env.development` 和 `1.api/.env.production` 读取；代码不得提供业务默认回退。
- 两份环境文件均写完整配置和详细中文备注；生产开关初始为 `HALF_FLOW_TRAFFIC_ENABLED=false`。
- 协议固定为 `ChannelCode` 请求头、`{ data: Base64(nonce + ciphertext) }`、Base64 AES 密钥、16 字节 nonce、AES-CTR、NoPadding、UTF-8 JSON。
- 对外接口只有 `POST /admission`、`POST /apply`、`POST /app/link`；内部接口只有 `POST /login/consume`。
- 授信通过回调固定 `orderStatus=3`，金额由元转分，有效期为 13 位毫秒时间戳；申请先持久化，再异步回调。
- 每次修改文件后都从仓库根目录运行 `node scripts/check-mojibake.js .`，失败时立即修复后重跑。
- 不运行任何会连接生产库并修改数据的脚本；测试只用内存仓储和内存 `db` 对象。

## File Map

- Create `1.api/src/halfFlowTrafficGateway/config.js`: 读取并严格校验 `HALF_FLOW_TRAFFIC_*`，不提供业务默认值。
- Create `1.api/src/halfFlowTrafficGateway/crypto.js`: AES-CTR、Base64、MD5/SHA-256、协议错误。
- Create `1.api/src/halfFlowTrafficGateway/schema.js`: 校验准入、进件和 H5 明文字段。
- Create `1.api/src/halfFlowTrafficGateway/repository.js`: 只访问 `halfFlowTrafficApplications`，提供独立内存测试仓储。
- Create `1.api/src/halfFlowTrafficGateway/service.js`: 准入、进件、H5 用户新增和一次性票据。
- Create `1.api/src/halfFlowTrafficGateway/notify.js`: 独立授信回调和通知日志。
- Create `1.api/src/halfFlowTrafficGateway/routes.js`: 路由、协议封装、异步回调和 Mongo 刷新计划。
- Create `1.api/src/halfFlowTrafficGateway/index.js`: 只导出本模块能力。
- Create `1.api/tests/halfFlowTrafficGateway.test.js`: 协议、业务、隔离、失败关闭和接线回归测试。
- Modify `1.api/src/index.js`: 三处最小可选接线，不改现有渠道分支。
- Modify ignored local files `1.api/.env.development` and `1.api/.env.production`: 完整新渠道变量及详细备注。

---

### Task 1: 独立配置、AES-CTR 协议和字段校验

**Files:**
- Create: `1.api/src/halfFlowTrafficGateway/config.js`
- Create: `1.api/src/halfFlowTrafficGateway/crypto.js`
- Create: `1.api/src/halfFlowTrafficGateway/schema.js`
- Create: `1.api/src/halfFlowTrafficGateway/index.js`
- Create: `1.api/tests/halfFlowTrafficGateway.test.js`

**Interfaces:**
- Produces: `halfFlowTrafficConfigFromEnv(env) -> config`
- Produces: `resolveHalfFlowTrafficConfig(config) -> config`
- Produces: `validateEnabledHalfFlowTrafficConfig(config) -> { valid, missing, invalid }`
- Produces: `encryptHalfFlowJson(payload, config, nonce?) -> string`
- Produces: `decryptHalfFlowData(data, config) -> object`
- Produces: `md5(value) -> lowercase hex` and `sha256(value) -> lowercase hex`
- Produces: `assertAdmissionPayload`, `assertApplyPayload`, `assertAppLinkPayload`

- [ ] **Step 1: 写配置和固定向量失败测试**

```js
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const gateway = require('../src/halfFlowTrafficGateway')
const gatewayDir = path.join(__dirname, '../src/halfFlowTrafficGateway')

const config = {
  enabled: true,
  routePrefix: '/open/partners/half-flow',
  channelCode: 'half-flow-test',
  registerChannelCode: 'lihalfflow-test',
  registerChannelName: '丽半流程',
  aesKey: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  creditNotifyUrl: 'https://partner.example.com/credit/notify',
  customerServicePhone: '4000000000',
  defaultAmount: 2750,
  defaultUserQuota: 2750,
  creditExpireDays: 365,
  loginTokenTtlMs: 600000,
  notifyTimeoutMs: 8000,
  loanUrlTemplate: 'https://shop.example.com/login?trafficLogin=1&channel={channel}&orderId={orderId}&token={token}&consumePath={consumePath}&domainUrl={domainUrl}',
}

test('uses only explicit HALF_FLOW_TRAFFIC environment values', () => {
  const parsed = gateway.halfFlowTrafficConfigFromEnv({
    HALF_FLOW_TRAFFIC_ENABLED: 'true',
    HALF_FLOW_TRAFFIC_ROUTE_PREFIX: config.routePrefix,
    HALF_FLOW_TRAFFIC_CHANNEL_CODE: config.channelCode,
    HALF_FLOW_TRAFFIC_REGISTER_CHANNEL_CODE: config.registerChannelCode,
    HALF_FLOW_TRAFFIC_REGISTER_CHANNEL_NAME: config.registerChannelName,
    HALF_FLOW_TRAFFIC_AES_KEY: config.aesKey,
    HALF_FLOW_TRAFFIC_CREDIT_NOTIFY_URL: config.creditNotifyUrl,
    HALF_FLOW_TRAFFIC_CUSTOMER_SERVICE_PHONE: config.customerServicePhone,
    HALF_FLOW_TRAFFIC_DEFAULT_AMOUNT: '2750',
    HALF_FLOW_TRAFFIC_DEFAULT_USER_QUOTA: '2750',
    HALF_FLOW_TRAFFIC_CREDIT_EXPIRE_DAYS: '365',
    HALF_FLOW_TRAFFIC_LOGIN_TOKEN_TTL_MS: '600000',
    HALF_FLOW_TRAFFIC_NOTIFY_TIMEOUT_MS: '8000',
    HALF_FLOW_TRAFFIC_LOAN_URL_TEMPLATE: config.loanUrlTemplate,
  })
  assert.deepEqual(parsed, config)
  assert.equal(gateway.halfFlowTrafficConfigFromEnv({}).enabled, false)
  assert.equal(gateway.halfFlowTrafficConfigFromEnv({}).defaultAmount, undefined)
})

test('matches the fixed AES-256-CTR NoPadding protocol vector', () => {
  const payload = {
    idCardMd5: '95dbf70af76519537e4fa8801f339ee2',
    mobileMd5: '6643f667b12386a1bb2e1adf8f054d0e',
  }
  const nonce = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')
  const encrypted = gateway.encryptHalfFlowJson(payload, config, nonce)
  assert.equal(encrypted, 'AAECAwQFBgcICQoLDA0ODyh/tZHVrkQATFiyb7+rghQiMrV6MkZtYgpz8ulbqsormH0wInfizhTfy5xvynF0WJSZ/y8rDGrMKJcevvAPuOkZLNhSg1fhLDpwS4rD+WkBMgrujSrFsY9S/zdFFEfH')
  assert.deepEqual(gateway.decryptHalfFlowData(encrypted, config), payload)
})
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `cd 1.api && node --test tests/halfFlowTrafficGateway.test.js`

Expected: FAIL with `Cannot find module '../src/halfFlowTrafficGateway'`.

- [ ] **Step 3: 实现不带业务默认值的配置解析**

```js
function readTrim(value) {
  return value == null ? '' : String(value).trim()
}

function parseExplicitNumber(value) {
  const raw = readTrim(value)
  if (!raw) return undefined
  const number = Number(raw)
  return Number.isFinite(number) ? number : NaN
}

function halfFlowTrafficConfigFromEnv(env = process.env) {
  return {
    enabled: ['1', 'true', 'yes', 'on'].includes(readTrim(env.HALF_FLOW_TRAFFIC_ENABLED).toLowerCase()),
    routePrefix: readTrim(env.HALF_FLOW_TRAFFIC_ROUTE_PREFIX).replace(/\/+$/, ''),
    channelCode: readTrim(env.HALF_FLOW_TRAFFIC_CHANNEL_CODE),
    registerChannelCode: readTrim(env.HALF_FLOW_TRAFFIC_REGISTER_CHANNEL_CODE),
    registerChannelName: readTrim(env.HALF_FLOW_TRAFFIC_REGISTER_CHANNEL_NAME),
    aesKey: readTrim(env.HALF_FLOW_TRAFFIC_AES_KEY),
    creditNotifyUrl: readTrim(env.HALF_FLOW_TRAFFIC_CREDIT_NOTIFY_URL),
    customerServicePhone: readTrim(env.HALF_FLOW_TRAFFIC_CUSTOMER_SERVICE_PHONE),
    defaultAmount: parseExplicitNumber(env.HALF_FLOW_TRAFFIC_DEFAULT_AMOUNT),
    defaultUserQuota: parseExplicitNumber(env.HALF_FLOW_TRAFFIC_DEFAULT_USER_QUOTA),
    creditExpireDays: parseExplicitNumber(env.HALF_FLOW_TRAFFIC_CREDIT_EXPIRE_DAYS),
    loginTokenTtlMs: parseExplicitNumber(env.HALF_FLOW_TRAFFIC_LOGIN_TOKEN_TTL_MS),
    notifyTimeoutMs: parseExplicitNumber(env.HALF_FLOW_TRAFFIC_NOTIFY_TIMEOUT_MS),
    loanUrlTemplate: readTrim(env.HALF_FLOW_TRAFFIC_LOAN_URL_TEMPLATE),
  }
}
```

`validateEnabledHalfFlowTrafficConfig` must require every string field above, require positive finite numeric values, require a route prefix beginning with `/`, require HTTP(S) URLs, require every H5 placeholder, and require the Base64-decoded AES key to contain exactly 16, 24, or 32 bytes. Disabled config returns valid without requiring secrets.

- [ ] **Step 4: 实现严格 Base64 和 AES-CTR**

```js
function decodeCanonicalBase64(value, label) {
  const raw = readTrim(value)
  if (!raw || raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    throw new HalfFlowTrafficError(`${label} is not valid Base64`)
  }
  const decoded = Buffer.from(raw, 'base64')
  if (decoded.toString('base64') !== raw) {
    throw new HalfFlowTrafficError(`${label} is not canonical Base64`)
  }
  return decoded
}

function encryptHalfFlowJson(payload, config, suppliedNonce) {
  const key = decodeAesKey(config.aesKey)
  const nonce = suppliedNonce || crypto.randomBytes(16)
  if (!Buffer.isBuffer(nonce) || nonce.length !== 16) throw new HalfFlowTrafficError('nonce must be 16 bytes')
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const cipher = crypto.createCipheriv(`aes-${key.length * 8}-ctr`, key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([nonce, ciphertext]).toString('base64')
}

function decryptHalfFlowData(data, config) {
  const key = decodeAesKey(config.aesKey)
  const packed = decodeCanonicalBase64(data, 'data')
  if (packed.length <= 16) throw new HalfFlowTrafficError('data must contain nonce and ciphertext')
  const decipher = crypto.createDecipheriv(`aes-${key.length * 8}-ctr`, key, packed.subarray(0, 16))
  const plaintext = Buffer.concat([decipher.update(packed.subarray(16)), decipher.final()])
  const text = plaintext.toString('utf8')
  const payload = JSON.parse(text)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HalfFlowTrafficError('decrypted data must be an object')
  }
  return payload
}
```

Follow the protocol confirmed by the partner during integration: use AES-CTR with NoPadding and encrypt the UTF-8 JSON bytes directly. Keep this behavior inside `halfFlowTrafficGateway/crypto.js` only.

- [ ] **Step 5: 写并实现精确字段校验测试**

```js
test('validates the documented apply field names including lssuing', () => {
  const payload = makeApplyPayload()
  assert.doesNotThrow(() => gateway.assertApplyPayload(payload))
  assert.throws(() => gateway.assertApplyPayload({ ...payload, authInfo: { ...payload.authInfo, lssuing: '' } }), /authInfo\.lssuing/)
  assert.throws(() => gateway.assertApplyPayload({ ...payload, contactInfos: { ...payload.contactInfos, emergentPhone: '' } }), /contactInfos\.emergentPhone/)
})
```

`makeApplyPayload()` must include the documented top-level fields and every required child field:

```js
function makeApplyPayload(overrides = {}) {
  return {
    orderId: 'HF-ORDER-001', mobile: '13812345678', name: '张三', idCard: '32010119900307663X',
    authInfo: {
      idCardFront: 'https://cdn.example/front.jpg', idCardBack: 'https://cdn.example/back.jpg',
      faceUrl: 'https://cdn.example/face.jpg', faceScore: '95', confidence: '0.99',
      faceTime: '2026-07-31 12:00:00', nativePlace: '江苏省南京市', effectiveDate: '20200101-20300101',
      gender: '男', birthday: '19900307', nation: '汉', lssuing: '南京市公安局', age: '36',
    },
    baseInfo: {
      marital: 2, education: 2, isOpType: 1, province: '江苏省', city: '南京市', area: '玄武区',
      address: '测试路1号', companyAddress: '产业园2号', companyName: '测试公司', companyPhone: '',
      monthlyAverageIncome: 1, industry: 8,
    },
    deviceInfo: { lng: '118.7969', lat: '32.0603', osType: 2, ip: '127.0.0.1', deviceid: 'device-001' },
    contactInfos: {
      commonName: '李四', commonPhone: '13912345678', commonRelationship: 5,
      emergentName: '王五', emergentPhone: '13712345678', emergentRelationship: 6,
    },
    domainUrl: 'https://partner.example/return',
    ...overrides,
  }
}
```

- [ ] **Step 6: 运行定向测试和乱码检查**

Run: `cd 1.api && node --test tests/halfFlowTrafficGateway.test.js`

Expected: PASS for config, crypto, and schema tests.

Run: `node scripts/check-mojibake.js .`

Expected: `Mojibake check passed`.

- [ ] **Step 7: 提交独立协议基础**

```bash
git add 1.api/src/halfFlowTrafficGateway/config.js 1.api/src/halfFlowTrafficGateway/crypto.js 1.api/src/halfFlowTrafficGateway/schema.js 1.api/src/halfFlowTrafficGateway/index.js 1.api/tests/halfFlowTrafficGateway.test.js
git commit -m "feat: add isolated half-flow protocol foundation"
```

---

### Task 2: 只访问新集合的仓储

**Files:**
- Create: `1.api/src/halfFlowTrafficGateway/repository.js`
- Modify: `1.api/src/halfFlowTrafficGateway/index.js`
- Modify: `1.api/tests/halfFlowTrafficGateway.test.js`

**Interfaces:**
- Produces: `COLLECTION_NAME = 'halfFlowTrafficApplications'`
- Produces: `createMemoryHalfFlowTrafficRepository(seed)`
- Produces: `createMongoHalfFlowTrafficRepository()`
- Repository methods: `findByHashes`, `findByEitherHash`, `findByOrderId`, `save`, `consumeLoginToken`, `list`

- [ ] **Step 1: 写新集合和仓储行为失败测试**

```js
test('uses only the halfFlowTrafficApplications repository', async () => {
  assert.equal(gateway.HALF_FLOW_COLLECTION_NAME, 'halfFlowTrafficApplications')
  const repository = gateway.createMemoryHalfFlowTrafficRepository()
  await repository.save({ id: 'HF-A1', mobileMd5: 'a'.repeat(32), idCardMd5: 'b'.repeat(32) })
  assert.equal((await repository.findByHashes('a'.repeat(32), 'b'.repeat(32))).id, 'HF-A1')
  assert.equal((await repository.findByEitherHash('a'.repeat(32), 'c'.repeat(32))).id, 'HF-A1')
  assert.equal((await repository.list()).length, 1)
})
```

- [ ] **Step 2: 运行测试并确认仓储导出缺失**

Run: `cd 1.api && node --test tests/halfFlowTrafficGateway.test.js`

Expected: FAIL because `createMemoryHalfFlowTrafficRepository` is undefined.

- [ ] **Step 3: 实现独立内存和 Mongo 仓储**

```js
const mongo = require('../mongo')
const COLLECTION_NAME = 'halfFlowTrafficApplications'

function createMongoHalfFlowTrafficRepository() {
  function collection() {
    const db = mongo.getMongoDb()
    if (!db) throw new HalfFlowTrafficError('database unavailable', 503)
    return db.collection(COLLECTION_NAME)
  }
  return {
    findByHashes(mobileMd5, idCardMd5) {
      return collection().findOne({ mobileMd5, idCardMd5 })
    },
    findByEitherHash(mobileMd5, idCardMd5) {
      return collection().findOne({ $or: [{ mobileMd5 }, { idCardMd5 }] })
    },
    findByOrderId(orderId) {
      return collection().findOne({ orderId })
    },
    async save(row) {
      await collection().updateOne({ id: row.id }, { $set: row }, { upsert: true })
      return row
    },
    async consumeLoginToken({ id, tokenHash, consumedAt }) {
      const result = await collection().updateOne(
        { id, loginTokenHash: tokenHash, $or: [{ loginTokenConsumedAt: '' }, { loginTokenConsumedAt: null }, { loginTokenConsumedAt: { $exists: false } }] },
        { $set: { loginTokenConsumedAt: consumedAt, updatedAt: consumedAt } },
      )
      return result.modifiedCount === 1
    },
  }
}
```

The memory repository mirrors the same signatures, deep-clones rows, and performs compare-and-set token consumption. Do not add index creation, migration, delete, rename, or access to any old collection.

- [ ] **Step 4: 加源码隔离断言**

```js
test('does not import or name existing traffic gateway resources', () => {
  const files = ['config.js', 'crypto.js', 'schema.js', 'repository.js', 'service.js', 'notify.js', 'routes.js', 'index.js']
  const source = files
    .map(file => fs.existsSync(path.join(gatewayDir, file)) ? fs.readFileSync(path.join(gatewayDir, file), 'utf8') : '')
    .join('\n')
  assert.doesNotMatch(source, /require\([^)]*(zheyinTrafficGateway|duodiandianGateway)/)
  assert.doesNotMatch(source, /zheyinTrafficApplications|partnerGatewayApplications/)
})
```

- [ ] **Step 5: 运行测试、乱码检查并提交**

Run: `cd 1.api && node --test tests/halfFlowTrafficGateway.test.js`

Expected: PASS.

Run: `node scripts/check-mojibake.js .`

Expected: PASS.

```bash
git add 1.api/src/halfFlowTrafficGateway/repository.js 1.api/src/halfFlowTrafficGateway/index.js 1.api/tests/halfFlowTrafficGateway.test.js
git commit -m "feat: add isolated half-flow application repository"
```

---

### Task 3: 准入、进件、幂等和基础授信

**Files:**
- Create: `1.api/src/halfFlowTrafficGateway/service.js`
- Modify: `1.api/src/halfFlowTrafficGateway/index.js`
- Modify: `1.api/tests/halfFlowTrafficGateway.test.js`

**Interfaces:**
- Consumes: repository methods from Task 2 and validators from Task 1
- Produces: `handleHalfFlowAdmission({ payload, db, repository, config, now })`
- Produces: `handleHalfFlowApply({ payload, repository, config, now })`
- Produces: `findExistingMallUser(db, { mobile, idCard })`
- Apply result: `{ data: {}, row, shouldNotify }`; only a newly persisted approval sets `shouldNotify: true`

- [ ] **Step 1: 写准入隔离和撞库失败测试**

```js
test('admits a new identity only into the half-flow repository', async () => {
  const repository = gateway.createMemoryHalfFlowTrafficRepository()
  const db = { users: [], orders: [{ id: 'KEEP' }], partnerGatewayApplications: [{ id: 'KEEP-DDD' }], zheyinTrafficApplications: [{ id: 'KEEP-ZY' }] }
  const result = await gateway.handleHalfFlowAdmission({
    payload: { mobileMd5: gateway.md5('13812345678'), idCardMd5: gateway.md5('32010119900307663X') },
    db, repository, config, now: () => 1760000000000,
  })
  assert.deepEqual(result, { result: 1, reason: '', customerServicePhone: config.customerServicePhone })
  assert.equal((await repository.list()).length, 1)
  assert.deepEqual(db.orders, [{ id: 'KEEP' }])
  assert.deepEqual(db.partnerGatewayApplications, [{ id: 'KEEP-DDD' }])
  assert.deepEqual(db.zheyinTrafficApplications, [{ id: 'KEEP-ZY' }])
})

test('rejects existing phone or identity without mutating the user', async () => {
  const original = { id: 'U-OLD', phone: '13812345678', idNumber: '32010119900307663X', name: '历史用户' }
  const db = { users: [structuredClone(original)] }
  const result = await gateway.handleHalfFlowAdmission({
    payload: { mobileMd5: gateway.md5(original.phone), idCardMd5: gateway.md5('110101199001011234') },
    db, repository: gateway.createMemoryHalfFlowTrafficRepository(), config, now: () => 1760000000000,
  })
  assert.equal(result.result, 0)
  assert.deepEqual(db.users[0], original)
})
```

- [ ] **Step 2: 运行测试并确认 service 导出缺失**

Run: `cd 1.api && node --test tests/halfFlowTrafficGateway.test.js`

Expected: FAIL because `handleHalfFlowAdmission` is undefined.

- [ ] **Step 3: 实现准入**

```js
async function handleHalfFlowAdmission({ payload, db, repository, config, now }) {
  const input = assertAdmissionPayload(payload)
  const samePair = await repository.findByHashes(input.mobileMd5, input.idCardMd5)
  if (samePair && samePair.admissionStatus === 'passed') return admissionResponse(true, config)
  if (await repository.findByEitherHash(input.mobileMd5, input.idCardMd5)) return admissionResponse(false, config)
  if (existingDbHashConflict(db, input)) return admissionResponse(false, config)
  const at = nowIso(now)
  await repository.save({
    id: `HF-${crypto.randomUUID()}`,
    channelCode: config.channelCode,
    mobileMd5: input.mobileMd5,
    idCardMd5: input.idCardMd5,
    admissionStatus: 'passed',
    admissionAt: at,
    notifyLogs: [],
    createdAt: at,
    updatedAt: at,
  })
  return admissionResponse(true, config)
}
```

`existingDbHashConflict` scans only `db.users`, hashes the stored phone and ID exactly, and returns a Boolean. It must not add, bind, normalize back into, or otherwise mutate existing users.

- [ ] **Step 4: 写进件、幂等和冲突失败测试**

```js
test('persists apply before reporting basic approval and does not create a mall user', async () => {
  const repository = gateway.createMemoryHalfFlowTrafficRepository()
  const payload = makeApplyPayload()
  await gateway.handleHalfFlowAdmission({
    payload: { mobileMd5: gateway.md5(payload.mobile), idCardMd5: gateway.md5(payload.idCard) },
    db: { users: [] }, repository, config, now: () => 1760000000000,
  })
  const result = await gateway.handleHalfFlowApply({ payload, repository, config, now: () => 1760000000000 })
  assert.deepEqual(result.data, {})
  assert.equal(result.shouldNotify, true)
  const stored = await repository.findByOrderId(payload.orderId)
  assert.equal(stored.creditStatus, 'approved')
  assert.equal(stored.creditAmountYuan, 2750)
  assert.equal(stored.rawApplyPayload.orderId, payload.orderId)
  assert.equal(stored.mallUserId, undefined)
})

test('makes same-order apply idempotent and rejects identity/order replacement', async () => {
  const repository = gateway.createMemoryHalfFlowTrafficRepository()
  const payload = makeApplyPayload()
  await gateway.handleHalfFlowAdmission({
    payload: { mobileMd5: gateway.md5(payload.mobile), idCardMd5: gateway.md5(payload.idCard) },
    db: { users: [] }, repository, config, now: () => 1760000000000,
  })
  const first = await gateway.handleHalfFlowApply({ payload, repository, config, now: () => 1760000000000 })
  const repeated = await gateway.handleHalfFlowApply({ payload, repository, config, now: () => 1760000000001 })
  assert.equal(first.shouldNotify, true)
  assert.equal(repeated.shouldNotify, false)
  await assert.rejects(
    () => gateway.handleHalfFlowApply({ payload: { ...payload, mobile: '13612345678' }, repository, config }),
    /another identity/,
  )
  await assert.rejects(
    () => gateway.handleHalfFlowApply({ payload: { ...payload, orderId: 'HF-ORDER-002' }, repository, config }),
    /another orderId/,
  )
})
```

- [ ] **Step 5: 实现进件和基础授信**

```js
async function handleHalfFlowApply({ payload, repository, config, now }) {
  const input = assertApplyPayload(payload)
  const mobileMd5 = md5(input.mobile)
  const idCardMd5 = md5(input.idCard)
  const admission = await repository.findByHashes(mobileMd5, idCardMd5)
  if (!admission || admission.admissionStatus !== 'passed') throw new HalfFlowTrafficError('identity has not passed admission')
  const byOrder = await repository.findByOrderId(input.orderId)
  if (byOrder) {
    if (byOrder.mobileMd5 !== mobileMd5 || byOrder.idCardMd5 !== idCardMd5) throw new HalfFlowTrafficError('orderId belongs to another identity')
    return { data: {}, row: byOrder, shouldNotify: false }
  }
  if (admission.orderId && admission.orderId !== input.orderId) throw new HalfFlowTrafficError('identity belongs to another orderId')
  const atMs = numericNow(now)
  const row = {
    ...admission,
    orderId: input.orderId,
    rawApplyPayload: input,
    userPhoneMasked: maskPhone(input.mobile),
    idCardMasked: maskIdCard(input.idCard),
    creditStatus: 'approved',
    creditAmountYuan: config.defaultAmount,
    creditExpireAt: new Date(atMs + config.creditExpireDays * 86400000).toISOString(),
    creditDecisionSource: 'half_flow_basic_admission',
    updatedAt: new Date(atMs).toISOString(),
  }
  await repository.save(row)
  return { data: {}, row, shouldNotify: true }
}
```

- [ ] **Step 6: 运行定向测试、乱码检查并提交**

Run: `cd 1.api && node --test tests/halfFlowTrafficGateway.test.js`

Expected: PASS for admission/apply happy path, idempotency, unadmitted apply, hash conflict, order conflict, and no-user-write assertions.

Run: `node scripts/check-mojibake.js .`

Expected: PASS.

```bash
git add 1.api/src/halfFlowTrafficGateway/service.js 1.api/src/halfFlowTrafficGateway/index.js 1.api/tests/halfFlowTrafficGateway.test.js
git commit -m "feat: add isolated half-flow admission and apply flow"
```

---

### Task 4: 独立授信回调

**Files:**
- Create: `1.api/src/halfFlowTrafficGateway/notify.js`
- Modify: `1.api/src/halfFlowTrafficGateway/index.js`
- Modify: `1.api/tests/halfFlowTrafficGateway.test.js`

**Interfaces:**
- Consumes: `encryptHalfFlowJson`, config, repository `save`
- Produces: `toHalfFlowCreditNotifyPayload(row) -> { orderId, orderStatus, money, expireTime }`
- Produces: `notifyHalfFlowCreditResult({ row, repository, config, httpClient, now })`

- [ ] **Step 1: 写回调格式和持久化顺序失败测试**

```js
function makeApprovedStoredRow(overrides = {}) {
  return {
    id: 'HF-APP-001',
    channelCode: config.channelCode,
    orderId: 'HF-ORDER-001',
    mobileMd5: gateway.md5('13812345678'),
    idCardMd5: gateway.md5('32010119900307663X'),
    creditStatus: 'approved',
    creditAmountYuan: 2750,
    creditExpireAt: '2027-10-09T08:53:20.000Z',
    notifyLogs: [],
    createdAt: '2026-10-09T08:53:20.000Z',
    updatedAt: '2026-10-09T08:53:20.000Z',
    ...overrides,
  }
}

test('sends an encrypted status-3 callback only after the approved row exists', async () => {
  const repository = gateway.createMemoryHalfFlowTrafficRepository()
  const row = makeApprovedStoredRow()
  await repository.save(row)
  const calls = []
  const result = await gateway.notifyHalfFlowCreditResult({
    row, repository, config,
    httpClient: async (url, options) => {
      assert.equal((await repository.findByOrderId(row.orderId)).creditStatus, 'approved')
      calls.push({ url, options })
      return { ok: true, status: 200, async text() { return '{"code":0}' } }
    },
    now: () => 1760000000000,
  })
  assert.equal(result.sent, true)
  assert.equal(calls[0].options.headers.ChannelCode, config.channelCode)
  const body = JSON.parse(calls[0].options.body)
  const payload = gateway.decryptHalfFlowData(body.data, config)
  assert.deepEqual(payload, {
    orderId: row.orderId,
    orderStatus: 3,
    money: 275000,
    expireTime: Date.parse(row.creditExpireAt),
  })
})
```

- [ ] **Step 2: 运行测试并确认 notify 导出缺失**

Run: `cd 1.api && node --test tests/halfFlowTrafficGateway.test.js`

Expected: FAIL because `notifyHalfFlowCreditResult` is undefined.

- [ ] **Step 3: 实现超时、响应判断、去重和日志**

```js
function toHalfFlowCreditNotifyPayload(row) {
  return {
    orderId: row.orderId,
    orderStatus: 3,
    money: Math.round(Number(row.creditAmountYuan) * 100),
    expireTime: Date.parse(row.creditExpireAt),
  }
}

async function notifyHalfFlowCreditResult({ row, repository, config, httpClient = fetch, now = Date.now }) {
  const payload = toHalfFlowCreditNotifyPayload(row)
  if (row.lastNotifyStatus === 'success' && Number(row.lastNotifiedOrderStatus) === payload.orderStatus) {
    return { sent: false, reason: 'duplicate_skipped', payload }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.notifyTimeoutMs)
  try {
    const response = await httpClient(config.creditNotifyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=UTF-8', ChannelCode: config.channelCode },
      body: JSON.stringify({ data: encryptHalfFlowJson(payload, config) }),
      signal: controller.signal,
    })
    const body = parseJson(await response.text())
    const accepted = response.ok && String(body.code) === '0'
    await saveNotifyLog({ row, repository, payload, accepted, response, body, now })
    return { sent: accepted, reason: accepted ? 'ok' : 'remote_rejected', payload }
  }
  catch (error) {
    await saveNotifyFailure({ row, repository, payload, error, now })
    return { sent: false, reason: 'request_failed', payload }
  }
  finally {
    clearTimeout(timer)
  }
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : {}
  }
  catch {
    return {}
  }
}

async function appendNotifyLog({ row, repository, payload, sent, reason, status, responseBody, error, now }) {
  const at = new Date(typeof now === 'function' ? Number(now()) : Date.now()).toISOString()
  const log = {
    at,
    orderStatus: payload.orderStatus,
    sent,
    reason,
    ...(status == null ? {} : { status }),
    ...(responseBody == null ? {} : { responseBody }),
    ...(error ? { error: String(error.message || error) } : {}),
  }
  const next = {
    ...row,
    notifyLogs: [...(Array.isArray(row.notifyLogs) ? row.notifyLogs.slice(-19) : []), log],
    lastNotifyStatus: sent ? 'success' : 'failed',
    lastNotifiedOrderStatus: payload.orderStatus,
    lastNotifyAt: at,
    updatedAt: at,
  }
  await repository.save(next)
  Object.assign(row, next)
}
```

The success branch calls `appendNotifyLog` with the HTTP status and parsed response; the catch branch calls it with `sent: false`, `reason: 'request_failed'`, and the safe error string. Keep at most 20 entries. Never log plaintext identity fields, image URLs, AES keys, or the unencrypted apply payload. Callback failure records failure on this row, does not change `creditStatus`, and never rolls back the approved application.

- [ ] **Step 4: 补失败、去重和单位测试**

```js
test('records callback failure without rolling back credit approval', async () => {
  const repository = gateway.createMemoryHalfFlowTrafficRepository([makeApprovedStoredRow()])
  const row = await repository.findByOrderId('HF-ORDER-001')
  const result = await gateway.notifyHalfFlowCreditResult({
    row, repository, config,
    httpClient: async () => { throw new Error('network down') },
    now: () => 1760000000000,
  })
  assert.equal(result.sent, false)
  const stored = await repository.findByOrderId(row.orderId)
  assert.equal(stored.creditStatus, 'approved')
  assert.equal(stored.lastNotifyStatus, 'failed')
})
```

- [ ] **Step 5: 运行测试、乱码检查并提交**

Run: `cd 1.api && node --test tests/halfFlowTrafficGateway.test.js`

Expected: PASS for success, code-not-zero, HTTP failure, thrown request, cents conversion, 13-digit expiration, and persisted deduplication.

Run: `node scripts/check-mojibake.js .`

Expected: PASS.

```bash
git add 1.api/src/halfFlowTrafficGateway/notify.js 1.api/src/halfFlowTrafficGateway/index.js 1.api/tests/halfFlowTrafficGateway.test.js
git commit -m "feat: add isolated half-flow credit callback"
```

---

### Task 5: H5 用户新增和一次性免登

**Files:**
- Modify: `1.api/src/halfFlowTrafficGateway/service.js`
- Modify: `1.api/src/halfFlowTrafficGateway/index.js`
- Modify: `1.api/tests/halfFlowTrafficGateway.test.js`

**Interfaces:**
- Produces: `handleHalfFlowAppLink({ payload, db, repository, config, now, writeDbPartial, flushMongoPersist })`
- Produces: `consumeHalfFlowLoginToken({ orderId, token, db, repository, config, now })`
- Produces: `sanitizeHalfFlowLoginUser(user)`

- [ ] **Step 1: 写“只在 H5 新增用户”和历史用户不变测试**

```js
async function seedApprovedApplication() {
  const repository = gateway.createMemoryHalfFlowTrafficRepository()
  const payload = makeApplyPayload()
  await gateway.handleHalfFlowAdmission({
    payload: { mobileMd5: gateway.md5(payload.mobile), idCardMd5: gateway.md5(payload.idCard) },
    db: { users: [] }, repository, config, now: () => 1760000000000,
  })
  await gateway.handleHalfFlowApply({ payload, repository, config, now: () => 1760000000000 })
  return { repository, row: await repository.findByOrderId(payload.orderId) }
}

test('creates one new mall user only when H5 is requested', async () => {
  const { repository, row } = await seedApprovedApplication()
  const db = { users: [], orders: [] }
  const writes = []
  const result = await gateway.handleHalfFlowAppLink({
    payload: { orderId: row.orderId, domainUrl: 'https://partner.example/return' },
    db, repository, config, now: () => 1760000000000,
    writeDbPartial: (nextDb, keys) => writes.push(keys),
    flushMongoPersist: async () => {},
  })
  assert.equal(db.users.length, 1)
  assert.equal(db.orders.length, 0)
  assert.deepEqual(writes, [['users']])
  assert.match(result.repaymentAddress, /^https:\/\/shop\.example\.com\/login\?/)
})

test('rejects a late existing identity and leaves it byte-for-byte unchanged', async () => {
  const { repository, row } = await seedApprovedApplication()
  const original = { id: 'U-OLD', phone: row.rawApplyPayload.mobile, idNumber: 'OTHER', name: '历史用户', quota: 99 }
  const db = { users: [structuredClone(original)] }
  await assert.rejects(() => gateway.handleHalfFlowAppLink({ payload: { orderId: row.orderId }, db, repository, config }))
  assert.deepEqual(db.users[0], original)
})
```

- [ ] **Step 2: 运行测试并确认 H5 service 缺失**

Run: `cd 1.api && node --test tests/halfFlowTrafficGateway.test.js`

Expected: FAIL because `handleHalfFlowAppLink` is undefined.

- [ ] **Step 3: 实现新用户映射、持久化和 URL**

```js
function makeHalfFlowMallUser(row, config, now) {
  const input = row.rawApplyPayload
  const at = nowIso(now)
  return {
    id: `U${numericNow(now)}${crypto.randomInt(1000, 10000)}`,
    name: input.name,
    phone: normalizePhone(input.mobile),
    idNumber: input.idCard.toUpperCase(),
    idCardFront: input.authInfo.idCardFront,
    idCardBack: input.authInfo.idCardBack,
    idCardHandheld: input.authInfo.faceUrl,
    locationText: [input.baseInfo.province, input.baseInfo.city, input.baseInfo.area, input.baseInfo.address].filter(Boolean).join(''),
    latitude: Number(input.deviceInfo.lat) || 0,
    longitude: Number(input.deviceInfo.lng) || 0,
    creditStatus: '良好',
    registerAt: at,
    quota: config.defaultUserQuota,
    adminRemark: '',
    orderBlacklisted: false,
    mallInstallmentRiskAttempted: false,
    emergencyContacts: mapHalfFlowContacts(input.contactInfos),
    registerChannelCode: config.registerChannelCode,
    registerChannelName: config.registerChannelName,
    halfFlowOrderId: row.orderId,
    halfFlowBoundAt: at,
  }
}

function mapHalfFlowContacts(contactInfos) {
  return [
    { name: contactInfos.commonName, phone: normalizePhone(contactInfos.commonPhone), mobile: normalizePhone(contactInfos.commonPhone), relation: String(contactInfos.commonRelationship) },
    { name: contactInfos.emergentName, phone: normalizePhone(contactInfos.emergentPhone), mobile: normalizePhone(contactInfos.emergentPhone), relation: String(contactInfos.emergentRelationship) },
  ]
}
```

`handleHalfFlowAppLink` must: require an approved row; reuse only `row.mallUserId`; otherwise recheck phone and ID against all shared users; append one new user; call `writeDbPartial(db, ['users'])`; await `flushMongoPersist`; then save `mallUserId`, SHA-256 token hash, issued time, empty consumed time on the application. Each repeated H5 request rotates the application token without creating a second user. Build `repaymentAddress` only from `config.loanUrlTemplate`, replacing `orderId`, `channel`, `token`, `consumePath`, and `domainUrl`; no fallback URL is permitted.

- [ ] **Step 4: 写并实现一次性票据测试**

```js
async function createH5Fixture() {
  const { repository, row } = await seedApprovedApplication()
  const db = { users: [], orders: [] }
  const link = await gateway.handleHalfFlowAppLink({
    payload: { orderId: row.orderId },
    db, repository, config, now: () => 1760000000000,
    writeDbPartial: () => {},
    flushMongoPersist: async () => {},
  })
  return { repository, db, repaymentAddress: link.repaymentAddress, row }
}

test('stores only a token hash and consumes the token once', async () => {
  const { repository, db, repaymentAddress, row } = await createH5Fixture()
  const token = new URL(repaymentAddress).searchParams.get('token')
  const stored = await repository.findByOrderId(row.orderId)
  assert.notEqual(stored.loginTokenHash, token)
  assert.equal(Object.values(stored).includes(token), false)
  const first = await gateway.consumeHalfFlowLoginToken({ orderId: row.orderId, token, db, repository, config, now: () => 1760000001000 })
  assert.equal(first.token, `mock-token-${row.rawApplyPayload.mobile}`)
  await assert.rejects(() => gateway.consumeHalfFlowLoginToken({ orderId: row.orderId, token, db, repository, config, now: () => 1760000002000 }), /already used|invalid/)
})
```

Token verification requires the approved application, exact SHA-256 hash, unconsumed status, finite issue time, age not exceeding `config.loginTokenTtlMs`, and the row's own `mallUserId`. `repository.consumeLoginToken` is the final compare-and-set so concurrent reuse cannot both succeed.

- [ ] **Step 5: 运行 H5/免登测试、乱码检查并提交**

Run: `cd 1.api && node --test tests/halfFlowTrafficGateway.test.js`

Expected: PASS for lazy creation, existing phone, existing ID, repeat H5, persistence failure, token hash, expiry, bad token, and single consumption.

Run: `node scripts/check-mojibake.js .`

Expected: PASS.

```bash
git add 1.api/src/halfFlowTrafficGateway/service.js 1.api/src/halfFlowTrafficGateway/index.js 1.api/tests/halfFlowTrafficGateway.test.js
git commit -m "feat: add isolated half-flow H5 login flow"
```

---

### Task 6: 对外路由、协议响应和 Mongo 刷新策略

**Files:**
- Create: `1.api/src/halfFlowTrafficGateway/routes.js`
- Modify: `1.api/src/halfFlowTrafficGateway/index.js`
- Modify: `1.api/tests/halfFlowTrafficGateway.test.js`

**Interfaces:**
- Produces: `registerHalfFlowTrafficGatewayRoutes(router, deps)`
- Produces: `isHalfFlowTrafficPublicPath(path, config?) -> boolean`
- Produces: `resolveHalfFlowTrafficMongoRefreshPlan(method, path, config?) -> plan|null`
- External success: `{ code: 0, message: 'success', data: encryptedString }`
- External failure: HTTP 200 and `{ code: nonzero, message, data: '' }`
- Internal login: `{ success: true, data }` or `{ success: false, code, msg, data: null }`

- [ ] **Step 1: 写禁用、完整路由和响应失败测试**

```js
function makeRouter() {
  const routes = new Map()
  return {
    routes,
    post(pathValue, handler) { routes.set(pathValue, handler) },
  }
}

function makeCtx(payload, channelCode = config.channelCode) {
  return {
    request: { body: payload },
    status: 0,
    body: null,
    get(name) { return name.toLowerCase() === 'channelcode' ? channelCode : '' },
  }
}

test('registers only four isolated routes when enabled and valid', () => {
  const disabled = makeRouter()
  gateway.registerHalfFlowTrafficGatewayRoutes(disabled, { configProvider: () => ({ enabled: false }) })
  assert.equal(disabled.routes.size, 0)

  const router = makeRouter()
  gateway.registerHalfFlowTrafficGatewayRoutes(router, {
    configProvider: () => config,
    repository: gateway.createMemoryHalfFlowTrafficRepository(),
    readDb: () => ({ users: [] }),
  })
  assert.deepEqual([...router.routes.keys()].sort(), [
    '/open/partners/half-flow/admission',
    '/open/partners/half-flow/app/link',
    '/open/partners/half-flow/apply',
    '/open/partners/half-flow/login/consume',
  ])
})
```

- [ ] **Step 2: 运行测试并确认 routes 导出缺失**

Run: `cd 1.api && node --test tests/halfFlowTrafficGateway.test.js`

Expected: FAIL because `registerHalfFlowTrafficGatewayRoutes` is undefined.

- [ ] **Step 3: 实现协议处理器和路由**

```js
async function handleEncrypted(ctx, deps, action, options = {}) {
  try {
    const config = resolveHalfFlowTrafficConfig(deps.configProvider())
    assertChannelCode(ctx, config.channelCode)
    const payload = decryptHalfFlowData(ctx.request.body && ctx.request.body.data, config)
    const result = await action({ payload, config, repository: deps.repository, db: options.needsDb === false ? undefined : deps.readDb() })
    ctx.status = 200
    ctx.body = { code: 0, message: 'success', data: encryptHalfFlowJson(result, config) }
  }
  catch (error) {
    ctx.status = 200
    ctx.body = { code: error.code || 400, message: safeProtocolMessage(error), data: '' }
  }
}

function assertChannelCode(ctx, expected) {
  const actual = typeof ctx.get === 'function' ? ctx.get('ChannelCode') : ''
  if (actual !== expected) throw new HalfFlowTrafficError('invalid ChannelCode', 400, 400)
}

function safeProtocolMessage(error) {
  return error instanceof HalfFlowTrafficError ? error.message : 'request failed'
}

async function handlePlainLogin(ctx, action) {
  try {
    const data = await action()
    ctx.status = 200
    ctx.body = { success: true, data }
  }
  catch (error) {
    const status = error && error.status ? error.status : 400
    ctx.status = status
    ctx.body = { success: false, code: status, msg: safeProtocolMessage(error), data: null }
  }
}
```

Route behaviors:

```js
router.post(`${prefix}/admission`, ctx => handleEncrypted(ctx, runtime, args => handleHalfFlowAdmission({ ...args, now })))
router.post(`${prefix}/apply`, ctx => handleEncrypted(ctx, runtime, async args => {
  const result = await handleHalfFlowApply({ ...args, now })
  if (result.shouldNotify) scheduleAsyncJob(() => notifyHalfFlowCreditResult({ row: result.row, repository, config: args.config, httpClient, now }))
  return result.data
}))
router.post(`${prefix}/app/link`, ctx => handleEncrypted(ctx, runtime, args => handleHalfFlowAppLink({ ...args, now, writeDbPartial, flushMongoPersist })))
router.post(`${prefix}/login/consume`, ctx => handlePlainLogin(ctx, () => consumeHalfFlowLoginToken({ ...ctx.request.body, db: readDb(), repository, config: resolveHalfFlowTrafficConfig(configProvider()), now })))
```

The logger prefix is `[half-flow-traffic]`; logs contain only endpoint/order status and safe error messages. Never log decrypted requests or config secrets.

- [ ] **Step 4: 实现刷新策略并验证路径边界**

```js
function resolveHalfFlowTrafficMongoRefreshPlan(method, pathValue, config = {}) {
  if (String(method).toUpperCase() !== 'POST' || !isHalfFlowTrafficPublicPath(pathValue, config)) return null
  const endpoint = endpointAfterPrefix(pathValue, config.routePrefix)
  if (endpoint === '/admission' || endpoint === '/app/link' || endpoint === '/login/consume') {
    return { mode: 'partial', keys: ['users'], allowColdPartial: true }
  }
  if (endpoint === '/apply') return { mode: 'skip' }
  return { mode: 'skip' }
}
```

Add tests for `/api/open/partners/half-flow/...`, unrelated paths, non-POST requests, wrong `ChannelCode`, missing data, short nonce, invalid Base64, invalid JSON, encrypted admission response, encrypted empty apply response, and plain internal login response.

- [ ] **Step 5: 运行路由测试、乱码检查并提交**

Run: `cd 1.api && node --test tests/halfFlowTrafficGateway.test.js`

Expected: PASS for the complete in-memory admission -> apply -> callback -> H5 -> consume flow.

Run: `node scripts/check-mojibake.js .`

Expected: PASS.

```bash
git add 1.api/src/halfFlowTrafficGateway/routes.js 1.api/src/halfFlowTrafficGateway/index.js 1.api/tests/halfFlowTrafficGateway.test.js
git commit -m "feat: expose isolated half-flow gateway routes"
```

---

### Task 7: 主服务最小接线和两套环境配置

**Files:**
- Modify: `1.api/src/index.js:160`
- Modify: `1.api/src/index.js:3952`
- Modify: `1.api/src/index.js:9669`
- Modify: `1.api/src/index.js:12300`
- Modify ignored local config: `1.api/.env.development`
- Modify ignored local config: `1.api/.env.production`
- Modify: `1.api/tests/halfFlowTrafficGateway.test.js`

**Interfaces:**
- Consumes: `registerHalfFlowTrafficGatewayRoutes`, `resolveHalfFlowTrafficMongoRefreshPlan`, `isHalfFlowTrafficPublicPath`
- Produces: no shared business interface changes

- [ ] **Step 1: 写源码接线和默认关闭失败测试**

```js
test('wires half-flow independently without changing existing gateway calls', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8')
  assert.match(source, /loadOptionalHalfFlowTrafficGateway/)
  assert.match(source, /resolveHalfFlowTrafficMongoRefreshPlan/)
  assert.match(source, /registerHalfFlowTrafficGatewayRoutes/)
  assert.match(source, /isHalfFlowTrafficPublicPath/)
  assert.match(source, /registerDuodiandianGatewayRoutes/)
  assert.match(source, /registerZheyinTrafficGatewayRoutes/)
})
```

- [ ] **Step 2: 运行测试并确认主服务尚未接线**

Run: `cd 1.api && node --test tests/halfFlowTrafficGateway.test.js`

Expected: FAIL on `loadOptionalHalfFlowTrafficGateway`.

- [ ] **Step 3: 在主服务增加四处最小接线**

```js
function loadOptionalHalfFlowTrafficGateway() {
  if (String(process.env.HALF_FLOW_TRAFFIC_ENABLED || '').trim().toLowerCase() !== 'true') return null
  try {
    return require('./halfFlowTrafficGateway')
  }
  catch (error) {
    console.warn('[half-flow-traffic] module unavailable, skipped:', error && error.message ? error.message : error)
    return null
  }
}

const halfFlowTrafficGateway = loadOptionalHalfFlowTrafficGateway()
```

In `resolveApiMongoRefreshPlan`, evaluate the Half-Flow plan after the existing two channel plans and before generic API behavior. Register routes in a new independent `if` block next to, not inside, the Shanghai block. Extend `isManagedApiPath` with a separate `isHalfFlowPath` Boolean. Do not edit the existing Duodiandian or Zheyin function bodies or dependency arguments.

- [ ] **Step 4: 在开发环境文件增加完整注释配置**

```dotenv
# ---- 新半流程流量商（Half-Flow）独立接入 ----
# 总开关：false=不加载模块、不注册路由、不读写本渠道集合；联调参数确认前必须保持 false。
HALF_FLOW_TRAFFIC_ENABLED=false
# 对外路由前缀；完整地址由现有 API `/api` 前缀加此值组成。
HALF_FLOW_TRAFFIC_ROUTE_PREFIX=/open/partners/half-flow
# 对方分配的 ChannelCode，请求头必须完全一致；敏感联调参数，未分配时留空。
HALF_FLOW_TRAFFIC_CHANNEL_CODE=
# 我方流量管理中的渠道标识；用于用户归因和 H5 channel 参数，不发送到对方接口头。
HALF_FLOW_TRAFFIC_REGISTER_CHANNEL_CODE=
# 新用户渠道归因展示名；只写入本渠道新创建用户。
HALF_FLOW_TRAFFIC_REGISTER_CHANNEL_NAME=新半流程流量商
# Base64 编码 AES 密钥，解码后必须为 16/24/32 字节；敏感，未分配时留空。
HALF_FLOW_TRAFFIC_AES_KEY=
# 对方授信结果回调完整 HTTPS 地址；未确认时留空，启用前必填。
HALF_FLOW_TRAFFIC_CREDIT_NOTIFY_URL=
# 准入响应客服电话；启用前填写确认后的号码。
HALF_FLOW_TRAFFIC_CUSTOMER_SERVICE_PHONE=
# 基础授信额度，单位元；只影响本渠道申请。
HALF_FLOW_TRAFFIC_DEFAULT_AMOUNT=2750
# 首次获取 H5 时新商城用户额度，单位元；不修改任何已有用户额度。
HALF_FLOW_TRAFFIC_DEFAULT_USER_QUOTA=2750
# 授信有效天数；回调 expireTime 由授信时刻加该天数后转换为毫秒时间戳。
HALF_FLOW_TRAFFIC_CREDIT_EXPIRE_DAYS=365
# 一次性免登票据有效期，单位毫秒；600000=10 分钟，库内只存 SHA-256。
HALF_FLOW_TRAFFIC_LOGIN_TOKEN_TTL_MS=600000
# 授信回调 HTTP 超时，单位毫秒；超时只记录失败，不回滚授信。
HALF_FLOW_TRAFFIC_NOTIFY_TIMEOUT_MS=8000
# 商城 H5 模板；支持 orderId/channel/token/consumePath/domainUrl，占位符必须全部保留。
HALF_FLOW_TRAFFIC_LOAN_URL_TEMPLATE=http://localhost:5173/login?trafficLogin=1&channel={channel}&orderId={orderId}&token={token}&consumePath={consumePath}&domainUrl={domainUrl}
```

- [ ] **Step 5: 在生产环境文件增加同名完整配置**

Use this complete production block so the key set and comments remain explicit. Keep the switch false and all sensitive partner values empty:

```dotenv
# ---- 新半流程流量商（Half-Flow）独立接入 ----
# 总开关：false=不加载模块、不注册路由、不读写本渠道集合；联调验收前必须保持 false。
HALF_FLOW_TRAFFIC_ENABLED=false
# 对外路由前缀；完整地址由现有 API `/api` 前缀加此值组成。
HALF_FLOW_TRAFFIC_ROUTE_PREFIX=/open/partners/half-flow
# 生产 ChannelCode；敏感参数，由流量商分配，未分配时留空。
HALF_FLOW_TRAFFIC_CHANNEL_CODE=
# 我方流量管理中的生产渠道标识；用于用户归因和 H5 channel 参数，不发送到对方接口头。
HALF_FLOW_TRAFFIC_REGISTER_CHANNEL_CODE=
# 新用户渠道归因展示名；只写入本渠道新创建用户。
HALF_FLOW_TRAFFIC_REGISTER_CHANNEL_NAME=新半流程流量商
# Base64 编码生产 AES 密钥；敏感，解码后必须为 16/24/32 字节，未分配时留空。
HALF_FLOW_TRAFFIC_AES_KEY=
# 对方生产授信回调完整 HTTPS 地址；未确认时留空，启用前必填。
HALF_FLOW_TRAFFIC_CREDIT_NOTIFY_URL=
# 生产准入响应客服电话；启用前填写确认后的号码。
HALF_FLOW_TRAFFIC_CUSTOMER_SERVICE_PHONE=
# 基础授信额度，单位元；只影响本渠道申请。
HALF_FLOW_TRAFFIC_DEFAULT_AMOUNT=2750
# 本渠道新商城用户额度，单位元；不修改任何已有用户额度。
HALF_FLOW_TRAFFIC_DEFAULT_USER_QUOTA=2750
# 授信有效天数；回调 expireTime 使用授信时刻加该天数的毫秒时间戳。
HALF_FLOW_TRAFFIC_CREDIT_EXPIRE_DAYS=365
# 一次性免登票据有效期，单位毫秒；数据库只保存 SHA-256。
HALF_FLOW_TRAFFIC_LOGIN_TOKEN_TTL_MS=600000
# 授信回调 HTTP 超时，单位毫秒；失败不回滚授信。
HALF_FLOW_TRAFFIC_NOTIFY_TIMEOUT_MS=8000
# 生产商城 H5 模板；五个占位符必须全部保留。
HALF_FLOW_TRAFFIC_LOAN_URL_TEMPLATE=https://wenshuosc.com/login?trafficLogin=1&channel={channel}&orderId={orderId}&token={token}&consumePath={consumePath}&domainUrl={domainUrl}
```

Do not force-add `.env.development` or `.env.production`; `.gitignore` intentionally protects them. Verify both files locally with `rg -n "^HALF_FLOW_TRAFFIC_"` and confirm each has exactly the same 14 variable names.

- [ ] **Step 6: 运行接线测试和旧渠道定向回归**

Run: `cd 1.api && node --test tests/halfFlowTrafficGateway.test.js tests/zheyinTrafficGateway.test.js tests/duodiandianGateway.test.js`

Expected: all tests PASS.

Run: `node scripts/check-mojibake.js .`

Expected: PASS.

- [ ] **Step 7: 只提交可跟踪代码接线**

```bash
git add 1.api/src/index.js 1.api/tests/halfFlowTrafficGateway.test.js
git commit -m "feat: wire isolated half-flow gateway"
```

Confirm `git status --ignored --short 1.api/.env.development 1.api/.env.production` shows both files remain ignored and no secret is staged.

---

### Task 8: 全量回归和上线保护审计

**Files:**
- Verify only; fix only files introduced or explicitly modified by Tasks 1-7 if a check fails.

**Interfaces:**
- Produces: verified disabled-by-default release candidate

- [ ] **Step 1: 验证代码隔离**

Run: `rg -n "zheyinTrafficGateway|duodiandianGateway|zheyinTrafficApplications|partnerGatewayApplications" 1.api/src/halfFlowTrafficGateway 1.api/tests/halfFlowTrafficGateway.test.js`

Expected: no production module import or old collection match; test-only negative assertions may contain names.

Run: `rg -n "deleteMany|drop\(|dropDatabase|createIndex|renameCollection|migration|migrate" 1.api/src/halfFlowTrafficGateway`

Expected: no matches.

- [ ] **Step 2: 验证环境配置对称和生产关闭**

Run: `rg -n "^HALF_FLOW_TRAFFIC_" 1.api/.env.development 1.api/.env.production`

Expected: both files contain the same 13 keys; production output includes `HALF_FLOW_TRAFFIC_ENABLED=false` and empty sensitive values.

- [ ] **Step 3: 运行新渠道测试**

Run: `cd 1.api && node --test tests/halfFlowTrafficGateway.test.js`

Expected: all Half-Flow tests PASS without connecting to Mongo or external network.

- [ ] **Step 4: 运行后端全量测试**

Run: `cd 1.api && npm test`

Expected: root mojibake check and every `1.api/tests/*.test.js` test PASS.

- [ ] **Step 5: 最终编码、差异和敏感信息检查**

Run: `node scripts/check-mojibake.js .`

Expected: `Mojibake check passed`.

Run: `git diff --check`

Expected: no output.

Run: `git status --short`

Expected: only intended tracked changes, or clean after task commits; `.env.development` and `.env.production` remain ignored.

Run: `git diff origin/app...HEAD -- 1.api/src/zheyinTrafficGateway 1.api/src/duodiandianGateway.js 1.api/src/store.js 2.shop 3.admin 4.admin-liuliang nginx.conf`

Expected: no output.

- [ ] **Step 6: 记录尚需外部确认的上线门槛**

Do not enable production. Handoff must state that production enablement still requires the partner's fixed AES-CTR vector, real `ChannelCode`, Base64 AES key, callback URL, customer-service phone, callback response confirmation, and a test-identity full-chain run. No database migration or historical-data operation is part of deployment or rollback; rollback is only setting `HALF_FLOW_TRAFFIC_ENABLED=false` and restarting the API.
