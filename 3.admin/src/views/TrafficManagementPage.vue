<script setup lang="ts">
import { CirclePlus, CopyDocument, Delete, EditPen, Loading, QuestionFilled } from '@element-plus/icons-vue'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import TrafficChannelNameTag from '../components/TrafficChannelNameTag.vue'
import { apiErrorMessage, withMallTenantHeaders } from '../composables/useAdminApi'
import { getAdminSession, isSuperAdminRole } from '../composables/useAdminAuth'
import { useAdminPagePermission } from '../composables/useAdminPagePermission'
import { donePageProgress, startPageProgress } from '../utils/progress'
import { trafficChannelDisplayKey } from '../utils/trafficChannelTagStyle'

interface TrafficChannelRow {
  id: string
  code: string
  name: string
  remark: string
  disabled: boolean
  createdAt: string
  updatedAt: string
  registerCount: number
  portalAccount?: {
    partnerId?: string
    username: string
    password: string
  }
}

/** 与 GET /admin/traffic-channels/portal-stats、admin-liuliang 数据表同口径（渠道注册用户仅计首单） */
interface TrafficPortalStatsRow {
  id: string
  code: string
  name: string
  clickCount: number
  registerCount: number
  applicationCount: number
  approvedCount: number
  overdueCount: number
  registerRate: number | null
  applicationRate: number | null
  approvalRate: number | null
  overdueRate: number | null
  registrationConversionRate: number | null
  applicationConversionRate: number | null
}

/** 全平台老客户复购汇总（与上方渠道引流首单分开） */
interface OldCustomerSummary {
  userCount: number
  orderCount: number
  approvedCount: number
  overdueCount: number
  approvedAmount: number
  approvalRate: number | null
  overdueRate: number | null
}

/** 指定日放款统计（按用户注册渠道归因） */
interface DailyDisbursementRow {
  id: string
  code: string
  name: string
  orderCount: number
  totalAmount: number
  principal: number
  profit: number
  avgTicket: number
}

interface DailyDisbursementSummary {
  orderCount: number
  totalAmount: number
  principal: number
  profit: number
  avgTicket: number
}

/** 列表行 = 渠道基础信息 + 引流统计 */
type TrafficMergedRow = TrafficChannelRow & {
  stats: TrafficPortalStatsRow | null
}

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

/** 商城 H5（shop）根地址，构建时注入。未配置时：开发环境见下方映射；生产常见「后台 :8080 + 商城 :80」会回退为同主机无端口地址 */
const MALL_H5_ORIGIN = (import.meta.env.VITE_MALL_H5_ORIGIN || '').replace(/\/$/, '')

const isViteDev = import.meta.env.DEV

/** 当前后台页 origin，用于判断推广基址是否仍误指向后台 */
const adminPageOrigin = computed(() => {
  if (typeof window === 'undefined' || !window.location?.origin)
    return ''
  return window.location.origin.replace(/\/$/, '')
})

const h5BaseForLink = computed(() => {
  if (MALL_H5_ORIGIN)
    return MALL_H5_ORIGIN
  if (typeof window !== 'undefined' && window.location?.origin) {
    const origin = window.location.origin.replace(/\/$/, '')
    if (isViteDev) {
      try {
        const u = new URL(origin)
        const port = u.port || (u.protocol === 'https:' ? '443' : '80')
        const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
        // admin 默认同 vite server.port=5174（见 admin/vite.config）；商城为 shop 5173
        if (local && port === '5174')
          return `${u.protocol}//${u.hostname}:5173`
      }
      catch {
        /* ignore */
      }
    }
    else {
      try {
        const u = new URL(origin)
        // 与子系统常见部署一致：后台 http://IP:8080，商城 http://IP/（默认 80，URL 不写端口）
        if (u.protocol === 'http:' && u.port === '8080')
          return `${u.protocol}//${u.hostname}`
      }
      catch {
        /* ignore */
      }
    }
    return origin
  }
  return ''
})

const showH5OriginDevHint = computed(
  () => isViteDev && !MALL_H5_ORIGIN && h5BaseForLink.value === adminPageOrigin.value,
)

/** 与待收明细等页 `el-table` 表头风格一致 */
const tableHeaderCellStyle = {
  background: 'var(--el-fill-color-light)',
  color: 'var(--el-text-color-primary)',
  fontWeight: 600 as const,
}

const {
  canCreate: canCreateTraffic,
  canToggleStatus,
  canRemark,
  canEditChannel,
  canBindPortalAccount,
  canDelete: canDeleteTraffic,
} = useAdminPagePermission('traffic', () => isSuperAdminRole(getAdminSession()?.role))
const showTrafficRowActions = computed(() => canEditChannel.value || canBindPortalAccount.value || canToggleStatus.value || canRemark.value || canDeleteTraffic.value)

const loading = ref(false)
const rows = ref<TrafficChannelRow[]>([])
const showCreate = ref(false)
const showEdit = ref(false)
const submitting = ref(false)
const deleteTarget = ref<TrafficChannelRow | null>(null)
const showDeleteDialog = ref(false)
const deleting = ref(false)
const errorMessage = ref('')

const statsRows = ref<TrafficPortalStatsRow[]>([])
const oldCustomerSummary = ref<OldCustomerSummary | null>(null)
const statsLoading = ref(false)
const statsErrorMessage = ref('')
/** 仅展示至少有一笔「通过」（发卡包）订单的流量商 */
const whitelistStatsPositive = ref(false)

const selectedDisbursementDate = ref(formatLocalYmd(new Date()))
const dailyDisbursementRows = ref<DailyDisbursementRow[]>([])
const dailyDisbursementSummary = ref<DailyDisbursementSummary | null>(null)
const dailyDisbursementLoading = ref(false)
const dailyDisbursementErrorMessage = ref('')

const statsByChannelId = computed(() => {
  const m = new Map<string, TrafficPortalStatsRow>()
  for (const s of statsRows.value) {
    m.set(s.id, s)
  }
  return m
})

/** 单一表格数据源：按流量商列表顺序合并统计；白名单时仅保留通过数 > 0 的渠道 */
const displayMergedRows = computed<TrafficMergedRow[]>(() => {
  const out: TrafficMergedRow[] = []
  for (const r of rows.value) {
    const s = statsByChannelId.value.get(r.id) ?? null
    if (whitelistStatsPositive.value && (!s || s.approvedCount <= 0))
      continue
    out.push({ ...r, stats: s })
  }
  return out
})

function mergedRowClassName({ row }: { row: TrafficMergedRow }) {
  return row.disabled ? 'traffic-quality-row--muted' : ''
}

/** 与 api buildTrafficPartnerPortalStatsRow 口径一致（渠道注册用户仅计首单） */
const TRAFFIC_PORTAL_STAT_HEADER_TIPS = {
  clickCount:
    '用户打开带本渠道参数（?channel=标识）的商城推广页时累计 +1；渠道已停用则不再累计。',
  registerCount: '注册时「渠道标识」等于本流量商的用户总数。',
  applicationCount: '上述注册用户中，存在首单（按下单时间最早一笔）的用户数（含待审核首单）。',
  approvedCount: '上述注册用户的首单中，状态非「待审核」且已发放卡包的用户数（每人最多计 1）。',
  overdueCount:
    '上述注册用户首单中，已通过且为分期订单、存在已到期未还清期次的用户数（每人最多计 1）。',
  registerRate: '注册数 ÷ 点击数 × 100，保留两位小数；点击数为 0 时显示 —。',
  applicationRate: '申请数 ÷ 注册数 × 100，保留两位小数；注册数为 0 时显示 —。',
  approvalRate: '通过数 ÷ 申请数 × 100，保留两位小数；申请数为 0 时显示 —。',
  overdueRate: '按本渠道首单集合动态计算：截至昨日（不含当日），各应还日未还笔数占比的每日平均值；通过数为 0 时显示 —。',
  registrationConversionRate: '通过数 ÷ 注册数 × 100，保留两位小数；注册数为 0 时显示 —。',
  applicationConversionRate: '通过数 ÷ 申请数 × 100，保留两位小数；申请数为 0 时显示 —。',
} as const

