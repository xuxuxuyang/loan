# 后台登录短信验证 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除后台固定 IP 白名单，改为账号密码通过后发送手机验证码，并签发不绑定 IP、固定 12 小时过期的可撤销后台会话。

**Architecture:** 新增独立的后台登录挑战、会话服务和 Mongo 存储；后台受保护接口通过服务端路由目录统一校验专用随机令牌，商城令牌和商城业务保持原样。Nginx 只保留 HTTPS、反向代理和真实 IP 转发，不再参与管理员身份判断。

**Tech Stack:** Node.js CommonJS、Koa、MongoDB TTL 索引、Node `crypto`、Vue 3、TypeScript、Vite、Node test runner、Nginx。

## Global Constraints

- 验证码发送到当前后台账号 `adminAccounts.phone`，必须先通过账号密码校验。
- 后台会话自验证码通过起固定有效 `43200000` 毫秒，不续期、不绑定 IP。
- 生产后台登录不得降级为旧 `mock-token`、手机号/角色请求头或默认超级管理员。
- 商城用户登录、商城 `mock-token`、下单、支付和合作方接口不在本期改造。
- 新数据只写入 `adminLoginChallenges`、`adminLoginSessions`，不加入 `store.js` 快照实体。
- 所有可变参数写入 `.env.development`、`.env.production`、`.env.example`，生产配置异常时后台登录失败关闭。
- 每次文件修改后，最终必须从项目根运行 `node scripts/check-mojibake.js .`。

---

### Task 1: 登录挑战和会话核心服务

**Files:**
- Create: `1.api/src/adminLoginSecurity.js`
- Create: `1.api/src/adminLoginSecurityStore.js`
- Test: `1.api/tests/adminLoginSecurity.test.js`

**Interfaces:**
- Produces: `createAdminLoginSecurityService(options)`，包含 `createChallenge(context)`、`verifyChallenge(input)`、`resolveSession(token)`、`revokeSession(token)`、`ensureIndexes()`。
- Produces: `createMemoryAdminLoginSecurityStore(options)` 和 `createMongoAdminLoginSecurityStore(options)`。
- Produces: `AdminLoginSecurityError`，包含稳定的 `code`、`message`、`status`。
- Depends on: `mongo.getMongoClient()` 与 `mongoConfig.getMongoConfig()`，安全集合固定存放在根数据库，不随请求 workspace 切换。

- [ ] **Step 1: 编写核心行为失败测试**

在 `adminLoginSecurity.test.js` 建立内存存储和固定时钟，覆盖：

```js
test('password-verified account receives a challenge and plaintext code is never stored', async () => {
  const sent = []
  const fixture = createFixture({ sendSms: async (phone, message) => sent.push({ phone, message }) })
  const result = await fixture.service.createChallenge(fixture.context)
  assert.equal(result.phoneMasked, '138****8000')
  assert.equal(sent.length, 1)
  assert.doesNotMatch(JSON.stringify(fixture.store.dump()), /123456/)
})

test('verified code issues a 12 hour opaque session that is not bound to IP', async () => {
  const fixture = createFixture()
  const challenge = await fixture.service.createChallenge(fixture.context)
  const login = await fixture.service.verifyChallenge({ challengeId: challenge.challengeId, code: fixture.code })
  assert.match(login.token, /^admin-session-v1\./)
  assert.equal(Date.parse(login.expiresAt) - fixture.nowMs, 43_200_000)
  assert.equal((await fixture.service.resolveSession(login.token, { ip: '203.0.113.99' })).username, 'boss1')
})

test('a session stops resolving after its fixed expiry', async () => {
  const fixture = createFixture({ sessionTtlMs: 1000 })
  const challenge = await fixture.service.createChallenge(fixture.context)
  const login = await fixture.service.verifyChallenge({ challengeId: challenge.challengeId, code: fixture.code })
  fixture.setNow(fixture.nowMs + 1001)
  await assert.rejects(() => fixture.service.resolveSession(login.token), { code: 'ADMIN_LOGIN_SESSION_EXPIRED' })
})

test('revocation invalidates a live session immediately', async () => {
  const fixture = createFixture()
  const challenge = await fixture.service.createChallenge(fixture.context)
  const login = await fixture.service.verifyChallenge({ challengeId: challenge.challengeId, code: fixture.code })
  await fixture.service.revokeSession(login.token)
  await assert.rejects(() => fixture.service.resolveSession(login.token), { code: 'ADMIN_LOGIN_SESSION_INVALID' })
})

test('a verified challenge cannot issue a second session', async () => {
  const fixture = createFixture()
  const challenge = await fixture.service.createChallenge(fixture.context)
  await fixture.service.verifyChallenge({ challengeId: challenge.challengeId, code: fixture.code })
  await assert.rejects(
    () => fixture.service.verifyChallenge({ challengeId: challenge.challengeId, code: fixture.code }),
    { code: 'ADMIN_LOGIN_CHALLENGE_INVALID' },
  )
})
```

