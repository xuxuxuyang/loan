<script setup lang="ts">
import { CirclePlus, EditPen } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { apiErrorMessage, readApiErrorMessage, withMallTenantHeaders } from '../composables/useAdminApi'
import { adminSessionRevision, getAdminSession, isSuperAdminRole } from '../composables/useAdminAuth'
import { useAdminPagePermission } from '../composables/useAdminPagePermission'
import TrafficChannelNameTag from '../components/TrafficChannelNameTag.vue'
import UserRegistrationInfoScroll from '../components/UserRegistrationInfoScroll.vue'
import UserRiskDetailDialog, {
  type UserItem,
  type UserRiskSnapshot,
} from '../components/UserRiskDetailDialog.vue'
import { donePageProgress, startPageProgress } from '../utils/progress'
import { trafficChannelDisplayKey } from '../utils/trafficChannelTagStyle'
import {
  displayCreditStatusFromOrderSevenSnapshot,
  type DisplayCreditStatus,
} from '../utils/orderSubmitSevenPanel'
import { MALL_DEFAULT_CREDIT_QUOTA, resolveMallCreditQuota } from '../utils/mallCreditQuota'

/** 与商城注册、后端校验一致的 18 位身份证号格式（扩展表单校验时可复用） */
const CN_ID_CARD_RE = /^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dX]$/

/** 列表与预览：档案字段；`riskControlSnapshot` 含十四槽 / 下单七项写入结果 */
type ListedUser = UserItem & {
  riskControlSnapshot?: UserRiskSnapshot | null
  riskUpstreamConfigured?: boolean
  adminRemark?: string
  orderBlacklisted?: boolean
  registerChannelCode?: string
  /** 注册时写入的渠道名称快照 */
  registerChannelName?: string
  /** 列表展示：快照优先，否则当前渠道名 */
  registerChannelLabel?: string
}

/** 与 GET /admin/traffic-channels 对齐，用于注册渠道筛选项（与流量管理联动） */
interface AdminTrafficChannelRow {
  id: string
  code: string
  name: string
}

interface ApiUserItem {
  id: string
  name: string
  phone: string
  quota?: number
  orderCount?: number
  totalAmount?: number
  lastOrderAt?: string
  locationText?: string
  registerAt?: string
  idCardFront: string
  idCardBack: string
  idCardHandheld?: string
  creditStatus?: UserItem['creditStatus']
  idNumber?: string
  riskControlSnapshot?: UserRiskSnapshot | null
  riskUpstreamConfigured?: boolean
  /** 仅管理端 GET 用户列表/详情返回，用于编辑回显 */
  adminPasswordPlain?: string
  adminRemark?: string
  orderBlacklisted?: boolean
  registerChannelCode?: string
  registerChannelName?: string
  registerChannelLabel?: string
  /** 两位紧急联系人（GET /users 等） */
  emergencyContacts?: Array<{ name: string, phone: string }>
}

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

/** 注册渠道筛选：与「商城注册 / 具体渠道」区分，表示不做渠道过滤 */
const REGISTER_CHANNEL_FILTER_ALL = '__all__'

const users = ref<ListedUser[]>([])
const currentPage = ref(1)
const pageSize = ref(20)
const totalUsers = ref(0)
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
const loading = ref(false)
const exporting = ref(false)
const exportDialogVisible = ref(false)
/** 导出弹窗独立筛选，不复用列表工具栏 */
const exportChannelFilter = ref<string>(REGISTER_CHANNEL_FILTER_ALL)

const EXPORT_FIELD_OPTIONS = [
  { key: 'registerAt', label: '注册时间' },
  { key: 'name', label: '姓名' },
  { key: 'phone', label: '手机号' },
  { key: 'registerChannel', label: '注册渠道' },
  { key: 'creditStatus', label: '信誉状态' },
  { key: 'quota', label: '额度' },
  { key: 'orderCount', label: '订单数' },
  { key: 'remark', label: '备注' },
] as const

const DEFAULT_EXPORT_FIELDS = ['name', 'phone'] as const
const exportSelectedFields = ref<string[]>([...DEFAULT_EXPORT_FIELDS])
const deletingId = ref('')
const pendingDeleteId = ref('')
const creating = ref(false)
const quotaDialogVisible = ref(false)
const quotaSaving = ref(false)
const quotaTarget = ref<ListedUser | null>(null)
const quotaInput = ref('')
const remarkDialogVisible = ref(false)
const remarkSaving = ref(false)
const remarkTarget = ref<ListedUser | null>(null)
const remarkDraft = ref('')
const blacklistBusyId = ref('')
const createDialogVisible = ref(false)
const keyword = ref('')
/** 下单用户页：按「最近一笔已计入订单」的本地日期筛选 */
const orderDateKey = ref<string | null>(null)
/** 注册用户页：按与列表「注册渠道」列一致的展示名筛选 */
const registerChannelFilter = ref<string>(REGISTER_CHANNEL_FILTER_ALL)
/** 流量管理端配置的渠道，用于下拉展示即使用户列表中尚无人从该渠道注册 */
const trafficChannelsForFilter = ref<AdminTrafficChannelRow[]>([])
const previewUser = ref<ListedUser | null>(null)
const editingUserId = ref<string | null>(null)
const userRiskDialogVisible = ref(false)
const riskDialogUserId = ref<string | null>(null)
/** 打开编辑时接口回显的登录密码；仅在与当前输入一致时不随 PATCH 重复提交 */
const editPasswordBaseline = ref('')

const createForm = reactive({
  name: '',
  phone: '',
  idNumber: '',
  /** 可选；至少 6 位才会写入商城登录密码 */
  initialPassword: '',
})

const createFormErrors = reactive({
  name: '',
  phone: '',
  idNumber: '',
  initialPassword: '',
})

function clearCreateFormErrors() {
  createFormErrors.name = ''
  createFormErrors.phone = ''
  createFormErrors.idNumber = ''
  createFormErrors.initialPassword = ''
}

function validateCreateUserForm(): boolean {
  clearCreateFormErrors()
  let ok = true
  const name = createForm.name.trim()
  const phone = createForm.phone.trim()
  if (!name) {
    createFormErrors.name = '请填写姓名'
    ok = false
  }
  if (!/^1\d{10}$/.test(phone)) {
    createFormErrors.phone = phone ? '请输入正确的 11 位手机号' : '请填写手机号'
    ok = false
  }
  const initPwd = createForm.initialPassword.trim()
  if (initPwd.length > 0 && initPwd.length < 6) {
    createFormErrors.initialPassword = '至少 6 位，或留空后在编辑中设置'
    ok = false
  }
  const idRaw = createForm.idNumber.trim().toUpperCase()
  if (idRaw.length > 0 && !CN_ID_CARD_RE.test(idRaw)) {
    createFormErrors.idNumber = '请填写 18 位合法大陆身份证号，或留空'
    ok = false
  }
  return ok
}

const route = useRoute()

const {
  canCreate: canCreateUser,
  canUpdate: canUpdateUser,
  canSetQuota,
  canRemark,
  canBlacklist,
  canRiskCheck,
  canResetPassword,
  canDelete: canDeleteUser,
  canExport: canExportUsers,
} = useAdminPagePermission(undefined, () => isSuperAdminRole(getAdminSession()?.role))
const canEditUsers = computed(() => canUpdateUser.value || canResetPassword.value)

/** 下单用户页：仅展示订单数大于 0 的用户 */
const isOrderingUsersView = computed(() => route.path === '/users/ordering')
/** 未下单用户页：仅展示已注册且订单数为 0 的用户 */
const isNoOrderUsersView = computed(() => route.path === '/users/no-order')
/** 仅「注册用户」页提供渠道导出 */
const isRegisteredUsersPage = computed(() => route.name === 'users')

