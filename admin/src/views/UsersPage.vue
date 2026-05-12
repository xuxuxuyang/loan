<script setup lang="ts">
import { CircleCheck, CircleClose, CirclePlus, EditPen, Minus, Picture } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { withAdminAuthHeaders } from '../composables/useAdminApi'
import { getAdminSession } from '../composables/useAdminAuth'
import TrafficChannelNameTag from '../components/TrafficChannelNameTag.vue'
import UserRiskDetailDialog, {
  type UserItem,
  type UserRiskSnapshot,
  type RiskProductRow,
} from '../components/UserRiskDetailDialog.vue'
import {
  INSTALLMENT_ORDER_RISK_STEP_KEYS,
  INSTALLMENT_ORDER_RISK_STEP_LABELS,
} from '../constants/installmentOrderRisk'
import { donePageProgress, startPageProgress } from '../utils/progress'
import { trafficChannelDisplayKey } from '../utils/trafficChannelTagStyle'
import { groupRadarV4FactsForTables, chunkRadarFactPairs } from '../utils/radarV4ReputationFacts'
import { getRiskFactLines, type RiskFactLine } from '../utils/riskRowFactLines'

const DEFAULT_USER_QUOTA = 3000

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
}

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

const users = ref<ListedUser[]>([])
const loading = ref(false)
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

const canManageUsers = computed(() => getAdminSession()?.role === 'super_admin')

const route = useRoute()

/** 下单用户页：仅展示订单数大于 0 的用户 */
const isOrderingUsersView = computed(() => route.path === '/users/ordering')

const editForm = reactive({
  name: '',
  phone: '',
  idNumber: '',
  /** 留空则不修改；填写则更新商城登录密码，至少 6 位 */
  newPassword: '',
})

const filteredUsers = computed(() => {
  if (!isOrderingUsersView.value) {
    return users.value
  }
  return users.value.filter(u => Number(u.orderCount || 0) > 0)
})

/** 下单用户：可选按下单日本地日期筛选，再按最近下单时间倒序；注册用户：保持接口顺序 */
const tableUsers = computed(() => {
  let list = [...filteredUsers.value]
  if (isOrderingUsersView.value) {
    const dk = orderDateKey.value
    if (dk) {
      list = list.filter((u) => {
        if (!u.lastOrderAt) {
          return false
        }
        return localYmdFromIso(u.lastOrderAt) === dk
      })
    }
    return list.sort((a, b) => {
      const ta = a.lastOrderAt ? new Date(a.lastOrderAt).getTime() : 0
      const tb = b.lastOrderAt ? new Date(b.lastOrderAt).getTime() : 0
      if (tb !== ta) {
        return tb - ta
      }
      return String(a.phone).localeCompare(String(b.phone))
    })
  }
  return list
})

watch(
  () => route.path,
  (path) => {
    if (path !== '/users/ordering') {
      orderDateKey.value = null
    }
  },
)

function localYmdFromIso(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return ''
  }
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

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
    }
  }
}

watch(userRiskDialogVisible, (open) => {
  if (!open)
    riskDialogUserId.value = null
})

function isMockImgSrc(src: string) {
  const s = String(src || '').trim()
  return !s || s.startsWith('mock://')
}

function findFourteenRow(rows: RiskProductRow[] | undefined, slotKey: string): RiskProductRow | null {
  if (!Array.isArray(rows)) {
    return null
  }
  return rows.find(r => r.slotKey === slotKey) || null
}

/** 占位槽「无执行记录」与真实跳过区分展示 */
function isRiskRowPlaceholderSkipped(row: RiskProductRow): boolean {
  return row.state === 'skipped'
    && (String(row.skippedReason || '').includes('无执行记录') || !String(row.skippedReason || '').trim())
}

type OrderRiskStepDisplay = {
  slotKey: string
  label: string
  row: RiskProductRow | null
  /** 通过 | 未通过 | 已跳过 | 暂无 */
  outcome: 'pass' | 'fail' | 'skip' | 'empty'
  detail: string
  /** 与风控详情弹窗一致的结构化摘要行 */
  facts: RiskFactLine[]
}

const RADAR_SLOT_KEY = 'radar_v4_enc'

function buildOrderRiskPreviewStep(
  slotKey: string,
  defaultLabel: string,
  row: RiskProductRow | null,
): OrderRiskStepDisplay {
  let outcome: OrderRiskStepDisplay['outcome'] = 'empty'
  let detail = ''
  if (row) {
    if (row.state === 'ok') {
      outcome = 'pass'
    }
    else if (row.state === 'fail') {
      outcome = 'fail'
      detail = String(row.error || '').trim()
    }
    else if (isRiskRowPlaceholderSkipped(row)) {
      outcome = 'empty'
      detail = ''
    }
    else {
      outcome = 'skip'
      detail = String(row.skippedReason || '').trim()
    }
  }
  const label = row?.productLabel?.trim() || defaultLabel
  const facts = row ? getRiskFactLines(row) : []
  return { slotKey, label, row, outcome, detail, facts }
}

