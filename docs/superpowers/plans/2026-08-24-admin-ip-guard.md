# Admin IP Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every mall-facing workflow online while allowing only `129.227.151.105` to enter the admin UI, resolve an admin identity, or call an admin read/write operation.

**Architecture:** Add a focused CommonJS security module that normalizes the real client IP, classifies known admin requests, and fails closed for admin traffic when `ADMIN_ALLOWED_IPS` is absent or does not match. Invoke it globally for known admin paths and again at the central admin login/permission boundary. Add the same early-rejection policy to every Nginx API gateway and the admin UI, using a separate deployable `geo` include.

**Tech Stack:** Node.js 24, CommonJS, Koa 3, Node native test runner, Nginx `geo`/`map`, PowerShell verification.

## Global Constraints

- Allow production admin access only from `129.227.151.105`.
- Do not stop or restrict mall registration, login, product reads, `POST /api/orders`, `/api/my/orders`, bills, payments, callbacks, addresses, bank cards, mall customer service, iOS, or traffic gateways.
- Do not read, write, migrate, delete, or test against live business data.
- Keep the IP in environment/configuration files, not business logic.
- A missing or invalid allowlist fails closed only for admin traffic; mall traffic remains available.
- Trust `X-Real-IP` only when the Node socket peer is loopback; otherwise use the socket address and ignore forwarding headers.
- Run `node scripts/check-mojibake.js .` from the repository root after every file-changing task and before completion.

---

### Task 1: Pure admin IP policy module

**Files:**
- Create: `1.api/src/adminIpGuard.js`
- Create: `1.api/tests/adminIpGuard.test.js`

**Interfaces:**
- Consumes: Koa-like `{ method, path, headers, req.socket.remoteAddress, state }` contexts and `ADMIN_ALLOWED_IPS` text.
- Produces: `normalizeIp(value)`, `parseAllowedIps(raw)`, `resolveClientIp(ctx)`, `hasAdminRequestHint(ctx)`, `isProtectedAdminRequest(ctx)`, and `enforceAdminIp(ctx, options)`.

- [ ] **Step 1: Write failing policy tests**

Create `1.api/tests/adminIpGuard.test.js` with Node `node:test` cases for exact IPv4 allow, non-allow denial, missing configuration `503`, loopback proxy trust, non-loopback spoof rejection, IPv4-mapped IPv6, admin headers, all `/api/admin` and `/api/platform` paths, admin users/orders/product mutations, and public mall exceptions. Use this context factory in the test:

```js
function createCtx({
  method = 'GET',
  path = '/api/admin/profile',
  remoteAddress = '127.0.0.1',
  realIp = '129.227.151.105',
  headers = {},
} = {}) {
  return {
    method,
    path,
    headers: { ...headers, ...(realIp ? { 'x-real-ip': realIp } : {}) },
    req: { socket: { remoteAddress } },
    state: {},
    status: 200,
    body: null,
    get(name) { return this.headers[String(name).toLowerCase()] || '' },
  }
}
```

Assert these public cases remain unprotected: `POST /api/orders`, `GET /api/my/orders`, `GET /api/products`, `GET /api/users/by-phone`, `/api/auth/login`, `/api/bills`, `/api/payment/lakala/notify`, `/api/addresses`, `/api/bank-cards`, `/api/mall/cs/messages`, `/api/ios/installment/orders`, and traffic gateway paths.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test tests/adminIpGuard.test.js` from `1.api`.

Expected: FAIL with `Cannot find module '../src/adminIpGuard'`.

- [ ] **Step 3: Implement the minimal security module**

Create `1.api/src/adminIpGuard.js` using `node:net.isIP`. The implementation must:

```js
const net = require('node:net')

function normalizeIp(value) {
  let ip = String(value || '').trim()
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1)
  if (ip.toLowerCase().startsWith('::ffff:') && net.isIP(ip.slice(7)) === 4) ip = ip.slice(7)
  return net.isIP(ip) ? ip.toLowerCase() : ''
}

function parseAllowedIps(raw) {
  return new Set(String(raw || '').split(',').map(normalizeIp).filter(Boolean))
}

function isLoopbackIp(ip) {
  return ip === '127.0.0.1' || ip === '::1'
}