const editForm = reactive({
  name: '',
  phone: '',
  idNumber: '',
  /** 留空则不修改；填写则更新商城登录密码，至少 6 位 */
  newPassword: '',
})

watch(
  () => route.path,
  (path) => {
    if (path !== '/users/ordering') {
      orderDateKey.value = null
    }
    currentPage.value = 1
  },
)

const registerChannelOptions = computed(() => {
  const set = new Set<string>()
  for (const ch of trafficChannelsForFilter.value) {
    const k = trafficChannelDisplayKey(undefined, ch.name, ch.code).trim()
    if (k)
      set.add(k)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
})

function formatDateTime(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const yyyy = date.getFullYear()
  const mm = `${date.getMonth() + 1}`.padStart(2, '0')
  const dd = `${date.getDate()}`.padStart(2, '0')
  const hh = `${date.getHours()}`.padStart(2, '0')
  const min = `${date.getMinutes()}`.padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

function creditStatusTagType(status: DisplayCreditStatus | UserItem['creditStatus']): 'success' | 'warning' | 'info' | 'danger' {
  if (status === '良好') {
    return 'info'
  }
  if (status === '待风控') {
    return 'warning'
  }
  return 'danger'
}

function openUserRiskDetail(user: ListedUser) {
  riskDialogUserId.value = user.id
  userRiskDialogVisible.value = true
}

function onRiskDialogUserUpdated(mapped: UserItem) {
  const idx = users.value.findIndex(u => u.id === mapped.id)
  if (idx >= 0) {
    const prev = users.value[idx]
    users.value[idx] = {
      ...prev,
      ...mapped,
      riskControlSnapshot: mapped.riskControlSnapshot ?? prev.riskControlSnapshot,
      riskUpstreamConfigured: mapped.riskUpstreamConfigured ?? prev.riskUpstreamConfigured,
      adminPasswordPlain: mapped.adminPasswordPlain ?? prev.adminPasswordPlain,
      lastOrderAt: mapped.lastOrderAt ?? prev.lastOrderAt,
      adminRemark: mapped.adminRemark ?? prev.adminRemark,
      orderBlacklisted: mapped.orderBlacklisted ?? prev.orderBlacklisted,
      emergencyContacts: mapped.emergencyContacts ?? prev.emergencyContacts,
    }
  }
}

watch(userRiskDialogVisible, (open) => {
  if (!open)
    riskDialogUserId.value = null
})

/** 列表/预览/入库展示用：仅依据先享后付下单七项快照——任一项未通过→风险，七项均为通过→良好，否则待风控（不采用人工修改） */
function displayCreditStatusFromRisk(user: ListedUser | null | undefined): DisplayCreditStatus {
  return displayCreditStatusFromOrderSevenSnapshot(user?.riskControlSnapshot)
}

const previewDisplayCreditStatus = computed(() => displayCreditStatusFromRisk(previewUser.value))

/** 用 POST/PATCH 返回的用户数据更新列表，避免 Mongo 异步落库后立刻 GET 覆盖为旧快照 */
function upsertUserFromApiRow(raw: ApiUserItem) {
  const next = mapApiUser(raw)
  const idx = users.value.findIndex(u => u.id === next.id)
  if (idx >= 0)
    users.value[idx] = next
  else
    users.value = [next, ...users.value]
}

function mapApiUser(user: ApiUserItem): ListedUser {
  const quota = resolveMallCreditQuota(user)
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    quota,
    orderCount: Number(user.orderCount || 0),
    totalAmount: Number(user.totalAmount || 0),
    locationText: user.locationText || '',
    registerAt: formatDateTime(user.registerAt),
    lastOrderAt: typeof user.lastOrderAt === 'string' && user.lastOrderAt.trim()
      ? user.lastOrderAt.trim()
      : undefined,
    idCardFront: user.idCardFront || '',
    idCardBack: user.idCardBack || '',
    idCardHandheld: user.idCardHandheld || '',
    idNumber: typeof user.idNumber === 'string' && user.idNumber.trim()
      ? (CN_ID_CARD_RE.test(user.idNumber.trim().toUpperCase())
          ? user.idNumber.trim().toUpperCase()
          : undefined)
      : undefined,
    creditStatus: displayCreditStatusFromOrderSevenSnapshot(user.riskControlSnapshot),
    riskControlSnapshot: user.riskControlSnapshot ?? undefined,
    riskUpstreamConfigured: user.riskUpstreamConfigured,
    adminPasswordPlain: typeof user.adminPasswordPlain === 'string' ? user.adminPasswordPlain : undefined,
    adminRemark: typeof user.adminRemark === 'string' ? user.adminRemark : '',
    orderBlacklisted: Boolean(user.orderBlacklisted),
    registerChannelCode: typeof user.registerChannelCode === 'string' ? user.registerChannelCode.trim() : undefined,
    registerChannelName: typeof user.registerChannelName === 'string' ? user.registerChannelName.trim() : undefined,
    registerChannelLabel: typeof user.registerChannelLabel === 'string' ? user.registerChannelLabel.trim() : undefined,
    emergencyContacts: Array.isArray(user.emergencyContacts)
      ? user.emergencyContacts
        .map(x => ({
          name: String(x?.name || '').trim(),
          phone: String(x?.phone || '').trim().replace(/\D/g, ''),
        }))
        .filter(x => x.name && /^1\d{10}$/.test(x.phone))
        .slice(0, 2)
      : [],
  }
}

async function fetchTrafficChannelsForFilter() {
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/traffic-channels`, {
      method: 'GET',
      headers: withMallTenantHeaders(),
    })
    const payload = await response.json() as { success?: boolean; data?: AdminTrafficChannelRow[] }
    if (!response.ok || payload.success === false) {
      trafficChannelsForFilter.value = []
      return
    }
    trafficChannelsForFilter.value = Array.isArray(payload.data) ? payload.data : []
  }
  catch {
    trafficChannelsForFilter.value = []
  }
}

function parseExportFilename(contentDisposition: string | null): string {
  if (!contentDisposition) {
    return ''
  }
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim())
    }
    catch {
      return utf8Match[1].trim()
    }
  }
  const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i)
  return plainMatch?.[1]?.trim() || ''
}

function openExportDialog() {
  if (!canExportUsers.value || !isRegisteredUsersPage.value) {
    return
  }
  exportChannelFilter.value = REGISTER_CHANNEL_FILTER_ALL
  exportSelectedFields.value = [...DEFAULT_EXPORT_FIELDS]
  exportDialogVisible.value = true
  void fetchTrafficChannelsForFilter()
}

function closeExportDialog() {
  if (exporting.value) {
    return
  }
  exportDialogVisible.value = false
}

function exportChannelLabel(ch: string): string {
  if (ch === '__none__') {
    return '商城注册'
  }
  if (!ch || ch === REGISTER_CHANNEL_FILTER_ALL) {
    return '全部'
  }
  return ch
}

async function exportRegisteredUsers() {
  if (!canExportUsers.value || !isRegisteredUsersPage.value) {
    return
  }
  const ch = exportChannelFilter.value || REGISTER_CHANNEL_FILTER_ALL
  const fields = exportSelectedFields.value.filter(Boolean)
  if (!fields.length) {
    ElMessage.warning('请至少选择一个导出字段')
    return
  }
  exporting.value = true
  startPageProgress()
  try {
    const params = new URLSearchParams()
    params.set('registerChannel', ch)
    params.set('fields', fields.join(','))
    const response = await fetch(`${MALL_API_BASE}/users/export?${params}`, {
      method: 'GET',
      headers: withMallTenantHeaders(),
    })
    if (!response.ok) {
      let msg = '导出失败'
      try {
        const err = await response.json() as { msg?: string }
        if (err.msg) {
          msg = err.msg
        }
      }
      catch {
        // ignore
      }
      throw new Error(msg)
    }
    const blob = await response.blob()
    const filename = parseExportFilename(response.headers.get('Content-Disposition'))
      || `注册用户_${exportChannelLabel(ch)}.csv`
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
    exportDialogVisible.value = false
    ElMessage.success('导出成功')
  }
  catch (error) {
    console.error('导出用户失败', error)
    ElMessage.error(error instanceof Error ? error.message : '导出失败')
  }
  finally {
    exporting.value = false
    donePageProgress()
  }
}

async function fetchUsers() {
  loading.value = true
  startPageProgress()
  try {
    let page = currentPage.value
    for (;;) {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', String(pageSize.value))
      const kw = keyword.value.trim()
      if (kw) {
        params.set('keyword', kw)
      }
      if (isOrderingUsersView.value) {
        params.set('view', 'ordering')
      }
      else if (isNoOrderUsersView.value) {
        params.set('view', 'no-order')
      }
      const ch = registerChannelFilter.value
      if (ch && ch !== REGISTER_CHANNEL_FILTER_ALL) {
        params.set('registerChannel', ch)
      }
      if (isOrderingUsersView.value && orderDateKey.value) {
        params.set('orderDate', orderDateKey.value)
      }
      const response = await fetch(`${MALL_API_BASE}/users?${params}`, {
        method: 'GET',
        headers: withMallTenantHeaders(),
      })
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, '请求用户失败'))
      }
      const payload = await response.json() as {
        data?: ApiUserItem[] | {
          list?: ApiUserItem[]
          total?: number
          page?: number
          pageSize?: number
        }
      }
      const data = payload.data
      let list: ApiUserItem[] = []
      if (Array.isArray(data)) {
        list = data
        totalUsers.value = data.length
      }
      else if (data && Array.isArray(data.list)) {
        list = data.list
        totalUsers.value = Math.max(0, Number(data.total) || 0)
      }
      if (totalUsers.value > 0 && list.length === 0 && page > 1) {
        page -= 1
        currentPage.value = page
        continue
      }
      currentPage.value = page
      users.value = list.map(mapApiUser)
      break
    }
  }
  catch (error) {
    console.error('加载用户失败', error)
  }
  finally {
    loading.value = false
    donePageProgress()
  }
}

function onUsersPageChange(page: number) {
  currentPage.value = page
  void fetchUsers()
}

function onUsersPageSizeChange(size: number) {
  pageSize.value = size
  currentPage.value = 1
  void fetchUsers()
}

function openPreview(user: ListedUser) {
  previewUser.value = user
  editingUserId.value = null
}

function closePreview() {
  previewUser.value = null
  editingUserId.value = null
  editPasswordBaseline.value = ''
}

function startEdit(user: ListedUser) {
  if (!canSetQuota.value)
    return
  previewUser.value = user
  editingUserId.value = user.id
  editForm.name = user.name
  editForm.phone = user.phone
  editForm.idNumber = user.idNumber || ''
  const echo = typeof user.adminPasswordPlain === 'string' ? user.adminPasswordPlain : ''
  editForm.newPassword = echo
  editPasswordBaseline.value = echo
}

function openCreateDialog() {
  if (!canCreateUser.value || !isRegisteredUsersPage.value)
    return
  clearCreateFormErrors()
  createDialogVisible.value = true
  createForm.name = ''
  createForm.phone = ''
  createForm.idNumber = ''
  createForm.initialPassword = ''
}

function closeCreateDialog() {
  if (creating.value) {
    return
  }
  clearCreateFormErrors()
  createDialogVisible.value = false
}

async function createUser() {
  if (!canCreateUser.value || !isRegisteredUsersPage.value)
    return
  if (creating.value) {
    return
  }
  if (!validateCreateUserForm()) {
    return
  }
  const initPwd = createForm.initialPassword.trim()
  const idRawCreate = createForm.idNumber.trim().toUpperCase()
  creating.value = true
  try {
    const response = await fetch(`${MALL_API_BASE}/users`, {
      method: 'POST',
      headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        name: createForm.name.trim(),
        phone: createForm.phone.trim(),
        quota: MALL_DEFAULT_CREDIT_QUOTA,
        ...(idRawCreate ? { idNumber: idRawCreate } : {}),
        ...(initPwd.length >= 6 ? { initialPassword: initPwd } : {}),
      }),
    })
    const payload = await response.json() as { success?: boolean, msg?: string, data?: ApiUserItem }
    if (!response.ok || payload.success === false) {
      throw new Error(apiErrorMessage(payload, '新增用户失败'))
    }
    if (payload.data) {
      currentPage.value = 1
      await fetchUsers()
    }
    createDialogVisible.value = false
    ElMessage.success('用户已添加')
  }
  catch (error) {
    console.error('新增用户失败', error)
    ElMessage.error((error as Error)?.message || '新增用户失败')
  }
  finally {
    creating.value = false
  }
}

async function saveEdit() {
  if (!canEditUsers.value)
    return
  if (!previewUser.value || editingUserId.value !== previewUser.value.id) {
    return
  }
  if (canUpdateUser.value && (!editForm.name.trim() || !/^1\d{10}$/.test(editForm.phone.trim()))) {
    return
  }
  const pwd = canResetPassword.value ? editForm.newPassword.trim() : ''
  if (pwd.length > 0 && pwd.length < 6) {
    ElMessage.warning('登录密码至少 6 位，或留空保持原密码')
    return
  }
  const idRaw = editForm.idNumber.trim().toUpperCase()
  if (canUpdateUser.value && idRaw.length > 0 && !CN_ID_CARD_RE.test(idRaw)) {
    ElMessage.warning('身份证号码需为 18 位合法格式，或留空可清空档案中的号码')
    return
  }

  const target = users.value.find(item => item.id === previewUser.value?.id)
  if (!target) {
    return
  }

  try {
    const response = await fetch(`${MALL_API_BASE}/users/${target.id}`, {
      method: 'PATCH',
      headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        ...(canUpdateUser.value
          ? { name: editForm.name.trim(), phone: editForm.phone.trim(), idNumber: idRaw }
          : {}),
        ...(pwd.length >= 6 && pwd !== editPasswordBaseline.value ? { newPassword: pwd } : {}),
      }),
    })
    const payload = await response.json() as { success?: boolean, msg?: string, data?: ApiUserItem }
    if (!response.ok || payload.success === false) {
      throw new Error(apiErrorMessage(payload, '更新用户失败'))
    }
    if (payload.data)
      upsertUserFromApiRow(payload.data)
    ElMessage.success('已保存')
    closePreview()
  }
  catch (error) {
    console.error('保存用户失败', error)
    ElMessage.error((error as Error)?.message || '保存用户失败')
  }
}

function toggleDeleteConfirm(userId: string) {
  if (pendingDeleteId.value === userId) {
    pendingDeleteId.value = ''
    return
  }
  pendingDeleteId.value = userId
}

function cancelDelete() {
  pendingDeleteId.value = ''
}

async function confirmDelete(user: ListedUser) {
  if (!canDeleteUser.value)
    return
  if (deletingId.value) {
    return
  }
  deletingId.value = user.id
  try {
    const response = await fetch(`${MALL_API_BASE}/users/${encodeURIComponent(user.id)}`, {
      method: 'DELETE',
      headers: withMallTenantHeaders(),
    })
    const delPayload = await response.json() as { success?: boolean, msg?: string }
    if (!response.ok || delPayload.success === false) {
      throw new Error(apiErrorMessage(delPayload, '删除用户失败'))
    }
    if (previewUser.value?.id === user.id) {
      closePreview()
    }
    pendingDeleteId.value = ''
    await fetchUsers()
  }
  catch (error) {
    console.error('删除用户失败', error)
  }
  finally {
    deletingId.value = ''
  }
}

watch(
  () => [route.fullPath, adminSessionRevision.value] as const,
  () => {
    pendingDeleteId.value = ''
    void fetchUsers()
    void fetchTrafficChannelsForFilter()
  },
  { immediate: true },
)

/** 搜索框防抖：减少逐字输入时的重复 GET /users，最终 keyword 与分页逻辑不变 */
const KEYWORD_FETCH_DEBOUNCE_MS = 300
let keywordFetchTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFetchUsersFromKeyword() {
  currentPage.value = 1
  if (keywordFetchTimer) {
    clearTimeout(keywordFetchTimer)
  }
  keywordFetchTimer = setTimeout(() => {
    keywordFetchTimer = null
    void fetchUsers()
  }, KEYWORD_FETCH_DEBOUNCE_MS)
}

watch(keyword, () => {
  scheduleFetchUsersFromKeyword()
})

onUnmounted(() => {
  if (keywordFetchTimer) {
    clearTimeout(keywordFetchTimer)
    keywordFetchTimer = null
  }
})

watch([registerChannelFilter, orderDateKey], () => {
  currentPage.value = 1
  void fetchUsers()
})

watch(users, () => {
  if (!previewUser.value) return
  const latest = users.value.find(item => item.id === previewUser.value?.id)
  if (latest) {
    previewUser.value = latest
  }
})

function getStatusClass(status: DisplayCreditStatus | UserItem['creditStatus']) {
  if (status === '良好') {
    return 'credit-badge badge-ok'
  }
  if (status === '待风控') {
    return 'credit-badge badge-pending'
  }
  return 'credit-badge badge-risk'
}

function openQuotaDialog(user: ListedUser) {
  if (!canEditUsers.value)
    return
  quotaTarget.value = user
  quotaInput.value = `${user.quota}`
  quotaDialogVisible.value = true
}

function closeQuotaDialog() {
  if (quotaSaving.value) return
  quotaDialogVisible.value = false
  quotaTarget.value = null
  quotaInput.value = ''
}

/** 保存成功后关闭（不受 quotaSaving 拦截） */
function resetQuotaDialogState() {
  quotaDialogVisible.value = false
  quotaTarget.value = null
  quotaInput.value = ''
}

async function saveQuota() {
  if (!canSetQuota.value || !quotaTarget.value || quotaSaving.value)
    return
  const n = Number(String(quotaInput.value).trim())
  if (!Number.isFinite(n) || n < 0) {
    ElMessage.warning('请输入大于等于 0 的有效数字额度')
    return
  }
  const id = quotaTarget.value.id
  quotaSaving.value = true
  try {
    const response = await fetch(`${MALL_API_BASE}/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ quota: Math.round(n) }),
    })
    const payload = await response.json() as { success?: boolean, msg?: string, data?: ApiUserItem }
    if (!response.ok || payload.success === false) {
      throw new Error(apiErrorMessage(payload, '更新额度失败'))
    }
    if (payload.data)
      upsertUserFromApiRow(payload.data)
    ElMessage.success('额度已更新')
    resetQuotaDialogState()
  }
  catch (error) {
    console.error('更新额度失败', error)
    ElMessage.error(error instanceof Error ? error.message : '更新额度失败')
  }
  finally {
    quotaSaving.value = false
  }
}

