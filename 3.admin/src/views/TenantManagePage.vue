<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { withAdminAuthHeaders, withMallTenantHeaders } from '../composables/useAdminApi'
import { getAdminSession, isSuperAdminRole } from '../composables/useAdminAuth'
import { useAdminPagePermission } from '../composables/useAdminPagePermission'
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
/** 顶栏错误提示标题：加载失败 / 删除失败 等，避免删除报错仍显示「加载失败」 */
const errorBannerTitle = ref('加载失败')
const newTenantId = ref('boss1')
const newTenantIdError = ref('')
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
const route = useRoute()
const router = useRouter()
const {
  canCreate: canCreateTenant,
  canUpdate: canUpdateTenant,
  canDelete: canDeleteTenant,
  canSwitchTenant,
} = useAdminPagePermission('tenants.system', () => isSuperAdminRole(getAdminSession()?.role))
const showTenantListActions = computed(
  () => canUpdateTenant.value || canDeleteTenant.value || canSwitchTenant.value,
)
const showTenantAccountActions = computed(() => canUpdateTenant.value || canDeleteTenant.value)
const { isPlatform, switchTenant } = useTenantScope()
const deletingTenantId = ref('')

/** 子系统账号删除：气泡确认（Teleport + fixed，避免表格裁切） */
const pendingDeleteAccountId = ref<string | null>(null)
const tenantAccountsTableWrapRef = ref<HTMLElement | null>(null)
const deleteAccountAnchorEl = ref<HTMLElement | null>(null)
const deleteAccountPopEl = ref<HTMLElement | null>(null)
const deleteAccountPopStyle = ref<Record<string, string>>({})

const ACCOUNT_DELETE_POP_GAP = 8
const ACCOUNT_DELETE_POP_VIEW_MARGIN = 8

const pendingDeleteAccount = computed(() => {
  const id = pendingDeleteAccountId.value
  if (id == null)
    return null
  return tenantAccounts.value.find(a => a.id === id) ?? null
})

function updateTenantAccountDeletePopPosition() {
  const anchor = deleteAccountAnchorEl.value
  const pop = deleteAccountPopEl.value
  if (!anchor || !pop || pendingDeleteAccountId.value == null)
    return

  const anchorRect = anchor.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const margin = ACCOUNT_DELETE_POP_VIEW_MARGIN

  const popRect = pop.getBoundingClientRect()
  let popH = popRect.height
  let popW = popRect.width
  if (popH < 4 || popW < 4) {
    popH = 96
    popW = 220
  }

  const spaceAbove = anchorRect.top - margin
  const spaceBelow = vh - anchorRect.bottom - margin

  const fitsAbove = spaceAbove >= popH + ACCOUNT_DELETE_POP_GAP
  const fitsBelow = spaceBelow >= popH + ACCOUNT_DELETE_POP_GAP

  let placeAbove: boolean
  if (fitsAbove && fitsBelow) {
    placeAbove = spaceAbove >= spaceBelow
  }
  else if (fitsBelow) {
    placeAbove = false
  }
  else if (fitsAbove) {
    placeAbove = true
  }
  else {
    placeAbove = spaceAbove >= spaceBelow
  }

  let top = placeAbove
    ? anchorRect.top - ACCOUNT_DELETE_POP_GAP - popH
    : anchorRect.bottom + ACCOUNT_DELETE_POP_GAP

  let left = anchorRect.right - popW

  left = Math.min(Math.max(left, margin), vw - popW - margin)
  top = Math.min(Math.max(top, margin), vh - popH - margin)

  deleteAccountPopStyle.value = {
    position: 'fixed',
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    zIndex: '3000',
  }
}

async function scheduleTenantAccountDeletePopPosition() {
  await nextTick()
  requestAnimationFrame(() => {
    updateTenantAccountDeletePopPosition()
    requestAnimationFrame(() => updateTenantAccountDeletePopPosition())
  })
}

function onTenantAccountDeletePopScrollOrResize() {
  void scheduleTenantAccountDeletePopPosition()
}

function onOutsideTenantAccountDeletePop(ev: PointerEvent) {
  const target = ev.target
  if (!(target instanceof Node))
    return
  if (deleteAccountPopEl.value?.contains(target))
    return
  if (deleteAccountAnchorEl.value?.contains(target))
    return
  cancelPendingTenantAccountDelete()
}