同一测试文件分别增加具名用例，断言挑战在 5 分钟后返回 `ADMIN_LOGIN_CHALLENGE_EXPIRED`、60 秒内重发返回 `ADMIN_LOGIN_RESEND_LIMITED`、第 11 次小时发送返回 `ADMIN_LOGIN_HOURLY_LIMITED`、第 5 次错误输入使挑战进入 `blocked`，以及无手机号、短信通道不可用、不完整配置都不会创建会话。

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `cd C:\Users\xu\Desktop\loan\1.api && node --test tests/adminLoginSecurity.test.js`

Expected: FAIL，原因是 `../src/adminLoginSecurity` 或 `../src/adminLoginSecurityStore` 尚不存在。

- [ ] **Step 3: 实现最小核心服务和双存储**

核心生成规则固定为：

```js
const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
const token = `admin-session-v1.${randomBytes(32).toString('base64url')}`
const digest = value => crypto.createHmac('sha256', secret).update(String(value)).digest('hex')
```

Mongo 存储创建以下索引：

```js
await Promise.all([
  challenges.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
  challenges.createIndex({ accountId: 1, tenantId: 1, createdAt: -1 }),
  sessions.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
  sessions.createIndex({ tokenHash: 1 }, { unique: true }),
  sessions.createIndex({ accountId: 1, revokedAt: 1, expireAt: 1 }),
])
```

验证码验证和挑战消费使用带 `status: 'pending'`、`attempts: { $lt: maxAttempts }`、`expireAt: { $gt: now }` 的原子 `findOneAndUpdate`；会话解析只接受未撤销、未过期记录。

- [ ] **Step 4: 运行核心测试并确认通过**

Run: `cd C:\Users\xu\Desktop\loan\1.api && node --test tests/adminLoginSecurity.test.js`

Expected: 全部 PASS，0 failed。

- [ ] **Step 5: 提交核心服务**

```bash
git add 1.api/src/adminLoginSecurity.js 1.api/src/adminLoginSecurityStore.js 1.api/tests/adminLoginSecurity.test.js
git commit -m "feat: add secure admin login sessions"
```

---

### Task 2: 后台路由目录与 API 强制鉴权

**Files:**
- Create: `1.api/src/adminLoginRoutePolicy.js`
- Modify: `1.api/src/index.js`
- Create: `1.api/tests/adminLoginSecurityIntegration.test.js`
- Test: `1.api/tests/adminPlatformLoginSource.test.js`

**Interfaces:**
- Consumes: Task 1 的登录安全服务与 Mongo 存储。
- Produces: `isAdminProtectedRequest(method, path)`、`isAdminLoginPublicRequest(method, path)`。
- Produces: `POST /api/admin/login`、`POST /api/admin/login/verify`、`POST /api/admin/logout`，并保留 `/api/login` 和 `/api/login/verify` 兼容入口。
- Produces: 受保护请求的 `ctx.state.adminAccount`、`ctx.state.adminRole`、`ctx.state.adminLoginSession`。

- [ ] **Step 1: 编写路由目录和绕过防护失败测试**

测试表至少包含：

```js
const protectedCases = [
  ['GET', '/api/admin/profile'],
  ['GET', '/api/platform/tenants'],
  ['GET', '/api/users'],
  ['GET', '/api/orders'],
  ['PATCH', '/api/orders/o1'],
  ['DELETE', '/api/orders/o1'],
  ['POST', '/api/products'],
  ['POST', '/api/uploads/public-image'],
]
const publicCases = [
  ['POST', '/api/admin/login'],
  ['POST', '/api/admin/login/verify'],
  ['POST', '/api/login'],
  ['POST', '/api/login/verify'],
  ['GET', '/api/users/by-phone'],
  ['POST', '/api/orders'],
  ['GET', '/api/products'],
  ['POST', '/api/payment/lakala/notify'],
]
```

集成测试还必须断言旧 `Bearer mock-token-13800138000`、`x-admin-role: super_admin`、`x-admin-phone` 和 `?adminRole=super_admin` 都不能访问受保护接口。

