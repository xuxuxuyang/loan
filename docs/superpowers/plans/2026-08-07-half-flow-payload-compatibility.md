# Half-Flow Payload Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent future partner enum or formatting extensions from blocking half-flow applications while preserving strict identity, security, required-structure, admission, and idempotency checks.

**Architecture:** Change only the isolated `halfFlowTrafficGateway` schema boundary. Descriptive partner metadata remains required and scalar but is no longer restricted to today's documented enums; the partner's original value is preserved. Core identifiers and protocol checks remain unchanged, and no database schema or historical data is touched.

**Tech Stack:** Node.js CommonJS, `node:test`, existing half-flow gateway helpers.

## Global Constraints

- Modify only the independent half-flow schema, its independent tests, and this implementation plan.
- Do not modify, migrate, delete, or rewrite database data.
- Do not change Shanghai Qihao, Duodiandian, shared mall routes, or existing business flows.
- Keep AES-CTR NoPadding because it is the partner's verified live protocol despite the stale PKCS7 wording in Yuque.
- Do not stage, commit, or push Git changes.
- Run `node scripts/check-mojibake.js .` from the repository root after all file edits.

---

### Task 1: Lock the Compatibility Contract with Failing Tests

**Files:**
- Modify: `1.api/tests/halfFlowTrafficGateway.test.js`

**Interfaces:**
- Consumes: `gateway.assertApplyPayload(payload)`.
- Produces: regression coverage for future descriptive values, contact-phone formats, issuing-field aliasing, and retained core validation.

- [x] **Step 1: Add a future-value compatibility test**

Add a test that submits non-empty scalar values outside today's documented enums for `marital`, `education`, `isOpType`, `monthlyAverageIncome`, `industry`, `osType`, `commonRelationship`, and `emergentRelationship`; also use a landline and a formatted `+86` contact number. Assert that validation succeeds and preserves every supplied descriptive value.

- [x] **Step 2: Add an issuing alias test**

Remove `authInfo.lssuing`, provide `authInfo.issuing`, and assert that the validated payload contains the same value under canonical `authInfo.lssuing`.

- [x] **Step 3: Add invalid-shape and core-identity regression tests**

For every compatible descriptive field, assert that `undefined`, blank strings, objects, and arrays are still rejected. Assert that invalid primary `mobile` and `idCard` values remain rejected.

- [x] **Step 4: Run the focused tests and verify RED**

Run:

```powershell
node --test 1.api/tests/halfFlowTrafficGateway.test.js
```

Expected: the new future-value test fails first at `baseInfo.marital is invalid`, and the alias test fails at `authInfo.lssuing is required`.

### Task 2: Implement the Isolated Compatibility Boundary

**Files:**
- Modify: `1.api/src/halfFlowTrafficGateway/schema.js`
- Test: `1.api/tests/halfFlowTrafficGateway.test.js`

**Interfaces:**
- Consumes: decrypted partner apply payloads.
- Produces: validated payloads that preserve non-empty descriptive scalar values and canonicalize `authInfo.issuing` to `authInfo.lssuing`.

- [x] **Step 1: Canonicalize the issuing field without mutating the caller payload**

Build a shallow `normalizedAuthInfo` copy. Prefer a non-empty `lssuing`; otherwise use `issuing`. Validate required auth fields against the copy and return it as `authInfo`.

- [x] **Step 2: Replace descriptive enum checks with scalar compatibility checks**

Use the existing non-empty scalar helper for all of these fields:

```text
baseInfo.marital
baseInfo.education
baseInfo.isOpType
baseInfo.monthlyAverageIncome
baseInfo.industry
deviceInfo.osType
contactInfos.commonRelationship
contactInfos.emergentRelationship
```

Do not coerce or replace accepted values.

- [x] **Step 3: Align contact-phone validation with the document**

Require `commonPhone` and `emergentPhone` to be non-empty scalar values instead of enforcing the primary-user mainland-mobile regex. Existing downstream `normalizePhone` behavior remains unchanged.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run:

```powershell
node --test 1.api/tests/halfFlowTrafficGateway.test.js
```

Expected: all half-flow tests pass.

### Task 3: Verify Isolation and Production Safety

**Files:**
- Verify only; no additional production files.

**Interfaces:**
- Consumes: completed compatibility change.
- Produces: evidence that the independent channel and existing API behavior remain intact.

- [x] **Step 1: Run the full API test suite**

Run the API project's existing full test command discovered from `1.api/package.json`.

Expected: all API tests pass with no warnings or failures.

- [x] **Step 2: Validate environment configuration**

Run the existing half-flow configuration validation against development and production environment files without printing secrets.

Expected: enabled production configuration is valid; any development/production mismatch is reported without modifying the environment files.

- [x] **Step 3: Run required repository checks**

Run:

```powershell
node scripts/check-mojibake.js .
git diff --check
git status --short
```

Expected: mojibake and whitespace checks pass; Git shows only the approved schema, test, and plan files.

- [x] **Step 4: Review the final diff for scope**

Confirm there is no database migration, deletion, collection change, environment write, shared route change, Shanghai Qihao change, Duodiandian change, Git commit, or Git push.
