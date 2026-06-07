<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { adminRoleDisplayLabel, adminSessionRevision, getAdminSession, isPlatformBootstrapUser, shouldUseHeadquartersPlatformApi } from '../composables/useAdminAuth'
import { withAdminAuthHeaders, withMallTenantHeaders } from '../composables/useAdminApi'
import { useAdminPagePermission } from '../composables/useAdminPagePermission'
import { donePageProgress, startPageProgress } from '../utils/progress'

type AccountRole = 'super_admin' | 'boss' | 'reviewer' | 'collector'
type AccountStatus = 'active' | 'disabled'
type PermissionAction = string

interface AdminPermissions {
  menus: string[]
  actions: Record<string, PermissionAction[]>
}

interface PermissionTreeNode {
  key: string
  label: string
  actions?: PermissionAction[]
  children?: PermissionTreeNode[]
}

interface AdminAccountItem {
  id: string
  username: string
  role: AccountRole
  roleLabel: string
  name: string
  phone: string
  status: AccountStatus
  scopeType?: 'platform' | 'tenant'
  tenantId?: string
  tenantName?: string
  scopeTenantIds?: string[]
  sourceTenantId?: string
  sourceTenantName?: string
  permissions?: AdminPermissions
  createdAt: string
  updatedAt: string
}

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`
const route = useRoute()
const loading = ref(false)
const submitting = ref(false)
const deletingId = ref('')
const pendingDeleteId = ref('')
const statusTogglingId = ref('')
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
const permissionSubmitting = ref(false)
const permissionTarget = ref<AdminAccountItem | null>(null)
const showPermissionModal = ref(false)
const permissionTreeRef = ref<any>(null)
const createPermissionTreeRef = ref<any>(null)
const syncingCreatePermissionTree = ref(false)
const permissionTreeVersion = ref(0)
const permissionTree = ref<PermissionTreeNode[]>([])
const permissionActions = ref<PermissionAction[]>(['view'])
const permissionActionLabels = ref<Record<PermissionAction, string>>({
  view: '查看',
  reply: '回复',
  review: '审核',
  issueCard: '发卡包',
  markPaid: '标记回款',
  export: '导出',
  create: '新增',
  update: '编辑',
  delete: '删除',
  permission: '分配权限',
  switchTenant: '切换子系统',
})
const permissionRoleDefaults = ref<Partial<Record<Exclude<AccountRole, 'super_admin'>, AdminPermissions>>>({})
const permissionForm = reactive<AdminPermissions>({
  menus: [],
  actions: {},
})
const createPermissionForm = reactive<AdminPermissions>({
  menus: [],
  actions: {},
})
const session = computed(() => {
  void route.fullPath
  void adminSessionRevision.value
  return getAdminSession()
})
const {
  canCreate: canCreateAccount,
  canUpdate: canUpdateAccount,
  canDelete: canDeleteAccount,
  canPermission: canSetAccountPermission,
} = useAdminPagePermission('accounts')
const showAccountRowActions = computed(
  () => canUpdateAccount.value || canDeleteAccount.value || canSetAccountPermission.value,
)
const isPlatformSession = computed(() => session.value?.scopeType === 'platform')
/** 使用 /platform/accounts（core）；子系统工作区下同纯子系统，走 /admin/accounts */
const usePlatformAccountsApi = computed(() => shouldUseHeadquartersPlatformApi(session.value))
const createRoleOptions = computed(() => {
  const options: Array<{ label: string, value: Exclude<AccountRole, 'super_admin'> }> = [
    { label: '审核员', value: 'reviewer' },
    { label: '催收员', value: 'collector' },
  ]
  if (usePlatformAccountsApi.value)
    options.push({ label: '老板', value: 'boss' })
  return options
})
const sessionUsername = computed(() => String(session.value?.username || '').trim())
/** 仅超级管理员可看「超级管理员」折叠分组；老板/员工等均不展示 */
const viewerMaySeeSuperAdminAccountsSection = computed(
  () => session.value?.role === 'super_admin',
)
const tableColumnCount = computed(() => (showAccountRowActions.value ? 7 : 6))

const createForm = reactive({
  username: '',
  name: '',
  phone: '',
  password: '',
  role: '' as '' | Exclude<AccountRole, 'super_admin'>,
})

const createFormErrors = reactive({
  username: '',
  name: '',
  phone: '',
  password: '',
  general: '',
})

function clearCreateFormErrors() {
  createFormErrors.username = ''
  createFormErrors.name = ''
  createFormErrors.phone = ''
  createFormErrors.password = ''
  createFormErrors.general = ''
}

function applyCreateAccountApiError(msg: string) {
  const t = String(msg || '').trim()
  clearCreateFormErrors()
  if (!t) {
    createFormErrors.general = '创建失败'
    return
  }
  if (t.includes('手机号') || (t.includes('手机') && t.includes('占用'))) {
    createFormErrors.phone = t
    return
  }
  if (t.includes('账号')) {
    createFormErrors.username = t
    return
  }
  if (t.includes('密码')) {
    createFormErrors.password = t
    return
  }
  createFormErrors.general = t
}

const passwordForm = reactive({
  password: '',
  confirmPassword: '',
})

const roleForm = reactive({
  role: 'reviewer' as AccountRole,
})

const filteredAccounts = computed(() => {
  const key = keyword.value.trim()
  const source = accounts.value
  if (!key) return source
  return source.filter(item =>
    item.username.includes(key) || item.name.includes(key) || item.phone.includes(key),
  )
})

type AccountTableRow =
  | { kind: 'section'; key: string; title: string }
  | { kind: 'account'; item: AdminAccountItem }
  | { kind: 'super_admin_toggle'; count: number }

/** 默认折叠；展开后显示超级管理员账号行 */
const superAdminSectionExpanded = ref(false)

const superAdminAccounts = computed(() => {
  const list = filteredAccounts.value.filter(i => i.role === 'super_admin')
  const byUsername = (a: AdminAccountItem, b: AdminAccountItem) =>
    a.username.localeCompare(b.username, 'zh-CN')
  return [...list].sort(byUsername)
})

/** 老板分区 → 员工（不含超级管理员） */
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
  if (viewerMaySeeSuperAdminAccountsSection.value && supers.length) {
    rows.push({ kind: 'super_admin_toggle', count: supers.length })
    if (superAdminSectionExpanded.value)
      supers.forEach(item => rows.push({ kind: 'account', item }))
  }
  rows.push(...accountTableRowsRest.value)
  return rows
})

/** 表中是否至少有一行账号数据（分段标题不算）；与「对谁可见」一致，用于空状态 */
const hasVisibleAccountRowInTable = computed(() =>
  accountTableBodyRows.value.some(row => row.kind === 'account'),
)

watch(viewerMaySeeSuperAdminAccountsSection, (ok) => {
  if (!ok)
    superAdminSectionExpanded.value = false
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
  if (item.roleLabel?.trim())
    return item.roleLabel
  return adminRoleDisplayLabel(item.role)
}

function sectionHeaderClass(sectionKey: string) {
  if (sectionKey === 'sec-super-admin')
    return 'section-head section-head-super'
  if (sectionKey === 'sec-boss')
    return 'section-head section-head-boss'
  return 'section-head section-head-staff'
}

function isProtectedPlatformSuperRow(item: AdminAccountItem): boolean {
  return usePlatformAccountsApi.value && isPlatformBootstrapUser(item.username)
}

/** 子系统侧不可删除/禁用的老板行；平台侧内置超级管理员不可删除/禁用/改角色，但可修改密码 */
function isAccountRowImmutable(item: AdminAccountItem): boolean {
  if (isProtectedPlatformSuperRow(item))
    return true
  if (!isPlatformSession.value && item.role === 'boss')
    return true
  return false
}

/** 当前登录账号自身行：禁止删、禁角色、禁禁用（可改密码） */
function isCurrentSessionRow(item: AdminAccountItem): boolean {
  return Boolean(sessionUsername.value && item.username === sessionUsername.value)
}



async function fetchAccounts() {
  loading.value = true
  startPageProgress()
  errorMessage.value = ''
  try {
    if (usePlatformAccountsApi.value) {
      const response = await fetch(`${MALL_API_BASE}/platform/accounts`, {
        method: 'GET',
        headers: withAdminAuthHeaders({ 'x-workspace-type': 'core' }),
      })
      const payload = await response.json() as {
        success?: boolean
        msg?: string
        data?: AdminAccountItem[]
      }
      if (!response.ok || payload.success === false) {
        const msg = payload.msg || `加载账号失败 (${response.status})`
        if (response.status === 401 || response.status === 403) {
          throw new Error(`${msg} — 请退出后重新登录`)
        }
        throw new Error(msg)
      }
      accounts.value = Array.isArray(payload.data) ? payload.data : []
    }
    else {
      const response = await fetch(`${MALL_API_BASE}/admin/accounts?scopeType=tenant`, {
        method: 'GET',
        headers: withMallTenantHeaders(),
      })
      const payload = await response.json() as {
        success?: boolean
        msg?: string
        data?: AdminAccountItem[]
      }
      if (!response.ok || payload.success === false) {
        throw new Error(payload.msg || `加载账号失败 (${response.status})`)
      }
      accounts.value = Array.isArray(payload.data) ? payload.data : []
    }
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

function applyAdminAccountUpsert(next: AdminAccountItem) {
  const idx = accounts.value.findIndex(a => a.id === next.id)
  if (idx >= 0)
    accounts.value[idx] = { ...accounts.value[idx], ...next }
  else
    accounts.value = [next, ...accounts.value]
}

function removeAdminAccountLocal(id: string) {
  accounts.value = accounts.value.filter(a => a.id !== id)
}

function openCreateModal() {
  showCreate.value = true
  createForm.username = ''
  createForm.name = ''
  createForm.phone = ''
  createForm.password = ''
  createForm.role = ''
  createPermissionForm.menus = []
  createPermissionForm.actions = {}
  clearCreateFormErrors()
  errorMessage.value = ''
  void fetchPermissionCatalog().catch((error) => {
    ElMessage.error(error instanceof Error ? error.message : '加载权限目录失败')
  })
}

function closeCreateModal() {
  if (submitting.value) return
  clearCreateFormErrors()
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
  if (!isPlatformSession.value && item.role === 'boss') {
    ElMessage.warning('不可修改老板账号角色')
    return
  }
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
  clearCreateFormErrors()
  if (!createForm.role) {
    createFormErrors.general = '请选择角色'
    return
  }
  const password = createForm.password.trim()
  if (!password) {
    createFormErrors.password = '请输入初始密码'
    return
  }
  if (password.length < 4) {
    createFormErrors.password = '初始密码至少 4 位'
    return
  }
  submitting.value = true
  try {
    const createPermissions = buildCreatePermissionsPayload()
    if (usePlatformAccountsApi.value) {
      const response = await fetch(`${MALL_API_BASE}/platform/accounts`, {
        method: 'POST',
        headers: withAdminAuthHeaders({ 'Content-Type': 'application/json', 'x-workspace-type': 'core' }),
        body: JSON.stringify({
          username: createForm.username.trim(),
          name: createForm.name.trim(),
          phone: createForm.phone.trim(),
          password: createForm.password.trim(),
          role: createForm.role,
          scopeType: 'platform',
          scopeTenantIds: [],
          ...(createPermissions ? { permissions: createPermissions } : {}),
        }),
      })
      const payload = await response.json() as { msg?: string, success?: boolean, data?: AdminAccountItem }
      if (!response.ok || payload.success === false) {
        throw new Error(payload.msg || `创建账号失败: ${response.status}`)
      }
      if (payload.data)
        applyAdminAccountUpsert(payload.data)
    }
    else {
      const tenantId = String(session.value?.tenantId || '').trim()
      const response = await fetch(`${MALL_API_BASE}/admin/accounts`, {
        method: 'POST',
        headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          username: createForm.username.trim(),
          name: createForm.name.trim(),
          phone: createForm.phone.trim(),
          password: createForm.password.trim(),
          role: createForm.role,
          scopeType: 'tenant',
          ...(createPermissions ? { permissions: createPermissions } : {}),
          ...(tenantId ? { tenantId } : {}),
        }),
      })
      const payload = await response.json() as { msg?: string, success?: boolean, data?: AdminAccountItem }
      if (!response.ok || payload.success === false) {
        throw new Error(payload.msg || `创建账号失败: ${response.status}`)
      }
      if (payload.data)
        applyAdminAccountUpsert(payload.data)
    }
    showCreate.value = false
    clearCreateFormErrors()
  }
  catch (error) {
    const msg = error instanceof Error ? error.message : '创建账号失败'
    applyCreateAccountApiError(msg)
  }
  finally {
    submitting.value = false
  }
}

async function updateAccount(id: string, body: Record<string, unknown>): Promise<AdminAccountItem | null> {
  if (usePlatformAccountsApi.value) {
    const response = await fetch(`${MALL_API_BASE}/platform/accounts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: withAdminAuthHeaders({ 'Content-Type': 'application/json', 'x-workspace-type': 'core' }),
      body: JSON.stringify(body),
    })
    const payload = await response.json() as { msg?: string, success?: boolean, data?: AdminAccountItem }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || `更新账号失败: ${response.status}`)
    }
    return payload.data ?? null
  }
  else {
    const response = await fetch(`${MALL_API_BASE}/admin/accounts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })
    const payload = await response.json() as { msg?: string, success?: boolean, data?: AdminAccountItem }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || `更新账号失败: ${response.status}`)
    }
    return payload.data ?? null
  }
}

function flattenPermissionTree(nodes: PermissionTreeNode[]) {
  const out: PermissionTreeNode[] = []
  const walk = (list: PermissionTreeNode[]) => {
    list.forEach((item) => {
      out.push(item)
      if (item.children?.length)
        walk(item.children)
    })
  }
  walk(nodes)
  return out
}

const flatPermissionNodes = computed(() => flattenPermissionTree(permissionTree.value))

function permissionNodeByKey(key: string) {
  return flatPermissionNodes.value.find(item => item.key === key)
}

function actionsForPermissionKey(key: string) {
  const nodeActions = permissionNodeByKey(key)?.actions
  const allowed = Array.isArray(nodeActions) && nodeActions.length ? nodeActions : ['view']
  return allowed.filter(action => permissionActions.value.includes(action))
}

function treeCheckedKeysForMenus(menus: string[]) {
  return menus.filter((key) => {
    const node = permissionNodeByKey(key)
    return node && !node.children?.length
  })
}

function setCreatePermissionTreeCheckedKeys() {
  createPermissionTreeRef.value?.setCheckedKeys(treeCheckedKeysForMenus(createPermissionForm.menus), false)
}

function setPermissionTreeCheckedKeys() {
  permissionTreeRef.value?.setCheckedKeys(treeCheckedKeysForMenus(permissionForm.menus), false)
}

const selectedPermissionNodes = computed(() => {
  const selected = new Set(permissionForm.menus)
  return flatPermissionNodes.value.filter(item => selected.has(item.key))
})

const selectedCreatePermissionNodes = computed(() => {
  const selected = new Set(createPermissionForm.menus)
  return flatPermissionNodes.value.filter(item => selected.has(item.key))
})

async function fetchPermissionCatalog() {
  if (permissionTree.value.length) return
  const response = await fetch(`${MALL_API_BASE}/admin/permissions/catalog`, {
    method: 'GET',
    headers: usePlatformAccountsApi.value
      ? withAdminAuthHeaders({ 'x-workspace-type': 'core' })
      : withMallTenantHeaders(),
  })
  const payload = await response.json() as {
    success?: boolean
    msg?: string
    data?: {
      tree?: PermissionTreeNode[]
      actions?: PermissionAction[]
      actionLabels?: Record<string, string>
      roleDefaults?: Partial<Record<Exclude<AccountRole, 'super_admin'>, AdminPermissions>>
    }
  }
  if (!response.ok || payload.success === false) {
    throw new Error(payload.msg || `加载权限目录失败 (${response.status})`)
  }
  permissionTree.value = Array.isArray(payload.data?.tree) ? payload.data.tree : []
  const actions = Array.isArray(payload.data?.actions) ? payload.data.actions : []
  permissionActions.value = actions.map(action => String(action || '').trim()).filter(Boolean)
  if (!permissionActions.value.includes('view'))
    permissionActions.value.unshift('view')
  permissionActionLabels.value = {
    ...permissionActionLabels.value,
    ...(payload.data?.actionLabels || {}),
  }
  permissionRoleDefaults.value = payload.data?.roleDefaults || {}
}

function applyCreateRoleDefaultPermissions(role: Exclude<AccountRole, 'super_admin'>) {
  const defaults = permissionRoleDefaults.value[role] || { menus: [], actions: {} }
  createPermissionForm.menus = [...(defaults.menus || [])]
  createPermissionForm.actions = {}
  Object.entries(defaults.actions || {}).forEach(([key, list]) => {
    const allowed = actionsForPermissionKey(key)
    const next = Array.isArray(list) ? list.filter(action => allowed.includes(action)) : []
    createPermissionForm.actions[key] = next.length ? next : ['view']
  })
  ensureActionsForSelectedMenus(createPermissionForm.menus, createPermissionForm.actions)
  void nextTick(() => {
    if (!createPermissionTreeRef.value)
      return
    syncingCreatePermissionTree.value = true
    setCreatePermissionTreeCheckedKeys()
    window.setTimeout(() => {
      syncingCreatePermissionTree.value = false
    }, 0)
  })
}

function selectCreateRole(role: Exclude<AccountRole, 'super_admin'>) {
  createFormErrors.general = ''
  if (createForm.role !== role)
    createForm.role = role
  applyCreateRoleDefaultPermissions(role)
}

function resetPermissionForm(item: AdminAccountItem) {
  const permissions = item.permissions || { menus: [], actions: {} }
  permissionForm.menus = [...(permissions.menus || [])]
  permissionForm.actions = {}
  Object.entries(permissions.actions || {}).forEach(([key, list]) => {
    permissionForm.actions[key] = Array.isArray(list)
      ? list.filter(action => actionsForPermissionKey(key).includes(action))
      : []
  })
  permissionTreeVersion.value += 1
}

async function openPermissionModal(item: AdminAccountItem) {
  if (!['super_admin', 'boss'].includes(String(session.value?.role || ''))) {
    ElMessage.warning('仅系统管理员和老板可以编辑权限')
    return
  }
  try {
    await fetchPermissionCatalog()
    permissionTarget.value = item
    resetPermissionForm(item)
    errorMessage.value = ''
    showPermissionModal.value = true
    void nextTick(setPermissionTreeCheckedKeys)
  }
  catch (error) {
    const msg = error instanceof Error ? error.message : '加载权限目录失败'
    errorMessage.value = msg
    ElMessage.error(msg)
  }
}

function closePermissionModal() {
  if (permissionSubmitting.value) return
  showPermissionModal.value = false
  permissionTarget.value = null
}

function ensureActionsForSelectedMenus(
  menus: string[],
  actions: Record<string, PermissionAction[]>,
) {
  menus.forEach((key) => {
    if (!actions[key]?.length)
      actions[key] = ['view']
  })
}

function syncPermissionMenusFromTree() {
  const keys = permissionTreeRef.value?.getCheckedKeys?.() || []
  const halfKeys = permissionTreeRef.value?.getHalfCheckedKeys?.() || []
  permissionForm.menus = [...new Set([...keys, ...halfKeys].map((key: unknown) => String(key || '').trim()).filter(Boolean))]
  const selected = new Set(permissionForm.menus)
  Object.keys(permissionForm.actions).forEach((key) => {
    if (!selected.has(key))
      delete permissionForm.actions[key]
  })
  ensureActionsForSelectedMenus(permissionForm.menus, permissionForm.actions)
}

function onPermissionTreeCheck() {
  syncPermissionMenusFromTree()
}

function syncCreatePermissionMenusFromTree() {
  const keys = createPermissionTreeRef.value?.getCheckedKeys?.() || []
  const halfKeys = createPermissionTreeRef.value?.getHalfCheckedKeys?.() || []
  createPermissionForm.menus = [...new Set([...keys, ...halfKeys].map((key: unknown) => String(key || '').trim()).filter(Boolean))]
  const selected = new Set(createPermissionForm.menus)
  Object.keys(createPermissionForm.actions).forEach((key) => {
    if (!selected.has(key))
      delete createPermissionForm.actions[key]
  })
  ensureActionsForSelectedMenus(createPermissionForm.menus, createPermissionForm.actions)
}

function onCreatePermissionTreeCheck() {
  if (syncingCreatePermissionTree.value)
    return
  syncCreatePermissionMenusFromTree()
}

function getPermissionActionList(key: string) {
  const allowed = actionsForPermissionKey(key)
  const current = permissionForm.actions[key]?.filter(action => allowed.includes(action)) || []
  return current.length ? current : ['view']
}

function getCreatePermissionActionList(key: string) {
  const allowed = actionsForPermissionKey(key)
  const current = createPermissionForm.actions[key]?.filter(action => allowed.includes(action)) || []
  return current.length ? current : ['view']
}

function setPermissionActions(key: string, value: unknown) {
  const list = Array.isArray(value) ? value : []
  const allowed = actionsForPermissionKey(key)
  const next = list
    .map(item => String(item || '') as PermissionAction)
    .filter(action => allowed.includes(action))
  permissionForm.actions[key] = next.length ? next : ['view']
}

function setCreatePermissionActions(key: string, value: unknown) {
  const list = Array.isArray(value) ? value : []
  const allowed = actionsForPermissionKey(key)
  const next = list
    .map(item => String(item || '') as PermissionAction)
    .filter(action => allowed.includes(action))
  createPermissionForm.actions[key] = next.length ? next : ['view']
}

function buildCreatePermissionsPayload() {
  if (!canSetAccountPermission.value) {
    return undefined
  }
  syncCreatePermissionMenusFromTree()
  const actions: Record<string, PermissionAction[]> = {}
  createPermissionForm.menus.forEach((key) => {
    const allowed = actionsForPermissionKey(key)
    const list = createPermissionForm.actions[key] || ['view']
    actions[key] = [...new Set(list.filter(action => allowed.includes(action)))]
    if (!actions[key].length)
      actions[key] = ['view']
  })
  return {
    menus: createPermissionForm.menus,
    actions,
  }
}

async function submitPermissionChange() {
  if (!permissionTarget.value || permissionSubmitting.value) return
  syncPermissionMenusFromTree()
  permissionSubmitting.value = true
  errorMessage.value = ''
  try {
    const actions: Record<string, PermissionAction[]> = {}
    permissionForm.menus.forEach((key) => {
      const allowed = actionsForPermissionKey(key)
      const list = permissionForm.actions[key] || ['view']
      actions[key] = [...new Set(list.filter(action => allowed.includes(action)))]
      if (!actions[key].length)
        actions[key] = ['view']
    })
    const next = await updateAccount(permissionTarget.value.id, {
      permissions: {
        menus: permissionForm.menus,
        actions,
      },
    })
    if (next)
      applyAdminAccountUpsert(next)
    ElMessage.success(`账号 ${permissionTarget.value.username} 权限已更新`)
    closePermissionModal()
  }
  catch (error) {
    const msg = error instanceof Error ? error.message : '更新账号权限失败'
    errorMessage.value = msg
    ElMessage.error(msg)
  }
  finally {
    permissionSubmitting.value = false
  }
}

async function switchStatus(item: AdminAccountItem) {
  if (statusTogglingId.value || deletingId.value || isStatusToggleLocked(item)) return
  statusTogglingId.value = item.id
  try {
    const next = await updateAccount(item.id, {
      status: item.status === 'active' ? 'disabled' : 'active',
    })
    if (next)
      applyAdminAccountUpsert(next)
    ElMessage.success(next?.status === 'active' ? '账号已启用' : '账号已禁用')
  }
  catch (error) {
    const msg = error instanceof Error ? error.message : '更新账号状态失败'
    errorMessage.value = msg
    ElMessage.error(msg)
  }
  finally {
    statusTogglingId.value = ''
  }
}

async function submitRoleChange() {
  if (!roleTarget.value || roleSubmitting.value) return
  if (roleForm.role === roleTarget.value.role) {
    closeRoleModal()
    return
  }
  if (roleForm.role === 'super_admin') {
    ElMessage.error('不可将账号修改为超级管理员')
    return
  }
  if (!isPlatformSession.value && roleForm.role === 'boss') {
    ElMessage.error('员工角色仅可为审核员或催收员')
    return
  }
  roleSubmitting.value = true
  errorMessage.value = ''
  try {
    const next = await updateAccount(roleTarget.value.id, { role: roleForm.role })
    ElMessage.success(`账号 ${roleTarget.value.username} 角色已更新`)
    showRoleModal.value = false
    roleTarget.value = null
    if (next)
      applyAdminAccountUpsert(next)
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
    const next = await updateAccount(passwordTarget.value.id, { password })
    ElMessage.success(`账号 ${passwordTarget.value.username} 密码已更新`)
    showPasswordModal.value = false
    passwordTarget.value = null
    passwordForm.password = ''
    passwordForm.confirmPassword = ''
    if (next)
      applyAdminAccountUpsert(next)
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
    const url = usePlatformAccountsApi.value
      ? `${MALL_API_BASE}/platform/accounts/${encodeURIComponent(item.id)}`
      : `${MALL_API_BASE}/admin/accounts/${encodeURIComponent(item.id)}`
    const response = await fetch(url, {
      method: 'DELETE',
      headers: usePlatformAccountsApi.value
        ? withAdminAuthHeaders({ 'x-workspace-type': 'core' })
        : withMallTenantHeaders(),
    })
    const payload = await response.json() as { msg?: string, success?: boolean }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || `删除账号失败: ${response.status}`)
    }
    pendingDeleteId.value = ''
    ElMessage.success('账号删除成功')
    removeAdminAccountLocal(item.id)
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

function isStatusToggleLocked(item: AdminAccountItem): boolean {
  return isAccountRowImmutable(item) || isCurrentSessionRow(item)
}

function isRoleEditLocked(item: AdminAccountItem): boolean {
  return isProtectedPlatformSuperRow(item) || isCurrentSessionRow(item) || (!isPlatformSession.value && item.role === 'boss')
}

function isDeleteButtonDisabled(item: AdminAccountItem): boolean {
  if (isAccountRowImmutable(item) || isCurrentSessionRow(item))
    return true
  return Boolean(deletingId.value && deletingId.value !== item.id)
}

function cancelDelete() {
  pendingDeleteId.value = ''
}

watch(
  () => [route.fullPath, adminSessionRevision.value] as const,
  () => {
    const s = getAdminSession()
    if (!s)
      return
    if (s.scopeType === 'platform' || s.role === 'boss') {
      void fetchAccounts()
    }
  },
  { immediate: true },
)
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
        v-if="canCreateAccount"
        class="btn btn-primary"
        type="button"
        @click="openCreateModal"
      >
        新增账号
      </button>
    </div>

    <p
      v-if="errorMessage && !showCreate"
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
          <th v-if="showAccountRowActions">
            操作
          </th>
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
              :colspan="tableColumnCount"
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
                <span class="super-admin-collapse-label">超级管理员</span>
                <span class="super-admin-collapse-meta">{{ row.count }} 个账号 · {{ superAdminSectionExpanded ? '点击收起' : '点击展开' }}</span>
              </button>
            </td>
          </tr>
          <tr
            v-else-if="row.kind === 'section'"
            class="table-section-row"
          >
            <td
              :colspan="tableColumnCount"
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
            <td v-if="showAccountRowActions">
              <div class="actions">
                <button
                  v-if="canUpdateAccount"
                  class="btn btn-warning"
                  type="button"
                  :disabled="isStatusToggleLocked(row.item) || Boolean(statusTogglingId) || Boolean(deletingId)"
                  @click="switchStatus(row.item)"
                >
                  {{
                    statusTogglingId === row.item.id
                      ? '处理中…'
                      : row.item.status === 'active' ? '禁用' : '启用'
                  }}
                </button>
                <button
                  v-if="canUpdateAccount"
                  class="btn btn-role-edit"
                  type="button"
                  :disabled="isRoleEditLocked(row.item)"
                  @click="openRoleModal(row.item)"
                >
                  修改角色
                </button>
                <button
                  v-if="canSetAccountPermission"
                  class="btn btn-permission-edit"
                  type="button"
                  @click="openPermissionModal(row.item)"
                >
                  权限设置
                </button>
                <button
                  v-if="canUpdateAccount"
                  class="btn btn-primary"
                  type="button"
                  @click="openPasswordModal(row.item)"
                >
                  修改密码
                </button>
                <div
                  v-if="canDeleteAccount"
                  class="delete-wrap"
                >
                  <button
                    class="btn btn-danger"
                    type="button"
                    :disabled="isDeleteButtonDisabled(row.item)"
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
        <tr v-if="!loading && !hasVisibleAccountRowInTable">
          <td
            :colspan="tableColumnCount"
            style="text-align: center; color: #9ca3af;"
          >
            当前暂无账号。
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
    <div class="modal-panel create-modal-panel">
      <div class="modal-header">
        <h3>新增账号</h3>
        <button
          class="btn btn-secondary"
          type="button"
          @click="closeCreateModal"
        >
          关闭
        </button>
      </div>
      <div class="form-grid">
        <p
          v-if="createFormErrors.general"
          class="form-field-error form-field-error--full"
        >
          {{ createFormErrors.general }}
        </p>
        <label>
          账号
          <el-input
            v-model="createForm.username"
            class="form-input"
            :class="{ 'is-error': !!createFormErrors.username }"
            clearable
            @update:model-value="createFormErrors.username = ''"
          />
          <span
            v-if="createFormErrors.username"
            class="form-field-error"
          >{{ createFormErrors.username }}</span>
        </label>
        <label>
          姓名
          <el-input
            v-model="createForm.name"
            class="form-input"
            clearable
            @update:model-value="createFormErrors.name = ''"
          />
        </label>
        <label>
          手机号
          <el-input
            v-model="createForm.phone"
            class="form-input"
            :class="{ 'is-error': !!createFormErrors.phone }"
            clearable
            @update:model-value="createFormErrors.phone = ''"
          />
          <span
            v-if="createFormErrors.phone"
            class="form-field-error"
          >{{ createFormErrors.phone }}</span>
        </label>
        <label>
          初始密码
          <el-input
            v-model="createForm.password"
            class="form-input"
            :class="{ 'is-error': !!createFormErrors.password }"
            type="password"
            placeholder="请输入初始密码"
            show-password
            autocomplete="new-password"
            @update:model-value="createFormErrors.password = ''"
          />
          <span
            v-if="createFormErrors.password"
            class="form-field-error"
          >{{ createFormErrors.password }}</span>
        </label>
        <label class="full create-role-field">
          角色
          <div class="create-role-options">
            <button
              v-for="option in createRoleOptions"
              :key="option.value"
              type="button"
              class="create-role-option"
              :class="[
                `create-role-option--${option.value}`,
                { 'is-active': createForm.role === option.value },
              ]"
              @click="selectCreateRole(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </label>
        <div class="create-permission-block full">
          <div class="create-permission-block__head">
            <strong>权限设置</strong>
            <span v-if="canSetAccountPermission">创建账号时直接分配菜单查看和数据操作权限</span>
            <span v-else>无「分配权限」能力时将使用该角色的系统默认权限</span>
          </div>
          <div
            v-if="!canSetAccountPermission"
            class="permission-empty create-permission-block__placeholder"
          >
            创建后将按所选角色自动套用默认权限；如需自定义权限，请使用具备「分配权限」能力的账号。
          </div>
          <div
            v-else-if="!createForm.role"
            class="permission-empty create-permission-block__placeholder"
          >
            请先选择角色，系统将加载该角色的默认权限，可再按需调整。
          </div>
          <div
            v-else
            class="permission-editor permission-editor--compact"
          >
            <div class="permission-tree-panel">
              <h4>菜单权限</h4>
              <el-tree
                ref="createPermissionTreeRef"
                class="permission-tree"
                node-key="key"
                show-checkbox
                default-expand-all
                :default-checked-keys="treeCheckedKeysForMenus(createPermissionForm.menus)"
                :data="permissionTree"
                :props="{ label: 'label', children: 'children' }"
                @check="onCreatePermissionTreeCheck"
              />
            </div>
            <div class="permission-actions-panel">
              <h4>数据权限</h4>
              <div
                v-if="selectedCreatePermissionNodes.length === 0"
                class="permission-empty"
              >
                可按需勾选菜单权限。
              </div>
              <div
                v-for="node in selectedCreatePermissionNodes"
                :key="node.key"
                class="permission-action-row"
              >
                <span class="permission-action-row__label">{{ node.label }}</span>
                <el-checkbox-group
                  :model-value="getCreatePermissionActionList(node.key)"
                  @update:model-value="setCreatePermissionActions(node.key, $event)"
                >
                  <el-checkbox
                    v-for="action in actionsForPermissionKey(node.key)"
                    :key="action"
                    :value="action"
                  >
                    {{ permissionActionLabels[action] }}
                  </el-checkbox>
                </el-checkbox-group>
              </div>
            </div>
          </div>
        </div>
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
            <el-option
              v-if="usePlatformAccountsApi"
              label="老板"
              value="boss"
            />
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
    v-if="showPermissionModal && permissionTarget"
    class="modal-mask"
    @click.self="closePermissionModal"
  >
    <div class="modal-panel permission-modal">
      <div class="modal-header">
        <h3>权限管理 - {{ permissionTarget.username }}</h3>
        <button
          class="btn btn-secondary"
          type="button"
          :disabled="permissionSubmitting"
          @click="closePermissionModal"
        >
          关闭
        </button>
      </div>
      <p class="permission-tips">
        左侧勾选菜单/子菜单查看权限，右侧配置对应数据操作权限。保存只更新当前账号权限配置，不会修改业务数据。
      </p>
      <div class="permission-editor">
        <div class="permission-tree-panel">
          <h4>菜单权限</h4>
          <el-tree
            :key="`edit-perm-${permissionTarget.id}-${permissionTreeVersion}`"
            ref="permissionTreeRef"
            class="permission-tree"
            node-key="key"
            show-checkbox
            default-expand-all
            :default-checked-keys="treeCheckedKeysForMenus(permissionForm.menus)"
            :data="permissionTree"
            :props="{ label: 'label', children: 'children' }"
            @check="onPermissionTreeCheck"
          />
        </div>
        <div class="permission-actions-panel">
          <h4>数据权限</h4>
          <div
            v-if="selectedPermissionNodes.length === 0"
            class="permission-empty"
          >
            请先在左侧选择菜单。
          </div>
          <div
            v-for="node in selectedPermissionNodes"
            :key="node.key"
            class="permission-action-row"
          >
            <span class="permission-action-row__label">{{ node.label }}</span>
            <el-checkbox-group
              :model-value="getPermissionActionList(node.key)"
              @update:model-value="setPermissionActions(node.key, $event)"
            >
              <el-checkbox
                v-for="action in actionsForPermissionKey(node.key)"
                :key="action"
                :value="action"
              >
                {{ permissionActionLabels[action] }}
              </el-checkbox>
            </el-checkbox-group>
          </div>
        </div>
      </div>
      <div class="actions actions-right">
        <button
          class="btn btn-primary"
          type="button"
          :disabled="permissionSubmitting"
          @click="submitPermissionChange"
        >
          {{ permissionSubmitting ? '保存中...' : '保存权限' }}
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

.btn-permission-edit {
  border-color: #0f766e;
  background: #0f766e;
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

.scope-switch {
  margin-left: 8px;
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

.create-modal-panel {
  width: min(920px, 94vw);
  max-height: 88vh;
  overflow: auto;
}

.password-modal {
  width: 520px;
}

.role-modal {
  width: 420px;
}

.permission-modal {
  width: min(920px, 94vw);
}

.permission-tips {
  margin: 0 0 12px;
  border-radius: 10px;
  background: #fff7ed;
  padding: 10px 12px;
  color: #9a3412;
  font-size: 13px;
  line-height: 1.6;
}

.permission-editor {
  display: grid;
  grid-template-columns: minmax(220px, 300px) 1fr;
  gap: 14px;
  min-height: 420px;
}

.permission-editor--compact {
  min-height: 300px;
}

.create-role-field {
  gap: 8px;
}

.create-role-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}

.create-role-option {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 8px 18px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  background: #fff;
  color: #6b7280;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s;
}

.create-role-option:hover:not(.is-active) {
  border-color: #9ca3af;
  background: #f9fafb;
  color: #374151;
}

.create-role-option--reviewer.is-active {
  border-color: #1d4ed8;
  background: #1d4ed8;
  color: #fff;
}

.create-role-option--collector.is-active {
  border-color: #5b21b6;
  background: #5b21b6;
  color: #fff;
}

.create-role-option--boss.is-active {
  border-color: rgba(146, 64, 14, 0.65);
  background: linear-gradient(
    110deg,
    #fde047 0%,
    #fbbf24 22%,
    #f59e0b 45%,
    #fcd34d 68%,
    #fde68a 88%,
    #fde047 100%
  );
  color: #422006;
  box-shadow:
    0 0 0 1px rgba(146, 64, 14, 0.35),
    0 0 10px rgba(251, 191, 36, 0.35);
}

.create-permission-block {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fffaf3;
  padding: 12px;
}

.create-permission-block__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.create-permission-block__head strong {
  color: #374151;
  font-size: 14px;
}

.create-permission-block__head span {
  color: #b45309;
  font-size: 12px;
}

.permission-tree-panel,
.permission-actions-panel {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #f8fafc;
  padding: 12px;
  overflow: auto;
}

.permission-tree-panel h4,
.permission-actions-panel h4 {
  margin: 0 0 10px;
  color: #374151;
  font-size: 14px;
}

.permission-tree {
  background: transparent;
}

.permission-empty {
  display: grid;
  min-height: 120px;
  place-items: center;
  border: 1px dashed #cbd5e1;
  border-radius: 10px;
  color: #94a3b8;
  font-size: 13px;
}

.permission-action-row {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid #e5e7eb;
  padding: 10px 0;
}

.permission-action-row:first-of-type {
  padding-top: 0;
}

.permission-action-row:last-child {
  border-bottom: 0;
}

.permission-action-row__label {
  color: #334155;
  font-size: 13px;
  font-weight: 700;
}

.permission-action-row :deep(.el-checkbox-group) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.permission-action-row :deep(.el-checkbox) {
  height: 28px;
  margin-right: 0;
  border: 1px solid #dbe4ef;
  border-radius: 999px;
  background: #fff;
  padding: 0 10px;
  transition: all 0.16s ease;
}

.permission-action-row :deep(.el-checkbox.is-checked) {
  border-color: #2563eb;
  background: #eff6ff;
}

.permission-action-row :deep(.el-checkbox__label) {
  color: #475569;
  font-size: 12px;
  line-height: 1;
}

.permission-action-row :deep(.el-checkbox.is-checked .el-checkbox__label) {
  color: #1d4ed8;
  font-weight: 700;
}

@media (max-width: 760px) {
  .permission-editor {
    grid-template-columns: 1fr;
  }
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

.form-grid > label {
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

.form-field-error {
  font-size: 12px;
  color: var(--el-color-danger);
  line-height: 1.35;
  margin: 0;
}

.form-field-error--full {
  grid-column: 1 / -1;
  margin-bottom: 2px;
}

.form-input.is-error :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--el-color-danger) inset;
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