let tenantAccountDeletePopOutsideTimer: ReturnType<typeof setTimeout> | null = null

function attachTenantAccountDeletePopListeners() {
  window.addEventListener('resize', onTenantAccountDeletePopScrollOrResize)
  window.addEventListener('scroll', onTenantAccountDeletePopScrollOrResize, true)
  tenantAccountsTableWrapRef.value?.addEventListener('scroll', onTenantAccountDeletePopScrollOrResize)
  tenantAccountDeletePopOutsideTimer = window.setTimeout(() => {
    tenantAccountDeletePopOutsideTimer = null
    document.addEventListener('pointerdown', onOutsideTenantAccountDeletePop, true)
  }, 0)
}

function detachTenantAccountDeletePopListeners() {
  window.removeEventListener('resize', onTenantAccountDeletePopScrollOrResize)
  window.removeEventListener('scroll', onTenantAccountDeletePopScrollOrResize, true)
  tenantAccountsTableWrapRef.value?.removeEventListener('scroll', onTenantAccountDeletePopScrollOrResize)
  if (tenantAccountDeletePopOutsideTimer != null) {
    clearTimeout(tenantAccountDeletePopOutsideTimer)
    tenantAccountDeletePopOutsideTimer = null
  }
  document.removeEventListener('pointerdown', onOutsideTenantAccountDeletePop, true)
}

function toggleDeleteTenantAccountConfirm(item: TenantAdminAccount, ev: MouseEvent) {
  const el = ev.currentTarget as HTMLElement | null
  if (pendingDeleteAccountId.value === item.id) {
    pendingDeleteAccountId.value = null
    deleteAccountAnchorEl.value = null
    return
  }
  pendingDeleteAccountId.value = item.id
  deleteAccountAnchorEl.value = el
}

function cancelPendingTenantAccountDelete() {
  pendingDeleteAccountId.value = null
  deleteAccountAnchorEl.value = null
}

async function confirmRemoveTenantAccount() {
  const item = pendingDeleteAccount.value
  if (!item)
    return
  await removeTenantAccount(item)
}

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

const createAccountFormErrors = ref({
  username: '',
  phone: '',
  password: '',
})

function clearCreateAccountFormErrors() {
  createAccountFormErrors.value = {
    username: '',
    phone: '',
    password: '',
  }
}

function validateCreateAccountFormFields(): boolean {
  clearCreateAccountFormErrors()
  const username = createAccountForm.value.username.trim()
  const phoneDigits = String(createAccountForm.value.phone || '').replace(/\D/g, '')
  const password = String(createAccountForm.value.password || '').trim()
  let ok = true
  if (!/^[a-zA-Z][a-zA-Z0-9_]{3,20}$/.test(username)) {
    createAccountFormErrors.value.username = '账号格式不正确，需4-21位字母数字下划线且以字母开头'
    ok = false
  }
  if (!/^1\d{10}$/.test(phoneDigits)) {
    createAccountFormErrors.value.phone = '手机号格式不正确'
    ok = false
  }
  const requirePassword = createAccountMode.value !== 'edit'
  const pwdCheck = requirePassword ? password : (password.length > 0 ? password : '')
  if (requirePassword && password.length < 4) {
    createAccountFormErrors.value.password = '密码长度至少为4位'
    ok = false
  }
  else if (!requirePassword && pwdCheck.length > 0 && pwdCheck.length < 4) {
    createAccountFormErrors.value.password = '密码长度至少为4位'
    ok = false
  }
  return ok
}

