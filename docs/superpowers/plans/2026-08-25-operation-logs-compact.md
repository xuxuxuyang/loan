# Operation Logs Compact Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oversized operation-log dashboard with a compact single-day audit table that automatically reloads when the date changes.

**Architecture:** Keep the existing audit-list and detail APIs unchanged. Simplify `OperationLogsPage.vue` so it derives a local-day start/end range from one date picker, sends only date and pagination parameters, and keeps secondary metadata inside the existing readonly detail drawer.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Element Plus, Node.js source-structure tests.

## Global Constraints

- Modify only the admin operation-log page and its frontend source test.
- Do not change backend routes, audit records, permissions, security enforcement, or business data.
- Default the selected date to today and reload automatically after a date change.
- Keep server-side pagination and the readonly detail drawer.
- Remove the security-mode banner, phone/OTP status, English decoration, and all filters except the date.
- Run the repository-root mojibake check after file changes.

---

### Task 1: Lock the compact single-day behavior with a failing test

**Files:**
- Modify: `3.admin/tests/adminSecurityUi.test.mjs`
- Test: `3.admin/tests/adminSecurityUi.test.mjs`

**Interfaces:**
- Consumes: the UTF-8 source text of `src/views/OperationLogsPage.vue` through the existing `read()` helper.
- Produces: a regression test named `operation logs use one date filter and show only key record information`.

- [ ] **Step 1: Add the failing source-structure test**

Append this test after the existing operation-log route test:

```js
test('operation logs use one date filter and show only key record information', () => {
  const page = read('src/views/OperationLogsPage.vue')

  assert.match(page, /const operationDate = ref<Date>\(new Date\(\)\)/)
  assert.match(page, /type="date"/)
  assert.match(page, /@change="changeOperationDate"/)
  assert.match(page, /const pageSize = ref\(50\)/)
  assert.match(page, /当日共/)
  assert.match(page, /当日暂无操作记录/)
  assert.match(page, /label="时间"/)
  assert.match(page, /label="操作人 \/ 角色"/)
  assert.match(page, /label="操作类型"/)
  assert.match(page, /label="操作对象"/)
  assert.match(page, /label="变更内容"/)
  assert.match(page, /label="IP"/)
  assert.match(page, /label="结果"/)
  assert.doesNotMatch(page, /SECURITY TRACE|security-mode-card|fetchAdminSecurityStatus/)
  assert.doesNotMatch(page, /categoryOptions|statusOptions|actorOptions|const keyword = ref/)
})
```

- [ ] **Step 2: Run the focused test and confirm the intended RED failure**

Run:

```powershell
cd C:\Users\xu\Desktop\loan\3.admin
node --test tests/adminSecurityUi.test.mjs
```

Expected: FAIL in the new test because `operationDate`, the single date picker, and compact labels do not exist yet.

### Task 2: Implement the compact operation-log page

**Files:**
- Modify: `3.admin/src/views/OperationLogsPage.vue`
- Test: `3.admin/tests/adminSecurityUi.test.mjs`

**Interfaces:**
- Consumes: `fetchAdminSecurityAuditLogs(query)` and `fetchAdminSecurityAuditLog(id)` from `src/api/adminSecurity.ts` without changing their signatures.
- Produces: `operationDate: Ref<Date>`, `selectedDayRange(date)`, and `changeOperationDate()` inside the page component.

- [ ] **Step 1: Remove unused status and multi-filter state**

Change the imports and state to this shape:

```ts
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Document } from '@element-plus/icons-vue'
import {
  fetchAdminSecurityAuditLog,
  fetchAdminSecurityAuditLogs,
  type AdminSecurityAuditLog,
  type AdminSecurityLogStatus,
} from '../api/adminSecurity'

const loading = ref(false)
const detailLoading = ref(false)
const rows = ref<AdminSecurityAuditLog[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(50)
const operationDate = ref<Date>(new Date())
const drawerVisible = ref(false)
const detail = ref<AdminSecurityAuditLog | null>(null)
```

Delete `status`, `dateRange`, `category`, `logStatus`, `actorId`, `keyword`, their option arrays and computed helpers, `modeView`, and `loadStatus()`.

