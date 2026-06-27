# Manual Review Reject Reason Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual reject reason captured during order review, bind it to the user, show it in risk-failed review rows, and make it available in user CSV exports.

**Architecture:** Reuse the existing order review status endpoint and existing order/user list enrichment. Store the per-order reason in `orders[].riskReason` and the user-bound export value in `users[].manualRejectReason`; old records without the field remain valid.

**Tech Stack:** Node.js Koa API in `1.api/src/index.js`, Vue 3 + Element Plus admin in `3.admin`, Node built-in test runner.

## Global Constraints

- Do not reset, delete, migrate, or overwrite online business data.
- Do not add new tables, background jobs, or extra list requests.
- The change must be backward compatible for users and orders missing `manualRejectReason`.
- Every file modification must be followed by `node scripts/check-mojibake.js .` from the project root before final response.

---

### Task 1: Backend Field Persistence And Export

**Files:**
- Create: `1.api/tests/manualRejectReasonSource.test.js`
- Modify: `1.api/src/index.js`

**Interfaces:**
- Consumes: existing `PATCH /orders/:id/status` with body `{ riskStatus: 'failed', riskReason: string }`.
- Produces: order responses include `manualRejectReason`; user exports support field key `manualRejectReason`.

- [ ] **Step 1: Write the failing test**

```js
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const apiSource = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8')

test('manual reject reason is persisted to the bound user and order atomically', () => {
  assert.match(apiSource, /target\.riskReason = customReason \|\| '人工审核不通过'/)
  assert.match(apiSource, /const buyer = resolveMallBuyerFromOrder\(db, target\)/)
  assert.match(apiSource, /buyer\.manualRejectReason = target\.riskReason/)
  assert.match(apiSource, /writeDbPartial\(db, \['orders', 'users'\]\)/)
})

test('manual reject reason is returned in order rows and exported by selected field', () => {
  assert.match(apiSource, /manualRejectReason: rawManualRejectReason/)
  assert.match(apiSource, /case 'manualRejectReason':/)
  assert.match(apiSource, /values\.manualRejectReason = String\(user\.manualRejectReason \|\| ''\)\.trim\(\)/)
  assert.match(apiSource, /manualRejectReason: '不通过原因'/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test 1.api/tests/manualRejectReasonSource.test.js`

Expected: FAIL because the source does not yet write `manualRejectReason` to users or export it.

- [ ] **Step 3: Write minimal implementation**

Update `1.api/src/index.js`:
- Add `manualRejectReason` to `enrichMallOrderWithBuyerFields()`.
- Add `manualRejectReason` to `pickRegisteredUserExportValues()` and `REGISTERED_USER_EXPORT_FIELDS`.
- In the `body.riskStatus === 'failed'` branch, after assigning `target.riskReason`, resolve the buyer and assign `buyer.manualRejectReason = target.riskReason`.
- Add a `writeUserDb(db, user)` single-entity helper and persist only the changed order and changed user when a buyer exists; otherwise keep `writeOrderDb(db, target)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test 1.api/tests/manualRejectReasonSource.test.js`

Expected: PASS.

---

### Task 2: Admin Review UI

**Files:**
- Create: `3.admin/tests/manualRejectReasonUi.test.mjs`
- Modify: `3.admin/src/stores/useOrdersStore.ts`
- Modify: `3.admin/src/views/OrderReviewPage.vue`
- Modify: `3.admin/src/views/UsersPage.vue`

**Interfaces:**
- Consumes: `OrderItem.manualRejectReason: string`.
- Produces: `rejectOrderReview(orderId: string, riskReason: string)` sends the reason, and the risk-failed table shows the reason column.

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const orderReview = fs.readFileSync(new URL('../src/views/OrderReviewPage.vue', import.meta.url), 'utf8')
const orderStore = fs.readFileSync(new URL('../src/stores/useOrdersStore.ts', import.meta.url), 'utf8')
const usersPage = fs.readFileSync(new URL('../src/views/UsersPage.vue', import.meta.url), 'utf8')

test('manual reject reason is collected and displayed in failed review rows', () => {
  assert.match(orderReview, /promptManualRejectReason/)
  assert.match(orderReview, /rejectOrderReview\(order\.id, reason\)/)
  assert.match(orderReview, /<th[^>]*>不通过原因<\/th>/)
  assert.match(orderReview, /manualRejectReason \|\| item\.riskReason/)
})

test('manual reject reason flows through order store and user export selector', () => {
  assert.match(orderStore, /manualRejectReason: string/)
  assert.match(orderStore, /manualRejectReason\?: string/)
  assert.match(orderStore, /manualRejectReason: order\.manualRejectReason \|\| ''/)
  assert.match(usersPage, /key: 'manualRejectReason', label: '不通过原因'/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test 3.admin/tests/manualRejectReasonUi.test.mjs`

Expected: FAIL because the UI does not yet collect/display/export the new field.

- [ ] **Step 3: Write minimal implementation**

Update frontend files:
- In `useOrdersStore.ts`, add `manualRejectReason` to `OrderItem` and `MallOrderPayload`, map it in `mapMallOrderToAdminOrder()`, and require a non-empty `riskReason` parameter in `rejectOrderReview()`.
- In `OrderReviewPage.vue`, replace the confirm-only reject flow with an `ElMessageBox.prompt()` textarea, trim the value, and pass it to `rejectOrderReview(order.id, reason)`.
- In `OrderReviewPage.vue`, add a "不通过原因" column that is only meaningful in the risk-failed filtered list and displays `item.manualRejectReason || item.riskReason || '-'`.
- In `UsersPage.vue`, add export field option `{ key: 'manualRejectReason', label: '不通过原因' }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test 3.admin/tests/manualRejectReasonUi.test.mjs`

Expected: PASS.

---

### Task 3: Full Verification

**Files:**
- Verify only; no new production changes.

**Interfaces:**
- Confirms backend, frontend, build, and mojibake checks.

- [ ] **Step 1: Run targeted backend and frontend tests**

Run:
```bash
node --test 1.api/tests/manualRejectReasonSource.test.js
node --test 3.admin/tests/manualRejectReasonUi.test.mjs
node --test 3.admin/tests/*.test.mjs
```

Expected: all tests pass.

- [ ] **Step 2: Run backend test suite**

Run from `1.api`: `npm test`

Expected: mojibake check passes and all API tests pass.

- [ ] **Step 3: Run frontend type check and build**

Run from `3.admin`:
```bash
.\node_modules\.bin\vue-tsc.cmd -b
.\node_modules\.bin\vite.cmd build --outDir <temp-dir>
```

Expected: both commands exit 0.

- [ ] **Step 4: Run root mojibake check**

Run from project root: `node scripts/check-mojibake.js .`

Expected: `Mojibake check passed`.