function buildOrderSubmitSevenPanel(snapshot: UserRiskSnapshot | null | undefined): {
  steps: OrderRiskStepDisplay[]
  radarStep: OrderRiskStepDisplay
  summary: string
  checkedAt: string
} {
  const steps: OrderRiskStepDisplay[] = []
  for (const key of INSTALLMENT_ORDER_RISK_STEP_KEYS) {
    const defaultLabel = INSTALLMENT_ORDER_RISK_STEP_LABELS[key] || key
    const row = snapshot ? findFourteenRow(snapshot.fourteenRows, key) : null
    steps.push(buildOrderRiskPreviewStep(key, defaultLabel, row))
  }

  const radarRow = snapshot ? findFourteenRow(snapshot.fourteenRows, RADAR_SLOT_KEY) : null
  const radarStep = buildOrderRiskPreviewStep(RADAR_SLOT_KEY, '风控雷达（全景雷达-MD5）', radarRow)

  const slots = [...steps, radarStep]
  const tested = slots.filter(s => s.outcome !== 'empty')
  const passN = slots.filter(s => s.outcome === 'pass').length
  const failN = slots.filter(s => s.outcome === 'fail').length
  const skipN = slots.filter(s => s.outcome === 'skip').length
  const emptyN = slots.filter(s => s.outcome === 'empty').length

  let summary = ''
  if (tested.length === 0) {
    summary = '档案中尚无下单七项与全景雷达的实测结果（多为占位「无执行记录」）。用户先享后付下单并完成系统审核后，接口结论会写入档案；也可在本弹窗「下单七项」页签手动单条核查。'
  }
  else {
    summary = `八项中已有 ${tested.length} 项有明确结论：通过 ${passN}，未通过 ${failN}，跳过 ${skipN}；未写入/占位 ${emptyN} 项。`
    if (snapshot?.passed === false || failN > 0) {
      summary += ' 存在未通过项时，请结合订单与人工审核处理。'
    }
    else if (failN === 0 && passN === slots.length) {
      summary += ' 八项均已通过。'
    }
    else if (failN === 0 && passN === INSTALLMENT_ORDER_RISK_STEP_KEYS.length && radarStep.outcome === 'empty') {
      summary += ' 下单七项均已通过；全景雷达尚未写入结论。'
    }
    const sm = typeof snapshot?.summaryMessage === 'string' ? snapshot.summaryMessage.trim() : ''
    if (sm) {
      summary += ` ${sm}`
    }
  }

  const checkedAt = snapshot?.checkedAt ? formatDateTime(snapshot.checkedAt) : ''
  return { steps, radarStep, summary, checkedAt }
}

const previewOrderRiskPanel = computed(() => buildOrderSubmitSevenPanel(previewUser.value?.riskControlSnapshot))

const previewRadarV4FactsGrouped = computed(() =>
  groupRadarV4FactsForTables(previewOrderRiskPanel.value.radarStep.facts),
)

/** 用户预览里雷达表每行并排组数（与风控详情弹窗一致） */
const PREVIEW_RADAR_PAIR_COLUMNS = 3
const PREVIEW_RADAR_TABLE_COLSPAN = PREVIEW_RADAR_PAIR_COLUMNS * 2
const previewRadarPairHeadIndexes = Array.from({ length: PREVIEW_RADAR_PAIR_COLUMNS }, (_, i) => i)

/** 列表/预览/入库展示用：仅依据先享后付下单七项快照——任一项未通过→风险，七项均为通过→良好，否则待风控（不采用人工修改） */
type DisplayCreditStatus = '良好' | '待风控' | '风险'

function displayCreditStatusFromOrderSevenSnapshot(snapshot: UserRiskSnapshot | null | undefined): DisplayCreditStatus {
  if (!snapshot || !Array.isArray(snapshot.fourteenRows)) {
    return '待风控'
  }
  const rows = snapshot.fourteenRows
  for (const key of INSTALLMENT_ORDER_RISK_STEP_KEYS) {
    const row = findFourteenRow(rows, key)
    if (row?.state === 'fail') {
      return '风险'
    }
  }
  for (const key of INSTALLMENT_ORDER_RISK_STEP_KEYS) {
    const row = findFourteenRow(rows, key)
    if (!row || row.state !== 'ok') {
      return '待风控'
    }
  }
  return '良好'
}

function displayCreditStatusFromRisk(user: ListedUser | null | undefined): DisplayCreditStatus {
  return displayCreditStatusFromOrderSevenSnapshot(user?.riskControlSnapshot)
}

const previewDisplayCreditStatus = computed(() => displayCreditStatusFromRisk(previewUser.value))