const OLD_CUSTOMER_SUMMARY_TIPS = {
  userCount: '全平台下单时判定为老客户的去重用户数（与订单管理「新老客户」口径一致：上一笔订单已发卡包且已全部还清）。',
  orderCount: '上述老客户的复购订单总笔数（不含首单，与上方渠道引流数据分开）。',
  approvedCount: '老客户复购订单中，状态非「待审核」且已发放卡包的笔数。',
  overdueCount: '老客户复购已通过订单中，分期且存在已到期未还清期次的笔数。',
  approvedAmount: '老客户复购已通过订单的成交金额合计。',
  approvalRate: '通过数 ÷ 下单数 × 100，保留两位小数。',
  overdueRate: '逾期数 ÷ 通过数 × 100，保留两位小数。',
} as const

const DAILY_DISBURSEMENT_TIPS = {
  orderCount: '所选日期内完成卡包发放（放款）的订单笔数；按买家注册渠道归因，含复购。',
  totalAmount: '上述订单成交金额（totalAmount）合计。',
  principal: '上述订单卡包本金（cardPackageAmount）合计，与财务报表口径一致。',
  profit: '利润 = 成交金额 − 本金。',
  avgTicket: '客单价 = 成交金额 ÷ 订单数。',
} as const

function formatLocalYmd(d: Date) {
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 比率展示为两位小数并带 % */
function formatRate(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value)))
    return '—'
  return `${Number(value).toFixed(2)}%`
}

function formatAmount(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value)))
    return '—'
  return Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const remarkDialogVisible = ref(false)
const remarkSaving = ref(false)
const remarkTarget = ref<TrafficChannelRow | null>(null)
const remarkDraft = ref('')

/** 正在 PATCH 状态的流量商 id，用于行内状态标签 loading */
const statusBusyId = ref<string | null>(null)

const createForm = reactive({
  code: '',
  name: '',
  remark: '',
  disabled: false,
  /** 同步创建 admin-liuliang 流量商数据后台登录账号 */
  createPortalAccount: true,
  portalUsername: '',
  portalPassword: '',
})

const editForm = reactive({
  id: '',
  name: '',
  remark: '',
  portalUsername: '',
  portalPassword: '',
})

/** 打开编辑弹窗时的账号密码快照，仅在实际变更时才提交 PATCH，避免误写 trafficPartners */
const editPortalBaseline = ref({ username: '', password: '' })

function promotionPathAndQuery(code: string) {
  return `/?channel=${encodeURIComponent(code)}`
}

function fullPromotionUrl(code: string) {
  const base = h5BaseForLink.value
  return base ? `${base}${promotionPathAndQuery(code)}` : promotionPathAndQuery(code)
}

/** HTTP / 受限环境无 Clipboard API 时仍能复制（需在点击回调里尽早同步执行 fallback） */
function copyTextViaExecCommand(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;'
    document.body.appendChild(ta)
    ta.focus({ preventScroll: true })
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  }
  catch {
    return false
  }
}

async function copyPromotionLink(code: string) {
  const full = fullPromotionUrl(code)
  let ok = false
  if (typeof window !== 'undefined' && window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(full)
      ok = true
    }
    catch {
      ok = copyTextViaExecCommand(full)
    }
  }
  else {
    ok = copyTextViaExecCommand(full)
  }

  if (ok) {
    ElMessage.success({
      message: '复制成功',
      /** 顶栏 .admin-header 高 64px，略微下移使绿条出现在内容区顶部 */
      offset: 72,
    })
  }
  else {
    ElMessage.error('复制失败，请手动复制')
  }
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  const yyyy = date.getFullYear()
  const mm = `${date.getMonth() + 1}`.padStart(2, '0')
  const dd = `${date.getDate()}`.padStart(2, '0')
  const hh = `${date.getHours()}`.padStart(2, '0')
  const min = `${date.getMinutes()}`.padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

/** POST/PATCH 成功后用接口返回的 data 写入列表（新建则插入首行） */
function applyTrafficChannelPatchRow(data: TrafficChannelRow) {
  const idx = rows.value.findIndex(r => r.id === data.id)
  if (idx >= 0)
    rows.value[idx] = { ...rows.value[idx], ...data }
  else
    rows.value = [data, ...rows.value]
}

