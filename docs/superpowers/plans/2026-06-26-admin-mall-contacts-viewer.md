# Admin Mall Contacts Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand, read-only admin viewer for the latest uploaded Android contacts in the user registration info dialog.

**Architecture:** Add a focused read method to the mall contacts store and a read-only admin API endpoint. Add a small on-demand UI block in the existing user registration info component so contacts are fetched only when clicked.

**Tech Stack:** Koa API in `1.api`, MongoDB/JSON fallback contact store, Vue 3 + Element Plus admin frontend in `3.admin`, Node test runner.

## Global Constraints

- Do not modify registration, order, review, signing, or contact upload write flows.
- Do not add contacts to `/api/users` list or CSV exports.
- The contact viewer must be read-only and must not call `writeDb*` or flush persistence.
- Fetch contact details only after an admin clicks the viewer button.
- Limit API `pageSize` to 50.
- Preserve UTF-8 Chinese text.

---

### Task 1: Backend Store Read API

**Files:**
- Modify: `1.api/src/mallContacts/store.js`
- Test: `1.api/tests/mallContactsStore.test.js`

**Interfaces:**
- Produces: `contactsStore.listLatestCompletedContacts({ phone, page, pageSize }) -> Promise<{ upload, list, total, page, pageSize }>`.

Steps:
- [ ] Add a failing store test that creates one completed upload with two batches and expects paginated contacts from the latest upload only.
- [ ] Run `node --test tests/mallContactsStore.test.js` and confirm the new test fails because `listLatestCompletedContacts` is missing.
- [ ] Implement `listLatestCompletedContacts` for Mongo and JSON fallback with normalized pagination and max page size 50.
- [ ] Run `node --test tests/mallContactsStore.test.js` and confirm it passes.

### Task 2: Backend Admin Endpoint

**Files:**
- Modify: `1.api/src/index.js`
- Test: `1.api/tests/mallContactsRoutes.test.js`

**Interfaces:**
- Consumes: `mallContactsStore.listLatestCompletedContacts`.
- Produces: `GET /api/users/:id/mall-contacts`.

Steps:
- [ ] Add a failing route/source test confirming the endpoint is registered and uses `requireAdminUsersActionOnAny(ctx, 'view', ...)`.
- [ ] Run the API contact tests and confirm failure before implementation.
- [ ] Implement the route near `/users/:id`, resolving user by id and returning `contactsStore.listLatestCompletedContacts({ phone: target.phone, page, pageSize })`.
- [ ] Run contact tests and route/source tests.

### Task 3: Admin Frontend On-Demand Viewer

**Files:**
- Modify: `3.admin/src/components/UserRegistrationInfoScroll.vue`
- Modify: `3.admin/src/views/UsersPage.vue` if types need extension only.

**Interfaces:**
- Consumes: `GET /api/users/:id/mall-contacts`.

Steps:
- [ ] Add local component state for load status, page, pageSize, upload summary, rows, total, and error.
- [ ] Add `fetchMallContacts(page = 1)` that calls the new endpoint only when the button or pagination is clicked.
- [ ] Add the “通讯录名单” section after basic info and before photos.
- [ ] Render table columns: 联系人姓名, 手机号, 通讯录ID.
- [ ] Reset contact viewer state when `props.user.id` changes.
- [ ] Run `npm run build` in `3.admin`.

### Task 4: Full Verification

**Files:**
- Verify only.

Steps:
- [ ] Run `node --test tests/mallContacts*.test.js` in `1.api`.
- [ ] Run `npm run build` in `3.admin`.
- [ ] Run `node scripts/check-mojibake.js .` at repository root.
- [ ] Review `git diff` to confirm no writes to existing business data paths and no contact data in `/users` list/export.