- [ ] **Step 2: Add exact local-day range and automatic reload behavior**

Add:

```ts
function selectedDayRange(value: Date) {
  const from = new Date(value)
  const to = new Date(value)
  from.setHours(0, 0, 0, 0)
  to.setHours(23, 59, 59, 999)
  return { from: from.toISOString(), to: to.toISOString() }
}

function changeOperationDate() {
  page.value = 1
  void loadLogs()
}
```

Update `loadLogs()` so it calls:

```ts
const range = selectedDayRange(operationDate.value)
const result = await fetchAdminSecurityAuditLogs({
  ...range,
  page: page.value,
  pageSize: pageSize.value,
})
```

Delete `searchLogs()` and `resetFilters()`. Change `onMounted()` to `void loadLogs()`.

- [ ] **Step 3: Separate compact table time from full detail time**

Use these two formatters:

```ts
function formatTime(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date)
}

function formatFullTime(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date).replaceAll('/', '-')
}
```

The table uses `formatTime(row.createdAt)` and the drawer uses `formatFullTime(detail.createdAt)`.

- [ ] **Step 4: Replace the header and filter grid with one compact toolbar**

Use this toolbar as the first template element inside `.operation-logs-page`:

```vue
<section class="operation-logs-page__toolbar">
  <label class="operation-date-filter">
    <span>操作日期</span>
    <el-date-picker
      v-model="operationDate"
      type="date"
      format="YYYY年MM月DD日"
      :clearable="false"
      :editable="false"
      @change="changeOperationDate"
    />
  </label>
  <span class="operation-count">当日共 <strong>{{ total }}</strong> 条</span>
</section>
```

Delete the red header and all multi-filter controls.

- [ ] **Step 5: Keep only key table columns**

Keep columns for `时间`, `操作人 / 角色`, `操作类型`, `操作对象`, `变更内容`, `IP`, `结果`, and `操作`. Rename `变更摘要` to `变更内容`, split `验证 / 状态` into a single result tag, and set the empty text to `当日暂无操作记录`.

The result column body is:

```vue
<el-tag :type="statusView(row.status).type" size="small">
  {{ statusView(row.status).label }}
</el-tag>
```

- [ ] **Step 6: Simplify the drawer and page CSS**

Replace the red drawer hero with a neutral `.detail-head` row. Use a flex-column page where the toolbar has `flex: none` and the table card has `flex: 1; min-height: 0`. Keep only a red accent for action labels, changed values, and failures. On screens below 760px, wrap the toolbar, allow horizontal table scrolling, and make the drawer full width.

- [ ] **Step 7: Run the focused test and confirm GREEN**

Run:

```powershell
cd C:\Users\xu\Desktop\loan\3.admin
node --test tests/adminSecurityUi.test.mjs
```

Expected: `5` tests pass and `0` fail.

### Task 3: Verify the final frontend snapshot

**Files:**
- Verify: `3.admin/src/views/OperationLogsPage.vue`
- Verify: `3.admin/tests/adminSecurityUi.test.mjs`

**Interfaces:**
- Consumes: the completed compact page and its regression test.
- Produces: build and repository hygiene evidence only; no additional production interface.

- [ ] **Step 1: Run the complete admin source-test suite**

Run:

```powershell
cd C:\Users\xu\Desktop\loan\3.admin
node --test tests/*.test.mjs
```

Expected: the new operation-log tests pass. If the known unrelated registered-whitelist text test still fails, report it separately and verify it is unchanged from `HEAD`.

- [ ] **Step 2: Build the admin application**

Run:

```powershell
cd C:\Users\xu\Desktop\loan\3.admin
npm run build
```

Expected: Vue type checking and Vite production build exit with code `0`.

- [ ] **Step 3: Run repository hygiene checks**

Run:

```powershell
cd C:\Users\xu\Desktop\loan
node scripts/check-mojibake.js .
git diff --check
git status --short
```

Expected: mojibake check and `git diff --check` exit with code `0`; status lists only the existing security feature changes plus this page/test/plan work.