async function fetchTrafficOverview() {
  loading.value = true
  statsLoading.value = true
  startPageProgress()
  errorMessage.value = ''
  statsErrorMessage.value = ''
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/traffic-channels/overview`, {
      method: 'GET',
      headers: withMallTenantHeaders(),
    })
    const payload = await response.json() as {
      success?: boolean
      msg?: string
      data?: {
        channels?: TrafficChannelRow[]
        portalStats?: TrafficPortalStatsRow[]
        oldCustomerSummary?: OldCustomerSummary
      }
    }
    if (!response.ok || payload.success === false) {
      const msg = apiErrorMessage(payload, '加载失败')
      if (response.status === 401 || response.status === 403) {
        throw new Error(`${msg} — 请重新登录`)
      }
      throw new Error(msg)
    }
    const data = payload.data
    rows.value = Array.isArray(data?.channels) ? data.channels : []
    statsRows.value = Array.isArray(data?.portalStats) ? data.portalStats : []
    oldCustomerSummary.value = data?.oldCustomerSummary ?? null
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载失败'
    statsErrorMessage.value = errorMessage.value
    rows.value = []
    statsRows.value = []
    oldCustomerSummary.value = null
    ElMessage.error(errorMessage.value)
  }
  finally {
    loading.value = false
    statsLoading.value = false
    donePageProgress()
  }
}

async function fetchDailyDisbursement() {
  const date = selectedDisbursementDate.value
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return
  }
  dailyDisbursementLoading.value = true
  dailyDisbursementErrorMessage.value = ''
  try {
    const qs = new URLSearchParams({ date })
    const response = await fetch(`${MALL_API_BASE}/admin/traffic-channels/daily-disbursement?${qs}`, {
      method: 'GET',
      headers: withMallTenantHeaders(),
    })
    const payload = await response.json() as {
      success?: boolean
      msg?: string
      data?: {
        date?: string
        rows?: DailyDisbursementRow[]
        summary?: DailyDisbursementSummary
      }
    }
    if (!response.ok || payload.success === false) {
      throw new Error(apiErrorMessage(payload, '加载放款统计失败'))
    }
    const data = payload.data
    dailyDisbursementRows.value = Array.isArray(data?.rows) ? data.rows : []
    dailyDisbursementSummary.value = data?.summary ?? null
    if (data?.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
      selectedDisbursementDate.value = data.date
    }
  }
  catch (error) {
    dailyDisbursementErrorMessage.value = error instanceof Error ? error.message : '加载放款统计失败'
    dailyDisbursementRows.value = []
    dailyDisbursementSummary.value = null
    ElMessage.error(dailyDisbursementErrorMessage.value)
  }
  finally {
    dailyDisbursementLoading.value = false
  }
}

async function refreshTrafficPage() {
  await Promise.all([fetchTrafficOverview(), fetchDailyDisbursement()])
}

function dailyDisbursementSummaryMethod(param: { columns: Array<{ property?: string }> }) {
  const { columns } = param
  const summary = dailyDisbursementSummary.value
  const sums: string[] = []
  columns.forEach((column, index) => {
    if (index === 0) {
      sums[index] = '合计'
      return
    }
    const prop = column.property
    if (!summary || !prop) {
      sums[index] = ''
      return
    }
    if (prop === 'orderCount') {
      sums[index] = String(summary.orderCount)
      return
    }
    if (prop === 'totalAmount' || prop === 'principal' || prop === 'profit' || prop === 'avgTicket') {
      sums[index] = formatAmount(summary[prop as keyof DailyDisbursementSummary] as number)
      return
    }
    sums[index] = ''
  })
  return sums
}

watch(selectedDisbursementDate, (next, prev) => {
  if (next === prev || !/^\d{4}-\d{2}-\d{2}$/.test(next)) {
    return
  }
  void fetchDailyDisbursement()
})

function syncPortalUsernameFromCode() {
  const code = createForm.code.trim()
  if (!code || createForm.portalUsername.trim()) {
    return
  }
  createForm.portalUsername = code
}

function openCreate() {
  showCreate.value = true
  createForm.code = ''
  createForm.name = ''
  createForm.remark = ''
  createForm.disabled = false
  createForm.createPortalAccount = true
  createForm.portalUsername = ''
  createForm.portalPassword = ''
  errorMessage.value = ''
}

function closeCreate() {
  if (submitting.value)
    return
  showCreate.value = false
}

function openEdit(row: TrafficChannelRow) {
  if (!canEditChannel.value && !canBindPortalAccount.value)
    return
  showEdit.value = true
  editForm.id = row.id
  editForm.name = row.name
  editForm.remark = row.remark || ''
  const portalUsername = row.portalAccount?.username || ''
  const portalPassword = row.portalAccount?.password || ''
  editForm.portalUsername = portalUsername
  editForm.portalPassword = portalPassword
  editPortalBaseline.value = { username: portalUsername, password: portalPassword }
  errorMessage.value = ''
}

function closeEdit() {
  if (submitting.value)
    return
  showEdit.value = false
}

async function submitCreate() {
  if (submitting.value)
    return
  syncPortalUsernameFromCode()
  const code = createForm.code.trim()
  const name = createForm.name.trim()
  if (!code || !name) {
    ElMessage.warning('请填写流量商标识与名称')
    return
  }
  if (canBindPortalAccount.value && createForm.createPortalAccount) {
    const portalUsername = createForm.portalUsername.trim()
    const portalPassword = createForm.portalPassword.trim()
    if (!portalUsername) {
      ElMessage.warning('请填写数据后台登录账号')
      return
    }
    if (portalPassword.length < 6) {
      ElMessage.warning('数据后台登录密码至少 6 位')
      return
    }
  }
  submitting.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/traffic-channels`, {
      method: 'POST',
      headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        code,
        name,
        remark: createForm.remark.trim(),
        disabled: createForm.disabled,
        createPortalAccount: canBindPortalAccount.value && createForm.createPortalAccount,
        ...(canBindPortalAccount.value
          ? { portalUsername: createForm.portalUsername.trim(), portalPassword: createForm.portalPassword.trim() }
          : {}),
      }),
    })
    const payload = await response.json() as {
      msg?: string
      success?: boolean
      data?: TrafficChannelRow & { portalAccount?: { username: string, merged?: boolean } }
    }
    if (!response.ok || payload.success === false) {
      throw new Error(apiErrorMessage(payload, '创建失败'))
    }
    const portal = payload.data?.portalAccount
    if (portal?.username) {
      ElMessage.success(
        portal.merged
          ? `流量商已创建；数据后台账号 ${portal.username} 已绑定本渠道`
          : `流量商已创建；数据后台账号 ${portal.username} 已开通`,
      )
    }
    else {
      ElMessage.success('流量商已创建')
    }
    showCreate.value = false
    if (payload.data)
      applyTrafficChannelPatchRow(payload.data)
    void refreshTrafficPage()
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '创建失败'
    ElMessage.error(errorMessage.value)
  }
  finally {
    submitting.value = false
  }
}

async function submitEdit() {
  if (!canEditChannel.value && !canBindPortalAccount.value)
    return
  if (submitting.value)
    return
  const name = editForm.name.trim()
  if (canEditChannel.value && !name) {
    ElMessage.warning('请填写名称')
    return
  }
  const portalUsername = editForm.portalUsername.trim()
  const portalPassword = editForm.portalPassword.trim()
  if (portalUsername && portalPassword.length < 6) {
    ElMessage.warning('数据后台登录密码至少 6 位')
    return
  }
  submitting.value = true
  errorMessage.value = ''
  try {
    const body: Record<string, string> = {}
    if (canEditChannel.value) {
      body.name = name
      body.remark = editForm.remark.trim()
    }
    const baseline = editPortalBaseline.value
    const portalChanged = portalUsername !== baseline.username
      || portalPassword !== baseline.password
    if (canBindPortalAccount.value && portalChanged && portalUsername) {
      body.portalUsername = portalUsername
      body.portalPassword = portalPassword
    }
    if (!Object.keys(body).length) {
      ElMessage.info('没有可保存的修改')
      submitting.value = false
      return
    }
    const response = await fetch(`${MALL_API_BASE}/admin/traffic-channels/${encodeURIComponent(editForm.id)}`, {
      method: 'PATCH',
      headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })
    const payload = await response.json() as { msg?: string; success?: boolean; data?: TrafficChannelRow }
    if (!response.ok || payload.success === false) {
      throw new Error(apiErrorMessage(payload, '保存失败'))
    }
    ElMessage.success('已保存')
    showEdit.value = false
    if (payload.data)
      applyTrafficChannelPatchRow(payload.data)
    void refreshTrafficPage()
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存失败'
    ElMessage.error(errorMessage.value)
  }
  finally {
    submitting.value = false
  }
}

async function toggleChannelDisabled(row: TrafficChannelRow) {
  if (!canToggleStatus.value)
    return
  if (statusBusyId.value === row.id)
    return
  const nextDisabled = !row.disabled
  statusBusyId.value = row.id
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/traffic-channels/${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ disabled: nextDisabled }),
    })
    const payload = await response.json() as { msg?: string; data?: TrafficChannelRow }
    if (!response.ok) {
      throw new Error(apiErrorMessage(payload, '操作失败'))
    }
    if (payload.data)
      applyTrafficChannelPatchRow(payload.data)
    ElMessage.success(nextDisabled ? '已停用' : '已启用')
  }
  catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  }
  finally {
    statusBusyId.value = null
  }
}

function openDelete(row: TrafficChannelRow) {
  deleteTarget.value = row
  showDeleteDialog.value = true
}

function closeDelete(opts?: { force?: boolean }) {
  const force = Boolean(opts?.force)
  if (!force && deleting.value)
    return
  showDeleteDialog.value = false
  deleteTarget.value = null
}

