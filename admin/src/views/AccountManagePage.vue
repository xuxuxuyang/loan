<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { withAdminAuthHeaders } from '../composables/useAdminApi'
import { donePageProgress, startPageProgress } from '../utils/progress'

type AccountRole = 'super_admin' | 'boss' | 'reviewer' | 'collector'
type AccountStatus = 'active' | 'disabled'

interface AdminAccountItem {
  id: string
  username: string
  role: AccountRole
  roleLabel: string
  name: string
  phone: string
  status: AccountStatus
  createdAt: string
  updatedAt: string
}

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`
const loading = ref(false)
const submitting = ref(false)
const deletingId = ref('')
const pendingDeleteId = ref('')
const keyword = ref('')
const showCreate = ref(false)
const showPasswordModal = ref(false)
const showRoleModal = ref(false)
const errorMessage = ref('')
const accounts = ref<AdminAccountItem[]>([])
const passwordSubmitting = ref(false)
const passwordTarget = ref<AdminAccountItem | null>(null)
const roleSubmitting = ref(false)
const roleTarget = ref<AdminAccountItem | null>(null)

const createForm = reactive({
  username: '',
  name: '',
  phone: '',
  password: '1234',
  role: 'reviewer' as Exclude<AccountRole, 'super_admin'>,
})

const passwordForm = reactive({
  password: '',
  confirmPassword: '',
})

const roleForm = reactive({
  role: 'reviewer' as AccountRole,
})

const filteredAccounts = computed(() => {
  const key = keyword.value.trim()
  if (!key) return accounts.value
  return accounts.value.filter(item =>
    item.username.includes(key) || item.name.includes(key) || item.phone.includes(key),
  )
})

type AccountTableRow =
  | { kind: 'section'; key: string; title: string }
  | { kind: 'account'; item: AdminAccountItem }
  | { kind: 'super_admin_toggle'; count: number }

/** 默认折叠；展开后显示系统管理员账号行 */
const superAdminSectionExpanded = ref(false)

const superAdminAccounts = computed(() => {
  const list = filteredAccounts.value.filter(i => i.role === 'super_admin')
  const byUsername = (a: AdminAccountItem, b: AdminAccountItem) =>
    a.username.localeCompare(b.username, 'zh-CN')
  return [...list].sort(byUsername)
})

/** 老板分区 → 员工（不含系统管理员） */
const accountTableRowsRest = computed((): AccountTableRow[] => {
  const list = filteredAccounts.value.filter(i => i.role !== 'super_admin')
  if (!list.length)
    return []

  const byUsername = (a: AdminAccountItem, b: AdminAccountItem) =>
    a.username.localeCompare(b.username, 'zh-CN')

  const bosses = list.filter(i => i.role === 'boss').sort(byUsername)
  const employees = list
    .filter(i => i.role !== 'boss')
    .sort((a, b) => {
      const tier = (r: AccountRole) => (r === 'reviewer' ? 0 : r === 'collector' ? 1 : 2)
      const d = tier(a.role) - tier(b.role)
      return d !== 0 ? d : byUsername(a, b)
    })

  const rows: AccountTableRow[] = []
  if (bosses.length) {
    rows.push({ kind: 'section', key: 'sec-boss', title: '老板账号' })
    bosses.forEach(item => rows.push({ kind: 'account', item }))
  }
  if (employees.length) {
    rows.push({ kind: 'section', key: 'sec-staff', title: '员工账号' })
    employees.forEach(item => rows.push({ kind: 'account', item }))
  }
  return rows
})

const accountTableBodyRows = computed((): AccountTableRow[] => {
  const rows: AccountTableRow[] = []
  const supers = superAdminAccounts.value
  if (supers.length) {
    rows.push({ kind: 'super_admin_toggle', count: supers.length })
    if (superAdminSectionExpanded.value)
      supers.forEach(item => rows.push({ kind: 'account', item }))
  }
  rows.push(...accountTableRowsRest.value)
  return rows
})

function toggleSuperAdminSection() {
  superAdminSectionExpanded.value = !superAdminSectionExpanded.value
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const yyyy = date.getFullYear()
  const mm = `${date.getMonth() + 1}`.padStart(2, '0')
  const dd = `${date.getDate()}`.padStart(2, '0')
  const hh = `${date.getHours()}`.padStart(2, '0')
  const min = `${date.getMinutes()}`.padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

function getRoleClass(role: AccountRole) {
  if (role === 'boss') return 'role-chip role-boss'
  if (role === 'super_admin') return 'role-chip role-super-admin'
  if (role === 'reviewer') return 'role-chip role-reviewer'
  if (role === 'collector') return 'role-chip role-collector'
  return 'role-chip role-reviewer'
}

function formatRoleCell(item: AdminAccountItem): string {
  if (item.role === 'super_admin')
    return '系统管理员'
  if (item.roleLabel?.trim())
    return item.roleLabel
  if (item.role === 'boss') return '老板'
  if (item.role === 'reviewer') return '审核员'
  if (item.role === 'collector') return '催收员'
  return '审核员'
}

function sectionHeaderClass(sectionKey: string) {
  if (sectionKey === 'sec-super-admin')
    return 'section-head section-head-super'
  if (sectionKey === 'sec-boss')
    return 'section-head section-head-boss'
  return 'section-head section-head-staff'
}

async function fetchAccounts() {
  loading.value = true
  startPageProgress()
  errorMessage.value = ''
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/accounts`, {
      method: 'GET',
      headers: withAdminAuthHeaders(),
    })
    const payload = await response.json() as {
      success?: boolean
      msg?: string
      data?: AdminAccountItem[]
    }
    if (!response.ok || payload.success === false) {
      const msg = payload.msg || `加载账号失败 (${response.status})`
      if (response.status === 401 || response.status === 403) {
        throw new Error(`${msg} — 请退出后使用系统管理员（xuyang）重新登录`)
      }
      throw new Error(msg)
    }
    accounts.value = Array.isArray(payload.data) ? payload.data : []
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载账号失败'
    accounts.value = []
    ElMessage.error(errorMessage.value)
  }
  finally {
    loading.value = false
    donePageProgress()
  }
}