- [ ] **Step 2: 运行集成测试并确认失败**

Run: `cd C:\Users\xu\Desktop\loan\1.api && node --test tests/adminLoginSecurityIntegration.test.js`

Expected: FAIL，原因是路由策略和登录验证码接口尚未实现，旧凭据仍被接受。

- [ ] **Step 3: 接入两步登录接口**

将现有 `handleAdminLogin` 拆为凭据解析和挑战创建。第一步成功响应：

```js
ctx.body = success({
  verificationRequired: true,
  challengeId: challenge.challengeId,
  phoneMasked: challenge.phoneMasked,
  expiresAt: challenge.expiresAt,
  resendAt: challenge.resendAt,
})
```

第二步验证后重新读取账号并检查 `active`、账号 ID、租户范围，再返回原登录资料以及：

```js
token: verified.token,
expiresAt: verified.expiresAt,
```

短信复用 `createAdminSecuritySmsSender()`；短信模板改用独立的 `ADMIN_LOGIN_SMS_MSG_TEMPLATE`。

- [ ] **Step 4: 在租户解析前安装后台会话网关**

网关逻辑：

```js
if (!isAdminProtectedRequest(ctx.method, ctx.path) || isAdminLoginPublicRequest(ctx.method, ctx.path)) {
  await next()
  return
}
const session = await adminLoginSecurityService.resolveSession(readBearer(ctx))
const account = await resolveAccountForAdminSession(session)
if (!account || account.status !== 'active') {
  fail(ctx, '后台登录已失效，请重新登录', 401, 'ADMIN_LOGIN_SESSION_INVALID')
  return
}
ctx.state.adminLoginSession = session
ctx.state.adminAccount = account
ctx.state.adminRole = account.role
ctx.state._resolvedAdminRole = true
ctx.state._resolvedAdminAccount = true
await next()
```

`clampIncomingWorkspaceType` 只信任上述会话账号。`resolveAdminRole` 对受保护后台请求不再读取手机号、角色、查询参数或默认超管；商城 token 解析函数保留给商城路径。

- [ ] **Step 5: 初始化索引并实现退出登录**

Mongo 连接成功后、监听端口前执行 `await adminLoginSecurityService.ensureIndexes()`。`POST /api/admin/logout` 撤销当前会话；即使撤销接口失败，前端仍允许清除本地状态。

- [ ] **Step 6: 运行后台集成和既有平台登录测试**

Run: `cd C:\Users\xu\Desktop\loan\1.api && node --test tests/adminLoginSecurityIntegration.test.js tests/adminPlatformLoginSource.test.js`

Expected: 全部 PASS，0 failed。

- [ ] **Step 7: 提交 API 集成**

```bash
git add 1.api/src/adminLoginRoutePolicy.js 1.api/src/index.js 1.api/tests/adminLoginSecurityIntegration.test.js 1.api/tests/adminPlatformLoginSource.test.js
git commit -m "feat: enforce sms verified admin sessions"
```

---

### Task 3: 后台两步登录界面与 12 小时过期

**Files:**
- Create: `3.admin/src/api/adminLogin.ts`
- Modify: `3.admin/src/views/LoginPage.vue`
- Modify: `3.admin/src/components/auth/LoginCard.vue`
- Modify: `3.admin/src/composables/useAdminAuth.ts`
- Modify: `3.admin/src/composables/useAdminApi.ts`
- Modify: `3.admin/src/router/index.ts`
- Modify: `3.admin/src/App.vue`
- Create: `3.admin/tests/adminLoginSmsUi.test.mjs`

**Interfaces:**
- Produces: `createAdminLoginChallenge(credentials)`、`verifyAdminLoginChallenge(challengeId, code)`、`revokeAdminLoginSession()`。
- Extends: `AdminSession.expiresAt: string`。
- Changes: `withAdminAuthHeaders()` 只发送 Bearer、租户和 workspace，不再发送客户端角色或用户名作为身份凭据。

- [ ] **Step 1: 编写前端失败测试**

静态行为测试断言：

```js
assert.match(loginPage, /createAdminLoginChallenge/)
assert.match(loginPage, /verifyAdminLoginChallenge/)
assert.match(loginCard, /验证码/)
assert.match(loginCard, /phoneMasked/)
assert.match(adminAuth, /expiresAt/)
assert.match(adminAuth, /Date\.parse/)
assert.doesNotMatch(adminApi, /headers\.set\('x-admin-role'/)
assert.doesNotMatch(adminApi, /headers\.set\('x-admin-username'/)
```

