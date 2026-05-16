<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { withAdminAuthHeaders } from '../composables/useAdminApi'
import { useTenantScope } from '../composables/useTenantScope'

interface TenantSummary {
  tenantId: string
  tenantName?: string
  userCount: number
  orderCount: number
  productCount: number
  createdAt?: string
}

interface TenantAdminAccount {
  id: string
  username: string
  name: string
  phone: string
  role?: 'boss' | 'reviewer' | 'collector' | 'super_admin'
  roleLabel?: string
  scopeType?: 'platform' | 'tenant'
  tenantId?: string
  tenantName?: string
  sourceTenantId?: string
  sourceTenantName?: string
  status?: 'active' | 'disabled'
  updatedAt?: string
}

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`
const loading = ref(false)
const accountLoading = ref(false)
const creatingTenantAccount = ref(false)
const updatingRole = ref(false)
const updatingPassword = ref(false)
const updatingStatusId = ref('')
const deletingAccountId = ref('')
const keyword = ref('')
const accountKeyword = ref('')
const errorMessage = ref('')
const newTenantId = ref('')
const tenants = ref<TenantSummary[]>([])
const selectedTenantId = ref('')
const tenantAccounts = ref<TenantAdminAccount[]>([])
const showCreateAccountModal = ref(false)
const showRoleModal = ref(false)
const showPasswordModal = ref(false)
const createAccountMode = ref<'existing' | 'onboard' | 'edit'>('existing')
const editingBossAccount = ref<TenantAdminAccount | null>(null)
const roleTarget = ref<TenantAdminAccount | null>(null)
const passwordTarget = ref<TenantAdminAccount | null>(null)
const { switchTenant } = useTenantScope()
const createAccountForm = ref({
  tenantId: '',
  username: '',
  name: '',
  phone: '',
  password: '123456',
})
const roleForm = ref({
  role: 'boss' as 'boss' | 'reviewer' | 'collector',
})
const passwordForm = ref({
  password: '',
  confirmPassword: '',
})

const filteredTenants = computed(() => {
  const key = keyword.value.trim().toLowerCase()
  if (!key) {
    return tenants.value
  }
  return tenants.value.filter((item) => {
    const id = String(item.tenantId || '').toLowerCase()
    const name = String(item.tenantName || '').toLowerCase()
    return id.includes(key) || name.includes(key)
  })
})

const filteredTenantAccounts = computed(() => {
  const key = accountKeyword.value.trim().toLowerCase()
  return tenantAccounts.value.filter((item) => {
    if (selectedTenantId.value) {
      const itemTenantId = normalizeTenantInput(String(item.tenantId || item.sourceTenantId || ''))
      if (itemTenantId !== normalizeTenantInput(selectedTenantId.value)) {
        return false
      }
    }
    if (!key) {
      return true
    }
    const fields = [
      item.username,
      item.name,
      item.phone,
      item.tenantName || item.tenantId,
      item.sourceTenantName || item.sourceTenantId,
      item.roleLabel,
    ]
    return fields.some(field => String(field || '').toLowerCase().includes(key))
  })
})

const tenantBossInfoMap = computed(() => {
  const map = new Map<string, { name: string, username: string, phone: string }>()
  tenantAccounts.value.forEach((item) => {
    const tenantId = normalizeTenantInput(String(item.tenantId || item.sourceTenantId || ''))
    if (!tenantId) return
    const isBoss = item.role === 'boss' || item.roleLabel === '老板'
    const ownerName = String(item.name || '').trim()
    if (!isBoss || !ownerName || map.has(tenantId)) return
    map.set(tenantId, {
      name: ownerName,
      username: String(item.username || '').trim(),
      phone: String(item.phone || '').trim(),
    })
  })
  return map
})

function resolveTenantDisplayName(rawTenantId?: string, rawTenantName?: string) {
  const tenantId = normalizeTenantInput(String(rawTenantId || ''))
  if (!tenantId) return '-'

  const bossName = tenantBossInfoMap.value.get(tenantId)?.name
  if (bossName) {
    return `${bossName}（${tenantId}）`
  }

  const knownTenant = tenants.value.find(item => normalizeTenantInput(item.tenantId) === tenantId)
  const tenantName = String(rawTenantName || knownTenant?.tenantName || '').trim()
  if (tenantName && tenantName !== tenantId) {
    return `${tenantName}（${tenantId}）`
  }
  return `租户系统（${tenantId}）`
}

function resolveTenantOwnerName(rawTenantId?: string) {
  const tenantId = normalizeTenantInput(String(rawTenantId || ''))
  if (!tenantId) return '-'
  return tenantBossInfoMap.value.get(tenantId)?.name || '-'
}

function resolveTenantOwnerUsername(rawTenantId?: string) {
  const tenantId = normalizeTenantInput(String(rawTenantId || ''))
  if (!tenantId) return '-'
  return tenantBossInfoMap.value.get(tenantId)?.username || '-'
}

function resolveTenantOwnerPhone(rawTenantId?: string) {
  const tenantId = normalizeTenantInput(String(rawTenantId || ''))
  if (!tenantId) return '-'
  return tenantBossInfoMap.value.get(tenantId)?.phone || '-'
}

function resolveTenantBossAccount(rawTenantId?: string) {
  const tenantId = normalizeTenantInput(String(rawTenantId || ''))
  if (!tenantId) return null
  return tenantAccounts.value.find((item) => {
    const itemTenantId = normalizeTenantInput(String(item.tenantId || item.sourceTenantId || ''))
    const isBoss = item.role === 'boss' || item.roleLabel === '老板'
    return isBoss && itemTenantId === tenantId
  }) || null
}

function resolveTenantOptionLabel(item: TenantSummary) {
  return resolveTenantDisplayName(item.tenantId, item.tenantName)
}

async function fetchTenants() {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(`${MALL_API_BASE}/platform/tenants`, {
      method: 'GET',
      headers: withAdminAuthHeaders(),
    })
    const payload = await response.json() as {
      success?: boolean
      msg?: string
      data?: TenantSummary[]
    }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || `加载租户列表失败 (${response.status})`)
    }
    tenants.value = Array.isArray(payload.data) ? payload.data : []
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载租户列表失败'
  }
  finally {
    loading.value = false
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function refreshTenantsAfterCreate(createdTenantId: string) {
  const normalizedCreatedId = normalizeTenantInput(createdTenantId)
  for (let i = 0; i < 3; i += 1) {
    await fetchTenants()
    const exists = tenants.value.some(item => normalizeTenantInput(item.tenantId) === normalizedCreatedId)
    if (exists) {
      return
    }
    await sleep(250 * (i + 1))
  }
  if (!tenants.value.some(item => normalizeTenantInput(item.tenantId) === normalizedCreatedId)) {
    tenants.value = [
      ...tenants.value,
      {
        tenantId: normalizedCreatedId,
        tenantName: normalizedCreatedId,
        userCount: 0,
        orderCount: 0,
        productCount: 0,
        createdAt: new Date().toISOString(),
      },
    ].sort((a, b) => {
      const ta = new Date(String(a.createdAt || '')).getTime()
      const tb = new Date(String(b.createdAt || '')).getTime()
      const va = Number.isFinite(ta) ? ta : 0
      const vb = Number.isFinite(tb) ? tb : 0
      if (vb !== va) return vb - va
      return String(a.tenantId || '').localeCompare(String(b.tenantId || ''))
    })
  }
}

async function fetchTenantAccounts() {
  accountLoading.value = true
  try {
    const response = await fetch(`${MALL_API_BASE}/platform/admin-accounts?scopeType=tenant`, {
      method: 'GET',
      headers: withAdminAuthHeaders(),
    })
    const payload = await response.json() as {
      success?: boolean
      msg?: string
      data?: TenantAdminAccount[]
    }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || `加载租户账号失败 (${response.status})`)
    }
    tenantAccounts.value = Array.isArray(payload.data) ? payload.data : []
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载租户账号失败'
  }
  finally {
    accountLoading.value = false
  }
}

function normalizeTenantInput(raw: string) {
  const normalized = String(raw || '').trim()
  if (!normalized) return ''
  const lowered = normalized.toLowerCase()
  if (normalized === '主系统' || lowered === 'default' || lowered === 'main' || lowered === 'platform') {
    return ''
  }
  return normalized
}

function isValidOnboardTenantId(raw: string) {
  return /^bo?s{2}\d+$/i.test(String(raw || '').trim()) || /^boss\d+$/i.test(String(raw || '').trim()) || /^boos\d+$/i.test(String(raw || '').trim())
}

function resolveAccountTenantId(item: TenantAdminAccount) {
  return normalizeTenantInput(String(item.sourceTenantId || item.tenantId || selectedTenantId.value || ''))
}

function buildTenantScopedHeaders(tenantId: string, init: HeadersInit = {}) {
  return withAdminAuthHeaders({
    ...init,
    'x-tenant-id': tenantId,
    'x-workspace-type': 'tenant',
  })
}

function normalizeRoleValue(item: TenantAdminAccount): 'boss' | 'reviewer' | 'collector' {
  if (item.role === 'boss' || item.roleLabel === '老板') return 'boss'
  if (item.role === 'collector' || item.roleLabel === '催收员') return 'collector'
  return 'reviewer'
}

function openEditTenantBossAccount(tenantId = '') {
  const normalizedTenantId = normalizeTenantInput(tenantId || selectedTenantId.value)
  const bossAccount = resolveTenantBossAccount(normalizedTenantId)
  if (!bossAccount) {
    errorMessage.value = '该租户未找到老板账号，请先检查开通流程'
    ElMessage.error(errorMessage.value)
    return
  }
  editingBossAccount.value = bossAccount
  createAccountMode.value = 'edit'
  showCreateAccountModal.value = true
  createAccountForm.value = {
    tenantId: normalizedTenantId,
    username: String(bossAccount.username || ''),
    name: String(bossAccount.name || ''),
    phone: String(bossAccount.phone || ''),
    password: '',
  }
  errorMessage.value = ''
}

function openCreateTenantWithBossModal() {
  const tenantId = normalizeTenantInput(newTenantId.value)
  if (!tenantId) {
    errorMessage.value = '请输入有效的租户系统ID（仅支持 boss/boos + 数字，例如 boss1 或 boos1）'
    void ElMessageBox.alert(errorMessage.value, '提示', {
      type: 'warning',
      confirmButtonText: '我知道了',
    })
    return
  }
  if (!isValidOnboardTenantId(tenantId)) {
    errorMessage.value = '租户系统ID仅支持 boss/boos + 数字，例如 boss1、boos1'
    void ElMessageBox.alert(errorMessage.value, '提示', {
      type: 'warning',
      confirmButtonText: '我知道了',
    })
    return
  }
  if (tenants.value.some(item => normalizeTenantInput(item.tenantId) === tenantId)) {
    errorMessage.value = `租户系统ID ${tenantId} 已存在，请勿重复开通`
    void ElMessageBox.alert(errorMessage.value, '提示', {
      type: 'warning',
      confirmButtonText: '我知道了',
    })
    return
  }
  editingBossAccount.value = null
  createAccountMode.value = 'onboard'
  showCreateAccountModal.value = true
  createAccountForm.value = {
    tenantId,
    username: '',
    name: '',
    phone: '',
    password: '123456',
  }
  errorMessage.value = ''
}

function closeCreateTenantAccount() {
  if (creatingTenantAccount.value) return
  showCreateAccountModal.value = false
  editingBossAccount.value = null
}

function openRoleDialog(item: TenantAdminAccount) {
  roleTarget.value = item
  roleForm.value.role = normalizeRoleValue(item)
  showRoleModal.value = true
}

function closeRoleDialog() {
  if (updatingRole.value) return
  showRoleModal.value = false
  roleTarget.value = null
}

function openPasswordDialog(item: TenantAdminAccount) {
  passwordTarget.value = item
  passwordForm.value.password = ''
  passwordForm.value.confirmPassword = ''
  showPasswordModal.value = true
}

function closePasswordDialog() {
  if (updatingPassword.value) return
  showPasswordModal.value = false
  passwordTarget.value = null
}

async function onboardTenantWithBoss(tenantId: string) {
  const response = await fetch(`${MALL_API_BASE}/platform/tenants/onboard`, {
    method: 'POST',
    headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      tenantId,
      username: createAccountForm.value.username.trim(),
      name: createAccountForm.value.name.trim(),
      phone: createAccountForm.value.phone.trim(),
      password: createAccountForm.value.password.trim(),
    }),
  })
  const payload = await response.json() as { success?: boolean, msg?: string, data?: { bossAccount?: Partial<TenantAdminAccount> } }
  if (!response.ok || payload.success === false) {
    throw new Error(payload.msg || `开通租户系统失败 (${response.status})`)
  }
  const account = payload.data?.bossAccount || {}
  return {
    id: String(account.id || `temp-${tenantId}-${Date.now()}`),
    username: String(account.username || createAccountForm.value.username || '').trim(),
    name: String(account.name || createAccountForm.value.name || '').trim(),
    phone: String(account.phone || createAccountForm.value.phone || '').trim(),
    role: (account.role as TenantAdminAccount['role']) || 'boss',
    roleLabel: String(account.roleLabel || '老板'),
    scopeType: 'tenant',
    tenantId,
    tenantName: tenantId,
    sourceTenantId: tenantId,
    sourceTenantName: tenantId,
    status: (account.status as TenantAdminAccount['status']) || 'active',
    updatedAt: String(account.updatedAt || new Date().toISOString()),
  } satisfies TenantAdminAccount
}

async function createBossAccount(tenantId: string) {
  const response = await fetch(`${MALL_API_BASE}/admin/accounts`, {
    method: 'POST',
    headers: withAdminAuthHeaders({
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
      'x-workspace-type': 'tenant',
    }),
    body: JSON.stringify({
      username: createAccountForm.value.username.trim(),
      name: createAccountForm.value.name.trim(),
      phone: createAccountForm.value.phone.trim(),
      password: createAccountForm.value.password.trim(),
      role: 'boss',
      scopeType: 'tenant',
      tenantId,
    }),
  })
  const payload = await response.json() as { success?: boolean, msg?: string, data?: Partial<TenantAdminAccount> }
  if (!response.ok || payload.success === false) {
    throw new Error(payload.msg || `新增租户账号失败 (${response.status})`)
  }
  const data = payload.data || {}
  return {
    id: String(data.id || `temp-${tenantId}-${Date.now()}`),
    username: String(data.username || createAccountForm.value.username || '').trim(),
    name: String(data.name || createAccountForm.value.name || '').trim(),
    phone: String(data.phone || createAccountForm.value.phone || '').trim(),
    role: (data.role as TenantAdminAccount['role']) || 'boss',
    roleLabel: String(data.roleLabel || '老板'),
    scopeType: 'tenant',
    tenantId,
    tenantName: tenantId,
    sourceTenantId: tenantId,
    sourceTenantName: tenantId,
    status: (data.status as TenantAdminAccount['status']) || 'active',
    updatedAt: String(data.updatedAt || new Date().toISOString()),
  } satisfies TenantAdminAccount
}

async function updateBossAccount(item: TenantAdminAccount, tenantId: string) {
  const body: Record<string, unknown> = {
    username: createAccountForm.value.username.trim(),
    name: createAccountForm.value.name.trim(),
    phone: createAccountForm.value.phone.trim(),
    role: 'boss',
    scopeType: 'tenant',
    tenantId,
  }
  const password = String(createAccountForm.value.password || '').trim()
  if (password) {
    body.password = password
  }
  await updateTenantAccount(item, body)
}

function upsertTenantAccountLocal(account: TenantAdminAccount) {
  const index = tenantAccounts.value.findIndex(item => item.id === account.id)
  if (index >= 0) {
    tenantAccounts.value[index] = { ...tenantAccounts.value[index], ...account }
    return
  }
  tenantAccounts.value = [account, ...tenantAccounts.value]
}

async function refreshTenantAccountsAfterCreate(tenantId: string, fallbackBoss: TenantAdminAccount) {
  const normalizedTenantId = normalizeTenantInput(tenantId)
  for (let i = 0; i < 3; i += 1) {
    await fetchTenantAccounts()
    const found = resolveTenantBossAccount(normalizedTenantId)
    if (found) {
      return
    }
    await sleep(250 * (i + 1))
  }
  upsertTenantAccountLocal(fallbackBoss)
}

async function createTenantAccount() {
  if (creatingTenantAccount.value) return
  const tenantId = normalizeTenantInput(createAccountForm.value.tenantId)
  if (!tenantId) {
    errorMessage.value = '请先选择所属租户系统'
    ElMessage.error(errorMessage.value)
    return
  }
  creatingTenantAccount.value = true
  errorMessage.value = ''
  let createdTenantId = ''
  let createdBossAccount: TenantAdminAccount | null = null
  try {
    if (createAccountMode.value === 'onboard') {
      createdTenantId = tenantId
      createdBossAccount = await onboardTenantWithBoss(tenantId)
      ElMessage.success('租户系统与老板账号开通成功')
      newTenantId.value = ''
    }
    else if (createAccountMode.value === 'edit' && editingBossAccount.value) {
      await updateBossAccount(editingBossAccount.value, tenantId)
      ElMessage.success('老板账号信息已更新')
    }
    else {
      await createBossAccount(tenantId)
      ElMessage.success('租户老板账号创建成功')
    }
    showCreateAccountModal.value = false
    if (createdTenantId) {
      await refreshTenantsAfterCreate(createdTenantId)
    }
    else {
      await fetchTenants()
    }
    if (createdBossAccount) {
      upsertTenantAccountLocal(createdBossAccount)
      await refreshTenantAccountsAfterCreate(createdTenantId, createdBossAccount)
    }
    else {
      await fetchTenantAccounts()
    }
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '新增失败'
    ElMessage.error(errorMessage.value)
    void ElMessageBox.alert(errorMessage.value, '开通失败', {
      type: 'error',
      confirmButtonText: '我知道了',
    })
  }
  finally {
    creatingTenantAccount.value = false
  }
}

async function updateTenantAccount(item: TenantAdminAccount, body: Record<string, unknown>) {
  const tenantId = resolveAccountTenantId(item)
  if (!tenantId) {
    throw new Error('无法识别该账号所属租户系统')
  }
  const response = await fetch(`${MALL_API_BASE}/admin/accounts/${encodeURIComponent(item.id)}`, {
    method: 'PATCH',
    headers: buildTenantScopedHeaders(tenantId, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
  const payload = await response.json() as { success?: boolean, msg?: string }
  if (!response.ok || payload.success === false) {
    throw new Error(payload.msg || `更新租户账号失败 (${response.status})`)
  }
}

async function submitRoleChange() {
  if (!roleTarget.value || updatingRole.value) return
  updatingRole.value = true
  errorMessage.value = ''
  try {
    await updateTenantAccount(roleTarget.value, { role: roleForm.value.role, scopeType: 'tenant' })
    ElMessage.success('租户账号角色已更新')
    showRoleModal.value = false
    roleTarget.value = null
    await fetchTenantAccounts()
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '更新租户账号角色失败'
    ElMessage.error(errorMessage.value)
  }
  finally {
    updatingRole.value = false
  }
}

async function submitPasswordChange() {
  if (!passwordTarget.value || updatingPassword.value) return
  const password = passwordForm.value.password.trim()
  const confirmPassword = passwordForm.value.confirmPassword.trim()
  if (password.length < 4) {
    errorMessage.value = '新密码长度不能少于4位'
    ElMessage.error(errorMessage.value)
    return
  }
  if (password !== confirmPassword) {
    errorMessage.value = '两次输入的新密码不一致'
    ElMessage.error(errorMessage.value)
    return
  }
  updatingPassword.value = true
  errorMessage.value = ''
  try {
    await updateTenantAccount(passwordTarget.value, { password })
    ElMessage.success('租户账号密码已更新')
    showPasswordModal.value = false
    passwordTarget.value = null
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '修改租户账号密码失败'
    ElMessage.error(errorMessage.value)
  }
  finally {
    updatingPassword.value = false
  }
}

async function toggleAccountStatus(item: TenantAdminAccount) {
  if (updatingStatusId.value) return
  updatingStatusId.value = item.id
  try {
    const nextStatus = item.status === 'active' ? 'disabled' : 'active'
    await updateTenantAccount(item, { status: nextStatus })
    await fetchTenantAccounts()
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '更新租户账号状态失败'
    ElMessage.error(errorMessage.value)
  }
  finally {
    updatingStatusId.value = ''
  }
}

async function removeTenantAccount(item: TenantAdminAccount) {
  if (deletingAccountId.value) return
  const confirmed = window.confirm(`确认删除租户账号 ${item.username} 吗？`)
  if (!confirmed) return
  const tenantId = resolveAccountTenantId(item)
  if (!tenantId) {
    errorMessage.value = '无法识别该账号所属租户系统'
    ElMessage.error(errorMessage.value)
    return
  }
  deletingAccountId.value = item.id
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/accounts/${encodeURIComponent(item.id)}`, {
      method: 'DELETE',
      headers: buildTenantScopedHeaders(tenantId),
    })
    const payload = await response.json() as { success?: boolean, msg?: string }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || `删除租户账号失败 (${response.status})`)
    }
    ElMessage.success('租户账号已删除')
    await fetchTenantAccounts()
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '删除租户账号失败'
    ElMessage.error(errorMessage.value)
  }
  finally {
    deletingAccountId.value = ''
  }
}