function openRemarkDialog(row: TrafficChannelRow) {
  if (!canRemark.value)
    return
  remarkTarget.value = row
  remarkDraft.value = typeof row.remark === 'string' ? row.remark : ''
  remarkDialogVisible.value = true
}

function resetRemarkDialog() {
  remarkDialogVisible.value = false
  remarkTarget.value = null
  remarkDraft.value = ''
}

function closeRemarkDialog() {
  if (remarkSaving.value)
    return
  resetRemarkDialog()
}

function remarkDialogBeforeClose(done: () => void) {
  if (remarkSaving.value)
    return
  remarkTarget.value = null
  remarkDraft.value = ''
  done()
}

async function saveChannelRemark() {
  if (!canRemark.value)
    return
  if (!remarkTarget.value || remarkSaving.value)
    return
  const row = remarkTarget.value
  remarkSaving.value = true
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/traffic-channels/${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ remark: remarkDraft.value.trim() }),
    })
    const payload = await response.json() as { msg?: string; success?: boolean; data?: TrafficChannelRow }
    if (!response.ok || payload.success === false) {
      throw new Error(apiErrorMessage(payload, '保存备注失败'))
    }
    ElMessage.success('备注已保存')
    resetRemarkDialog()
    if (payload.data)
      applyTrafficChannelPatchRow(payload.data)
  }
  catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存备注失败')
  }
  finally {
    remarkSaving.value = false
  }
}

