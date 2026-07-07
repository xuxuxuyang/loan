# Zheyin Traffic Passwordless Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add independent Zheyin traffic user auto-binding and passwordless login so approved Zheyin leads can enter the mall without re-registering.

**Architecture:** Keep all partner-specific behavior in `1.api/src/zheyinTrafficGateway/`. Reuse the existing mall `/login?trafficLogin=1` frontend contract through a Zheyin-owned `/login/consume` endpoint, while creating/binding mall users only after Zheyin credit approval succeeds.

**Tech Stack:** Node.js CommonJS API, Koa routes, Mongo-backed store helpers, Node test runner.

## Global Constraints

- Do not mix Zheyin endpoints with Duodiandian endpoints; only reference Duodiandian behavior as a business pattern.
- Do not create orders, mutate repayment data, or overwrite existing user order/blacklist state.
- Zheyin user quota is configured independently via `ZHEYIN_TRAFFIC_DEFAULT_USER_QUOTA`, defaulting to 2750.
- Zheyin credit result fields still follow partner docs and use Zheyin routes/envelopes.
- Run `node scripts/check-mojibake.js .` from repository root after edits.

---

### Task 1: Zheyin User Binding and Login Token Tests

**Files:**
- Modify: `1.api/tests/zheyinTrafficGateway.test.js`

**Interfaces:**
- Produces expectations for `mallUserId`, `loginTokenHash`, `/login/consume`, and app link `trafficLogin=1` URL.

- [ ] Add failing tests that approved Zheyin credit apply creates a mall user with Zheyin fields and quota 2750.
- [ ] Add failing tests that `/app/link` returns `/login` with `trafficLogin=1`, `token`, and Zheyin `consumePath`.
- [ ] Add failing tests that `/login/consume` returns `mock-token-{phone}`, consumes token once, and rejects reuse.

### Task 2: Zheyin Service Helpers

**Files:**
- Modify: `1.api/src/zheyinTrafficGateway/config.js`
- Modify: `1.api/src/zheyinTrafficGateway/service.js`

**Interfaces:**
- Produce `defaultUserQuota` config.
- Produce Zheyin-only helpers for creating/binding users and issuing/verifying one-time login tokens.

- [ ] Add `ZHEYIN_TRAFFIC_DEFAULT_USER_QUOTA` parsing with fallback 2750.
- [ ] Add user mapper from `rawApplyPayload` to mall `users` shape.
- [ ] Add one-time token issue/verify helpers using SHA-256 hashes.

### Task 3: Route Integration

**Files:**
- Modify: `1.api/src/zheyinTrafficGateway/routes.js`
- Modify: `1.api/src/index.js`

**Interfaces:**
- Consume `readDb`, `writeDbPartial`, and `flushMongoPersist` from main API.
- Produce `POST /open/partners/zheyin/login/consume`.

- [ ] During async approval, bind/create user and persist `users` plus Zheyin application metadata.
- [ ] In `/app/link`, issue a fresh token after approval and include `consumePath=/api/open/partners/zheyin/login/consume`.
- [ ] Add `/login/consume` endpoint returning the same mall login response shape as existing traffic login.

### Task 4: Env and Verification

**Files:**
- Modify: `1.api/.env.example`
- Modify: `1.api/.env.production`

**Interfaces:**
- Produce explicit Zheyin quota env lines.

- [ ] Set `ZHEYIN_TRAFFIC_DEFAULT_AMOUNT=2750` and `ZHEYIN_TRAFFIC_DEFAULT_USER_QUOTA=2750` for production config.
- [ ] Run Zheyin tests, Duodiandian regression tests, full API tests, and root mojibake check.