function openCreateModal() {
  showCreate.value = true
  createForm.username = ''
  createForm.name = ''
  createForm.phone = ''
  createForm.password = '1234'
  createForm.role = 'reviewer'
  errorMessage.value = ''
}

function closeCreateModal() {
  if (submitting.value) return
  showCreate.value = false
}

function openPasswordModal(item: AdminAccountItem) {
  passwordTarget.value = item
  passwordForm.password = ''
  passwordForm.confirmPassword = ''
  errorMessage.value = ''
  showPasswordModal.value = true
  void nextTick(() => {
    // 双重清空，避免浏览器/插件在弹窗挂载瞬间自动回填密码
    passwordForm.password = ''
    passwordForm.confirmPassword = ''
  })
}

function closePasswordModal() {
  if (passwordSubmitting.value) return
  showPasswordModal.value = false
  passwordTarget.value = null
}

function openRoleModal(item: AdminAccountItem) {
  roleTarget.value = item
  roleForm.role = item.role
  errorMessage.value = ''
  showRoleModal.value = true
}

function closeRoleModal() {
  if (roleSubmitting.value) return
  showRoleModal.value = false
  roleTarget.value = null
}

async function createAccount() {
  if (submitting.value) return
  submitting.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/accounts`, {
      method: 'POST',
      headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        username: createForm.username.trim(),
        name: createForm.name.trim(),
        phone: createForm.phone.trim(),
        password: createForm.password.trim(),
        role: createForm.role,
      }),
    })
    const payload = await response.json() as { msg?: string }
    if (!response.ok) {
      throw new Error(payload.msg || `创建账号失败: ${response.status}`)
    }
    showCreate.value = false
    await fetchAccounts()
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '创建账号失败'
  }
  finally {
    submitting.value = false
  }
}

async function updateAccount(id: string, body: Record<string, unknown>) {
  const response = await fetch(`${MALL_API_BASE}/admin/accounts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
  const payload = await response.json() as { msg?: string }
  if (!response.ok) {
    throw new Error(payload.msg || `更新账号失败: ${response.status}`)
  }
}

async function switchStatus(item: AdminAccountItem) {
  try {
    await updateAccount(item.id, {
      status: item.status === 'active' ? 'disabled' : 'active',
    })
    await fetchAccounts()
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '更新账号状态失败'
  }
}