并断言 `App.vue` 根据 `expiresAt` 设置单次退出定时器，退出时调用撤销接口后无条件清除本地会话。

- [ ] **Step 2: 运行前端测试并确认失败**

Run: `cd C:\Users\xu\Desktop\loan\3.admin && node --test tests/adminLoginSmsUi.test.mjs`

Expected: FAIL，原因是两步登录 API、验证码 UI 和 `expiresAt` 尚不存在。

- [ ] **Step 3: 实现两步登录状态机**

`LoginPage.vue` 使用 `credentials`、`challenge`、`verificationCode` 三组仅内存状态：第一步成功后不写 localStorage；第二步成功后才调用 `setAdminSession()`。返回登录页或挑战过期时清空密码和验证码。

`LoginCard.vue` 在 `step === 'credentials'` 时显示账号密码，在 `step === 'verification'` 时显示：

- `验证码已发送至 138****8000`
- 六位数字输入框
- 60 秒倒计时
- `确认登录`
- `重新发送`（倒计时结束后可用）
- `返回修改账号`

- [ ] **Step 4: 实现本地会话到期处理**

`safeParseSession()` 要求 `expiresAt` 有效且晚于当前时间，否则删除旧 localStorage 项并返回 `null`。`App.vue` 在登录后设置到期定时器，到点调用统一退出逻辑；浏览器休眠恢复后再次比较当前时间，避免定时器延迟导致超期会话留存。

- [ ] **Step 5: 移除不可信身份请求头并实现退出撤销**

`withAdminAuthHeaders()` 保留：

```ts
Authorization: Bearer ${session.token}
x-tenant-id: ${session.tenantId}
x-workspace-type: ${resolveRequestWorkspaceType(session)}
```

删除 `x-admin-role`、`x-admin-username`。退出登录先尽力调用 `/admin/logout`，随后始终执行 `clearAdminSession()` 和路由跳转。

- [ ] **Step 6: 运行前端测试和构建**

Run: `cd C:\Users\xu\Desktop\loan\3.admin && node --test tests/adminLoginSmsUi.test.mjs`

Run: `cd C:\Users\xu\Desktop\loan\3.admin && npm run build`

Expected: 测试全部 PASS，构建退出码 0。

- [ ] **Step 7: 提交前端登录流程**

```bash
git add 3.admin/src/api/adminLogin.ts 3.admin/src/views/LoginPage.vue 3.admin/src/components/auth/LoginCard.vue 3.admin/src/composables/useAdminAuth.ts 3.admin/src/composables/useAdminApi.ts 3.admin/src/router/index.ts 3.admin/src/App.vue 3.admin/tests/adminLoginSmsUi.test.mjs
git commit -m "feat: add admin sms login flow"
```

---

### Task 4: 环境变量与可替换 Nginx 配置

**Files:**
- Modify: `1.api/.env.example`
- Modify: `1.api/.env.development`
- Modify: `1.api/.env.production`
- Modify: `nginx.conf`
- Create: `1.api/tests/adminLoginDeploymentConfig.test.js`

**Interfaces:**
- Produces: 八项 `ADMIN_LOGIN_*` 配置及中文维护注释。
- Produces: 不含后台 IP 白名单、8080 仅跳转 HTTPS 的完整 Nginx 文件。

- [ ] **Step 1: 编写部署配置失败测试**

测试读取 `.env.example` 和根目录 `nginx.conf`，断言：

```js
for (const key of [
  'ADMIN_LOGIN_SMS_MODE',
  'ADMIN_LOGIN_SECURITY_SECRET',
  'ADMIN_LOGIN_SMS_MSG_TEMPLATE',
  'ADMIN_LOGIN_OTP_TTL_MS',
  'ADMIN_LOGIN_OTP_RESEND_MS',
  'ADMIN_LOGIN_OTP_HOURLY_SEND_LIMIT',
  'ADMIN_LOGIN_OTP_MAX_ATTEMPTS',
  'ADMIN_LOGIN_SESSION_TTL_MS',
]) assert.match(envExample, new RegExp(`^${key}=`, 'm'))

assert.doesNotMatch(nginx, /115\.152\.87\.204|60\.179\.212\.69|39\.189\.46\.72/)
assert.doesNotMatch(nginx, /admin_ip_allowed|admin_request_denied|deny all/)
assert.match(nginx, /listen\s+8080;[\s\S]*return 301 https:\/\/admin\.wenshuosc\.com\$request_uri;/)
```

- [ ] **Step 2: 运行配置测试并确认失败**