/** 将接口错误文案映射到表单项；命中则不再弹窗，仅表内标红 */
function applyCreateAccountServerMessageToFields(msg: string): boolean {
  const t = String(msg || '').trim()
  if (!t) {
    return false
  }
  if (t === '手机号格式不正确' || (t.includes('手机号') && t.includes('格式'))) {
    createAccountFormErrors.value.phone = t
    return true
  }
  if (t.includes('老板手机号已存在') || t.includes('更换手机号')) {
    createAccountFormErrors.value.phone = t
    return true
  }
  if (t.includes('账号格式不正确') || t.includes('老板账号已存在') || t.includes('更换账号')) {
    createAccountFormErrors.value.username = t
    return true
  }
  if (t.includes('密码长度')) {
    createAccountFormErrors.value.password = t
    return true
  }
  return false
}

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
    const username = String(item.username || '').trim()
    const phone = String(item.phone || '').trim()
    if (!isBoss || map.has(tenantId)) return
    if (!ownerName && !username && !phone) return
    map.set(tenantId, {
      name: ownerName,
      username,
      phone,
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
  return `子系统（${tenantId}）`
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

function computeNextSuggestedBossTenantId(alsoReserveNormalizedId?: string): string {
  const usedN = new Set<number>()
  const markId = (raw: string) => {
    const id = normalizeTenantInput(String(raw || ''))
    const m = id ? /^boss(\d+)$/i.exec(id) : null
    if (!m) {
      return
    }
    const n = Number(m[1])
    if (Number.isFinite(n) && n >= 1) {
      usedN.add(Math.floor(n))
    }
  }
  for (const item of tenants.value) {
    markId(String(item.tenantId || ''))
  }
  if (alsoReserveNormalizedId) {
    markId(alsoReserveNormalizedId)
  }
  let n = 1
  while (usedN.has(n)) {
    n += 1
  }
  return `boss${n}`
}

async function fetchTenants() {
  loading.value = true
  errorMessage.value = ''
  errorBannerTitle.value = '加载失败'
  try {
    const response = await fetch(`${MALL_API_BASE}/platform/tenants`, {
      method: 'GET',
      headers: withAdminAuthHeaders({ 'x-workspace-type': 'core' }),
    })
    const payload = await response.json() as {
      success?: boolean
      msg?: string
      data?: TenantSummary[]
    }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || `加载子系统列表失败 (${response.status})`)
    }
    tenants.value = Array.isArray(payload.data) ? payload.data : []
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载子系统列表失败'
    ElMessage.error(errorMessage.value)
  }
  finally {
    loading.value = false
  }
}

async function deleteTenantApi(tenantId: string, wipeAll: boolean): Promise<{ ok: boolean, status: number, msg: string }> {
  const qs = wipeAll ? '?wipeAll=1' : ''
  const response = await fetch(
    `${MALL_API_BASE}/platform/tenants/${encodeURIComponent(tenantId)}${qs}`,
    {
      method: 'DELETE',
      headers: withAdminAuthHeaders({ 'x-workspace-type': 'core' }),
    },
  )
  const payload = await response.json() as { success?: boolean, msg?: string }
  const ok = Boolean(response.ok && payload.success !== false)
  const msg = String(payload.msg || (ok ? '' : `删除失败 (${response.status})`))
  return { ok, status: response.status, msg }
}