async function doDelete() {
  const row = deleteTarget.value
  if (!row || deleting.value)
    return
  deleting.value = true
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/traffic-channels/${encodeURIComponent(row.id)}`, {
      method: 'DELETE',
      headers: withMallTenantHeaders(),
    })
    const payload = await response.json() as { msg?: string; success?: boolean }
    if (!response.ok || payload.success === false) {
      throw new Error(apiErrorMessage(payload, '删除失败'))
    }
    ElMessage.success('已删除')
    closeDelete({ force: true })
    const delId = row.id
    rows.value = rows.value.filter(r => r.id !== delId)
    void refreshTrafficPage()
  }
  catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
  finally {
    deleting.value = false
  }
}

onMounted(() => {
  void refreshTrafficPage()
})
</script>

<template>
  <div class="panel traffic-page">
    <el-alert
      v-if="showH5OriginDevHint"
      type="warning"
      :closable="false"
      show-icon
      class="traffic-h5-hint"
    >
      推广链接应指向<strong>商城 H5（shop）</strong>，不应等于本后台地址。本地默认已将后台
      <code class="traffic-code">5174</code>
      对应到商城
      <code class="traffic-code">5173</code>
      ；若你改了端口或仍有误，请在
      <code class="traffic-code">admin/.env.development</code>
      设置（示例，按实际商城地址修改）：
      <code class="traffic-code traffic-code--block">VITE_MALL_H5_ORIGIN=http://localhost:5173</code>
      保存后<strong>重启</strong>
      <code class="traffic-code">npm run dev</code>
      。
    </el-alert>

    <div class="toolbar">
      <button
        v-if="canCreateTraffic"
        class="btn btn-primary"
        type="button"
        :disabled="loading"
        @click="openCreate"
      >
        + 新建流量商
      </button>
      <button
        class="btn btn-refresh"
        type="button"
        :disabled="loading || statsLoading || dailyDisbursementLoading"
        @click="refreshTrafficPage"
      >
        刷新
      </button>
    </div>

    <el-alert
      v-if="errorMessage && !loading"
      type="error"
      :closable="false"
      show-icon
      class="traffic-error"
    >
      {{ errorMessage }}
    </el-alert>

    <div class="traffic-page-body">
      <section
        v-loading="dailyDisbursementLoading"
        class="traffic-section traffic-section--disbursement"
      >
        <header class="traffic-section__header">
          <div class="traffic-section__title-row">
            <span class="traffic-section__title">当日放款统计</span>
            <el-tag
              type="success"
              effect="plain"
              size="small"
            >
              按卡包发放日
            </el-tag>
          </div>
        </header>

        <div class="traffic-daily-disbursement-toolbar">
          <span class="traffic-daily-disbursement-toolbar__label">选择统计日期</span>
          <el-date-picker
            v-model="selectedDisbursementDate"
            class="traffic-daily-disbursement-date"
            type="date"
            value-format="YYYY-MM-DD"
            format="YYYY年MM月DD日"
            placeholder="请选择统计日期"
            :clearable="false"
            :disabled="dailyDisbursementLoading"
          />
        </div>

        <el-alert
          v-if="dailyDisbursementErrorMessage && !dailyDisbursementLoading"
          type="error"
          :closable="false"
          show-icon
          class="traffic-quality-error"
        >
          {{ dailyDisbursementErrorMessage }}
        </el-alert>

        <p class="traffic-section__intro">
          统计所选日期内<strong>完成卡包发放</strong>的订单，按买家<strong>注册渠道</strong>汇总（含复购，与下方引流首单口径分开；无渠道归属记为「商城注册」）。
          金额与利润计算与财务报表一致。
        </p>

        <div class="traffic-table-wrap">
          <el-table
            :data="dailyDisbursementRows"
            stripe
            border
            size="default"
            class="traffic-table traffic-daily-disbursement-table"
            :header-cell-style="tableHeaderCellStyle"
            show-summary
            :summary-method="dailyDisbursementSummaryMethod"
            empty-text=""
          >
            <template #empty>
              <el-empty
                description="所选日期暂无放款记录"
                :image-size="72"
              />
            </template>

            <el-table-column
              label="渠道名称"
              min-width="140"
              show-overflow-tooltip
            >
              <template #default="{ row }">
                <TrafficChannelNameTag
                  v-if="row.code"
                  :display-key="trafficChannelDisplayKey(undefined, row.name, row.code)"
                  :color-seed="row.code"
                  size="default"
                />
                <el-tag
                  v-else
                  type="info"
                  effect="plain"
                  class="traffic-mall-registration-tag"
                >
                  商城注册
                </el-tag>
              </template>
            </el-table-column>

            <el-table-column
              prop="orderCount"
              width="100"
              align="center"
            >
              <template #header>
                <span class="traffic-col-header">
                  订单数
                  <el-tooltip
                    :content="DAILY_DISBURSEMENT_TIPS.orderCount"
                    placement="top"
                    :show-after="300"
                  >
                    <el-icon class="traffic-col-header__tip" aria-label="订单数计算规则">
                      <QuestionFilled />
                    </el-icon>
                  </el-tooltip>
                </span>
              </template>
            </el-table-column>

            <el-table-column
              prop="totalAmount"
              min-width="120"
              align="right"
            >
              <template #header>
                <span class="traffic-col-header">
                  成交金额
                  <el-tooltip
                    :content="DAILY_DISBURSEMENT_TIPS.totalAmount"
                    placement="top"
                    :show-after="300"
                  >
                    <el-icon class="traffic-col-header__tip" aria-label="成交金额计算规则">
                      <QuestionFilled />
                    </el-icon>
                  </el-tooltip>
                </span>
              </template>
              <template #default="{ row }">
                {{ formatAmount(row.totalAmount) }}
              </template>
            </el-table-column>

            <el-table-column
              prop="principal"
              min-width="120"
              align="right"
            >
              <template #header>
                <span class="traffic-col-header">
                  本金
                  <el-tooltip
                    :content="DAILY_DISBURSEMENT_TIPS.principal"
                    placement="top"
                    :show-after="300"
                  >
                    <el-icon class="traffic-col-header__tip" aria-label="本金计算规则">
                      <QuestionFilled />
                    </el-icon>
                  </el-tooltip>
                </span>
              </template>
              <template #default="{ row }">
                {{ formatAmount(row.principal) }}
              </template>
            </el-table-column>

            <el-table-column
              prop="profit"
              min-width="120"
              align="right"
            >
              <template #header>
                <span class="traffic-col-header">
                  利润
                  <el-tooltip
                    :content="DAILY_DISBURSEMENT_TIPS.profit"
                    placement="top"
                    :show-after="300"
                  >
                    <el-icon class="traffic-col-header__tip" aria-label="利润计算规则">
                      <QuestionFilled />
                    </el-icon>
                  </el-tooltip>
                </span>
              </template>
              <template #default="{ row }">
                {{ formatAmount(row.profit) }}
              </template>
            </el-table-column>

            <el-table-column
              prop="avgTicket"
              min-width="120"
              align="right"
            >
              <template #header>
                <span class="traffic-col-header">
                  客单价
                  <el-tooltip
                    :content="DAILY_DISBURSEMENT_TIPS.avgTicket"
                    placement="top"
                    :show-after="300"
                  >
                    <el-icon class="traffic-col-header__tip" aria-label="客单价计算规则">
                      <QuestionFilled />
                    </el-icon>
                  </el-tooltip>
                </span>
              </template>
              <template #default="{ row }">
                {{ formatAmount(row.avgTicket) }}
              </template>
            </el-table-column>
          </el-table>
        </div>
      </section>

      <section
        v-loading="loading || statsLoading"
        class="traffic-section traffic-section--channels"
      >
        <header class="traffic-section__header">
          <div class="traffic-section__title-row">
            <span class="traffic-section__title">流量商</span>
            <el-checkbox
              v-model="whitelistStatsPositive"
              border
              size="small"
            >
              白名单（通过数大于 0）
            </el-checkbox>
            <el-tag
              v-if="rows.length"
              type="info"
              effect="plain"
              size="small"
            >
              共 {{ displayMergedRows.length }} / {{ rows.length }} 个
            </el-tag>
          </div>
        </header>

        <el-alert
          v-if="statsErrorMessage && !statsLoading"
          type="error"
          :closable="false"
          show-icon
          class="traffic-quality-error"
        >
          {{ statsErrorMessage }}
        </el-alert>

        <p class="traffic-section__intro traffic-quality-stats">
          当前展示 <strong>{{ displayMergedRows.length }}</strong> 家
          <template v-if="whitelistStatsPositive && rows.length !== displayMergedRows.length">
            （已过滤 {{ rows.length - displayMergedRows.length }} 家通过数为 0）
          </template>
          · 引流转化仅统计各渠道注册用户的<strong>首单</strong>，复购计入下方老客户汇总
        </p>

        <div class="traffic-table-wrap">
          <el-table
            :data="displayMergedRows"
            stripe
            border
            size="default"
            class="traffic-table traffic-unified-table"
            :header-cell-style="tableHeaderCellStyle"
            :highlight-current-row="true"
            :row-class-name="mergedRowClassName"
            empty-text=""
          >
          <template #empty>
            <el-empty
              :description="rows.length === 0 ? '暂无流量商，点击「新建流量商」添加' : (whitelistStatsPositive ? '无符合白名单条件的流量商' : '暂无数据')"
              :image-size="88"
            />
          </template>

        <el-table-column
          label="创建时间"
          width="156"
        >
          <template #default="{ row }">
            {{ formatDateTime(row.createdAt) }}
          </template>
        </el-table-column>

        <el-table-column
          label="流量商标识"
          min-width="108"
        >
          <template #default="{ row }">
            <el-tag
              type="info"
              effect="plain"
              class="code-tag"
            >
              {{ row.code }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column
          label="渠道名称"
          min-width="120"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            <TrafficChannelNameTag
              :display-key="trafficChannelDisplayKey(undefined, row.name, row.code)"
              :color-seed="row.code"
              size="default"
            />
          </template>
        </el-table-column>

        <el-table-column
          label="备注"
          min-width="140"
          class-name="traffic-remark-col"
        >
          <template #default="{ row }">
            <el-button
              v-if="canRemark"
              type="primary"
              link
              class="remark-table-trigger"
              :title="row.remark?.trim() ? '点击编辑备注' : '点击添加备注'"
              @click="openRemarkDialog(row)"
            >
              <span class="remark-cell">
                <span
                  class="remark-cell__icon-wrap"
                  aria-hidden="true"
                >
                  <el-icon
                    class="remark-cell__icon"
                    :class="row.remark?.trim() ? 'remark-cell__icon--edit' : 'remark-cell__icon--add'"
                    :size="17"
                  >
                    <EditPen v-if="row.remark?.trim()" />
                    <CirclePlus v-else />
                  </el-icon>
                </span>
                <span
                  class="remark-cell__text remark-preview"
                  :class="row.remark?.trim() ? 'remark-preview--filled' : 'remark-preview--empty'"
                >{{ row.remark?.trim() ? row.remark : '暂无备注' }}</span>
              </span>
            </el-button>
            <span
              v-else
              class="remark-cell__text remark-preview"
              :class="row.remark?.trim() ? 'remark-preview--filled' : 'remark-preview--empty'"
            >{{ row.remark?.trim() ? row.remark : '暂无备注' }}</span>
          </template>
        </el-table-column>

        <el-table-column
          label="状态"
          width="100"
          align="center"
        >
          <template #default="{ row }">
            <el-tooltip
              v-if="canToggleStatus"
              :content="row.disabled ? '点击启用' : '点击停用'"
              placement="top"
              :show-after="400"
            >
              <el-tag
                role="button"
                tabindex="0"
                :type="row.disabled ? 'info' : 'success'"
                effect="light"
                round
                size="small"
                class="status-tag-clickable"
                :class="{ 'status-tag-clickable--busy': statusBusyId === row.id }"
                @click="toggleChannelDisabled(row)"
                @keydown.enter.prevent="toggleChannelDisabled(row)"
                @keydown.space.prevent="toggleChannelDisabled(row)"
              >
                <el-icon
                  v-if="statusBusyId === row.id"
                  class="status-tag-clickable__spin"
                >
                  <Loading />
                </el-icon>
                <template v-else>
                  {{ row.disabled ? '已停用' : '启用' }}
                </template>
              </el-tag>
            </el-tooltip>
            <el-tag
              v-else
              :type="row.disabled ? 'info' : 'success'"
              effect="light"
              round
              size="small"
            >
              {{ row.disabled ? '已停用' : '启用' }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column
          label="推广链接"
          min-width="200"
        >
          <template #default="{ row }">
            <div class="link-cell">
              <el-tooltip
                :content="fullPromotionUrl(row.code)"
                placement="top"
                :show-after="300"
              >
                <el-text
                  class="link-cell__url"
                  truncated
                >
                  {{ fullPromotionUrl(row.code) }}
                </el-text>
              </el-tooltip>
              <el-button
                type="primary"
                link
                size="small"
                :icon="CopyDocument"
                @click="copyPromotionLink(row.code)"
              >
                复制
              </el-button>
            </div>
          </template>
        </el-table-column>

        <el-table-column
          width="88"
          align="center"
        >
          <template #header>
            <span class="traffic-col-header">
              点击数
              <el-tooltip
                :content="TRAFFIC_PORTAL_STAT_HEADER_TIPS.clickCount"
                placement="top"
                :show-after="300"
              >
                <el-icon
                  class="traffic-col-header__tip"
                  aria-label="点击数计算规则"
                >
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            {{ row.stats ? row.stats.clickCount : '—' }}
          </template>
        </el-table-column>

        <el-table-column
          width="88"
          align="center"
        >
          <template #header>
            <span class="traffic-col-header">
              注册数
              <el-tooltip
                :content="TRAFFIC_PORTAL_STAT_HEADER_TIPS.registerCount"
                placement="top"
                :show-after="300"
              >
                <el-icon
                  class="traffic-col-header__tip"
                  aria-label="注册数计算规则"
                >
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            {{ row.stats ? row.stats.registerCount : '—' }}
          </template>
        </el-table-column>

        <el-table-column
          width="88"
          align="center"
        >
          <template #header>
            <span class="traffic-col-header">
              申请数
              <el-tooltip
                :content="TRAFFIC_PORTAL_STAT_HEADER_TIPS.applicationCount"
                placement="top"
                :show-after="300"
              >
                <el-icon
                  class="traffic-col-header__tip"
                  aria-label="申请数计算规则"
                >
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            <span
              v-if="row.stats"
              class="traffic-stats-link-num"
            >{{ row.stats.applicationCount }}</span>
            <template v-else>
              —
            </template>
          </template>
        </el-table-column>

        <el-table-column
          width="88"
          align="center"
        >
          <template #header>
            <span class="traffic-col-header">
              通过数
              <el-tooltip
                :content="TRAFFIC_PORTAL_STAT_HEADER_TIPS.approvedCount"
                placement="top"
                :show-after="300"
              >
                <el-icon
                  class="traffic-col-header__tip"
                  aria-label="通过数计算规则"
                >
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            <span
              v-if="row.stats"
              class="traffic-stats-link-num"
            >{{ row.stats.approvedCount }}</span>
            <template v-else>
              —
            </template>
          </template>
        </el-table-column>

        <el-table-column
          width="88"
          align="center"
        >
          <template #header>
            <span class="traffic-col-header">
              逾期数
              <el-tooltip
                :content="TRAFFIC_PORTAL_STAT_HEADER_TIPS.overdueCount"
                placement="top"
                :show-after="300"
              >
                <el-icon
                  class="traffic-col-header__tip"
                  aria-label="逾期数计算规则"
                >
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            {{ row.stats ? row.stats.overdueCount : '—' }}
          </template>
        </el-table-column>

        <el-table-column
          width="96"
          align="center"
        >
          <template #header>
            <span class="traffic-col-header">
              注册率
              <el-tooltip
                :content="TRAFFIC_PORTAL_STAT_HEADER_TIPS.registerRate"
                placement="top"
                :show-after="300"
              >
                <el-icon
                  class="traffic-col-header__tip"
                  aria-label="注册率计算规则"
                >
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            {{ row.stats ? formatRate(row.stats.registerRate) : '—' }}
          </template>
        </el-table-column>

        <el-table-column
          width="96"
          align="center"
        >
          <template #header>
            <span class="traffic-col-header">
              申请率
              <el-tooltip
                :content="TRAFFIC_PORTAL_STAT_HEADER_TIPS.applicationRate"
                placement="top"
                :show-after="300"
              >
                <el-icon
                  class="traffic-col-header__tip"
                  aria-label="申请率计算规则"
                >
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            {{ row.stats ? formatRate(row.stats.applicationRate) : '—' }}
          </template>
        </el-table-column>

        <el-table-column
          width="96"
          align="center"
        >
          <template #header>
            <span class="traffic-col-header">
              通过率
              <el-tooltip
                :content="TRAFFIC_PORTAL_STAT_HEADER_TIPS.approvalRate"
                placement="top"
                :show-after="300"
              >
                <el-icon
                  class="traffic-col-header__tip"
                  aria-label="通过率计算规则"
                >
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            {{ row.stats ? formatRate(row.stats.approvalRate) : '—' }}
          </template>
        </el-table-column>

        <el-table-column
          width="96"
          align="center"
        >
          <template #header>
            <span class="traffic-col-header">
              逾期率
              <el-tooltip
                :content="TRAFFIC_PORTAL_STAT_HEADER_TIPS.overdueRate"
                placement="top"
                :show-after="300"
              >
                <el-icon
                  class="traffic-col-header__tip"
                  aria-label="逾期率计算规则"
                >
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            {{ row.stats ? formatRate(row.stats.overdueRate) : '—' }}
          </template>
        </el-table-column>

        <el-table-column
          width="108"
          align="center"
        >
          <template #header>
            <span class="traffic-col-header">
              注册转化率
              <el-tooltip
                :content="TRAFFIC_PORTAL_STAT_HEADER_TIPS.registrationConversionRate"
                placement="top"
                :show-after="300"
              >
                <el-icon
                  class="traffic-col-header__tip"
                  aria-label="注册转化率计算规则"
                >
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            {{ row.stats ? formatRate(row.stats.registrationConversionRate) : '—' }}
          </template>
        </el-table-column>

        <el-table-column
          width="108"
          align="center"
        >
          <template #header>
            <span class="traffic-col-header">
              申请转化率
              <el-tooltip
                :content="TRAFFIC_PORTAL_STAT_HEADER_TIPS.applicationConversionRate"
                placement="top"
                :show-after="300"
              >
                <el-icon
                  class="traffic-col-header__tip"
                  aria-label="申请转化率计算规则"
                >
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            {{ row.stats ? formatRate(row.stats.applicationConversionRate) : '—' }}
          </template>
        </el-table-column>

        <el-table-column
          v-if="showTrafficRowActions"
          label="操作"
          width="132"
          fixed="right"
          align="center"
        >
          <template #default="{ row }">
            <el-space
              :size="4"
              spacer="|"
            >
              <el-button
                v-if="canEditChannel || canBindPortalAccount"
                type="primary"
                link
                size="small"
                :icon="EditPen"
                @click="openEdit(row)"
              >
                {{ canEditChannel ? '编辑' : '绑定账号' }}
              </el-button>
              <el-button
                v-if="canDeleteTraffic"
                type="danger"
                link
                size="small"
                :icon="Delete"
                :disabled="row.registerCount > 0"
                :title="row.registerCount > 0 ? `已有 ${row.registerCount} 人通过该流量商注册，为保留统计归因不可删除；可先停用流量商` : '删除流量商'"
                @click="openDelete(row)"
              >
                删除
              </el-button>
            </el-space>
          </template>
        </el-table-column>
      </el-table>
        </div>
      </section>

      <section
        v-loading="statsLoading"
        class="traffic-section traffic-section--old-customer"
      >
        <header class="traffic-section__header">
          <div class="traffic-section__title-row">
            <span class="traffic-section__title">老客户汇总</span>
            <el-tag
              type="warning"
              effect="plain"
              size="small"
            >
              全平台 · 与引流首单分开
            </el-tag>
          </div>
        </header>

        <p class="traffic-section__intro">
          统计全平台<strong>老客户复购</strong>数据（下单时上一笔订单已发卡包且已全部还清）。
          不含各渠道注册用户的首单，首单转化见上方流量商表格。
        </p>

        <div
          v-if="oldCustomerSummary"
          class="traffic-old-customer-kpis"
        >
        <div class="traffic-old-customer-kpi">
          <span class="traffic-old-customer-kpi__label">
            复购人数
            <el-tooltip
              :content="OLD_CUSTOMER_SUMMARY_TIPS.userCount"
              placement="top"
              :show-after="300"
            >
              <el-icon class="traffic-col-header__tip" aria-label="复购人数计算规则">
                <QuestionFilled />
              </el-icon>
            </el-tooltip>
          </span>
          <strong class="traffic-old-customer-kpi__value">{{ oldCustomerSummary.userCount }}</strong>
        </div>
        <div class="traffic-old-customer-kpi">
          <span class="traffic-old-customer-kpi__label">
            下单数
            <el-tooltip
              :content="OLD_CUSTOMER_SUMMARY_TIPS.orderCount"
              placement="top"
              :show-after="300"
            >
              <el-icon class="traffic-col-header__tip" aria-label="下单数计算规则">
                <QuestionFilled />
              </el-icon>
            </el-tooltip>
          </span>
          <strong class="traffic-old-customer-kpi__value">{{ oldCustomerSummary.orderCount }}</strong>
        </div>
        <div class="traffic-old-customer-kpi">
          <span class="traffic-old-customer-kpi__label">
            通过数
            <el-tooltip
              :content="OLD_CUSTOMER_SUMMARY_TIPS.approvedCount"
              placement="top"
              :show-after="300"
            >
              <el-icon class="traffic-col-header__tip" aria-label="通过数计算规则">
                <QuestionFilled />
              </el-icon>
            </el-tooltip>
          </span>
          <strong class="traffic-old-customer-kpi__value traffic-old-customer-kpi__value--primary">{{ oldCustomerSummary.approvedCount }}</strong>
        </div>
        <div class="traffic-old-customer-kpi">
          <span class="traffic-old-customer-kpi__label">
            逾期数
            <el-tooltip
              :content="OLD_CUSTOMER_SUMMARY_TIPS.overdueCount"
              placement="top"
              :show-after="300"
            >
              <el-icon class="traffic-col-header__tip" aria-label="逾期数计算规则">
                <QuestionFilled />
              </el-icon>
            </el-tooltip>
          </span>
          <strong class="traffic-old-customer-kpi__value">{{ oldCustomerSummary.overdueCount }}</strong>
        </div>
        <div class="traffic-old-customer-kpi">
          <span class="traffic-old-customer-kpi__label">
            成交金额
            <el-tooltip
              :content="OLD_CUSTOMER_SUMMARY_TIPS.approvedAmount"
              placement="top"
              :show-after="300"
            >
              <el-icon class="traffic-col-header__tip" aria-label="成交金额计算规则">
                <QuestionFilled />
              </el-icon>
            </el-tooltip>
          </span>
          <strong class="traffic-old-customer-kpi__value">{{ formatAmount(oldCustomerSummary.approvedAmount) }}</strong>
        </div>
        <div class="traffic-old-customer-kpi">
          <span class="traffic-old-customer-kpi__label">
            通过率
            <el-tooltip
              :content="OLD_CUSTOMER_SUMMARY_TIPS.approvalRate"
              placement="top"
              :show-after="300"
            >
              <el-icon class="traffic-col-header__tip" aria-label="通过率计算规则">
                <QuestionFilled />
              </el-icon>
            </el-tooltip>
          </span>
          <strong class="traffic-old-customer-kpi__value">{{ formatRate(oldCustomerSummary.approvalRate) }}</strong>
        </div>
        <div class="traffic-old-customer-kpi">
          <span class="traffic-old-customer-kpi__label">
            逾期率
            <el-tooltip
              :content="OLD_CUSTOMER_SUMMARY_TIPS.overdueRate"
              placement="top"
              :show-after="300"
            >
              <el-icon class="traffic-col-header__tip" aria-label="逾期率计算规则">
                <QuestionFilled />
              </el-icon>
            </el-tooltip>
          </span>
          <strong class="traffic-old-customer-kpi__value">{{ formatRate(oldCustomerSummary.overdueRate) }}</strong>
        </div>
      </div>
        <el-empty
          v-else-if="!statsLoading"
          description="暂无老客户复购数据"
          :image-size="72"
        />
      </section>
    </div>

    <el-dialog
      v-model="showCreate"
      title="新建流量商"
      width="520px"
      destroy-on-close
      align-center
      class="traffic-dialog"
      @close="closeCreate"
    >
      <el-form
        label-position="top"
        class="traffic-form"
        @submit.prevent
      >
        <el-form-item
          label="流量商标识"
          required
        >
          <el-input
            v-model="createForm.code"
            placeholder="2～40 位，如 liuliang1"
            maxlength="40"
            show-word-limit
            clearable
            @blur="syncPortalUsernameFromCode"
          />
        </el-form-item>
        <el-form-item
          label="名称"
          required
        >
          <el-input
            v-model="createForm.name"
            placeholder="显示名称"
            clearable
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="createForm.remark"
            type="textarea"
            :rows="3"
            placeholder="选填"
            maxlength="200"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="创建后停用">
          <el-switch
            v-model="createForm.disabled"
            inline-prompt
            active-text="停"
            inactive-text="启"
          />
        </el-form-item>
        <el-form-item label="开通登录账号">
          <el-switch v-model="createForm.createPortalAccount" />
        </el-form-item>
        <template v-if="canBindPortalAccount && createForm.createPortalAccount">
          <el-form-item
            label="登录账号"
            required
          >
            <el-input
              v-model="createForm.portalUsername"
              placeholder="默认可与流量商标识相同"
              maxlength="40"
              clearable
              @blur="syncPortalUsernameFromCode"
            />
          </el-form-item>
          <el-form-item
            label="登录密码"
            required
          >
            <el-input
              v-model="createForm.portalPassword"
              type="password"
              placeholder="至少 6 位"
              show-password
              maxlength="64"
              autocomplete="new-password"
            />
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="closeCreate">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="submitting"
          @click="submitCreate"
        >
          创建
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showEdit"
      title="编辑流量商"
      width="520px"
      destroy-on-close
      align-center
      class="traffic-dialog"
      @close="closeEdit"
    >
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        class="dialog-tip"
      >
        流量商标识不可修改；可编辑名称、备注及数据后台登录账号。
      </el-alert>
      <el-form
        label-position="top"
        class="traffic-form"
        @submit.prevent
      >
        <el-form-item
          label="名称"
          required
        >
          <el-input
            v-model="editForm.name"
            :disabled="!canEditChannel"
            clearable
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="editForm.remark"
            type="textarea"
            :disabled="!canEditChannel"
            :rows="3"
            placeholder="选填"
            maxlength="200"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="登录账号">
          <el-input
            v-model="editForm.portalUsername"
            :disabled="!canBindPortalAccount"
            placeholder="数据后台登录账号，未开通可留空"
            maxlength="40"
            clearable
          />
        </el-form-item>
        <el-form-item label="登录密码">
          <el-input
            v-model="editForm.portalPassword"
            :disabled="!canBindPortalAccount"
            placeholder="至少 6 位，明文显示"
            maxlength="64"
            autocomplete="off"
          />
        </el-form-item>
        <el-alert
          type="info"
          :closable="false"
          show-icon
          class="dialog-tip dialog-tip--compact"
        >
          启用 / 停用请在列表「状态」列点击标签切换。
        </el-alert>
      </el-form>
      <template #footer>
        <el-button @click="closeEdit">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="submitting"
          @click="submitEdit"
        >
          保存
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="remarkDialogVisible"
      title="流量商备注"
      width="480px"
      destroy-on-close
      align-center
      class="traffic-dialog"
      :close-on-click-modal="!remarkSaving"
      :close-on-press-escape="!remarkSaving"
      :before-close="remarkDialogBeforeClose"
    >
      <p
        v-if="remarkTarget"
        class="remark-dialog-hint"
      >
        {{ remarkTarget.name }}
        <el-tag
          type="info"
          effect="plain"
          size="small"
          class="remark-dialog-code"
        >
          {{ remarkTarget.code }}
        </el-tag>
      </p>
      <el-input
        v-model="remarkDraft"
        type="textarea"
        :rows="4"
        maxlength="200"
        show-word-limit
        placeholder="请输入添加备注"
        :disabled="remarkSaving"
      />
      <template #footer>
        <el-button
          :disabled="remarkSaving"
          @click="closeRemarkDialog"
        >
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="remarkSaving"
          @click="saveChannelRemark"
        >
          保存
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showDeleteDialog"
      title="删除流量商"
      width="420px"
      align-center
      @close="() => closeDelete()"
    >
      <p class="delete-confirm-text">
        确定删除「{{ deleteTarget?.name }}」？
      </p>
      <el-alert
        v-if="deleteTarget && deleteTarget.registerCount > 0"
        type="error"
        :closable="false"
        show-icon
      >
        该流量商已有注册记录，无法删除。
      </el-alert>
      <template #footer>
        <el-button @click="() => closeDelete()">
          取消
        </el-button>
        <el-button
          type="danger"
          :disabled="!deleteTarget || deleteTarget.registerCount > 0"
          :loading="deleting"
          @click="doDelete"
        >
          删除
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.traffic-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  max-width: 100%;
  overflow: hidden;
}

.traffic-page-body {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: #fff;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}

.traffic-section {
  padding: 16px 18px 18px;
  min-width: 0;
}

.traffic-section + .traffic-section {
  border-top: 1px solid var(--el-border-color-lighter);
}

.traffic-section__header {
  margin-bottom: 12px;
}

.traffic-section__title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.traffic-section__title {
  font-weight: 600;
  font-size: 15px;
  color: var(--el-text-color-primary);
}

.traffic-section__intro {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--el-text-color-secondary);
}

.traffic-alert {
  margin-bottom: 16px;
  border-radius: 8px;
}

.traffic-h5-hint {
  margin-bottom: 16px;
  border-radius: 8px;
}

.traffic-h5-hint :deep(.el-alert__description),
.traffic-h5-hint .traffic-code--block {
  display: block;
  margin-top: 8px;
  word-break: break-all;
}

.traffic-alert__title {
  font-weight: 600;
}

.traffic-alert__body {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.traffic-code {
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(139, 107, 74, 0.1);
  font-size: 12px;
  font-family: ui-monospace, monospace;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
}

.btn {
  height: 30px;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  background: #fff;
  cursor: pointer;
  padding: 0 10px;
  font-size: 14px;
}

.btn-primary {
  border-color: #2563eb;
  background: #2563eb;
  color: #fff;
}

.btn-refresh {
  border-color: #d1d5db;
  background: #fff;
  color: #374151;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.traffic-error {
  margin-bottom: 12px;
  border-radius: 8px;
}

.traffic-table-wrap {
  min-height: 80px;
  max-width: 100%;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}

.traffic-table {
  width: 100%;
  min-width: 1520px;
}

.traffic-table :deep(.el-table__row:hover > td) {
  background-color: var(--el-fill-color-lighter) !important;
}

.code-tag {
  font-family: ui-monospace, monospace;
  font-weight: 500;
}

.link-cell {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: 100%;
}

.link-cell__url {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.dialog-tip {
  margin-bottom: 16px;
  border-radius: 8px;
}

.dialog-tip--compact {
  margin-top: 8px;
  margin-bottom: 0;
}

.status-tag-clickable {
  cursor: pointer;
  user-select: none;
  transition: opacity 0.15s ease, transform 0.12s ease;
}

.status-tag-clickable:hover:not(.status-tag-clickable--busy) {
  filter: brightness(0.97);
}

.status-tag-clickable:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.status-tag-clickable--busy {
  cursor: wait;
  pointer-events: none;
  opacity: 0.88;
}

.status-tag-clickable__spin {
  display: block;
  font-size: 14px;
  animation: traffic-status-spin 0.9s linear infinite;
}

@keyframes traffic-status-spin {
  to {
    transform: rotate(360deg);
  }
}

.traffic-form {
  padding-top: 4px;
}

.delete-confirm-text {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.panel :deep(.traffic-dialog .el-dialog__body) {
  padding-top: 8px;
}

.panel :deep(.traffic-table .el-table__cell) {
  vertical-align: middle;
}

.panel :deep(.traffic-table .traffic-remark-col) {
  vertical-align: top;
}

.remark-dialog-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.remark-dialog-code {
  font-family: ui-monospace, monospace;
}

.remark-preview {
  margin: 0;
  line-height: 1.45;
  max-height: 4.35em;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
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

.remark-table-trigger {
  height: auto;
  padding: 2px 6px 2px 2px;
  margin: 0;
  justify-content: flex-start;
  max-width: 100%;
  font-weight: inherit;
}

.remark-table-trigger :deep(.el-button__inner) {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  width: 100%;
  min-width: 0;
}

.remark-table-trigger:hover .remark-cell__icon--add {
  color: #047857;
}

.remark-table-trigger:hover .remark-cell__icon--edit {
  color: #475569;
}

.traffic-quality-intro {
  margin-bottom: 12px;
  border-radius: 8px;
}

.traffic-quality-intro__p {
  margin: 0 0 6px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--el-text-color-regular);
}

.traffic-quality-intro__p--last {
  margin-bottom: 0;
}

.traffic-quality-error {
  margin-bottom: 12px;
  border-radius: 8px;
}

.traffic-quality-stats {
  margin: 0 0 10px;
}

.traffic-quality-stats strong {
  color: var(--el-text-color-primary);
}

.traffic-stats-link-num {
  color: var(--el-color-primary);
  font-weight: 500;
}

.traffic-col-header {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  line-height: 1.2;
}

.traffic-col-header__tip {
  font-size: 14px;
  color: var(--el-text-color-secondary);
  cursor: help;
}

.traffic-col-header__tip:hover {
  color: var(--el-color-primary);
}

.traffic-unified-table :deep(.traffic-quality-row--muted) {
  opacity: 0.78;
}

.traffic-old-customer-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
  min-width: 0;
  max-width: 100%;
}

.traffic-old-customer-kpi {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-lighter);
}

.traffic-old-customer-kpi__label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.traffic-old-customer-kpi__value {
  font-size: 22px;
  line-height: 1.2;
  color: var(--el-text-color-primary);
}

.traffic-old-customer-kpi__value--primary {
  color: var(--el-color-primary);
}

.traffic-daily-disbursement-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.traffic-daily-disbursement-toolbar__label {
  font-size: 14px;
  color: var(--el-text-color-regular);
}

.traffic-daily-disbursement-date {
  width: 200px;
}

.traffic-daily-disbursement-table {
  min-width: 720px;
}

.traffic-mall-registration-tag {
  font-weight: 500;
}
</style>