async function submitRoleChange() {
  if (!roleTarget.value || roleSubmitting.value) return
  if (roleForm.role === roleTarget.value.role) {
    closeRoleModal()
    return
  }
  roleSubmitting.value = true
  errorMessage.value = ''
  try {
    await updateAccount(roleTarget.value.id, { role: roleForm.role })
    ElMessage.success(`账号 ${roleTarget.value.username} 角色已更新`)
    showRoleModal.value = false
    roleTarget.value = null
    await fetchAccounts()
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '更新角色失败'
    ElMessage.error(errorMessage.value)
  }
  finally {
    roleSubmitting.value = false
  }
}

async function submitPasswordChange() {
  if (!passwordTarget.value || passwordSubmitting.value) return
  const password = passwordForm.password.trim()
  const confirmPassword = passwordForm.confirmPassword.trim()

  if (password.length < 4) {
    errorMessage.value = '新密码长度不能少于 4 位'
    return
  }
  if (password !== confirmPassword) {
    errorMessage.value = '两次输入的新密码不一致'
    return
  }

  passwordSubmitting.value = true
  errorMessage.value = ''
  try {
    await updateAccount(passwordTarget.value.id, { password })
    ElMessage.success(`账号 ${passwordTarget.value.username} 密码已更新`)
    showPasswordModal.value = false
    passwordTarget.value = null
    passwordForm.password = ''
    passwordForm.confirmPassword = ''
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '修改密码失败'
    ElMessage.error(errorMessage.value)
  }
  finally {
    passwordSubmitting.value = false
  }
}