Run: `cd C:\Users\xu\Desktop\loan\1.api && node --test tests/adminLoginDeploymentConfig.test.js`

Expected: FAIL，因为登录环境变量未记录且 Nginx 仍包含白名单。

- [ ] **Step 3: 写入开发、生产和示例环境配置**

三份文件写入同样的变量名和详细中文注释：

```dotenv
ADMIN_LOGIN_SMS_MODE=enforce
ADMIN_LOGIN_SECURITY_SECRET=
ADMIN_LOGIN_SMS_MSG_TEMPLATE=【现有备案签名】您的后台登录验证码为{code}，5分钟内有效，请勿泄露。
ADMIN_LOGIN_OTP_TTL_MS=300000
ADMIN_LOGIN_OTP_RESEND_MS=60000
ADMIN_LOGIN_OTP_HOURLY_SEND_LIMIT=10
ADMIN_LOGIN_OTP_MAX_ATTEMPTS=5
ADMIN_LOGIN_SESSION_TTL_MS=43200000
```

`.env.example` 的密钥和值保持示例性质；实际开发和生产密钥不得相同，验证脚本只输出“存在/长度/是否相同”，不得输出密钥内容。
开发和生产文件各自使用 `crypto.randomBytes(48).toString('base64url')` 生成一次密钥并写入；生成过程不把密钥输出到终端或日志。

- [ ] **Step 4: 移除 Nginx IP 鉴权并保护 HTTP 入口**

删除 `geo`、两个 `map`、所有 `$admin_request_denied` 条件和三个 IP 的 `allow/deny`。后台 80 端口直接 301 到 HTTPS；8080 server 只保留：

```nginx
server {
    listen 8080;
    listen [::]:8080;
    server_name _;
    return 301 https://admin.wenshuosc.com$request_uri;
}
```

其它商城、API、静态文件、风险接口、支付与合作方代理块逐行保留。

- [ ] **Step 5: 运行部署配置测试和静态 Nginx 检查**

Run: `cd C:\Users\xu\Desktop\loan\1.api && node --test tests/adminLoginDeploymentConfig.test.js`

Run: `cd C:\Users\xu\Desktop\loan && rg -n "115\.152\.87\.204|60\.179\.212\.69|39\.189\.46\.72|admin_ip_allowed|admin_request_denied|deny all" nginx.conf`

Expected: 测试 PASS；`rg` 退出码 1 且无匹配。服务器上仍需另行执行真实 `nginx -t`。

- [ ] **Step 6: 提交部署配置**

```bash
git add nginx.conf 1.api/.env.example 1.api/tests/adminLoginDeploymentConfig.test.js
git commit -m "chore: replace admin ip allowlist with sms login"
```

说明：`.env.development`、`.env.production` 被 Git 忽略，只保留在对应环境，不加入提交。

---

### Task 5: 全量验证与上线交接

**Files:**
- Verify only; no production business data writes.

**Interfaces:**
- Consumes: Tasks 1-4 的完整实现。
- Produces: 可部署构建产物和明确的服务器上线顺序。

- [ ] **Step 1: 运行后端全量测试**

Run: `cd C:\Users\xu\Desktop\loan\1.api && npm test`

Expected: 0 failed。

- [ ] **Step 2: 运行后台前端全量测试**

Run: `cd C:\Users\xu\Desktop\loan\3.admin && node --test tests/*.test.mjs`

Expected: 记录总数、通过数和任何失败；若仍存在与本功能无关的既有失败，必须明确标出，不能声称全量通过。

- [ ] **Step 3: 构建后台前端**

Run: `cd C:\Users\xu\Desktop\loan\3.admin && npm run build`

Expected: exit 0。

- [ ] **Step 4: 检查差异、乱码和生产环境完整性**

Run: `cd C:\Users\xu\Desktop\loan && git diff --check`

Run: `cd C:\Users\xu\Desktop\loan && node scripts/check-mojibake.js .`

Run: 从 Node 读取 `1.api/.env.production`，仅输出 8/8 配置完整、密钥长度合格、短信模板含 `{code}`、会话 TTL 为 `43200000`，不得输出密钥。

Expected: diff check 与乱码检查通过，生产环境摘要全部为 true。

- [ ] **Step 5: 形成部署说明，不直接操作服务器**

交接必须写明：先保留旧 IP 白名单部署 API/前端并完成短信登录验证，再替换 Nginx；替换前备份，服务器执行 `nginx -t && systemctl reload nginx`。任何短信异常都恢复旧 Nginx 备份，不关闭短信鉴权、不迁移或修改业务数据。