function jumpToTenant(tenantId: string) {
  switchTenant(tenantId)
}

onMounted(() => {
  void fetchTenants()
  void fetchTenantAccounts()
})
</script>

<template>
  <div
    v-loading="loading"
    class="tenant-manage-page"
  >
    <div class="panel">
      <div class="tenant-open-card__head">
        <h3>租户系统开通</h3>
        <p>新开租户的必选步骤：先登记租户系统ID，再为该租户创建老板账号，最后交付客户使用。</p>
      </div>
      <div class="toolbar toolbar-left">
        <el-input
          v-model="newTenantId"
          class="toolbar-input"
          clearable
          placeholder="请输入租户系统ID（如 boss1 或 boos1）"
        />
        <button
          class="btn btn-primary"
          type="button"
          :disabled="creatingTenantAccount"
          @click="openCreateTenantWithBossModal"
        >
          {{ creatingTenantAccount && createAccountMode === 'onboard' ? '开通中...' : '开通租户系统' }}
        </button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">
        <h3>租户系统列表</h3>
      </div>
      <div class="toolbar toolbar-left">
        <el-input
          v-model="keyword"
          class="toolbar-input"
          clearable
          placeholder="搜索租户系统ID"
        />
      </div>

      <table class="table">
        <thead>
          <tr>
            <th>租户系统</th>
            <th>老板姓名</th>
            <th>老板账号</th>
            <th>老板手机号</th>
            <th>用户数</th>
            <th>订单数</th>
            <th>商品数</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in filteredTenants"
            :key="item.tenantId"
          >
            <td>{{ item.tenantName || item.tenantId }}</td>
            <td>{{ resolveTenantOwnerName(item.tenantId) }}</td>
            <td>{{ resolveTenantOwnerUsername(item.tenantId) }}</td>
            <td>{{ resolveTenantOwnerPhone(item.tenantId) }}</td>
            <td>{{ item.userCount }}</td>
            <td>{{ item.orderCount }}</td>
            <td>{{ item.productCount }}</td>
            <td>
              <div class="actions">
                <button
                  class="btn btn-danger"
                  type="button"
                  @click="openEditTenantBossAccount(item.tenantId)"
                >
                  修改老板账号
                </button>
                <button
                  class="btn btn-primary"
                  type="button"
                  @click="jumpToTenant(item.tenantId)"
                >
                  切到该租户
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && filteredTenants.length === 0">
            <td
              colspan="8"
              class="empty"
            >
              暂无租户系统
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-loading="accountLoading"
      class="panel"
    >
      <div class="panel-title">
        <h3>租户账号数据</h3>
      </div>
      <div class="toolbar toolbar-left">
        <el-input
          v-model="accountKeyword"
          class="toolbar-input"
          clearable
          placeholder="搜索账号 / 姓名 / 手机号"
        />
        <el-select
          v-model="selectedTenantId"
          class="toolbar-input"
          clearable
          placeholder="按租户系统筛选"
        >
          <el-option
            v-for="item in tenants"
            :key="`filter-${item.tenantId}`"
              :label="resolveTenantOptionLabel(item)"
            :value="item.tenantId"
          />
        </el-select>
        <button
          class="btn btn-refresh"
          type="button"
          :disabled="accountLoading"
          @click="fetchTenantAccounts"
        >
          刷新
        </button>
      </div>

      <table class="table">
        <thead>
          <tr>
            <th>账号</th>
            <th>姓名</th>
            <th>手机号</th>
            <th>角色</th>
            <th>所属系统</th>
            <th>所属数据库</th>
            <th>状态</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in filteredTenantAccounts"
            :key="`acct-${item.id}`"
          >
            <td>{{ item.username }}</td>
            <td>{{ item.name }}</td>
            <td>{{ item.phone }}</td>
            <td>{{ item.roleLabel || '-' }}</td>
            <td>{{ resolveTenantOwnerName(item.tenantId) }}</td>
            <td>{{ resolveTenantOwnerName(item.sourceTenantId) }}</td>
            <td>{{ item.status === 'disabled' ? '禁用' : '启用' }}</td>
            <td>{{ item.updatedAt || '-' }}</td>
            <td>
              <div class="actions">
                <button
                  class="btn btn-warning"
                  type="button"
                  :disabled="updatingStatusId === item.id"
                  @click="toggleAccountStatus(item)"
                >
                  {{ item.status === 'active' ? '禁用' : '启用' }}
                </button>
                <button
                  class="btn btn-role-edit"
                  type="button"
                  @click="openRoleDialog(item)"
                >
                  修改角色
                </button>
                <button
                  class="btn btn-primary"
                  type="button"
                  @click="openPasswordDialog(item)"
                >
                  修改密码
                </button>
                <button
                  class="btn btn-danger"
                  type="button"
                  :disabled="deletingAccountId === item.id"
                  @click="removeTenantAccount(item)"
                >
                  删除
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="!accountLoading && filteredTenantAccounts.length === 0">
            <td
              colspan="9"
              class="empty"
            >
              暂无租户账号数据
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-if="showCreateAccountModal"
      class="modal-mask"
      @click.self="closeCreateTenantAccount"
    >
      <div class="modal-panel">
        <div class="modal-header">
          <h3>{{ createAccountMode === 'onboard' ? '开通租户系统并新增老板账号' : (createAccountMode === 'edit' ? '修改老板账号' : '新增老板账号') }}</h3>
          <button
            class="btn btn-secondary"
            type="button"
            @click="closeCreateTenantAccount"
          >
            关闭
          </button>
        </div>
        <div class="form-grid">
          <label v-if="createAccountMode === 'onboard'">
            所属租户系统ID
            <el-input
              v-model="createAccountForm.tenantId"
              class="form-input"
              disabled
            />
          </label>
          <label v-else>
            所属租户系统
            <el-select
              v-model="createAccountForm.tenantId"
              class="form-select"
              filterable
              allow-create
              default-first-option
              placeholder="选择租户系统ID"
            >
              <el-option
                v-for="item in tenants"
                :key="`acct-tenant-${item.tenantId}`"
                :label="resolveTenantOptionLabel(item)"
                :value="item.tenantId"
              />
            </el-select>
          </label>
          <label>
            账号
            <el-input
              v-model="createAccountForm.username"
              class="form-input"
              clearable
            />
          </label>
          <label>
            姓名
            <el-input
              v-model="createAccountForm.name"
              class="form-input"
              clearable
              placeholder="例如 张三"
            />
          </label>
          <label>
            手机号
            <el-input
              v-model="createAccountForm.phone"
              class="form-input"
              clearable
            />
          </label>
          <label>
            {{ createAccountMode === 'edit' ? '新密码（留空则不修改）' : '初始密码' }}
            <el-input
              v-model="createAccountForm.password"
              class="form-input"
              type="password"
              show-password
            />
          </label>
          <label>
            角色（固定）
            <el-input
              class="form-input"
              model-value="老板"
              disabled
            />
          </label>
        </div>
        <div class="modal-actions">
          <button
            class="btn btn-primary"
            type="button"
            :disabled="creatingTenantAccount"
            @click="createTenantAccount"
          >
            {{
              creatingTenantAccount
                ? '提交中...'
                : (createAccountMode === 'onboard'
                    ? '确认开通并创建老板'
                    : (createAccountMode === 'edit' ? '确认修改老板账号' : '确认创建账号'))
            }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="showRoleModal && roleTarget"
      class="modal-mask"
      @click.self="closeRoleDialog"
    >
      <div class="modal-panel modal-panel--small">
        <div class="modal-header">
          <h3>修改角色 - {{ roleTarget.username }}</h3>
          <button
            class="btn btn-secondary"
            type="button"
            @click="closeRoleDialog"
          >
            关闭
          </button>
        </div>
        <div class="form-grid form-grid--single">
          <label>
            角色
            <el-select
              v-model="roleForm.role"
              class="form-select"
            >
              <el-option label="老板" value="boss" />
              <el-option label="审核员" value="reviewer" />
              <el-option label="催收员" value="collector" />
            </el-select>
          </label>
        </div>
        <div class="modal-actions">
          <button
            class="btn btn-primary"
            type="button"
            :disabled="updatingRole"
            @click="submitRoleChange"
          >
            {{ updatingRole ? '提交中...' : '确认修改' }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="showPasswordModal && passwordTarget"
      class="modal-mask"
      @click.self="closePasswordDialog"
    >
      <div class="modal-panel modal-panel--small">
        <div class="modal-header">
          <h3>修改密码 - {{ passwordTarget.username }}</h3>
          <button
            class="btn btn-secondary"
            type="button"
            @click="closePasswordDialog"
          >
            关闭
          </button>
        </div>
        <div class="form-grid form-grid--single">
          <label>
            新密码
            <el-input
              v-model="passwordForm.password"
              class="form-input"
              type="password"
              show-password
              placeholder="请输入新密码（至少4位）"
            />
          </label>
          <label>
            确认新密码
            <el-input
              v-model="passwordForm.confirmPassword"
              class="form-input"
              type="password"
              show-password
              placeholder="请再次输入新密码"
            />
          </label>
        </div>
        <div class="modal-actions">
          <button
            class="btn btn-primary"
            type="button"
            :disabled="updatingPassword"
            @click="submitPasswordChange"
          >
            {{ updatingPassword ? '提交中...' : '确认修改' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tenant-manage-page {
  display: grid;
  gap: 14px;
}

.panel {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #fff;
  padding: 12px;
}

.tenant-open-card__head h3,
.panel-title h3 {
  margin: 0;
  font-size: 16px;
}

.tenant-open-card__head p {
  margin: 6px 0 0;
  color: #475569;
  font-size: 13px;
}

.toolbar {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.toolbar-left {
  justify-content: flex-start;
}

.panel-title {
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.toolbar-input {
  width: 260px;
}

.table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 10px;
}

.table th,
.table td {
  border-bottom: 1px solid #f1f5f9;
  padding: 10px 8px;
  text-align: left;
  vertical-align: middle;
}

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

.btn-success {
  border-color: #16a34a;
  background: #16a34a;
  color: #fff;
}

.btn-refresh {
  border-color: #d1d5db;
  background: #fff;
  color: #374151;
}

.btn-role-edit {
  border-color: #7c3aed;
  background: #7c3aed;
  color: #fff;
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
  flex-wrap: wrap;
}

.empty {
  text-align: center;
  color: #94a3b8;
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
  width: min(860px, 100%);
  border-radius: 12px;
  background: #fff;
  border: 1px solid #e5e7eb;
  padding: 16px;
}

.modal-panel--small {
  width: min(520px, 92vw);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.modal-header h3 {
  margin: 0;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 12px;
}

.form-grid label {
  display: grid;
  gap: 6px;
  font-size: 14px;
  color: #a8a1a1;
}

.form-grid--single {
  grid-template-columns: 1fr;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

</style>