async function removeAccount(item: AdminAccountItem) {
  if (deletingId.value) {
    return
  }
  deletingId.value = item.id
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/accounts/${encodeURIComponent(item.id)}`, {
      method: 'DELETE',
      headers: withAdminAuthHeaders(),
    })
    const payload = await response.json() as { msg?: string }
    if (!response.ok) {
      throw new Error(payload.msg || `删除账号失败: ${response.status}`)
    }
    pendingDeleteId.value = ''
    ElMessage.success('账号删除成功')
    await fetchAccounts()
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '删除账号失败'
    ElMessage.error(errorMessage.value)
  }
  finally {
    deletingId.value = ''
  }
}

function toggleDeleteConfirm(accountId: string) {
  if (pendingDeleteId.value === accountId) {
    pendingDeleteId.value = ''
    return
  }
  pendingDeleteId.value = accountId
}

function cancelDelete() {
  pendingDeleteId.value = ''
}

onMounted(() => {
  void fetchAccounts()
})
</script>

<template>
  <div class="panel">
    <div class="toolbar">
      <el-input
        v-model="keyword"
        class="toolbar-input"
        placeholder="搜索账号 / 姓名 / 手机号"
        clearable
      />
      <button
        class="btn btn-refresh"
        type="button"
        :disabled="loading"
        @click="fetchAccounts"
      >
        刷新
      </button>
      <button
        class="btn btn-primary"
        type="button"
        @click="openCreateModal"
      >
        新增账号
      </button>
    </div>

    <p
      v-if="errorMessage"
      class="error"
    >
      {{ errorMessage }}
    </p>

    <table class="table">
      <thead>
        <tr>
          <th>账号</th>
          <th>姓名</th>
          <th>手机号</th>
          <th>角色</th>
          <th>状态</th>
          <th>更新时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <template
          v-for="row in accountTableBodyRows"
          :key="row.kind === 'super_admin_toggle' ? 'super-admin-toggle' : row.kind === 'section' ? row.key : row.item.id"
        >
          <tr
            v-if="row.kind === 'super_admin_toggle'"
            class="table-section-row"
          >
            <td
              colspan="7"
              :class="['table-section-cell', sectionHeaderClass('sec-super-admin'), 'super-admin-collapse-cell']"
            >
              <button
                type="button"
                class="super-admin-collapse-btn"
                :aria-expanded="superAdminSectionExpanded"
                @click="toggleSuperAdminSection"
              >
                <span
                  class="super-admin-chevron"
                  :class="{ 'super-admin-chevron--open': superAdminSectionExpanded }"
                  aria-hidden="true"
                />
                <span class="super-admin-collapse-label">系统管理员</span>
                <span class="super-admin-collapse-meta">{{ row.count }} 个账号 · {{ superAdminSectionExpanded ? '点击收起' : '点击展开' }}</span>
              </button>
            </td>
          </tr>
          <tr
            v-else-if="row.kind === 'section'"
            class="table-section-row"
          >
            <td
              colspan="7"
              :class="['table-section-cell', sectionHeaderClass(row.key)]"
            >
              {{ row.title }}
            </td>
          </tr>
          <tr
            v-else
            :class="['table-account-row', { 'account-row-boss-block': row.item.role === 'boss' }]"
          >
            <td>{{ row.item.username }}</td>
            <td>{{ row.item.name }}</td>
            <td>{{ row.item.phone }}</td>
            <td>
              <span :class="getRoleClass(row.item.role)">
                {{ formatRoleCell(row.item) }}
              </span>
            </td>
            <td>
              <span :class="row.item.status === 'active' ? 'badge badge-on' : 'badge badge-off'">
                {{ row.item.status === 'active' ? '启用' : '禁用' }}
              </span>
            </td>
            <td>{{ formatDateTime(row.item.updatedAt) }}</td>
            <td>
              <div class="actions">
                <button
                  class="btn btn-warning"
                  type="button"
                  :disabled="row.item.username === 'xuyang'"
                  @click="switchStatus(row.item)"
                >
                  {{ row.item.status === 'active' ? '禁用' : '启用' }}
                </button>
                <button
                  class="btn btn-role-edit"
                  type="button"
                  :disabled="row.item.username === 'xuyang'"
                  @click="openRoleModal(row.item)"
                >
                  修改角色
                </button>
                <button
                  class="btn btn-primary"
                  type="button"
                  :disabled="row.item.username === 'xuyang'"
                  @click="openPasswordModal(row.item)"
                >
                  修改密码
                </button>
                <div class="delete-wrap">
                  <button
                    class="btn btn-danger"
                    type="button"
                    :disabled="Boolean(deletingId) && deletingId !== row.item.id || row.item.username === 'xuyang'"
                    @click="toggleDeleteConfirm(row.item.id)"
                  >
                    {{ deletingId === row.item.id ? '删除中...' : '删除' }}
                  </button>
                  <div
                    v-if="pendingDeleteId === row.item.id"
                    class="delete-pop"
                  >
                    <p>确定删除该账号？</p>
                    <div class="delete-pop-actions">
                      <button
                        class="btn btn-danger"
                        type="button"
                        :disabled="deletingId === row.item.id"
                        @click="removeAccount(row.item)"
                      >
                        删除
                      </button>
                      <button
                        class="btn btn-ghost"
                        type="button"
                        :disabled="deletingId === row.item.id"
                        @click="cancelDelete"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </td>
          </tr>
        </template>
        <tr v-if="!loading && !filteredAccounts.length">
          <td
            colspan="7"
            style="text-align: center; color: #9ca3af;"
          >
            暂无后台账号。本页<strong>仅限系统管理员</strong>访问；请先检查是否误用客服/审核员账号登录。<br>
            「数据库重置」后请<strong>退出登录</strong>，再用 <strong>xuyang</strong> 登录；并确认 mall-api（默认 3110）已连通。
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div
    v-if="showCreate"
    class="modal-mask"
    @click.self="closeCreateModal"
  >
    <div class="modal-panel">
      <div class="modal-header">
        <h3>新增后台账号</h3>
        <button
          class="btn btn-secondary"
          type="button"
          @click="closeCreateModal"
        >
          关闭
        </button>
      </div>
      <div class="form-grid">
        <label>
          账号
          <el-input
            v-model="createForm.username"
            class="form-input"
            clearable
          />
        </label>
        <label>
          姓名
          <el-input
            v-model="createForm.name"
            class="form-input"
            clearable
          />
        </label>
        <label>
          手机号
          <el-input
            v-model="createForm.phone"
            class="form-input"
            clearable
          />
        </label>
        <label>
          初始密码
          <el-input
            v-model="createForm.password"
            class="form-input"
            type="password"
            show-password
          />
        </label>
        <label class="full">
          角色
          <el-select
            v-model="createForm.role"
            class="form-select"
          >
            <el-option label="审核员" value="reviewer" />
            <el-option label="催收员" value="collector" />
            <el-option label="老板" value="boss" />
          </el-select>
        </label>
      </div>
      <div class="actions actions-right">
        <button
          class="btn btn-primary"
          type="button"
          :disabled="submitting"
          @click="createAccount"
        >
          {{ submitting ? '创建中...' : '确认创建' }}
        </button>
      </div>
    </div>
  </div>

  <div
    v-if="showRoleModal && roleTarget"
    class="modal-mask"
    @click.self="closeRoleModal"
  >
    <div class="modal-panel role-modal">
      <div class="modal-header">
        <h3>修改角色 - {{ roleTarget.username }}</h3>
        <button
          class="btn btn-secondary"
          type="button"
          :disabled="roleSubmitting"
          @click="closeRoleModal"
        >
          关闭
        </button>
      </div>
      <div class="form-grid role-form-grid">
        <label class="full">
          角色
          <el-select
            v-model="roleForm.role"
            class="form-select"
          >
            <el-option label="系统管理员" value="super_admin" />
            <el-option label="老板" value="boss" />
            <el-option label="审核员" value="reviewer" />
            <el-option label="催收员" value="collector" />
          </el-select>
        </label>
      </div>
      <div class="actions actions-right">
        <button
          class="btn btn-primary"
          type="button"
          :disabled="roleSubmitting"
          @click="submitRoleChange"
        >
          {{ roleSubmitting ? '提交中...' : '确认修改' }}
        </button>
      </div>
    </div>
  </div>

  <div
    v-if="showPasswordModal && passwordTarget"
    class="modal-mask"
    @click.self="closePasswordModal"
  >
    <div class="modal-panel password-modal">
      <div class="modal-header">
        <h3>修改密码 - {{ passwordTarget.username }}</h3>
        <button
          class="btn btn-secondary"
          type="button"
          :disabled="passwordSubmitting"
          @click="closePasswordModal"
        >
          关闭
        </button>
      </div>
      <div class="form-grid password-form-grid">
        <label class="full">
          新密码
          <el-input
            v-model="passwordForm.password"
            class="form-input"
            type="password"
            show-password
            autocomplete="new-password"
            name="new-password"
            placeholder="请输入新密码（至少 4 位）"
          />
        </label>
        <label class="full">
          确认新密码
          <el-input
            v-model="passwordForm.confirmPassword"
            class="form-input"
            type="password"
            show-password
            autocomplete="new-password"
            name="confirm-new-password"
            placeholder="请再次输入新密码"
          />
        </label>
      </div>
      <div class="actions actions-right">
        <button
          class="btn btn-primary"
          type="button"
          :disabled="passwordSubmitting"
          @click="submitPasswordChange"
        >
          {{ passwordSubmitting ? '提交中...' : '确认修改' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.btn {
  height: 30px;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  background: #fff;
  cursor: pointer;
  padding: 0 10px;
}

.btn-primary {
  border-color: #2563eb;
  background: #2563eb;
  color: #fff;
}

.btn-secondary {
  border-color: #9ca3af;
  background: #f8fafc;
  color: #374151;
}

.btn-role-edit {
  border-color: #7c3aed;
  background: #7c3aed;
  color: #fff;
}

.btn-ghost {
  color: #374151;
}

.btn-warning {
  border-color: #d97706;
  background: #d97706;
  color: #fff;
}

.btn-danger {
  border-color: #dc2626;
  background: #dc2626;
  color: #fff;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel .table tbody td:last-child {
  vertical-align: middle;
}

.table-section-row td {
  padding: 0;
  border-bottom: none;
}

.table-section-cell {
  padding: 10px 12px 8px !important;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #64748b;
  background: linear-gradient(180deg, #f1f5f9 0%, #f8fafc 100%);
  border-top: 1px solid #e2e8f0;
  border-bottom: 1px solid #e2e8f0;
}

.table-section-row:first-child .table-section-cell {
  border-top: none;
}

.section-head-super {
  border-left: 3px solid #ea580c;
  padding-left: 9px !important;
  color: #9a3412;
}

.section-head-boss {
  border-left: 3px solid #d97706;
  padding-left: 9px !important;
  color: #92400e;
}

.section-head-staff {
  border-left: 3px solid #64748b;
  padding-left: 9px !important;
}

.super-admin-collapse-cell {
  padding: 0 !important;
}

.super-admin-collapse-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin: 0;
  padding: 10px 12px 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font: inherit;
  box-sizing: border-box;
}

.super-admin-collapse-btn:focus-visible {
  outline: 2px solid #ea580c;
  outline-offset: -2px;
}

.super-admin-chevron {
  display: inline-block;
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 6px solid #9a3412;
  flex-shrink: 0;
  transition: transform 0.2s ease;
  transform: rotate(-90deg);
}

.super-admin-chevron--open {
  transform: rotate(0deg);
}

@media (prefers-reduced-motion: reduce) {
  .super-admin-chevron {
    transition: none;
  }
}

.super-admin-collapse-label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #9a3412;
}

.super-admin-collapse-meta {
  margin-left: auto;
  font-size: 12px;
  font-weight: 600;
  color: #94a3b8;
}

.account-row-boss-block td {
  background: #fffbeb;
}

.account-row-boss-block:hover td {
  background: #fef3c7;
}

.actions-right {
  justify-content: flex-end;
  margin-top: 12px;
}

.toolbar-input {
  width: 260px;
}

.badge {
  display: inline-flex;
  align-items: center;
  height: 24px;
  border-radius: 999px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 600;
}

.badge-on {
  color: #166534;
  background: #dcfce7;
}

.badge-off {
  color: #991b1b;
  background: #fee2e2;
}

.role-chip {
  display: inline-flex;
  align-items: center;
  height: 26px;
  border-radius: 999px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 600;
}

.role-super-admin {
  color: #7c2d12;
  background: #ffedd5;
}

@keyframes role-boss-glow {
  0%,
  100% {
    box-shadow:
      0 0 0 1px rgba(146, 64, 14, 0.35),
      0 0 10px rgba(251, 191, 36, 0.35);
  }
  50% {
    box-shadow:
      0 0 0 1px rgba(146, 64, 14, 0.55),
      0 0 18px rgba(252, 211, 77, 0.65),
      0 0 28px rgba(245, 158, 11, 0.35);
  }
}

@keyframes role-boss-flow {
  0% {
    background-position: 0% 50%;
  }
  100% {
    background-position: 100% 50%;
  }
}

.role-boss {
  position: relative;
  color: #422006;
  border: 1px solid rgba(146, 64, 14, 0.45);
  background: linear-gradient(
    110deg,
    #fde047 0%,
    #fbbf24 22%,
    #f59e0b 45%,
    #fcd34d 68%,
    #fde68a 88%,
    #fde047 100%
  );
  background-size: 220% 100%;
  animation:
    role-boss-flow 5s ease-in-out infinite alternate,
    role-boss-glow 2.5s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .role-boss {
    animation: none;
    background-size: 100% 100%;
    box-shadow: 0 0 0 1px rgba(146, 64, 14, 0.35);
  }
}

.role-reviewer {
  color: #1d4ed8;
  background: #dbeafe;
}

.role-customer-service {
  color: #0f766e;
  background: #ccfbf1;
}

.role-collector {
  color: #5b21b6;
  background: #ede9fe;
}

.delete-wrap {
  position: relative;
}

.delete-pop {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 180px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.12);
  padding: 10px;
  z-index: 30;
}

.delete-pop p {
  margin: 0;
  color: #374151;
  font-size: 13px;
}

.delete-pop-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 8px;
}

.delete-pop-actions .btn {
  width: 100%;
}

.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  display: grid;
  place-items: center;
  padding: 20px;
}

.modal-panel {
  width: 620px;
  max-width: 100%;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #e5e7eb;
  padding: 16px;
}

.password-modal {
  width: 520px;
}

.role-modal {
  width: 420px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.modal-header h3 {
  margin: 0;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.form-grid label {
  display: grid;
  gap: 6px;
  font-size: 14px;
  color: #a8a1a1;
}

.form-grid .full {
  grid-column: 1 / -1;
}

.form-grid input,
.form-grid select {
  height: 36px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 0 10px;
}

.form-input,
.form-select {
  width: 100%;
}

.password-form-grid {
  grid-template-columns: 1fr;
}

.role-form-grid {
  grid-template-columns: 1fr;
}

.error {
  margin: 0 0 10px;
  color: #b91c1c;
  font-size: 13px;
}
</style>
