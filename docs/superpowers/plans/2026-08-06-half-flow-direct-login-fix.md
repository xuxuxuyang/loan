# Half-Flow Direct Login Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every newly issued half-flow repayment link use the mall's stable `applyNo` login contract and enter the mall automatically after one-time token consumption.

**Architecture:** Keep the mall frontend and every existing traffic channel unchanged. The independent half-flow URL template maps the partner `orderId` value into the query key `applyNo`; the independent half-flow `/login/consume` route maps `body.applyNo` back into the module's internal `orderId` argument.

**Tech Stack:** Node.js CommonJS, Koa, Node test runner, Vue mall's existing traffic-login contract.

## Global Constraints

- Do not modify `2.shop` traffic-login code, Shanghai Qihao, Duodiandian, shared database schemas, or historical data.
- Do not add compatibility aliases or dual request shapes; the internal mall contract is exactly `applyNo + token`.
- Change only the half-flow module, half-flow test/configuration, and its documentation.
- Do not stage, commit, merge, or push Git changes.
- After every file-edit batch, run `node scripts/check-mojibake.js .` from the repository root.

---

### Task 1: Reproduce the broken browser-to-consume contract

**Files:**
- Modify: `1.api/tests/halfFlowTrafficGateway.test.js`

**Interfaces:**
- Consumes: `handleHalfFlowAppLink()` and the registered `POST /open/partners/half-flow/login/consume` handler.
- Produces: a regression test proving the returned URL has `applyNo`, omits `orderId`, and succeeds when the mall posts `{ applyNo, token }`.

- [ ] **Step 1: Change the test-only loan URL template to the stable mall query shape**

```js
loanUrlTemplate: 'https://shop.example.com/login?trafficLogin=1&channel={channel}&applyNo={orderId}&token={token}&consumePath={consumePath}&domainUrl={domainUrl}',
```

- [ ] **Step 2: Assert the browser-facing URL and consume request contract**

```js
assert.equal(url.searchParams.get('applyNo'), row.orderId)
assert.equal(url.searchParams.get('orderId'), null)

const loginUrl = new URL(repaymentAddress)
const applyNo = loginUrl.searchParams.get('applyNo')
const token = loginUrl.searchParams.get('token')
const consume = makeCtx({ applyNo, token }, '')
```

- [ ] **Step 3: Run the focused test and verify RED**

Run: `node --test tests/halfFlowTrafficGateway.test.js`

Expected: FAIL in the encrypted H5/login flow because the route still passes `undefined` as the internal order ID when the mall sends `applyNo`.

---

### Task 2: Align only the half-flow route and environment templates

**Files:**
- Modify: `1.api/src/halfFlowTrafficGateway/routes.js`
- Modify: `1.api/.env.development`
- Modify: `1.api/.env.production`
- Modify: `docs/superpowers/specs/2026-07-31-half-flow-traffic-gateway-design.md`
- Modify: `docs/superpowers/plans/2026-07-31-half-flow-traffic-gateway.md`

**Interfaces:**
- Consumes: mall request body `{ applyNo, token }`.
- Produces: `consumeHalfFlowLoginToken({ orderId: body.applyNo, token, ... })` and newly issued URLs containing `applyNo=<partner orderId>`.

- [ ] **Step 1: Map the stable mall field inside the independent route**

```js
const data = await consumeHalfFlowLoginToken({
  orderId: body.applyNo,
  token: body.token,
  db: readDb(),
  repository,
  config: currentConfig,
  now,
})
```

- [ ] **Step 2: Update both environment URL templates without changing any other values**

```env
HALF_FLOW_TRAFFIC_LOAN_URL_TEMPLATE=https://wenshuosc.com/login?trafficLogin=1&channel={channel}&applyNo={orderId}&token={token}&consumePath={consumePath}&domainUrl={domainUrl}
```

The development template uses the same query string with its existing `http://localhost:5173/login` origin.

- [ ] **Step 3: Synchronize the existing half-flow documentation**

Document that the partner's `orderId` remains the module's business identifier, while the mall-facing query and consume body use the stable key `applyNo` only.

- [ ] **Step 4: Run focused and full verification**

Run from `1.api`: `node --test tests/halfFlowTrafficGateway.test.js`

Expected: all half-flow tests PASS.

Run from `1.api`: `npm.cmd test`

Expected: the mojibake check and all API tests PASS.

Run from the repository root: `node scripts/check-mojibake.js .` and `git diff --check`.

Expected: both commands exit successfully; line-ending warnings are informational.