async function deleteTenantSystem(rawTenantId: string) {
  const tenantId = normalizeTenantInput(rawTenantId)
  if (!tenantId) {
    ElMessage.error('子系统ID无效')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定删除子系统「${tenantId}」吗？仅当该子系统尚未产生任何用户、订单、商品且无后台账号时才能直接删除。\n\n若已有商品等数据，系统将提示你是否「强制清空」该子系统在库内的全部业务数据后再注销登记（不可恢复）。`,
      '删除子系统',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      },
    )
  }
  catch {
    return
  }
  deletingTenantId.value = tenantId
  errorMessage.value = ''
  errorBannerTitle.value = '加载失败'
  try {
    const first = await deleteTenantApi(tenantId, false)
    if (first.ok) {
      if (normalizeTenantInput(selectedTenantId.value) === tenantId) {
        selectedTenantId.value = ''
      }
      ElMessage.success('已删除该子系统')
      tenants.value = tenants.value.filter(t => normalizeTenantInput(String(t.tenantId)) !== tenantId)
      tenantAccounts.value = tenantAccounts.value.filter((acc) => {
        const tid = normalizeTenantInput(String(acc.tenantId || acc.sourceTenantId || ''))
        return tid !== tenantId
      })
      newTenantId.value = computeNextSuggestedBossTenantId()
      return
    }
    if (first.status === 409 && first.msg.includes('已存在数据')) {
      try {
        await ElMessageBox.confirm(
          `子系统「${tenantId}」仍有商品、订单、用户或后台账号，无法按「空库」规则删除。\n\n下一步将永久删除该子系统在 Mongo / 本地 JSON 中的全部业务数据，并从总部登记中移除，操作不可恢复。确认继续？`,
          '强制清空并删除子系统',
          {
            type: 'error',
            confirmButtonText: '清空并删除',
            cancelButtonText: '取消',
          },
        )
      }
      catch {
        errorBannerTitle.value = '删除被拒绝'
        errorMessage.value = first.msg
        ElMessage.warning(first.msg)
        return
      }
      const second = await deleteTenantApi(tenantId, true)
      if (!second.ok) {
        errorBannerTitle.value = '删除失败'
        errorMessage.value = second.msg
        ElMessage.error(second.msg)
        return
      }
      if (normalizeTenantInput(selectedTenantId.value) === tenantId) {
        selectedTenantId.value = ''
      }
      ElMessage.success('已强制清空并删除该子系统')
      tenants.value = tenants.value.filter(t => normalizeTenantInput(String(t.tenantId)) !== tenantId)
      tenantAccounts.value = tenantAccounts.value.filter((acc) => {
        const tid = normalizeTenantInput(String(acc.tenantId || acc.sourceTenantId || ''))
        return tid !== tenantId
      })
      newTenantId.value = computeNextSuggestedBossTenantId()
      return
    }
    errorBannerTitle.value = '删除失败'
    errorMessage.value = first.msg
    ElMessage.error(first.msg)
  }
  catch (error) {
    const msg = error instanceof Error ? error.message : '删除子系统失败'
    errorBannerTitle.value = '删除失败'
    errorMessage.value = msg
    ElMessage.error(msg)
  }
  finally {
    deletingTenantId.value = ''
  }
}

function refreshTenantsAfterCreate(createdTenantId: string) {
  const normalizedCreatedId = normalizeTenantInput(createdTenantId)
  if (!normalizedCreatedId)
    return
  if (tenants.value.some(item => normalizeTenantInput(item.tenantId) === normalizedCreatedId)) {
    return
  }
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
    if (vb !== va)
      return vb - va
    return String(a.tenantId || '').localeCompare(String(b.tenantId || ''))
  })
}

async function fetchTenantAccounts() {
  accountLoading.value = true
  errorBannerTitle.value = '加载失败'
  try {
    const response = await fetch(`${MALL_API_BASE}/platform/admin-accounts?scopeType=tenant`, {
      method: 'GET',
      headers: withAdminAuthHeaders({ 'x-workspace-type': 'core' }),
    })
    const payload = await response.json() as {
      success?: boolean
      msg?: string
      data?: TenantAdminAccount[]
    }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || `加载子系统账号失败 (${response.status})`)
    }
    tenantAccounts.value = Array.isArray(payload.data) ? payload.data : []
    errorMessage.value = ''
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载子系统账号失败'
    tenantAccounts.value = []
    ElMessage.error(errorMessage.value)
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
  /** 与后端 normalizeTenantId 一致，避免筛选下拉框值与子系统 ID 大小写不一致导致账号表被滤空 */
  return lowered
}

function isValidOnboardTenantId(raw: string) {
  return /^bo?s{2}\d+$/i.test(String(raw || '').trim()) || /^boss\d+$/i.test(String(raw || '').trim()) || /^boos\d+$/i.test(String(raw || '').trim())
}

function resolveAccountTenantId(item: TenantAdminAccount) {
  return normalizeTenantInput(String(item.sourceTenantId || item.tenantId || selectedTenantId.value || ''))
}

function buildTenantScopedHeaders(tenantId: string, extra: Record<string, string> = {}) {
  return withMallTenantHeaders({
    ...extra,
    'x-tenant-id': tenantId,
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
    errorMessage.value = '该子系统未找到老板账号，请先检查新建流程'
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
  clearCreateAccountFormErrors()
  errorMessage.value = ''
}

function openCreateTenantWithBossModal() {
  newTenantIdError.value = ''
  const tenantId = normalizeTenantInput(newTenantId.value)
  if (!tenantId) {
    newTenantIdError.value = '请输入有效的子系统ID（仅支持 boss/boos + 数字，例如 boss1 或 boos1）'
    return
  }
  if (!isValidOnboardTenantId(tenantId)) {
    newTenantIdError.value = '子系统ID仅支持 boss/boos + 数字，例如 boss1、boos1'
    return
  }
  if (tenants.value.some(item => normalizeTenantInput(item.tenantId) === tenantId)) {
    newTenantIdError.value = `子系统ID ${tenantId} 已存在，请勿重复新建`
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
  clearCreateAccountFormErrors()
  errorMessage.value = ''
}

function closeCreateTenantAccount() {
  if (creatingTenantAccount.value) return
  clearCreateAccountFormErrors()
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
    headers: withAdminAuthHeaders({ 'Content-Type': 'application/json', 'x-workspace-type': 'core' }),
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
    throw new Error(payload.msg || `新建子系统失败 (${response.status})`)
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
    headers: withMallTenantHeaders({
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
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
    throw new Error(payload.msg || `新增子系统账号失败 (${response.status})`)
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

async function createTenantAccount() {
  if (creatingTenantAccount.value) return
  const tenantId = normalizeTenantInput(createAccountForm.value.tenantId)
  if (!tenantId) {
    errorMessage.value = '请先选择所属子系统'
    ElMessage.error(errorMessage.value)
    return
  }
  if (!validateCreateAccountFormFields()) {
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
      ElMessage.success('子系统与老板账号新建成功')
    }
    else if (createAccountMode.value === 'edit' && editingBossAccount.value) {
      await updateBossAccount(editingBossAccount.value, tenantId)
      ElMessage.success('老板账号信息已更新')
    }
    else {
      createdBossAccount = await createBossAccount(tenantId)
      ElMessage.success('子系统老板账号创建成功')
    }
    showCreateAccountModal.value = false
    if (createdTenantId)
      refreshTenantsAfterCreate(createdTenantId)
    if (createdBossAccount)
      upsertTenantAccountLocal(createdBossAccount)
    if (createAccountMode.value === 'onboard' && createdTenantId) {
      newTenantId.value = computeNextSuggestedBossTenantId(createdTenantId)
      newTenantIdError.value = ''
    }
    clearCreateAccountFormErrors()
  }
  catch (error) {
    const msg = error instanceof Error ? error.message : '新增失败'
    errorMessage.value = msg
    clearCreateAccountFormErrors()
    if (applyCreateAccountServerMessageToFields(msg)) {
      return
    }
    ElMessage.error(msg)
  }
  finally {
    creatingTenantAccount.value = false
  }
}

function mergeTenantAdminFromApi(prev: TenantAdminAccount, patch: TenantAdminAccount): TenantAdminAccount {
  return {
    ...prev,
    ...patch,
    tenantId: patch.tenantId || prev.tenantId,
    tenantName: patch.tenantName || prev.tenantName,
    sourceTenantId: patch.sourceTenantId || prev.sourceTenantId,
    sourceTenantName: patch.sourceTenantName || prev.sourceTenantName,
  }
}

async function updateTenantAccount(item: TenantAdminAccount, body: Record<string, unknown>): Promise<void> {
  const tenantId = resolveAccountTenantId(item)
  if (!tenantId) {
    throw new Error('无法识别该账号所属子系统')
  }
  const response = await fetch(`${MALL_API_BASE}/admin/accounts/${encodeURIComponent(item.id)}`, {
    method: 'PATCH',
    headers: buildTenantScopedHeaders(tenantId, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
  const payload = await response.json() as { success?: boolean, msg?: string, data?: TenantAdminAccount }
  if (!response.ok || payload.success === false) {
    throw new Error(payload.msg || `更新子系统账号失败 (${response.status})`)
  }
  const patch = payload.data
  if (patch && patch.id) {
    upsertTenantAccountLocal(mergeTenantAdminFromApi(item, patch))
  }
}

async function submitRoleChange() {
  if (!roleTarget.value || updatingRole.value) return
  updatingRole.value = true
  errorMessage.value = ''
  try {
    await updateTenantAccount(roleTarget.value, { role: roleForm.value.role, scopeType: 'tenant' })
    ElMessage.success('子系统账号角色已更新')
    showRoleModal.value = false
    roleTarget.value = null
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '更新子系统账号角色失败'
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
    ElMessage.success('子系统账号密码已更新')
    showPasswordModal.value = false
    passwordTarget.value = null
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '修改子系统账号密码失败'
    ElMessage.error(errorMessage.value)
  }
  finally {
    updatingPassword.value = false
  }
}

async function toggleAccountStatus(item: TenantAdminAccount) {
  if (updatingStatusId.value) return
  updatingStatusId.value = item.id
  const nextStatus = item.status === 'active' ? 'disabled' : 'active'
  try {
    await updateTenantAccount(item, { status: nextStatus })
    ElMessage.success(nextStatus === 'active' ? '账号已启用' : '账号已禁用')
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '更新子系统账号状态失败'
    ElMessage.error(errorMessage.value)
  }
  finally {
    updatingStatusId.value = ''
  }
}

async function removeTenantAccount(item: TenantAdminAccount) {
  if (deletingAccountId.value) return
  const tenantId = resolveAccountTenantId(item)
  if (!tenantId) {
    errorMessage.value = '无法识别该账号所属子系统'
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
      throw new Error(payload.msg || `删除子系统账号失败 (${response.status})`)
    }
    ElMessage.success('子系统账号已删除')
    pendingDeleteAccountId.value = null
    tenantAccounts.value = tenantAccounts.value.filter(a => a.id !== item.id)
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '删除子系统账号失败'
    ElMessage.error(errorMessage.value)
  }
  finally {
    deletingAccountId.value = ''
  }
}

function jumpToTenant(rawTenantId: string) {
  if (!isPlatform.value) {
    ElMessage.warning('仅平台管理员可使用此功能')
    return
  }
  const tenantId = normalizeTenantInput(rawTenantId)
  if (!tenantId) {
    ElMessage.warning('无效的子系统')
    return
  }
  if (!getAdminSession()) {
    ElMessage.warning('请先登录')
    return
  }
  switchTenant(tenantId)
  const sess = getAdminSession()
  const targetLc = tenantId.toLowerCase()
  const currentLc = normalizeTenantInput(String(sess?.tenantId || ''))
  const ok = Boolean(
    sess
    && sess.workspaceType === 'tenant'
    && currentLc === targetLc,
  )
  if (!ok) {
    ElMessage.warning('无法切换到该子系统（可能没有权限或子系统 ID 无效）')
    return
  }
  ElMessage.success(`已进入子系统「${tenantId}」后台视图（侧栏已隐藏总部菜单，顶栏可点「返回总部」）`)
  void router.replace({ name: 'orders' })
}

async function loadTenantManagePageData() {
  errorMessage.value = ''
  errorBannerTitle.value = '加载失败'
  selectedTenantId.value = ''
  accountKeyword.value = ''
  await fetchTenants()
  newTenantId.value = computeNextSuggestedBossTenantId()
  if (errorMessage.value) {
    tenantAccounts.value = []
    return
  }
  await fetchTenantAccounts()
}

function clearGlobalPageError() {
  errorMessage.value = ''
  errorBannerTitle.value = '加载失败'
}

watch(
  () => route.name,
  (name) => {
    if (name === 'tenants') {
      void loadTenantManagePageData()
    }
  },
  { immediate: true },
)

watch(pendingDeleteAccountId, (id) => {
  detachTenantAccountDeletePopListeners()
  deleteAccountPopStyle.value = {}
  if (id == null) {
    deleteAccountAnchorEl.value = null
    return
  }
  queueMicrotask(() => attachTenantAccountDeletePopListeners())
  void scheduleTenantAccountDeletePopPosition()
})

onUnmounted(() => {
  detachTenantAccountDeletePopListeners()
})
</script>

<template>
  <div
    v-loading="loading"
    class="tenant-manage-page"
  >
    <el-alert
      v-if="errorMessage"
      type="error"
      show-icon
      closable
      class="tenant-page__global-error"
      :title="errorBannerTitle"
      :description="errorMessage"
      @close="clearGlobalPageError"
    />
    <div
      v-if="canCreateTenant"
      class="tenant-page__quick-open"
    >
      <div class="tenant-page__quick-open-row">
        <span class="tenant-page__quick-label">新建子系统</span>
        <el-input
          v-model="newTenantId"
          class="toolbar-input tenant-page__quick-input"
          :class="{ 'is-error': !!newTenantIdError }"
          clearable
          placeholder="请输入子系统ID（如 boss1 或 boos1）"
          @update:model-value="newTenantIdError = ''"
        />
        <button
          class="btn btn-primary"
          type="button"
          :disabled="creatingTenantAccount"
          @click="openCreateTenantWithBossModal"
        >
          {{ creatingTenantAccount && createAccountMode === 'onboard' ? '新建中...' : '新建子系统' }}
        </button>
      </div>
      <p
        v-if="newTenantIdError"
        class="form-field-error tenant-page__quick-open-hint"
      >
        {{ newTenantIdError }}
      </p>
    </div>

    <div class="panel">
      <div class="panel-title">
        <h3>子系统列表</h3>
      </div>
      <div class="toolbar toolbar-left">
        <el-input
          v-model="keyword"
          class="toolbar-input"
          clearable
          placeholder="搜索子系统ID"
        />
      </div>

      <table class="table">
        <thead>
          <tr>
            <th>子系统</th>
            <th>老板姓名</th>
            <th>老板账号</th>
            <th>老板手机号</th>
            <th>用户数</th>
            <th>订单数</th>
            <th>商品数</th>
            <th v-if="showTenantListActions">
              操作
            </th>
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
            <td v-if="showTenantListActions">
              <div class="actions">
                <button
                  v-if="canUpdateTenant"
                  class="btn btn-danger"
                  type="button"
                  @click="openEditTenantBossAccount(item.tenantId)"
                >
                  修改老板账号
                </button>
                <button
                  v-if="canSwitchTenant"
                  class="btn btn-primary"
                  type="button"
                  @click="jumpToTenant(item.tenantId)"
                >
                  切换到该子系统
                </button>
                <button
                  v-if="canDeleteTenant"
                  class="btn btn-danger"
                  type="button"
                  :disabled="!!deletingTenantId"
                  @click="deleteTenantSystem(item.tenantId)"
                >
                  {{ deletingTenantId === normalizeTenantInput(item.tenantId) ? '删除中…' : '删除子系统' }}
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && filteredTenants.length === 0">
            <td
              colspan="8"
              class="empty"
            >
              暂无子系统
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
        <h3>子系统账号数据</h3>
      </div>
      <div class="toolbar toolbar-left">
        <el-select
          v-model="selectedTenantId"
          class="toolbar-input"
          clearable
          placeholder="按子系统筛选"
        >
          <el-option
            v-for="item in tenants"
            :key="`filter-${item.tenantId}`"
              :label="resolveTenantOptionLabel(item)"
            :value="item.tenantId"
          />
        </el-select>
        <el-input
          v-model="accountKeyword"
          class="toolbar-input"
          clearable
          placeholder="搜索账号 / 姓名 / 手机号"
        />
        
        <button
          class="btn btn-refresh"
          type="button"
          :disabled="accountLoading"
          @click="fetchTenantAccounts"
        >
          刷新
        </button>
      </div>

      <div
        ref="tenantAccountsTableWrapRef"
        class="tenant-accounts-table-wrap"
      >
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
            <th v-if="showTenantAccountActions">
              操作
            </th>
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
            <td v-if="showTenantAccountActions">
              <div class="actions">
                <button
                  v-if="canUpdateTenant"
                  class="btn btn-warning"
                  type="button"
                  :disabled="Boolean(updatingStatusId) || deletingAccountId === item.id"
                  @click="toggleAccountStatus(item)"
                >
                  {{
                    updatingStatusId === item.id
                      ? '处理中…'
                      : item.status === 'active' ? '禁用' : '启用'
                  }}
                </button>
                <button
                  v-if="canUpdateTenant"
                  class="btn btn-role-edit"
                  type="button"
                  @click="openRoleDialog(item)"
                >
                  修改角色
                </button>
                <button
                  v-if="canUpdateTenant"
                  class="btn btn-primary"
                  type="button"
                  @click="openPasswordDialog(item)"
                >
                  修改密码
                </button>
                <button
                  v-if="canDeleteTenant"
                  class="btn btn-danger"
                  type="button"
                  :disabled="deletingAccountId === item.id"
                  @click="toggleDeleteTenantAccountConfirm(item, $event)"
                >
                  {{ deletingAccountId === item.id ? '删除中…' : '删除' }}
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="!accountLoading && filteredTenantAccounts.length === 0">
            <td
              colspan="9"
              class="empty"
            >
              暂无子系统账号数据
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>

    <div
      v-if="showCreateAccountModal"
      class="modal-mask"
      @click.self="closeCreateTenantAccount"
    >
      <div class="modal-panel">
        <div class="modal-header">
          <h3>{{ createAccountMode === 'onboard' ? '新建子系统并新增老板账号' : (createAccountMode === 'edit' ? '修改老板账号' : '新增老板账号') }}</h3>
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
            所属子系统ID
            <el-input
              v-model="createAccountForm.tenantId"
              class="form-input"
              disabled
            />
          </label>
          <label v-else>
            所属子系统
            <el-select
              v-model="createAccountForm.tenantId"
              class="form-select"
              filterable
              allow-create
              default-first-option
              placeholder="选择子系统ID"
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
              :class="{ 'is-error': !!createAccountFormErrors.username }"
              clearable
              @update:model-value="createAccountFormErrors.username = ''"
            />
            <span
              v-if="createAccountFormErrors.username"
              class="form-field-error"
            >{{ createAccountFormErrors.username }}</span>
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
              :class="{ 'is-error': !!createAccountFormErrors.phone }"
              clearable
              @update:model-value="createAccountFormErrors.phone = ''"
            />
            <span
              v-if="createAccountFormErrors.phone"
              class="form-field-error"
            >{{ createAccountFormErrors.phone }}</span>
          </label>
          <label>
            {{ createAccountMode === 'edit' ? '新密码（留空则不修改）' : '初始密码' }}
            <el-input
              v-model="createAccountForm.password"
              class="form-input"
              :class="{ 'is-error': !!createAccountFormErrors.password }"
              type="password"
              show-password
              @update:model-value="createAccountFormErrors.password = ''"
            />
            <span
              v-if="createAccountFormErrors.password"
              class="form-field-error"
            >{{ createAccountFormErrors.password }}</span>
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
                    ? '确认新建并创建老板'
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

    <Teleport to="body">
      <div
        v-if="pendingDeleteAccountId !== null && pendingDeleteAccount"
        ref="deleteAccountPopEl"
        class="tenant-account-delete-pop"
        role="dialog"
        aria-modal="true"
        :style="deleteAccountPopStyle"
      >
        <p>确认删除子系统账号「{{ pendingDeleteAccount.username }}」吗？</p>
        <div class="tenant-account-delete-pop__actions">
          <button
            class="btn btn-danger"
            type="button"
            :disabled="deletingAccountId === pendingDeleteAccount.id"
            @click="confirmRemoveTenantAccount"
          >
            删除
          </button>
          <button
            class="btn btn-ghost"
            type="button"
            :disabled="deletingAccountId === pendingDeleteAccount.id"
            @click="cancelPendingTenantAccountDelete"
          >
            取消
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.tenant-manage-page {
  display: grid;
  gap: 12px;
  align-content: start;
  width: 100%;
  flex: 0 1 auto;
  min-height: 0;
}

.tenant-page__quick-open {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.tenant-page__quick-open-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.tenant-page__quick-label {
  font-size: 14px;
  font-weight: 600;
  color: #334155;
  margin-right: 4px;
}

.tenant-page__quick-input {
  width: 260px;
  max-width: 100%;
}

.tenant-page__quick-open-hint {
  margin: 0;
  padding-left: 0;
  max-width: min(560px, 100%);
}

.panel {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #fff;
  padding: 12px;
}

.panel-title h3 {
  margin: 0;
  font-size: 16px;
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

.btn-ghost {
  border-color: #d1d5db;
  background: #fff;
  color: #374151;
}

.tenant-accounts-table-wrap {
  max-width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.tenant-account-delete-pop {
  min-width: 220px;
  max-width: min(320px, calc(100vw - 16px));
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.12);
  padding: 10px;
  box-sizing: border-box;
}

.tenant-account-delete-pop p {
  margin: 0;
  color: #374151;
  font-size: 13px;
  line-height: 1.45;
}

.tenant-account-delete-pop__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 8px;
}

.tenant-account-delete-pop__actions .btn {
  width: 100%;
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

.form-field-error {
  font-size: 12px;
  color: var(--el-color-danger);
  line-height: 1.35;
  margin-top: 2px;
}

.form-input.is-error :deep(.el-input__wrapper),
.toolbar-input.is-error :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--el-color-danger) inset;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

</style>