function openRemarkDialog(user: ListedUser) {
  if (!canRemark.value)
    return
  remarkTarget.value = user
  remarkDraft.value = typeof user.adminRemark === 'string' ? user.adminRemark : ''
  remarkDialogVisible.value = true
}

function closeRemarkDialog(opts?: { force?: boolean }) {
  const force = Boolean(opts?.force)
  if (!force && remarkSaving.value) return
  remarkDialogVisible.value = false
  remarkTarget.value = null
  remarkDraft.value = ''
}

async function saveRemark() {
  if (!canRemark.value || !remarkTarget.value || remarkSaving.value)
    return
  const id = remarkTarget.value.id
  remarkSaving.value = true
  try {
    const response = await fetch(`${MALL_API_BASE}/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ adminRemark: remarkDraft.value.trim() }),
    })
    const payload = await response.json() as { success?: boolean, msg?: string, data?: ApiUserItem }
    if (!response.ok || payload.success === false) {
      throw new Error(apiErrorMessage(payload, '保存备注失败'))
    }
    if (payload.data)
      upsertUserFromApiRow(payload.data)
    ElMessage.success('备注已保存')
    closeRemarkDialog({ force: true })
  }
  catch (error) {
    console.error('保存备注失败', error)
    ElMessage.error(error instanceof Error ? error.message : '保存备注失败')
  }
  finally {
    remarkSaving.value = false
  }
}

async function toggleBlacklist(user: ListedUser) {
  if (!canBlacklist.value || blacklistBusyId.value)
    return
  blacklistBusyId.value = user.id
  const next = !user.orderBlacklisted
  try {
    const response = await fetch(`${MALL_API_BASE}/users/${encodeURIComponent(user.id)}`, {
      method: 'PATCH',
      headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ orderBlacklisted: next }),
    })
    const payload = await response.json() as { success?: boolean, msg?: string, data?: ApiUserItem }
    if (!response.ok || payload.success === false) {
      throw new Error(apiErrorMessage(payload, '操作失败'))
    }
    if (payload.data)
      upsertUserFromApiRow(payload.data)
    ElMessage.success(next ? '已限制该用户下单' : '已解除下单限制')
  }
  catch (error) {
    console.error('拉黑状态更新失败', error)
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  }
  finally {
    blacklistBusyId.value = ''
  }
}
</script>

<template>
  <div class="panel users-panel">
    <div class="toolbar">
      <el-select
        v-model="registerChannelFilter"
        class="toolbar-select-channel"
        placeholder="注册渠道"
        clearable
        filterable
        @clear="registerChannelFilter = REGISTER_CHANNEL_FILTER_ALL"
      >
        <el-option
          label="全部"
          :value="REGISTER_CHANNEL_FILTER_ALL"
        />
        <el-option
          label="商城注册"
          value="__none__"
        />
        <el-option
          v-for="name in registerChannelOptions"
          :key="name"
          :label="name"
          :value="name"
        />
      </el-select>
      <el-date-picker
        v-if="isOrderingUsersView"
        v-model="orderDateKey"
        class="toolbar-datepicker"
        type="date"
        placeholder="下单日期"
        value-format="YYYY-MM-DD"
        clearable
      />
      <el-input
        v-model="keyword"
        class="toolbar-input"
        placeholder="搜索姓名 / 手机号"
        clearable
      />
      
      <button
        class="btn btn-refresh"
        type="button"
        :disabled="loading"
        @click="() => { void fetchUsers(); void fetchTrafficChannelsForFilter() }"
      >
        刷新
      </button>
      <button
        v-if="canCreateUser && isRegisteredUsersPage"
        class="btn btn-primary"
        type="button"
        @click="openCreateDialog"
      >
        添加用户
      </button>
      <button
        v-if="canExportUsers && isRegisteredUsersPage"
        class="btn btn-export"
        type="button"
        :disabled="exporting || loading"
        @click="openExportDialog"
      >
        导出数据
      </button>
    </div>
    <div class="users-table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th>{{ isOrderingUsersView ? '下单时间' : '注册时间' }}</th>
          <th>姓名</th>
          <th>手机号</th>
          <th>注册渠道</th>
          <th>信誉状态</th>
          <th>额度</th>
          <th>订单数</th>
           <th>备注</th>
          <th>操作</th>
         
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in users"
          :key="item.id"
        >
          <td>{{ isOrderingUsersView ? formatDateTime(item.lastOrderAt) : item.registerAt }}</td>
          <td>{{ item.name }}</td>
          <td>{{ item.phone }}</td>
          <td class="td-register-channel">
            <TrafficChannelNameTag
              mall-plain-when-empty
              :display-key="trafficChannelDisplayKey(item.registerChannelLabel, item.registerChannelName, item.registerChannelCode)"
              :color-seed="item.registerChannelCode || undefined"
            />
          </td>
          <td class="td-credit-status">
            <el-tag
              :type="creditStatusTagType(displayCreditStatusFromRisk(item))"
              effect="light"
              round
              size="small"
              class="credit-status-tag"
              @click="openUserRiskDetail(item)"
            >
              {{ displayCreditStatusFromRisk(item) }}
            </el-tag>
          </td>
          <td class="quota-cell">
            <button
              v-if="canSetQuota"
              type="button"
              class="quota-trigger"
              @click="openQuotaDialog(item)"
            >
              ¥ {{ item.quota }}
            </button>
            <span
              v-else
              class="quota-plain"
            >¥ {{ item.quota }}</span>
          </td>
          <td>{{ item.orderCount }}</td>
          <td class="td-remark">
            <button
              v-if="canRemark"
              type="button"
              class="remark-cell remark-cell--clickable"
              :title="item.adminRemark?.trim() ? '点击编辑备注' : '点击添加备注'"
              @click="openRemarkDialog(item)"
            >
              <span class="remark-cell__icon-wrap" aria-hidden="true">
                <el-icon
                  class="remark-cell__icon"
                  :class="item.adminRemark?.trim() ? 'remark-cell__icon--edit' : 'remark-cell__icon--add'"
                  :size="17"
                >
                  <EditPen v-if="item.adminRemark?.trim()" />
                  <CirclePlus v-else />
                </el-icon>
              </span>
              <span
                class="remark-cell__text remark-preview"
                :class="item.adminRemark?.trim() ? 'remark-preview--filled' : 'remark-preview--empty'"
              >{{ item.adminRemark?.trim() ? item.adminRemark : '暂无备注' }}</span>
            </button>
            <div
              v-else
              class="remark-cell"
            >
              <span class="remark-cell__icon-wrap" aria-hidden="true">
                <el-icon
                  class="remark-cell__icon"
                  :class="item.adminRemark?.trim() ? 'remark-cell__icon--edit' : 'remark-cell__icon--add'"
                  :size="17"
                >
                  <EditPen v-if="item.adminRemark?.trim()" />
                  <CirclePlus v-else />
                </el-icon>
              </span>
              <p
                class="remark-cell__text remark-preview"
                :class="item.adminRemark?.trim() ? 'remark-preview--filled' : 'remark-preview--empty'"
                :title="item.adminRemark?.trim() ? item.adminRemark : ''"
              >
                {{ item.adminRemark?.trim() ? item.adminRemark : '暂无备注' }}
              </p>
            </div>
          </td>
          <td>
            <div class="actions">
              <button
                class="btn btn-ghost"
                type="button"
                @click="openPreview(item)"
              >
                查看
              </button>
              <button
                v-if="canEditUsers"
                class="btn btn-primary"
                type="button"
                @click="startEdit(item)"
              >
                修改
              </button>
              <button
                v-if="canBlacklist"
                type="button"
                class="btn"
                :class="item.orderBlacklisted ? 'btn-success' : 'btn-danger'"
                :disabled="blacklistBusyId === item.id"
                @click="toggleBlacklist(item)"
              >
                {{
                  blacklistBusyId === item.id
                    ? '处理中…'
                    : item.orderBlacklisted
                      ? '移除黑名单'
                      : '拉黑'
                }}
              </button>
              <div
                v-if="canDeleteUser"
                class="delete-wrap"
              >
                <button
                  class="btn btn-danger"
                  type="button"
                  :disabled="Boolean(deletingId) && deletingId !== item.id"
                  @click="toggleDeleteConfirm(item.id)"
                >
                  {{ deletingId === item.id ? '删除中...' : '删除' }}
                </button>
                <div
                  v-if="pendingDeleteId === item.id"
                  class="delete-pop"
                >
                  <p>确定删除该用户？</p>
                  <div class="delete-pop-actions">
                    <button
                      class="btn btn-danger"
                      type="button"
                      :disabled="deletingId === item.id"
                      @click="confirmDelete(item)"
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
        <tr v-if="!loading && users.length === 0">
          <td colspan="9" style="text-align: center; color: #9ca3af;">
            暂无用户数据
          </td>
        </tr>
      </tbody>
    </table>
    </div>
    <div
      v-if="totalUsers > 0"
      class="users-pagination"
    >
      <el-pagination
        :current-page="currentPage"
        :page-size="pageSize"
        :page-sizes="[...PAGE_SIZE_OPTIONS]"
        :total="totalUsers"
        layout="total, sizes, prev, pager, next, jumper"
        background
        @current-change="onUsersPageChange"
        @size-change="onUsersPageSizeChange"
      />
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="createDialogVisible && canCreateUser && isRegisteredUsersPage"
      class="modal-mask"
      @click.self="closeCreateDialog"
    >
      <div class="modal-panel create-modal">
        <div class="modal-header">
          <h3>添加用户</h3>
          <button
            type="button"
            class="btn btn-ghost"
            :disabled="creating"
            @click="closeCreateDialog"
          >
            关闭
          </button>
        </div>
        <div class="modal-grid">
          <label>
            姓名
            <el-input
              v-model="createForm.name"
              class="form-input"
              :class="{ 'is-error': !!createFormErrors.name }"
              clearable
              @update:model-value="createFormErrors.name = ''"
            />
            <span
              v-if="createFormErrors.name"
              class="create-form-field-error"
            >{{ createFormErrors.name }}</span>
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
              class="create-form-field-error"
            >{{ createFormErrors.phone }}</span>
          </label>
          <label class="full">
            身份证号码（可选）
            <el-input
              v-model="createForm.idNumber"
              class="form-input"
              :class="{ 'is-error': !!createFormErrors.idNumber }"
              maxlength="18"
              clearable
              placeholder="18 位大陆身份证号，风控 B 类接口必填；可留空"
              @update:model-value="createFormErrors.idNumber = ''"
            />
            <span
              v-if="createFormErrors.idNumber"
              class="create-form-field-error"
            >{{ createFormErrors.idNumber }}</span>
          </label>
          <label class="full">
            初始登录密码（可选）
            <el-input
              v-model="createForm.initialPassword"
              class="form-input"
              :class="{ 'is-error': !!createFormErrors.initialPassword }"
              type="password"
              show-password
              clearable
              placeholder="至少 6 位，留空则用户需验证码登录或由后台再次设置"
              autocomplete="new-password"
              @update:model-value="createFormErrors.initialPassword = ''"
            />
            <span
              v-if="createFormErrors.initialPassword"
              class="create-form-field-error"
            >{{ createFormErrors.initialPassword }}</span>
          </label>
        </div>
        <p
          v-if="creating"
          class="create-modal-status"
          role="status"
          aria-live="polite"
        >
          正在提交，请稍候…
        </p>
        <div class="actions actions-right">
          <button
            class="btn btn-primary"
            type="button"
            :disabled="creating"
            @click="createUser"
          >
            {{ creating ? '创建中...' : '确认添加' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="quotaDialogVisible && quotaTarget && canSetQuota"
      class="modal-mask"
      @click.self="closeQuotaDialog"
    >
    <div class="modal-panel create-modal">
      <div class="modal-header">
        <h3>修改额度</h3>
        <button
          type="button"
          class="btn btn-ghost"
          :disabled="quotaSaving"
          @click="closeQuotaDialog"
        >
          关闭
        </button>
      </div>
      <p class="quota-hint">
        {{ quotaTarget.name }}（{{ quotaTarget.phone }}）
      </p>
      <label class="quota-label">
        额度（元）
        <el-input
          v-model="quotaInput"
          class="form-input"
          type="text"
          inputmode="decimal"
          clearable
          autofocus
        />
      </label>
      <div class="actions actions-right">
        <button
          class="btn btn-primary"
          type="button"
          :disabled="quotaSaving"
          @click="saveQuota"
        >
          {{ quotaSaving ? '保存中...' : '保存' }}
        </button>
      </div>
    </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="remarkDialogVisible && remarkTarget && canRemark"
      class="modal-mask"
      @click.self="() => closeRemarkDialog()"
    >
    <div class="modal-panel create-modal">
      <div class="modal-header">
        <h3>用户备注</h3>
        <button
          type="button"
          class="btn btn-ghost"
          :disabled="remarkSaving"
          @click="() => closeRemarkDialog()"
        >
          关闭
        </button>
      </div>
      <p class="quota-hint">
        {{ remarkTarget.name }}（{{ remarkTarget.phone }}）
      </p>
      <label class="quota-label full">
        备注内容
        <el-input
          v-model="remarkDraft"
          class="form-input"
          type="textarea"
          :rows="4"
          maxlength="500"
          show-word-limit
          placeholder="请输入添加备注"
        />
      </label>
      <div class="actions actions-right">
        <button
          class="btn btn-primary"
          type="button"
          :disabled="remarkSaving"
          @click="saveRemark"
        >
          {{ remarkSaving ? '保存中...' : '保存' }}
        </button>
      </div>
    </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="exportDialogVisible && canExportUsers"
      class="modal-mask"
      @click.self="closeExportDialog"
    >
      <div class="modal-panel create-modal export-modal">
        <div class="modal-header">
          <h3>导出注册用户</h3>
          <button
            type="button"
            class="btn btn-ghost"
            :disabled="exporting"
            @click="closeExportDialog"
          >
            关闭
          </button>
        </div>
        <label class="quota-label full">
          注册渠道
          <el-select
            v-model="exportChannelFilter"
            class="export-channel-select"
            placeholder="选择注册渠道"
            filterable
          >
            <el-option
              label="全部"
              :value="REGISTER_CHANNEL_FILTER_ALL"
            />
            <el-option
              label="商城注册"
              value="__none__"
            />
            <el-option
              v-for="name in registerChannelOptions"
              :key="name"
              :label="name"
              :value="name"
            />
          </el-select>
        </label>
        <div class="export-fields-block">
          <p class="export-fields-block__title">
            导出字段
          </p>
          <el-checkbox-group
            v-model="exportSelectedFields"
            class="export-fields-grid"
          >
            <el-checkbox
              v-for="opt in EXPORT_FIELD_OPTIONS"
              :key="opt.key"
              :value="opt.key"
              :label="opt.key"
            >
              {{ opt.label }}
            </el-checkbox>
          </el-checkbox-group>
          <p
            v-if="!exportSelectedFields.length"
            class="export-fields-block__warn"
          >
            请至少选择一个字段
          </p>
        </div>
        <p class="export-modal-format">
          文件格式为 <strong>CSV 表格</strong>（.csv），可用 Microsoft Excel、WPS 等直接打开。
        </p>
        <div class="actions actions-right">
          <button
            class="btn btn-ghost"
            type="button"
            :disabled="exporting"
            @click="closeExportDialog"
          >
            取消
          </button>
          <button
            class="btn btn-export-solid"
            type="button"
            :disabled="exporting || !exportSelectedFields.length"
            @click="exportRegisteredUsers"
          >
            {{ exporting ? '导出中…' : '确认导出' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <UserRiskDetailDialog
    v-model="userRiskDialogVisible"
    :user-id="riskDialogUserId"
    @user-updated="onRiskDialogUserUpdated"
  />

  <Teleport to="body">
    <div
      v-if="previewUser"
      class="modal-mask"
      @click.self="closePreview"
    >
    <div class="modal-panel user-preview-panel">
      <header class="user-preview-head">
        <div class="user-preview-head__titles">
          <h3 class="user-preview-title">
            用户注册信息
          </h3>
          <p class="user-preview-meta">
            <span>{{ previewUser.name }}</span>
            <span class="user-preview-meta__sep">·</span>
            <span>{{ previewUser.phone }}</span>
            <span class="user-preview-meta__sep">·</span>
            <span class="user-preview-meta__id">{{ previewUser.id }}</span>
          </p>
        </div>
        <button
          type="button"
          class="btn btn-ghost user-preview-close"
          @click="closePreview"
        >
          关闭
        </button>
      </header>

      <div class="user-preview-scroll">
        <section
          v-if="editingUserId === previewUser.id && canEditUsers"
          class="user-preview-block"
        >
          <h4 class="user-preview-block__title">
            <span class="user-preview-block__bar" />
            基本信息
          </h4>

          <div
            class="user-preview-edit-grid"
          >
            <label class="user-preview-field">
              <span class="user-preview-field__label">姓名</span>
              <el-input
                v-model="editForm.name"
                class="form-input"
                clearable
                :disabled="!canUpdateUser"
              />
            </label>
            <label class="user-preview-field">
              <span class="user-preview-field__label">手机号</span>
              <el-input
                v-model="editForm.phone"
                class="form-input"
                clearable
                :disabled="!canUpdateUser"
              />
            </label>
            <label
              v-if="canResetPassword"
              class="user-preview-field user-preview-field--full"
            >
              <span class="user-preview-field__label">身份证号码</span>
              <el-input
                v-model="editForm.idNumber"
                class="form-input user-preview-id-number-input"
                maxlength="18"
                clearable
                :disabled="!canUpdateUser"
                placeholder="18 位大陆身份证号，留空可清空档案中的号码"
              />
            </label>
            <label class="user-preview-field user-preview-field--full">
              <span class="user-preview-field__label">信誉状态</span>
              <div class="user-preview-credit-readonly">
                <span :class="getStatusClass(previewDisplayCreditStatus)">{{ previewDisplayCreditStatus }}</span>
              </div>
            </label>
            <label class="user-preview-field user-preview-field--full">
              <span class="user-preview-field__label">登录密码</span>
              <el-input
                v-model="editForm.newPassword"
                class="form-input"
                type="password"
                show-password
                clearable
                placeholder="留空不修改；填写至少 6 位以重置商城密码登录"
                autocomplete="new-password"
              />
            </label>
            <div class="user-preview-edit-readonly">
              <div class="user-preview-edit-readonly__cell">
                <span class="user-preview-edit-readonly__k">注册时间</span>
                <span class="user-preview-edit-readonly__v">{{ previewUser.registerAt }}</span>
              </div>
              <div class="user-preview-edit-readonly__cell">
                <span class="user-preview-edit-readonly__k">注册渠道</span>
                <span class="user-preview-edit-readonly__v">
                  <TrafficChannelNameTag
                    mall-plain-when-empty
                    :display-key="trafficChannelDisplayKey(previewUser.registerChannelLabel, previewUser.registerChannelName, previewUser.registerChannelCode)"
                    :color-seed="previewUser.registerChannelCode || undefined"
                  />
                </span>
              </div>
              <div class="user-preview-edit-readonly__cell">
                <span class="user-preview-edit-readonly__k">额度</span>
                <span class="user-preview-edit-readonly__v user-preview-quota">¥ {{ previewUser.quota }}</span>
              </div>
            </div>
          </div>
        </section>

        <UserRegistrationInfoScroll
          v-if="!(editingUserId === previewUser.id && canEditUsers)"
          embedded-in-parent-scroll
          :user="previewUser"
          :snapshot="previewUser.riskControlSnapshot ?? null"
          :can-manage-users="canRiskCheck"
        />
        <UserRegistrationInfoScroll
          v-else
          photos-and-risk-only
          embedded-in-parent-scroll
          :user="previewUser"
          :snapshot="previewUser.riskControlSnapshot ?? null"
          :can-manage-users="canRiskCheck"
        />
      </div>

      <div class="user-preview-footer">
        <button
          v-if="editingUserId === previewUser.id && canEditUsers"
          class="btn btn-primary"
          type="button"
          @click="saveEdit"
        >
          保存修改
        </button>
      </div>
    </div>
    </div>
  </Teleport>
</template>

<style scoped>
.users-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.users-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.users-pagination {
  display: flex;
  justify-content: flex-end;
  padding-top: 12px;
  flex-shrink: 0;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.actions-right {
  justify-content: flex-end;
  margin-top: 14px;
}

.toolbar-input {
  width: 260px;
}

.toolbar-datepicker {
  width: 168px;
}

.toolbar-select-channel {
  width: 200px;
}

.toolbar-select-channel :deep(.el-select__wrapper) {
  min-height: 36px;
  border-radius: 8px;
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

.quota-cell {
  white-space: nowrap;
}

.quota-plain {
  color: #111827;
}

.quota-trigger {
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: #0f766e;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: rgba(15, 118, 110, 0.35);
  text-underline-offset: 3px;
}

.quota-trigger:hover {
  color: #0d9488;
  text-decoration-color: #0d9488;
}

.quota-trigger:focus-visible {
  outline: 2px solid #2dd4bf;
  outline-offset: 2px;
  border-radius: 4px;
}

.btn-danger {
  border-color: #dc2626;
  background: #dc2626;
  color: #fff;
}

.btn-success {
  border-color: #059669;
  background: #059669;
  color: #fff;
}

.btn-export {
  border-color: #d97706;
  background: #fff;
  color: #b45309;
}

.btn-export:hover:not(:disabled) {
  background: #fffbeb;
}

.btn-export:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-export-solid {
  border-color: #d97706;
  background: #d97706;
  color: #fff;
}

.btn-export-solid:hover:not(:disabled) {
  background: #b45309;
  border-color: #b45309;
}

.btn-export-solid:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.export-channel-select {
  width: 100%;
}

.export-channel-select :deep(.el-select__wrapper) {
  min-height: 36px;
  border-radius: 8px;
}

.export-fields-block {
  margin-top: 4px;
  padding: 12px 14px;
  border-radius: 8px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
}

.export-fields-block__title {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
}

.export-fields-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
}

.export-fields-grid :deep(.el-checkbox) {
  margin-right: 0;
  height: auto;
}

.export-fields-block__warn {
  margin: 10px 0 0;
  font-size: 12px;
  color: #b45309;
}

.export-modal-format {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: #64748b;
}

.btn-muted {
  border-color: #9ca3af;
  background: #f3f4f6;
  color: #1f2937;
}

.btn-ghost {
  color: #374151;
}

.td-remark {
  max-width: 280px;
  vertical-align: top;
}

.remark-preview {
  margin: 0;
  line-height: 1.45;
  max-height: 4.35em;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  word-break: break-word;
}

.remark-preview--filled {
  font-size: 16px;
  font-weight: 700;
  color: #dc2626;
}

.remark-preview--empty {
  font-size: 12px;
  font-weight: 400;
  color: #a8a1a1;
}

.remark-cell {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  max-width: 100%;
  text-align: left;
}

.remark-cell__icon-wrap {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding-top: 2px;
}

.remark-cell__icon {
  vertical-align: middle;
}

.remark-cell__icon--add {
  color: #059669;
}

.remark-cell__icon--edit {
  color: #64748b;
}

.remark-cell__text {
  flex: 1;
  min-width: 0;
}

.remark-cell--clickable {
  margin: 0;
  border: none;
  background: transparent;
  padding: 2px 6px 2px 2px;
  font: inherit;
  cursor: pointer;
  border-radius: 6px;
  transition: background-color 0.12s ease;
}

.remark-cell--clickable:hover {
  background-color: #f1f5f9;
}

.remark-cell--clickable:focus-visible {
  outline: 2px solid #6366f1;
  outline-offset: 2px;
}

.remark-cell--clickable:hover .remark-cell__icon--add {
  color: #047857;
}

.remark-cell--clickable:hover .remark-cell__icon--edit {
  color: #475569;
}

.quota-label.full {
  width: 100%;
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
  /* 低于 Element Plus Message / Popper 默认层级（约 2000+），避免校验 Toast 被挡在蒙层后 */
  z-index: 1900;
  background: rgba(15, 23, 42, 0.35);
  display: grid;
  place-items: center;
  padding: 20px;
}

.modal-panel {
  position: relative;
  z-index: 1;
  width: 760px;
  max-width: 100%;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #e5e7eb;
  padding: 16px;
}

.user-preview-panel {
  width: min(960px, 100%);
  max-height: min(92vh, 900px);
  display: flex;
  flex-direction: column;
  padding: 0;
  border: none;
  box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.18);
  overflow: hidden;
  background: linear-gradient(180deg, #fafbfc 0%, #fff 120px);
}

.user-preview-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 22px 16px;
  border-bottom: 1px solid #e8ecf1;
  background: #fff;
}

.user-preview-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: 0.02em;
}

.user-preview-meta {
  margin: 6px 0 0;
  font-size: 13px;
  color: #64748b;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
}

.user-preview-meta__sep {
  opacity: 0.45;
}

.user-preview-meta__id {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: #94a3b8;
}

.user-preview-meta__muted {
  color: #94a3b8;
}

.user-preview-close {
  flex-shrink: 0;
  margin-top: 2px;
}

.user-preview-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 16px 22px 12px;
}

.user-preview-block + .user-preview-block {
  margin-top: 20px;
}

.user-preview-block__title {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 700;
  color: #1e293b;
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-preview-block__bar {
  width: 4px;
  height: 14px;
  border-radius: 2px;
  background: linear-gradient(180deg, #6366f1, #8b5cf6);
}

.user-preview-desc {
  border-radius: 10px;
  overflow: hidden;
}

.user-preview-desc :deep(.el-descriptions__label) {
  width: 112px;
  font-weight: 600;
  color: #64748b !important;
  background: #f8fafc !important;
}

.user-preview-desc :deep(.el-descriptions__content) {
  color: #0f172a;
}

.user-preview-quota {
  font-weight: 700;
  color: #0f766e;
  font-variant-numeric: tabular-nums;
}

.user-preview-edit-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 16px;
}

.user-preview-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.user-preview-field--full {
  grid-column: 1 / -1;
}

.user-preview-field__label {
  font-size: 13px;
  font-weight: 600;
  color: #64748b;
}

.user-preview-field__hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: #94a3b8;
}

.user-preview-edit-readonly {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  background: #f1f5f9;
  border: 1px dashed #cbd5e1;
}

.user-preview-edit-readonly__cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.user-preview-edit-readonly__k {
  font-size: 12px;
  color: #64748b;
  font-weight: 500;
}

.user-preview-edit-readonly__v {
  font-size: 14px;
  color: #0f172a;
  font-weight: 600;
}

.user-preview-id-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

@media (max-width: 900px) {
  .user-preview-id-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 700px) {
  .user-preview-id-grid {
    grid-template-columns: 1fr;
  }
}

.user-preview-id-label {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: #475569;
}

.user-preview-id-frame {
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  aspect-ratio: 4 / 3;
}

.user-preview-el-image {
  width: 100%;
  height: 100%;
  display: block;
}

.user-preview-el-image :deep(.el-image__inner) {
  width: 100%;
  height: 100%;
}

.user-preview-id-placeholder {
  height: 100%;
  min-height: 140px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #94a3b8;
  font-size: 13px;
  padding: 16px;
  text-align: center;
}

.user-preview-id-placeholder--error {
  color: #cbd5e1;
  background: #1e293b;
}

.user-preview-id-placeholder__icon {
  font-size: 36px;
  opacity: 0.65;
}

.user-preview-block--risk {
  margin-top: 8px;
}

.user-preview-risk-card {
  border-radius: 14px;
  border: 1px solid rgba(99, 102, 241, 0.2);
  background: linear-gradient(145deg, #f8fafc 0%, #f5f3ff 45%, #faf5ff 100%);
  padding: 16px 18px 18px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.user-preview-risk-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 14px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.35);
}

.user-preview-risk-card__title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #1e293b;
}

.user-preview-risk-card__sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: #64748b;
}

.user-preview-risk-seven {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

@media (max-width: 720px) {
  .user-preview-risk-seven {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.user-preview-risk-step {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 8px 10px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.user-preview-risk-step--compact {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.user-preview-risk-step__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px 8px;
  flex-wrap: wrap;
}

.user-preview-risk-step__label {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 11px;
  font-weight: 600;
  color: #334155;
  line-height: 1.35;
}

.user-preview-risk-step__row {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 4px;
  flex-shrink: 0;
}

.user-preview-risk-icon {
  font-size: 16px;
}

.user-preview-risk-outcome {
  font-size: 11px;
  font-weight: 600;
  color: #15803d;
}

.user-preview-risk-icon--ok {
  color: #16a34a;
}

.user-preview-risk-icon--bad {
  color: #dc2626;
}

.user-preview-risk-icon--skip {
  color: #d97706;
}

.user-preview-risk-icon--muted {
  color: #94a3b8;
}

.user-preview-risk-outcome--bad {
  color: #b91c1c;
}

.user-preview-risk-outcome--skip {
  color: #b45309;
}

.user-preview-risk-outcome--muted {
  font-weight: 500;
  color: #64748b;
}

.user-preview-risk-step__facts {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 3px 8px;
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.35;
}

.user-preview-risk-fact {
  display: flex;
  flex-wrap: nowrap;
  align-items: baseline;
  gap: 3px 5px;
  min-width: 0;
}

.user-preview-risk-fact__k {
  flex-shrink: 0;
  color: #64748b;
  white-space: nowrap;
}

.user-preview-risk-fact__v {
  flex: 1;
  min-width: 0;
  color: #475569;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-preview-risk-fact__v--emph {
  font-weight: 600;
  color: #0f172a;
}

.user-preview-risk-radar {
  margin-top: 10px;
}

.user-preview-radar-facts-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
}

.user-preview-radar-report-note {
  margin: 0;
  padding: 8px 10px;
  font-size: 11px;
  line-height: 1.5;
  color: #334155;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.user-preview-radar-sec {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.user-preview-radar-sec__head {
  padding: 0 2px;
}

.user-preview-radar-sec__title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: 0.02em;
}

.user-preview-radar-sec__sub {
  margin: 2px 0 0;
  font-size: 11px;
  line-height: 1.45;
  color: #64748b;
}

.user-preview-radar-table-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.user-preview-radar-table {
  width: 100%;
  min-width: 640px;
  border-collapse: collapse;
  font-size: 11px;
  background: #fff;
}

.user-preview-radar-table--multi {
  table-layout: fixed;
  min-width: 720px;
}

.user-preview-radar-table--multi .user-preview-radar-table__label {
  width: 15%;
  max-width: none;
}

.user-preview-radar-table__pad {
  border-bottom: 1px solid #f1f5f9;
  background: #fafbfc;
}

.user-preview-radar-table thead th {
  text-align: left;
  padding: 6px 10px;
  font-weight: 600;
  color: #475569;
  background: linear-gradient(180deg, #f1f5f9 0%, #e8eef5 100%);
  border-bottom: 1px solid #cbd5e1;
  white-space: nowrap;
}

.user-preview-radar-table tbody td {
  padding: 6px 10px;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: top;
}

.user-preview-radar-table tbody tr:last-child td {
  border-bottom: none;
}

.user-preview-radar-table tbody tr:nth-child(even) td {
  background: #fafbfc;
}

.user-preview-radar-table__label {
  width: 46%;
  max-width: 260px;
  color: #334155;
  font-weight: 500;
  word-break: break-word;
}

.user-preview-radar-table__value {
  color: #0f172a;
  word-break: break-word;
}

.user-preview-radar-table__value--emphasis {
  font-weight: 700;
  color: #1d4ed8;
}

.user-preview-radar-table__empty {
  text-align: center;
  color: #94a3b8;
  font-size: 11px;
  padding: 12px 10px;
}

.user-preview-risk-step__detail--radar {
  -webkit-line-clamp: 6;
}

.user-preview-risk-step__detail {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.45;
  color: #64748b;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

@media (max-width: 640px) {
  .user-preview-risk-seven {
    grid-template-columns: 1fr;
  }

  .user-preview-edit-grid {
    grid-template-columns: 1fr;
  }

  .user-preview-edit-readonly {
    grid-template-columns: 1fr;
  }
}

.user-preview-risk-summary {  margin: 14px 0 0;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.55;
  color: #475569;
  background: rgba(255, 255, 255, 0.75);
  border: 1px solid rgba(226, 232, 240, 0.9);
}

.user-preview-footer {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 22px 18px;
  border-top: 1px solid #e8ecf1;
  background: #fff;
}

.create-modal {
  width: 520px;
}

.create-form-field-error {
  margin: 4px 0 0;
  font-size: 12px;
  color: #dc2626;
  line-height: 1.35;
}

.create-modal-status {
  margin: 10px 0 0;
  font-size: 13px;
  color: #64748b;
}

.modal-grid :deep(.el-input.form-input.is-error .el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--el-color-danger) inset;
}

.quota-hint {
  margin: 0 0 12px;
  font-size: 14px;
  color: #4b5563;
}

.quota-label {
  display: grid;
  gap: 6px;
  font-size: 14px;
  color: #a8a1a1;
  margin-bottom: 8px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.modal-header h3 {
  margin: 0;
}

.modal-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.modal-grid label {
  display: grid;
  gap: 6px;
  font-size: 14px;
  color: #a8a1a1;
}

.modal-grid .full {
  grid-column: 1 / -1;
}

.modal-grid p {
  margin: 0;
  min-height: 36px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 8px 10px;
  color: #111827;
  display: flex;
  align-items: center;
}

.modal-grid input {
  height: 36px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 0 10px;
}

.modal-grid select {
  height: 36px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 0 10px;
}

.form-input,
.form-select {
  width: 100%;
}

.credit-badge {
  display: inline-flex;
  align-items: center;
  height: 24px;
  border-radius: 999px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 600;
}

.badge-ok {
  color: #1d4ed8;
  background: #dbeafe;
}

.badge-pending {
  color: #b45309;
  background: #fef3c7;
}

.badge-risk {
  color: #b91c1c;
  background: #fee2e2;
}

.td-register-channel {
  vertical-align: middle;
}

.td-credit-status {
  vertical-align: middle;
}

.credit-status-tag {
  cursor: pointer;
  user-select: none;
  font-weight: 600;
  transition: filter 0.15s ease, transform 0.12s ease;
}

.credit-status-tag:hover {
  filter: brightness(0.96);
}

.credit-status-tag:active {
  transform: scale(0.98);
}
</style>
