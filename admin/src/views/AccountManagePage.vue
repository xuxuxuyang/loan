<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { withAdminAuthHeaders } from '../composables/useAdminApi'
import { donePageProgress, startPageProgress } from '../utils/progress'

type AccountRole = 'super_admin' | 'reviewer' | 'collector'
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
  if (role === 'super_admin') return 'role-chip role-super-admin'
  if (role === 'reviewer') return 'role-chip role-reviewer'
  if (role === 'collector') return 'role-chip role-collector'
  return 'role-chip role-reviewer'
}

function formatRoleCell(item: AdminAccountItem): string {
  if (item.roleLabel?.trim())
    return item.roleLabel
  if (item.role === 'super_admin') return '超级管理员'
  if (item.role === 'reviewer') return '审核员'
  if (item.role === 'collector') return '催收员'
  return '审核员'
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
        throw new Error(`${msg} — 请退出后使用超级管理员（xuyang）重新登录`)
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
        <tr
          v-for="item in filteredAccounts"
          :key="item.id"
        >
          <td>{{ item.username }}</td>
          <td>{{ item.name }}</td>
          <td>{{ item.phone }}</td>
          <td>
            <span :class="getRoleClass(item.role)">
              {{ formatRoleCell(item) }}
            </span>
          </td>
          <td>
            <span :class="item.status === 'active' ? 'badge badge-on' : 'badge badge-off'">
              {{ item.status === 'active' ? '启用' : '禁用' }}
            </span>
          </td>
          <td>{{ formatDateTime(item.updatedAt) }}</td>
          <td>
            <div class="actions">
              <button
                class="btn btn-warning"
                type="button"
                :disabled="item.username === 'xuyang'"
                @click="switchStatus(item)"
              >
                {{ item.status === 'active' ? '禁用' : '启用' }}
              </button>
              <button
                class="btn btn-role-edit"
                type="button"
                :disabled="item.username === 'xuyang'"
                @click="openRoleModal(item)"
              >
                修改角色
              </button>
              <button
                class="btn btn-primary"
                type="button"
                :disabled="item.username === 'xuyang'"
                @click="openPasswordModal(item)"
              >
                修改密码
              </button>
              <div class="delete-wrap">
                <button
                  class="btn btn-danger"
                  type="button"
                  :disabled="Boolean(deletingId) && deletingId !== item.id || item.username === 'xuyang'"
                  @click="toggleDeleteConfirm(item.id)"
                >
                  {{ deletingId === item.id ? '删除中...' : '删除' }}
                </button>
                <div
                  v-if="pendingDeleteId === item.id"
                  class="delete-pop"
                >
                  <p>确定删除该账号？</p>
                  <div class="delete-pop-actions">
                    <button
                      class="btn btn-danger"
                      type="button"
                      :disabled="deletingId === item.id"
                      @click="removeAccount(item)"
                    >
                      删除
                    </button>
                    <button
                      class="btn btn-ghost"
                      type="button"
                      :disabled="deletingId === item.id"
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
        <tr v-if="!loading && !filteredAccounts.length">
          <td
            colspan="7"
            style="text-align: center; color: #9ca3af;"
          >
            暂无后台账号。本页<strong>仅限超级管理员</strong>访问；请先检查是否误用客服/审核员账号登录。<br>
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
            <el-option label="超级管理员" value="super_admin" />
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
  gap: 8px;
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

.role-reviewer {
  color: #1d4ed8;
  background: #dbeafe;
}

.role-customer-service {
  color: #0f766e;
  background: #ccfbf1;
}

.role-collector {
  color: #9a3412;
  background: #ffedd5;
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
  color: #6b7280;
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