function resolveClientIp(ctx) {
  const socketIp = normalizeIp(ctx && ctx.req && ctx.req.socket && ctx.req.socket.remoteAddress)
  if (!isLoopbackIp(socketIp)) return socketIp
  const realIp = normalizeIp(ctx && typeof ctx.get === 'function' ? ctx.get('x-real-ip') : ctx && ctx.headers && ctx.headers['x-real-ip'])
  return realIp || socketIp
}
```

`hasAdminRequestHint` must recognize `x-admin-role`, `x-admin-phone`, `x-admin-username`, `x-user-role`, `x-user-phone`, and `x-user-username`. `isProtectedAdminRequest` must protect requests with those hints plus the explicit admin route matrix from the approved design, while preserving every public exception listed in Step 1.

`enforceAdminIp(ctx, { force = false, env = process.env, log = console.warn } = {})` must return `true` for public traffic. For protected/forced traffic it must cache one decision in `ctx.state`, return `503` with `{ success: false, code: 503, msg: '后台 IP 白名单未配置，后台访问已暂停', data: null }` when the allowlist is empty, return `403` with `{ success: false, code: 403, msg: '当前 IP 无权访问后台', data: null }` when denied, and emit one JSON security event containing only timestamp, decision, method, path, and client IP.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `node --test tests/adminIpGuard.test.js` from `1.api`.

Expected: all admin IP policy tests PASS.

- [ ] **Step 5: Run encoding verification**

Run: `node scripts/check-mojibake.js .` from the repository root.

Expected: `Mojibake check passed`.

- [ ] **Step 6: Commit the isolated policy module**

```powershell
git add -- 1.api/src/adminIpGuard.js 1.api/tests/adminIpGuard.test.js
git commit -m "feat: add admin IP access policy"
```

---

### Task 2: Enforce the policy at every admin identity boundary

**Files:**
- Modify: `1.api/src/index.js`
- Modify: `1.api/.env.example`
- Modify locally for deployment: `1.api/.env.production`
- Modify locally for development: `1.api/.env.development`
- Create: `1.api/tests/adminIpGuardIntegrationSource.test.js`

**Interfaces:**
- Consumes: `enforceAdminIp(ctx, { force })` from Task 1.
- Produces: fail-closed global route protection plus central protection for admin login, role resolution, and both main permission functions.

- [ ] **Step 1: Write failing integration/source assertions**

Create `1.api/tests/adminIpGuardIntegrationSource.test.js`. Read `src/index.js` and assert that it imports `enforceAdminIp`, calls `enforceAdminIp(ctx, { force: true })` inside `handleAdminLogin`, `resolveAdminRole`, `requireAdminPermission`, and `requireAdminPermissionOnAny`, and mounts a global middleware calling `enforceAdminIp(ctx)` before `app.use(router.routes())`. Read `.env.example` and assert it documents `ADMIN_ALLOWED_IPS`.

- [ ] **Step 2: Run the integration/source test and confirm RED**

Run: `node --test tests/adminIpGuardIntegrationSource.test.js` from `1.api`.

Expected: FAIL because `index.js` does not import or invoke the guard.

- [ ] **Step 3: Wire the guard into `index.js`**

Import the module near other local security helpers:

```js
const { enforceAdminIp } = require('./adminIpGuard')
```

Add this as the first statement in `handleAdminLogin`, `resolveAdminRole`, `requireAdminPermission`, and `requireAdminPermissionOnAny`:

```js
if (!enforceAdminIp(ctx, { force: true })) {
  return ''
}
```

For `handleAdminLogin`, use bare `return` rather than returning a role. Mount the following middleware after `bodyParser` and before tenant/Mongo/router middleware:

```js
app.use(async (ctx, next) => {
  if (!enforceAdminIp(ctx)) return
  await next()
})
```

This double enforcement is intentional: route classification rejects known admin requests early, while forced checks prevent direct calls through current and future admin identity/permission helpers.

- [ ] **Step 4: Add environment configuration**

Add the following documented production setting to `.env.example` and `.env.production`:

```dotenv
# 后台页面、查询和数据操作仅允许这些公网 IP；多个地址用英文逗号分隔
ADMIN_ALLOWED_IPS=129.227.151.105
```

Add this development value to `.env.development`:

```dotenv
ADMIN_ALLOWED_IPS=127.0.0.1,::1
```

- [ ] **Step 5: Run policy and integration tests**

Run: `node --test tests/adminIpGuard.test.js tests/adminIpGuardIntegrationSource.test.js` from `1.api`.

Expected: all tests PASS.

- [ ] **Step 6: Run the complete API suite**

Run: `npm test` from `1.api`.

Expected: mojibake check and all API tests PASS.

- [ ] **Step 7: Commit tracked API integration files**

```powershell
git add -- 1.api/src/index.js 1.api/.env.example 1.api/tests/adminIpGuardIntegrationSource.test.js
git commit -m "feat: enforce IP guard for all admin access"
```

Do not add ignored `.env.production` or `.env.development` files to Git; verify their local values separately for deployment.

---

### Task 3: Add Nginx early rejection on every exposed gateway

**Files:**
- Create: `nginx.admin-allowed-ips.conf`
- Modify: `nginx.conf`
- Create: `1.api/tests/nginxAdminIpGuardSource.test.js`

**Interfaces:**
- Consumes: server-local `/etc/nginx/admin-allowed-ips.conf` copied from the tracked whitelist config.
- Produces: `$admin_ip_allowed`, `$admin_route_protected`, `$admin_header_protected`, `$admin_request_denied`, and early `403` responses.

- [ ] **Step 1: Write failing Nginx source assertions**

Create `1.api/tests/nginxAdminIpGuardSource.test.js` to read `../../nginx.conf` and `../../nginx.admin-allowed-ips.conf`. Assert the whitelist contains `129.227.151.105 1;`, the `http` block defines the four variables above, all four `/api/` proxy locations contain `if ($admin_request_denied = 1) { return 403; }`, and the admin HTTP, admin HTTPS, and port `8080` UI entries apply `$admin_ip_allowed`.

- [ ] **Step 2: Run the Nginx source test and confirm RED**

Run: `node --test tests/nginxAdminIpGuardSource.test.js` from `1.api`.

Expected: FAIL because the whitelist and Nginx variables do not exist.

- [ ] **Step 3: Add the deployable Nginx whitelist**

Create `nginx.admin-allowed-ips.conf`:

```nginx
# Copied to /etc/nginx/admin-allowed-ips.conf on the production server.
129.227.151.105 1;
```

- [ ] **Step 4: Add `geo` and `map` policy to `nginx.conf`**

Inside `http`, before server blocks, add a `geo` include for `/etc/nginx/admin-allowed-ips.conf`. Add ordered `map` rules that exempt `GET /api/users/by-phone` and `POST /api/orders`, protect `/api/admin`, `/api/platform`, `/api/login`, other `/api/users`, admin `/api/orders`, product mutations, and `/api/uploads/public-image`, and treat any `x-admin-*`/`x-user-*` identity hint as admin traffic. Combine route/header protection with `$admin_ip_allowed` into `$admin_request_denied`.

Inside each of the four `/api/` proxy locations, add:

```nginx
if ($admin_request_denied = 1) {
    return 403;
}
```

Restrict both admin-domain `location /` blocks and the entire port `8080` server to `$admin_ip_allowed`, while leaving `/.well-known/acme-challenge/` public.

- [ ] **Step 5: Run Nginx source tests**

Run: `node --test tests/nginxAdminIpGuardSource.test.js` from `1.api`.

Expected: PASS.

- [ ] **Step 6: Run complete verification**

Run from the repository root:

```powershell
node scripts/check-mojibake.js .
Set-Location 1.api
npm test
```

Expected: root mojibake check and all API tests PASS.

- [ ] **Step 7: Commit Nginx protection**

```powershell
git add -- nginx.conf nginx.admin-allowed-ips.conf 1.api/tests/nginxAdminIpGuardSource.test.js
git commit -m "feat: restrict admin gateways by IP"
```

---

### Task 4: Deployment and non-mutating verification handoff

**Files:**
- Create: `docs/ADMIN_IP_GUARD_DEPLOY.md`

**Interfaces:**
- Consumes: the tracked Nginx files, API code, and local production environment from Tasks 1-3.
- Produces: exact backup, deployment, validation, and rollback commands that do not mutate business data.

- [ ] **Step 1: Write the deployment runbook**

Document commands to back up `/etc/nginx/nginx.conf`, `/var/1bossapi`, and access logs; copy `nginx.admin-allowed-ips.conf` to `/etc/nginx/admin-allowed-ips.conf`; verify `.env.production` contains `ADMIN_ALLOWED_IPS=129.227.151.105`; run `nginx -t`; reload rather than restart Nginx; restart only `bossapi` after code deployment; and inspect PM2/Nginx errors.

The runbook must use only non-mutating HTTP checks: allowed-IP admin login with intentionally invalid credentials should return `401` rather than `403`; a non-allowed network should receive `403`; public product, health, and other safe GET routes should remain reachable. It must explicitly prohibit testing by changing a real order, repayment, user, product, or account.

- [ ] **Step 2: Add rollback commands**

Document restoring the timestamped Nginx backup, running `nginx -t`, reloading Nginx, restoring the prior API release, and retaining logs. State that removing the guard without restoring a secure prior release reopens the incident.

- [ ] **Step 3: Run final repository verification**

Run:

```powershell
node scripts/check-mojibake.js .
Set-Location 1.api
npm test
git status --short
```

Expected: all checks PASS; status contains only intended plan/runbook changes before commit.

- [ ] **Step 4: Commit the runbook**

```powershell
git add -- docs/ADMIN_IP_GUARD_DEPLOY.md
git commit -m "docs: add admin IP guard deployment runbook"
```