function mapApiUser(user: ApiUserItem): ListedUser {
  const quotaRaw = user.quota
  const quota = Number.isFinite(Number(quotaRaw)) && Number(quotaRaw) >= 0
    ? Math.round(Number(quotaRaw))
    : DEFAULT_USER_QUOTA
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
  }
}

async function fetchUsers() {
  loading.value = true
  startPageProgress()
  try {
    const query = keyword.value.trim() ? `?keyword=${encodeURIComponent(keyword.value.trim())}` : ''
    const response = await fetch(`${MALL_API_BASE}/users${query}`, {
      method: 'GET',
      headers: withAdminAuthHeaders(),
    })
    if (!response.ok) {
      throw new Error(`请求用户失败: ${response.status}`)
    }
    const payload = await response.json() as { data?: ApiUserItem[] }
    const list = Array.isArray(payload.data) ? payload.data : []
    users.value = list.map(mapApiUser)
  }
  catch (error) {
    console.error('加载用户失败', error)
  }
  finally {
    loading.value = false
    donePageProgress()
  }
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
  if (!canManageUsers.value) return
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
  if (!canManageUsers.value) return
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
  createDialogVisible.value = false
}

async function createUser() {
  if (!canManageUsers.value) return
  if (creating.value) {
    return
  }
  if (!createForm.name.trim() || !/^1\d{10}$/.test(createForm.phone.trim())) {
    return
  }
  const initPwd = createForm.initialPassword.trim()
  if (initPwd.length > 0 && initPwd.length < 6) {
    ElMessage.warning('初始登录密码至少 6 位，或留空稍后在编辑中设置')
    return
  }
  const idRawCreate = createForm.idNumber.trim().toUpperCase()
  if (idRawCreate.length > 0 && !CN_ID_CARD_RE.test(idRawCreate)) {
    ElMessage.warning('身份证号码需为 18 位合法格式，或留空')
    return
  }
  creating.value = true
  try {
    const response = await fetch(`${MALL_API_BASE}/users`, {
      method: 'POST',
      headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        name: createForm.name.trim(),
        phone: createForm.phone.trim(),
        ...(idRawCreate ? { idNumber: idRawCreate } : {}),
        ...(initPwd.length >= 6 ? { initialPassword: initPwd } : {}),
      }),
    })
    if (!response.ok) {
      const payload = await response.json() as { msg?: string }
      throw new Error(payload.msg || `新增用户失败: ${response.status}`)
    }
    createDialogVisible.value = false
    ElMessage.success('用户已添加')
    await fetchUsers()
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
  if (!canManageUsers.value) return
  if (!previewUser.value || editingUserId.value !== previewUser.value.id) {
    return
  }
  if (!editForm.name.trim() || !/^1\d{10}$/.test(editForm.phone.trim())) {
    return
  }
  const pwd = editForm.newPassword.trim()
  if (pwd.length > 0 && pwd.length < 6) {
    ElMessage.warning('登录密码至少 6 位，或留空保持原密码')
    return
  }
  const idRaw = editForm.idNumber.trim().toUpperCase()
  if (idRaw.length > 0 && !CN_ID_CARD_RE.test(idRaw)) {
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
      headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        name: editForm.name.trim(),
        phone: editForm.phone.trim(),
        idNumber: idRaw,
        ...(pwd.length >= 6 && pwd !== editPasswordBaseline.value ? { newPassword: pwd } : {}),
      }),
    })
    if (!response.ok) {
      const payload = await response.json() as { msg?: string }
      throw new Error(payload.msg || `更新用户失败: ${response.status}`)
    }
    await fetchUsers()
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
  if (!canManageUsers.value) return
  if (deletingId.value) {
    return
  }
  deletingId.value = user.id
  try {
    const response = await fetch(`${MALL_API_BASE}/users/${encodeURIComponent(user.id)}`, {
      method: 'DELETE',
      headers: withAdminAuthHeaders(),
    })
    if (!response.ok) {
      const payload = await response.json() as { msg?: string }
      throw new Error(payload.msg || `删除用户失败: ${response.status}`)
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

onMounted(() => {
  void fetchUsers()
  pendingDeleteId.value = ''
})

watch(keyword, () => {
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
  if (!canManageUsers.value) return
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

async function saveQuota() {
  if (!canManageUsers.value || !quotaTarget.value || quotaSaving.value) return
  const n = Number(String(quotaInput.value).trim())
  if (!Number.isFinite(n) || n < 0) {
    return
  }
  const id = quotaTarget.value.id
  quotaSaving.value = true
  try {
    const response = await fetch(`${MALL_API_BASE}/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ quota: Math.round(n) }),
    })
    if (!response.ok) {
      const payload = await response.json() as { msg?: string }
      throw new Error(payload.msg || `更新额度失败: ${response.status}`)
    }
    await fetchUsers()
    closeQuotaDialog()
  }
  catch (error) {
    console.error('更新额度失败', error)
  }
  finally {
    quotaSaving.value = false
  }
}

function openRemarkDialog(user: ListedUser) {
  if (!canManageUsers.value) return
  remarkTarget.value = user
  remarkDraft.value = typeof user.adminRemark === 'string' ? user.adminRemark : ''
  remarkDialogVisible.value = true
}

function closeRemarkDialog() {
  if (remarkSaving.value) return
  remarkDialogVisible.value = false
  remarkTarget.value = null
  remarkDraft.value = ''
}

async function saveRemark() {
  if (!canManageUsers.value || !remarkTarget.value || remarkSaving.value) return
  const id = remarkTarget.value.id
  remarkSaving.value = true
  try {
    const response = await fetch(`${MALL_API_BASE}/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ adminRemark: remarkDraft.value.trim() }),
    })
    if (!response.ok) {
      const payload = await response.json() as { msg?: string }
      throw new Error(payload.msg || `保存备注失败: ${response.status}`)
    }
    ElMessage.success('备注已保存')
    closeRemarkDialog()
    await fetchUsers()
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
  if (!canManageUsers.value || blacklistBusyId.value) return
  blacklistBusyId.value = user.id
  const next = !user.orderBlacklisted
  try {
    const response = await fetch(`${MALL_API_BASE}/users/${encodeURIComponent(user.id)}`, {
      method: 'PATCH',
      headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ orderBlacklisted: next }),
    })
    if (!response.ok) {
      const payload = await response.json() as { msg?: string }
      throw new Error(payload.msg || `操作失败: ${response.status}`)
    }
    ElMessage.success(next ? '已限制该用户下单' : '已解除下单限制')
    await fetchUsers()
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
  <div class="panel">
    <div class="toolbar">
      <el-input
        v-model="keyword"
        class="toolbar-input"
        placeholder="搜索姓名 / 手机号"
        clearable
      />
      <el-date-picker
        v-if="isOrderingUsersView"
        v-model="orderDateKey"
        class="toolbar-datepicker"
        type="date"
        placeholder="下单日期"
        value-format="YYYY-MM-DD"
        clearable
      />
      <button
        class="btn btn-refresh"
        type="button"
        :disabled="loading"
        @click="fetchUsers"
      >
        刷新
      </button>
      <button
        v-if="canManageUsers && !isOrderingUsersView"
        class="btn btn-primary"
        type="button"
        @click="openCreateDialog"
      >
        添加用户
      </button>
    </div>

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
          v-for="item in tableUsers"
          :key="item.id"
        >
          <td>{{ isOrderingUsersView ? formatDateTime(item.lastOrderAt) : item.registerAt }}</td>
          <td>{{ item.name }}</td>
          <td>{{ item.phone }}</td>
          <td class="td-register-channel">
            <TrafficChannelNameTag
              :display-key="trafficChannelDisplayKey(item.registerChannelLabel, item.registerChannelName, item.registerChannelCode)"
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
              v-if="canManageUsers"
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
              v-if="canManageUsers"
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
                :class="{ 'remark-preview--empty': !item.adminRemark?.trim() }"
              >{{ item.adminRemark?.trim() ? item.adminRemark : '—' }}</span>
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
                :class="{ 'remark-preview--empty': !item.adminRemark?.trim() }"
                :title="item.adminRemark?.trim() ? item.adminRemark : ''"
              >
                {{ item.adminRemark?.trim() ? item.adminRemark : '—' }}
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
                v-if="canManageUsers"
                class="btn btn-primary"
                type="button"
                @click="startEdit(item)"
              >
                修改
              </button>
              <button
                v-if="canManageUsers"
                type="button"
                class="btn"
                :class="item.orderBlacklisted ? 'btn-muted' : 'btn-danger'"
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
                v-if="canManageUsers"
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
        <tr v-if="!loading && tableUsers.length === 0">
          <td colspan="8" style="text-align: center; color: #9ca3af;">
            暂无用户数据
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div
    v-if="createDialogVisible && canManageUsers"
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
        <label class="full">
          身份证号码（可选）
          <el-input
            v-model="createForm.idNumber"
            class="form-input"
            maxlength="18"
            clearable
            placeholder="18 位大陆身份证号，风控 B 类接口必填；可留空"
          />
        </label>
        <label class="full">
          初始登录密码（可选）
          <el-input
            v-model="createForm.initialPassword"
            class="form-input"
            type="password"
            show-password
            clearable
            placeholder="至少 6 位，留空则用户需验证码登录或由后台再次设置"
            autocomplete="new-password"
          />
        </label>
      </div>
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

  <div
    v-if="quotaDialogVisible && quotaTarget && canManageUsers"
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
          type="number"
          :min="0"
          clearable
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

  <div
    v-if="remarkDialogVisible && remarkTarget && canManageUsers"
    class="modal-mask"
    @click.self="closeRemarkDialog"
  >
    <div class="modal-panel create-modal">
      <div class="modal-header">
        <h3>用户备注</h3>
        <button
          type="button"
          class="btn btn-ghost"
          :disabled="remarkSaving"
          @click="closeRemarkDialog"
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
          placeholder="仅后台可见，可用于记录沟通或风控说明"
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

  <UserRiskDetailDialog
    v-model="userRiskDialogVisible"
    :user-id="riskDialogUserId"
    @user-updated="onRiskDialogUserUpdated"
  />

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
        <section class="user-preview-block">
          <h4 class="user-preview-block__title">
            <span class="user-preview-block__bar" />
            基本信息
          </h4>

          <div
            v-if="editingUserId === previewUser.id && canManageUsers"
            class="user-preview-edit-grid"
          >
            <label class="user-preview-field">
              <span class="user-preview-field__label">姓名</span>
              <el-input
                v-model="editForm.name"
                class="form-input"
                clearable
              />
            </label>
            <label class="user-preview-field">
              <span class="user-preview-field__label">手机号</span>
              <el-input
                v-model="editForm.phone"
                class="form-input"
                clearable
              />
            </label>
            <label class="user-preview-field user-preview-field--full">
              <span class="user-preview-field__label">身份证号码</span>
              <el-input
                v-model="editForm.idNumber"
                class="form-input user-preview-id-number-input"
                maxlength="18"
                clearable
                placeholder="18 位大陆身份证号，留空可清空档案中的号码"
              />
            </label>
            <label class="user-preview-field user-preview-field--full">
              <span class="user-preview-field__label">信誉状态</span>
              <div class="user-preview-credit-readonly">
                <span :class="getStatusClass(previewDisplayCreditStatus)">{{ previewDisplayCreditStatus }}</span>
                <p class="user-preview-field__hint">
                  由先享后付下单七项接口结果自动判定（七项均为通过为「良好」，任一项未通过为「风险」，尚无结论或未测完为「待风控」），不可手动修改。
                </p>
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
                    :display-key="trafficChannelDisplayKey(previewUser.registerChannelLabel, previewUser.registerChannelName, previewUser.registerChannelCode)"
                  />
                </span>
              </div>
              <div class="user-preview-edit-readonly__cell">
                <span class="user-preview-edit-readonly__k">额度</span>
                <span class="user-preview-edit-readonly__v user-preview-quota">¥ {{ previewUser.quota }}</span>
              </div>
            </div>
          </div>

          <template v-else>
            <el-descriptions
              :column="2"
              border
              size="default"
              class="user-preview-desc"
            >
              <el-descriptions-item label="姓名">
                {{ previewUser.name }}
              </el-descriptions-item>
              <el-descriptions-item label="手机号">
                {{ previewUser.phone }}
              </el-descriptions-item>
              <el-descriptions-item
                v-if="canManageUsers"
                label="登录密码"
              >
                <span v-if="previewUser.adminPasswordPlain">{{ previewUser.adminPasswordPlain }}</span>
                <span
                  v-else
                  class="user-preview-meta__muted"
                >未设置</span>
              </el-descriptions-item>
              <el-descriptions-item label="身份证号码">
                <span
                  v-if="previewUser.idNumber"
                  class="user-preview-id-number"
                >{{ previewUser.idNumber }}</span>
                <span
                  v-else
                  class="user-preview-meta__muted"
                >未填写</span>
              </el-descriptions-item>
              <el-descriptions-item label="注册时间">
                {{ previewUser.registerAt }}
              </el-descriptions-item>
              <el-descriptions-item label="注册渠道">
                <TrafficChannelNameTag
                  :display-key="trafficChannelDisplayKey(previewUser.registerChannelLabel, previewUser.registerChannelName, previewUser.registerChannelCode)"
                />
              </el-descriptions-item>
              <el-descriptions-item label="额度">
                <span class="user-preview-quota">¥ {{ previewUser.quota }}</span>
              </el-descriptions-item>
              <el-descriptions-item
                label="信誉状态"
                :span="2"
              >
                <span :class="getStatusClass(previewDisplayCreditStatus)">
                  {{ previewDisplayCreditStatus }}
                </span>
              </el-descriptions-item>
            </el-descriptions>
          </template>
        </section>

        <section class="user-preview-block">
          <h4 class="user-preview-block__title">
            <span class="user-preview-block__bar" />
            证件照片
          </h4>
          <div class="user-preview-id-grid">
            <div class="user-preview-id-cell">
              <p class="user-preview-id-label">
                身份证正面
              </p>
              <div class="user-preview-id-frame">
                <template v-if="isMockImgSrc(previewUser.idCardFront)">
                  <div class="user-preview-id-placeholder">
                    <el-icon class="user-preview-id-placeholder__icon"><Picture /></el-icon>
                    <span>模拟证件 · 无图片</span>
                  </div>
                </template>
                <el-image
                  v-else
                  :src="previewUser.idCardFront"
                  fit="cover"
                  class="user-preview-el-image"
                  :preview-src-list="[previewUser.idCardFront]"
                  preview-teleported
                >
                  <template #error>
                    <div class="user-preview-id-placeholder user-preview-id-placeholder--error">
                      <el-icon><Picture /></el-icon>
                      <span>加载失败</span>
                    </div>
                  </template>
                </el-image>
              </div>
            </div>
            <div class="user-preview-id-cell">
              <p class="user-preview-id-label">
                身份证反面
              </p>
              <div class="user-preview-id-frame">
                <template v-if="isMockImgSrc(previewUser.idCardBack)">
                  <div class="user-preview-id-placeholder">
                    <el-icon class="user-preview-id-placeholder__icon"><Picture /></el-icon>
                    <span>模拟证件 · 无图片</span>
                  </div>
                </template>
                <el-image
                  v-else
                  :src="previewUser.idCardBack"
                  fit="cover"
                  class="user-preview-el-image"
                  :preview-src-list="[previewUser.idCardBack]"
                  preview-teleported
                >
                  <template #error>
                    <div class="user-preview-id-placeholder user-preview-id-placeholder--error">
                      <el-icon><Picture /></el-icon>
                      <span>加载失败</span>
                    </div>
                  </template>
                </el-image>
              </div>
            </div>
            <div class="user-preview-id-cell">
              <p class="user-preview-id-label">
                手持身份证
              </p>
              <div class="user-preview-id-frame">
                <template v-if="!String(previewUser.idCardHandheld || '').trim()">
                  <div class="user-preview-id-placeholder">
                    <el-icon class="user-preview-id-placeholder__icon"><Picture /></el-icon>
                    <span>未上传</span>
                  </div>
                </template>
                <template v-else-if="isMockImgSrc(previewUser.idCardHandheld)">
                  <div class="user-preview-id-placeholder">
                    <el-icon class="user-preview-id-placeholder__icon"><Picture /></el-icon>
                    <span>模拟证件 · 无图片</span>
                  </div>
                </template>
                <el-image
                  v-else
                  :src="previewUser.idCardHandheld"
                  fit="cover"
                  class="user-preview-el-image"
                  :preview-src-list="[previewUser.idCardHandheld]"
                  preview-teleported
                >
                  <template #error>
                    <div class="user-preview-id-placeholder user-preview-id-placeholder--error">
                      <el-icon><Picture /></el-icon>
                      <span>加载失败</span>
                    </div>
                  </template>
                </el-image>
              </div>
            </div>
          </div>
        </section>

        <section class="user-preview-block user-preview-block--risk">
          <div class="user-preview-risk-card">
            <div class="user-preview-risk-card__head">
              <div>
                <h4 class="user-preview-risk-card__title">
                  信誉报告
                </h4>
                <p class="user-preview-risk-card__sub">
                  <template v-if="previewOrderRiskPanel.checkedAt">
                    档案更新时间 {{ previewOrderRiskPanel.checkedAt }} ·
                  </template>
                  先享后付下单七项与全景雷达（共八项，与商城档案写入口径一致）
                </p>
              </div>
              <span :class="getStatusClass(previewDisplayCreditStatus)">
                {{ previewDisplayCreditStatus }}
              </span>
            </div>

            <div class="user-preview-risk-seven">
              <article
                v-for="step in previewOrderRiskPanel.steps"
                :key="step.slotKey"
                class="user-preview-risk-step user-preview-risk-step--compact"
              >
                <div class="user-preview-risk-step__head">
                  <p class="user-preview-risk-step__label">
                    {{ step.label }}
                  </p>
                  <div class="user-preview-risk-step__row">
                    <template v-if="step.outcome === 'pass'">
                      <el-icon class="user-preview-risk-icon user-preview-risk-icon--ok" aria-hidden="true">
                        <CircleCheck />
                      </el-icon>
                      <span class="user-preview-risk-outcome">通过</span>
                    </template>
                    <template v-else-if="step.outcome === 'fail'">
                      <el-icon class="user-preview-risk-icon user-preview-risk-icon--bad" aria-hidden="true">
                        <CircleClose />
                      </el-icon>
                      <span class="user-preview-risk-outcome user-preview-risk-outcome--bad">未通过</span>
                    </template>
                    <template v-else-if="step.outcome === 'skip'">
                      <el-icon class="user-preview-risk-icon user-preview-risk-icon--skip" aria-hidden="true">
                        <Minus />
                      </el-icon>
                      <span class="user-preview-risk-outcome user-preview-risk-outcome--skip">已跳过</span>
                    </template>
                    <template v-else>
                      <el-icon class="user-preview-risk-icon user-preview-risk-icon--muted" aria-hidden="true">
                        <Minus />
                      </el-icon>
                      <span class="user-preview-risk-outcome user-preview-risk-outcome--muted">暂无</span>
                    </template>
                  </div>
                </div>
                <div
                  v-if="step.facts.length"
                  class="user-preview-risk-step__facts"
                >
                  <div
                    v-for="(line, fi) in step.facts"
                    :key="fi"
                    class="user-preview-risk-fact"
                  >
                    <span class="user-preview-risk-fact__k">{{ line.label }}</span>
                    <span
                      class="user-preview-risk-fact__v"
                      :class="{ 'user-preview-risk-fact__v--emph': line.emphasis }"
                      :title="`${line.label}：${line.value}`"
                    >{{ line.value }}</span>
                  </div>
                </div>
                <p
                  v-if="step.detail"
                  class="user-preview-risk-step__detail"
                  :title="step.detail"
                >
                  {{ step.detail }}
                </p>
              </article>
            </div>

            <div class="user-preview-risk-radar">
              <article class="user-preview-risk-step user-preview-risk-step--compact user-preview-risk-step--radar">
                <div class="user-preview-risk-step__head">
                  <p class="user-preview-risk-step__label">
                    {{ previewOrderRiskPanel.radarStep.label }}
                  </p>
                  <div class="user-preview-risk-step__row">
                    <template v-if="previewOrderRiskPanel.radarStep.outcome === 'pass'">
                      <el-icon class="user-preview-risk-icon user-preview-risk-icon--ok" aria-hidden="true">
                        <CircleCheck />
                      </el-icon>
                      <span class="user-preview-risk-outcome">通过</span>
                    </template>
                    <template v-else-if="previewOrderRiskPanel.radarStep.outcome === 'fail'">
                      <el-icon class="user-preview-risk-icon user-preview-risk-icon--bad" aria-hidden="true">
                        <CircleClose />
                      </el-icon>
                      <span class="user-preview-risk-outcome user-preview-risk-outcome--bad">未通过</span>
                    </template>
                    <template v-else-if="previewOrderRiskPanel.radarStep.outcome === 'skip'">
                      <el-icon class="user-preview-risk-icon user-preview-risk-icon--skip" aria-hidden="true">
                        <Minus />
                      </el-icon>
                      <span class="user-preview-risk-outcome user-preview-risk-outcome--skip">已跳过</span>
                    </template>
                    <template v-else>
                      <el-icon class="user-preview-risk-icon user-preview-risk-icon--muted" aria-hidden="true">
                        <Minus />
                      </el-icon>
                      <span class="user-preview-risk-outcome user-preview-risk-outcome--muted">暂无</span>
                    </template>
                  </div>
                </div>
                <div
                  v-if="previewOrderRiskPanel.radarStep.facts.length"
                  class="user-preview-radar-facts-wrap"
                >
                  <template
                    v-if="previewRadarV4FactsGrouped.sections.length > 0 || previewRadarV4FactsGrouped.reportNote"
                  >
                    <p
                      v-if="previewRadarV4FactsGrouped.reportNote"
                      class="user-preview-radar-report-note"
                    >
                      {{ previewRadarV4FactsGrouped.reportNote }}
                    </p>
                    <div
                      v-for="(sec, si) in previewRadarV4FactsGrouped.sections"
                      :key="si"
                      class="user-preview-radar-sec"
                    >
                      <div class="user-preview-radar-sec__head">
                        <h4 class="user-preview-radar-sec__title">
                          {{ sec.title }}
                        </h4>
                        <p
                          v-if="sec.subtitle"
                          class="user-preview-radar-sec__sub"
                        >
                          {{ sec.subtitle }}
                        </p>
                      </div>
                      <div class="user-preview-radar-table-scroll">
                        <table
                          class="user-preview-radar-table user-preview-radar-table--multi"
                          :aria-label="`${sec.title}指标`"
                        >
                          <thead>
                            <tr>
                              <template
                                v-for="hi in previewRadarPairHeadIndexes"
                                :key="hi"
                              >
                                <th scope="col">
                                  指标
                                </th>
                                <th scope="col">
                                  取值
                                </th>
                              </template>
                            </tr>
                          </thead>
                          <tbody>
                            <tr v-if="!sec.rows.length">
                              <td
                                :colspan="PREVIEW_RADAR_TABLE_COLSPAN"
                                class="user-preview-radar-table__empty"
                              >
                                暂无该项返回数据
                              </td>
                            </tr>
                            <template v-else>
                              <tr
                                v-for="(chunk, ci) in chunkRadarFactPairs(sec.rows, PREVIEW_RADAR_PAIR_COLUMNS)"
                                :key="ci"
                              >
                                <template
                                  v-for="(cell, idx) in chunk"
                                  :key="idx"
                                >
                                  <td class="user-preview-radar-table__label">
                                    {{ cell.label }}
                                  </td>
                                  <td
                                    class="user-preview-radar-table__value"
                                    :class="{ 'user-preview-radar-table__value--emphasis': cell.emphasis }"
                                  >
                                    {{ cell.value }}
                                  </td>
                                </template>
                                <td
                                  v-if="chunk.length < PREVIEW_RADAR_PAIR_COLUMNS"
                                  :colspan="(PREVIEW_RADAR_PAIR_COLUMNS - chunk.length) * 2"
                                  class="user-preview-radar-table__pad"
                                ></td>
                              </tr>
                            </template>
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div
                      v-if="previewRadarV4FactsGrouped.extras.length"
                      class="user-preview-radar-sec"
                    >
                      <div class="user-preview-radar-sec__head">
                        <h4 class="user-preview-radar-sec__title">
                          其它信息
                        </h4>
                      </div>
                      <div class="user-preview-radar-table-scroll">
                        <table
                          class="user-preview-radar-table user-preview-radar-table--multi"
                          aria-label="其它信息"
                        >
                          <thead>
                            <tr>
                              <template
                                v-for="hi in previewRadarPairHeadIndexes"
                                :key="hi"
                              >
                                <th scope="col">
                                  项目
                                </th>
                                <th scope="col">
                                  内容
                                </th>
                              </template>
                            </tr>
                          </thead>
                          <tbody>
                            <tr
                              v-for="(chunk, ci) in chunkRadarFactPairs(previewRadarV4FactsGrouped.extras, PREVIEW_RADAR_PAIR_COLUMNS)"
                              :key="ci"
                            >
                              <template
                                v-for="(ex, idx) in chunk"
                                :key="idx"
                              >
                                <td class="user-preview-radar-table__label">
                                  {{ ex.label }}
                                </td>
                                <td
                                  class="user-preview-radar-table__value"
                                  :class="{ 'user-preview-radar-table__value--emphasis': ex.emphasis }"
                                >
                                  {{ ex.value }}
                                </td>
                              </template>
                              <td
                                v-if="chunk.length < PREVIEW_RADAR_PAIR_COLUMNS"
                                :colspan="(PREVIEW_RADAR_PAIR_COLUMNS - chunk.length) * 2"
                                class="user-preview-radar-table__pad"
                              ></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <div class="user-preview-radar-table-scroll">
                      <table
                        class="user-preview-radar-table user-preview-radar-table--multi"
                        aria-label="全景雷达数据"
                      >
                        <thead>
                          <tr>
                            <template
                              v-for="hi in previewRadarPairHeadIndexes"
                              :key="hi"
                            >
                              <th scope="col">
                                项目
                              </th>
                              <th scope="col">
                                内容
                              </th>
                            </template>
                          </tr>
                        </thead>
                        <tbody>
                          <tr
                            v-for="(chunk, ci) in chunkRadarFactPairs(previewOrderRiskPanel.radarStep.facts, PREVIEW_RADAR_PAIR_COLUMNS)"
                            :key="ci"
                          >
                            <template
                              v-for="(fl, idx) in chunk"
                              :key="idx"
                            >
                              <td class="user-preview-radar-table__label">
                                {{ fl.label }}
                              </td>
                              <td
                                class="user-preview-radar-table__value"
                                :class="{ 'user-preview-radar-table__value--emphasis': fl.emphasis }"
                              >
                                {{ fl.value }}
                              </td>
                            </template>
                            <td
                              v-if="chunk.length < PREVIEW_RADAR_PAIR_COLUMNS"
                              :colspan="(PREVIEW_RADAR_PAIR_COLUMNS - chunk.length) * 2"
                              class="user-preview-radar-table__pad"
                            ></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </template>
                </div>
                <p
                  v-if="previewOrderRiskPanel.radarStep.detail"
                  class="user-preview-risk-step__detail user-preview-risk-step__detail--radar"
                  :title="previewOrderRiskPanel.radarStep.detail"
                >
                  {{ previewOrderRiskPanel.radarStep.detail }}
                </p>
              </article>
            </div>

            
          </div>
        </section>
      </div>

      <div class="user-preview-footer">
        <button
          v-if="editingUserId === previewUser.id && canManageUsers"
          class="btn btn-primary"
          type="button"
          @click="saveEdit"
        >
          保存修改
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
  font-size: 13px;
  color: #f10202;
  line-height: 1.45;
  max-height: 4.35em;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  word-break: break-word;
}

.remark-preview--empty {
  color: #000;
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
  background: rgba(15, 23, 42, 0.35);
  display: grid;
  place-items: center;
  padding: 20px;
}

.modal-panel {
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

.quota-hint {
  margin: 0 0 12px;
  font-size: 14px;
  color: #4b5563;
}

.quota-label {
  display: grid;
  gap: 6px;
  font-size: 14px;
  color: #6b7280;
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
  color: #6b7280;
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
