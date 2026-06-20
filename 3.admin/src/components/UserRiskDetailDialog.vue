<script setup lang="ts">
import { CircleCheck, CircleClose, DataAnalysis, Minus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, ref, watch } from 'vue'
import { apiErrorMessage, withMallTenantHeaders } from '../composables/useAdminApi'
import { getAdminSession, isSuperAdminRole } from '../composables/useAdminAuth'
import UserRegistrationInfoScroll, { type OrderShippingSnapshot } from './UserRegistrationInfoScroll.vue'
import RadarV4FactsPanel from './RadarV4FactsPanel.vue'
import {
  INSTALLMENT_ORDER_RISK_STEP_KEYS,
  INSTALLMENT_ORDER_RISK_STEP_LABELS,
} from '../constants/installmentOrderRisk'
import type { OrderRiskDetail, RiskDetailRule } from '../stores/useOrdersStore'
import { getRiskFactLines, type RiskFactLine } from '../utils/riskRowFactLines'
import { resolveMallCreditQuota } from '../utils/mallCreditQuota'

export interface RiskProductRow {
  slotKey: string
  productLabel: string
  state: 'ok' | 'fail' | 'skipped'
  skippedReason?: string
  httpStatus?: number
  error?: string
  rawResponse?: unknown
}

export interface RadarV4HistoryEntry {
  fetchedAt: string
  row: RiskProductRow
}

export interface UserRiskSnapshot {
  configured: boolean
  simulated?: boolean
  passed: boolean
  checkedAt: string
  summaryMessage?: string
  fourteenRows: RiskProductRow[]
  /** 管理端手动调取全景雷达的历史记录（新条目在前） */
  radarV4History?: RadarV4HistoryEntry[]
}

export interface ApiRiskView {
  snapshot: UserRiskSnapshot | null
  templateRows: RiskProductRow[]
  upstreamConfigured: boolean
}

/** 与 api/src/riskControl/RISK_FOURTEEN_SLOTS.md 一致：管理端卡片分组与排序 */
interface RiskSlotCategoryDef {
  id: string
  title: string
  subtitle: string
  slotKeys: string[]
}

const RISK_SLOT_CATEGORY_GROUPS: RiskSlotCategoryDef[] = [
  {
    id: 'A',
    title: 'A 类 · 仅需手机或「姓名 + 手机」',
    subtitle: '不依赖身份证号即可联调：运营商二要素、在网时长、运营商状态。',
    slotKeys: ['mobile2', 'ds_phone_time', 'ds_phone_state'],
  },
  {
    id: 'B',
    title: 'B 类 · 实名三要素（姓名 + 身份证 + 手机）',
    subtitle: '档案需补齐三项：法院、被执行人、三要素比对、探针、全景雷达、人脸认证等；人脸认证在管理端固定为「跳过」展示，不单槽手动查询。',
    slotKeys: [
      'court_detail_pro',
      'execution_pro',
      'personal3',
      'probe_c_enc',
      'radar_v4_enc',
      'auth_person_face',
    ],
  },
  {
    id: 'C',
    title: 'C 类 · 额外资料或业务条件',
    subtitle: '身份证 OCR、短信、物流、合同等依赖业务动作；管理端仅展示档案快照，不单槽手动查询（界面固定为「跳过」）。',
    slotKeys: ['id_card_ocr', 'cl_sms_send', 'cl_sms_notify', 'logistics', 'create_contract'],
  },
]

const RISK_SLOT_DISPLAY_ORDER = RISK_SLOT_CATEGORY_GROUPS.flatMap(g => g.slotKeys)

function orderRiskRowsForDisplay(rows: RiskProductRow[]): RiskProductRow[] {
  if (!Array.isArray(rows) || rows.length !== RISK_SLOT_DISPLAY_ORDER.length) {
    return rows
  }
  const byKey = new Map(rows.map(r => [r.slotKey, r]))
  const ordered = RISK_SLOT_DISPLAY_ORDER.map(k => byKey.get(k)).filter(Boolean) as RiskProductRow[]
  return ordered.length === RISK_SLOT_DISPLAY_ORDER.length ? ordered : rows
}

const RISK_CATEGORY_C_SLOT_KEYS = new Set(
  RISK_SLOT_CATEGORY_GROUPS.find(g => g.id === 'C')?.slotKeys ?? [],
)

/** C 类 + 人脸：不提供「手动查询」 */
const RISK_SLOTS_MANUAL_QUERY_DISABLED = new Set<string>([
  ...RISK_CATEGORY_C_SLOT_KEYS,
  'auth_person_face',
])

function riskSlotManualQueryEnabled(slotKey: string): boolean {
  return !RISK_SLOTS_MANUAL_QUERY_DISABLED.has(String(slotKey || '').trim())
}

export interface UserItem {
  id: string
  name: string
  phone: string
  quota: number
  orderCount: number
  totalAmount: number
  locationText: string
  registerAt: string
  /** 最近一笔已计入口径的订单创建时间 ISO（GET /users 等由服务端计算） */
  lastOrderAt?: string
  idCardFront: string
  idCardBack: string
  idCardHandheld: string
  /** 18 位身份证号码（风控、下单用） */
  idNumber?: string
  creditStatus: '良好' | '待风控' | '风险'
  /** 库内风控快照（管理端列表/详情接口可能返回） */
  riskControlSnapshot?: UserRiskSnapshot | null
  riskUpstreamConfigured?: boolean
  /** 管理端 GET 用户详情时可能返回，供列表/编辑回显 */
  adminPasswordPlain?: string
  /** 仅管理端：内部备注 */
  adminRemark?: string
  /** 仅管理端写入；商城接口仅返回布尔结果供前端拦截下单 */
  orderBlacklisted?: boolean
  /** 注册渠道（与 UsersPage 用户预览一致） */
  registerChannelCode?: string
  registerChannelName?: string
  registerChannelLabel?: string
  /** 两位紧急联系人 */
  emergencyContacts?: Array<{ name: string, phone: string }>
}

interface ApiUserItem {
  id: string
  name: string
  phone: string
  quota?: number
  orderCount?: number
  totalAmount?: number
  lastOrderAt?: string
  locationText: string
  registerAt?: string
  idCardFront: string
  idCardBack: string
  idCardHandheld: string
  creditStatus?: UserItem['creditStatus']
  idNumber?: string
  riskControlSnapshot?: UserRiskSnapshot | null
  riskUpstreamConfigured?: boolean
  adminPasswordPlain?: string
  adminRemark?: string
  registerChannelCode?: string
  registerChannelName?: string
  registerChannelLabel?: string
  emergencyContacts?: Array<{ name?: string, phone?: string }>
}

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

const props = withDefaults(defineProps<{
  modelValue: boolean
  userId: string | null
  /** 为 true 时隐藏「基本信息」页签（仅保留下单七项、雷达风控），并默认打开下单七项。 */
  hideBasicInfoTab?: boolean
  /**
   * 从订单列表打开时传入该单收货人姓名、电话、地址，在用户注册信息中展示收货区块；
   * 不传则不展示该区块。
   */
  contextOrderShipping?: OrderShippingSnapshot | null
}>(), {
  hideBasicInfoTab: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  userUpdated: [user: UserItem]
}>()

const selectedUserForRisk = ref<UserItem | null>(null)
const displayedUserRiskDetail = ref<OrderRiskDetail | null>(null)
const riskDialogBootLoading = ref(false)
const fullRiskCheckLoading = ref(false)
const userRiskError = ref('')
const manualRiskSlotLoading = ref<string | null>(null)
const userRiskSnapshot = ref<UserRiskSnapshot | null>(null)
type RiskDialogMainTab = 'basic' | 'order7' | 'radar'
const riskDialogMainTab = ref<RiskDialogMainTab>('basic')

function buildRiskSnapshotFromView(rv: ApiRiskView): UserRiskSnapshot {
  const snap = rv.snapshot
  const upstreamLive = rv.upstreamConfigured
  /** 接口 templateRows 恒为 14 条占位；将库内 fourteenRows（可少于 14）按 slotKey 覆盖到对应槽位，避免「只测过几项却整表变空」 */
  const template = Array.isArray(rv.templateRows) && rv.templateRows.length === 14
    ? rv.templateRows.map(r => ({ ...r }))
    : []
  if (template.length === 14 && snap && Array.isArray(snap.fourteenRows)) {
    for (const pr of snap.fourteenRows) {
      if (!pr || typeof pr !== 'object' || !pr.slotKey)
        continue
      const idx = template.findIndex(b => b.slotKey === pr.slotKey)
      if (idx >= 0)
        template[idx] = { ...pr }
    }
  }
  const rowsOrdered = template.length === 14
    ? orderRiskRowsForDisplay(template)
    : (snap && Array.isArray(snap.fourteenRows) && snap.fourteenRows.length === 14
      ? orderRiskRowsForDisplay(snap.fourteenRows)
      : orderRiskRowsForDisplay(snap?.fourteenRows || []))
  const anyFail = rowsOrdered.some(r => r.state === 'fail')
  return {
    configured: upstreamLive,
    simulated: false,
    passed: typeof snap?.passed === 'boolean' ? snap.passed : !anyFail,
    checkedAt: snap?.checkedAt ? String(snap.checkedAt) : '',
    summaryMessage: snap?.summaryMessage ? String(snap.summaryMessage) : '',
    fourteenRows: rowsOrdered,
    radarV4History: Array.isArray(snap?.radarV4History) ? snap.radarV4History : undefined,
  }
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

function formatRiskFactsPlain(row: RiskProductRow): string {
  const lines = getRiskFactLines(row)
  if (!lines.length) return ''
  return lines.map(l => `${l.label}：${l.value}`).join('；')
}

interface RiskSlotCardItem {
  globalIdx: number
  slotKey: string
  row: RiskProductRow
  facts: RiskFactLine[]
}

/** 先享后付下单实际写入档案的 7 项接口卡片（扁平，无 A/B/C 分组） */
const orderSevenCardItems = computed((): RiskSlotCardItem[] => {
  const rows = userRiskSnapshot.value?.fourteenRows
  const byKey = new Map(Array.isArray(rows) ? rows.map(r => [r.slotKey, r]) : [])
  let globalIdx = 0
  return INSTALLMENT_ORDER_RISK_STEP_KEYS.map((slotKey) => {
    globalIdx += 1
    const row = byKey.get(slotKey)
    if (!row) {
      const fallback: RiskProductRow = {
        slotKey,
        productLabel: INSTALLMENT_ORDER_RISK_STEP_LABELS[slotKey],
        state: 'skipped',
        skippedReason: '库内快照暂无该项调用记录',
      }
      return { globalIdx, slotKey, row: fallback, facts: [] as RiskFactLine[] }
    }
    return {
      globalIdx,
      slotKey,
      row,
      facts: getRiskFactLines(row),
    }
  })
})

/** 「雷达风控」Tab：全景雷达槽位展示（与下单七项分离） */
const radarV4CardItem = computed((): RiskSlotCardItem => {
  const rows = userRiskSnapshot.value?.fourteenRows
  const row = Array.isArray(rows) ? rows.find(r => r.slotKey === 'radar_v4_enc') : undefined
  if (row) {
    return { globalIdx: 1, slotKey: 'radar_v4_enc', row, facts: getRiskFactLines(row) }
  }
  return {
    globalIdx: 1,
    slotKey: 'radar_v4_enc',
    row: {
      slotKey: 'radar_v4_enc',
      productLabel: '全景雷达-MD5',
      state: 'skipped',
      skippedReason: '档案中尚无全景雷达数据，可点击下方按钮单独调用并写回快照',
    },
    facts: [],
  }
})

interface RadarV4DisplayEntry {
  id: string
  fetchedAt: string
  fetchedAtLabel: string
  row: RiskProductRow
  facts: RiskFactLine[]
  isLegacy?: boolean
}

const RADAR_V4_HISTORY_MAX = 30

function radarV4RowContentKey(row: RiskProductRow): string {
  try {
    return JSON.stringify({
      state: row.state,
      error: row.error ?? '',
      httpStatus: row.httpStatus ?? null,
      rawResponse: row.rawResponse ?? null,
    })
  }
  catch {
    return `${row.state}-${row.error ?? ''}`
  }
}

function cloneRadarV4HistoryEntries(entries: RadarV4HistoryEntry[] | undefined): RadarV4HistoryEntry[] {
  if (!Array.isArray(entries)) {
    return []
  }
  return entries
    .filter(h => h && h.row && h.fetchedAt)
    .map(h => ({
      fetchedAt: String(h.fetchedAt),
      row: { ...h.row },
    }))
}

/** 前端兜底：后端未归档旧快照时，合并本地历史 + 本次结果 */
function mergeRadarV4HistoryAfterManualFetch(
  prevSnap: UserRiskSnapshot | null,
  incoming: UserRiskSnapshot,
): UserRiskSnapshot {
  const prevHist = cloneRadarV4HistoryEntries(prevSnap?.radarV4History)
  const nextHist = cloneRadarV4HistoryEntries(incoming.radarV4History)
  if (nextHist.length > prevHist.length) {
    return { ...incoming, radarV4History: nextHist }
  }

  const latestRow = incoming.fourteenRows.find(r => r.slotKey === 'radar_v4_enc')
  if (!latestRow) {
    return incoming
  }

  const fetchedAt = incoming.checkedAt || new Date().toISOString()
  const merged = cloneRadarV4HistoryEntries([
    { fetchedAt, row: { ...latestRow } },
    ...prevHist,
  ])

  const prevRow = prevSnap?.fourteenRows?.find(r => r.slotKey === 'radar_v4_enc')
  const prevKey = prevRow && prevRow.state !== 'skipped' ? radarV4RowContentKey(prevRow) : ''
  const newKey = radarV4RowContentKey(latestRow)
  if (prevRow && prevKey && prevKey !== newKey) {
    const archived = merged.some(item => radarV4RowContentKey(item.row) === prevKey)
    if (!archived) {
      const seedAt = prevSnap?.checkedAt || fetchedAt
      merged.splice(1, 0, { fetchedAt: seedAt, row: { ...prevRow } })
    }
  }

  const deduped: RadarV4HistoryEntry[] = []
  const seen = new Set<string>()
  for (const item of merged) {
    const key = `${item.fetchedAt}::${radarV4RowContentKey(item.row)}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    deduped.push(item)
    if (deduped.length >= RADAR_V4_HISTORY_MAX) {
      break
    }
  }

  return { ...incoming, radarV4History: deduped }
}

/** 雷达历史展示项：读 radarV4History；无历史时回退展示档案最新一条（只读） */
const radarV4HistoryDisplayItems = computed((): RadarV4DisplayEntry[] => {
  const snap = userRiskSnapshot.value
  if (!snap) {
    return []
  }

  const items: RadarV4DisplayEntry[] = []
  const seen = new Set<string>()

  const pushEntry = (
    fetchedAt: string,
    row: RiskProductRow,
    opts?: { isLegacy?: boolean },
  ) => {
    const dedupeKey = `${fetchedAt}::${radarV4RowContentKey(row)}`
    if (seen.has(dedupeKey)) {
      return
    }
    seen.add(dedupeKey)
    items.push({
      id: `radar-hist-${items.length}-${dedupeKey.slice(0, 48)}`,
      fetchedAt,
      fetchedAtLabel: opts?.isLegacy
        ? `${formatDateTime(fetchedAt)}（档案快照）`
        : formatDateTime(fetchedAt),
      row,
      facts: getRiskFactLines(row),
      isLegacy: opts?.isLegacy,
    })
  }

  for (const h of cloneRadarV4HistoryEntries(snap.radarV4History)) {
    pushEntry(h.fetchedAt, h.row)
  }

  if (items.length === 0) {
    const latestRow = snap.fourteenRows?.find(r => r.slotKey === 'radar_v4_enc')
    if (latestRow && latestRow.state !== 'skipped') {
      pushEntry(snap.checkedAt || '', latestRow, { isLegacy: true })
    }
  }

  items.sort((a, b) => {
    const ta = new Date(a.fetchedAt).getTime()
    const tb = new Date(b.fetchedAt).getTime()
    const aValid = Number.isFinite(ta)
    const bValid = Number.isFinite(tb)
    if (aValid && bValid && ta !== tb) {
      return tb - ta
    }
    if (aValid !== bValid) {
      return aValid ? -1 : 1
    }
    return 0
  })

  return items.map((item, index) => ({
    ...item,
    id: `radar-hist-${index}-${item.fetchedAt}-${radarV4RowContentKey(item.row).slice(0, 24)}`,
  }))
})

const radarHistoryExpanded = ref<string[]>([])

watch(
  () => radarV4HistoryDisplayItems.value[0]?.id,
  (id) => {
    if (id) {
      radarHistoryExpanded.value = [id]
    }
  },
  { immediate: true },
)

function findFourteenRowForBasic(rows: RiskProductRow[] | undefined, slotKey: string): RiskProductRow | null {
  if (!Array.isArray(rows)) {
    return null
  }
  return rows.find(r => r.slotKey === slotKey) || null
}

type DisplayCreditStatusBasic = '良好' | '待风控' | '风险'

/** 与 UsersPage 一致：仅看先享后付下单七项；任一项 fail→风险，七项均为 ok→良好，否则待风控 */
function displayCreditFromSnapshotBasic(snapshot: UserRiskSnapshot | null): DisplayCreditStatusBasic {
  if (!snapshot || !Array.isArray(snapshot.fourteenRows)) {
    return '待风控'
  }
  for (const key of INSTALLMENT_ORDER_RISK_STEP_KEYS) {
    const row = findFourteenRowForBasic(snapshot.fourteenRows, key)
    if (row?.state === 'fail') {
      return '风险'
    }
  }
  for (const key of INSTALLMENT_ORDER_RISK_STEP_KEYS) {
    const row = findFourteenRowForBasic(snapshot.fourteenRows, key)
    if (!row || row.state !== 'ok') {
      return '待风控'
    }
  }
  return '良好'
}

const riskBasicCanSeePasswordRow = computed(() => isSuperAdminRole(getAdminSession()?.role))

function truncateText(s: string, max: number) {
  if (s.length <= max) {
    return s
  }
  return `${s.slice(0, max)}…`
}

function buildUserRiskDetailFromSnapshot(user: UserItem, snap: UserRiskSnapshot): OrderRiskDetail {
  const rawOrdered = orderRiskRowsForDisplay(snap.fourteenRows || [])
  const byKey = new Map(rawOrdered.map(r => [r.slotKey, r]))
  const sevenRows: RiskProductRow[] = INSTALLMENT_ORDER_RISK_STEP_KEYS.map((slotKey) => {
    const row = byKey.get(slotKey)
    if (row)
      return { ...row }
    return {
      slotKey,
      productLabel: INSTALLMENT_ORDER_RISK_STEP_LABELS[slotKey],
      state: 'skipped',
      skippedReason: '库内快照暂无该项调用记录',
    }
  })

  const okCount = sevenRows.filter(r => r.state === 'ok').length
  const failCount = sevenRows.filter(r => r.state === 'fail').length
  const testedCount = okCount + failCount

  let decision = '尚未写入先享后付下单七项接口的实测结果'
  let riskStatus: 'passed' | 'failed' = 'passed'
  if (testedCount === 0) {
    decision = '尚无成功或失败记录（打开时已加载库内档案；可点「手动查询」或标题旁「一键查询七项」）'
    riskStatus = 'passed'
  }
  else if (failCount > 0) {
    decision = `七项中 ${testedCount} 项已有结论：${failCount} 项失败、${okCount} 项成功`
    riskStatus = 'failed'
  }
  else {
    decision = `七项中 ${testedCount} 项已有结论，均为成功`
    riskStatus = 'passed'
  }

  const rules: RiskDetailRule[] = sevenRows.map((row, idx) => ({
    code: `INF-${String(idx + 1).padStart(2, '0')}`,
    name: row.productLabel,
    hit: row.state === 'fail',
    scoreImpact: row.state === 'fail' ? 12 : 0,
    slotKey: row.slotKey,
    rowState: row.state,
    httpStatus: row.httpStatus ?? null,
    skippedReason: row.skippedReason,
    error: row.error,
    detail:
      row.state === 'skipped'
        ? (row.skippedReason || '暂无调用记录')
        : truncateText(
            [
              row.error ? `请求异常：${row.error}` : '',
              formatRiskFactsPlain(row),
            ].filter(Boolean).join('\n'),
            1200,
          ),
  }))

  const modelVersion = snap.configured
    ? '风控上游已启用'
    : '未配置风控上游'

  const successRate = testedCount === 0 ? 0 : Math.round((okCount / testedCount) * 100)

  return {
    orderId: user.id,
    riskStatus,
    decision,
    riskScore: successRate,
    threshold: 100,
    checkedAt: snap.checkedAt ? formatDateTime(snap.checkedAt) : '—',
    reason:
      failCount > 0
        ? '存在接口返回失败，请查看下方各接口摘要'
        : (testedCount === 0 ? '以下为下单七项档案快照；实测数据在调用后出现' : ''),
    modelVersion,
    factors: [],
    rules,
    testedSlotCount: testedCount,
    okSlotCount: okCount,
    failSlotCount: failCount,
    skippedSlotCount: 0,
  }
}

async function loadUserRiskDialogById(userId: string) {
  selectedUserForRisk.value = null
  userRiskSnapshot.value = null
  displayedUserRiskDetail.value = null
  userRiskError.value = ''
  riskDialogBootLoading.value = true
  try {
    const response = await fetch(`${MALL_API_BASE}/users/${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: withMallTenantHeaders(),
    })
    const payload = await response.json().catch(() => ({})) as {
      msg?: string
      data?: { user?: ApiUserItem, riskView?: ApiRiskView }
    }
    if (!response.ok) {
      throw new Error(apiErrorMessage(payload, '加载失败'))
    }
    const rv = payload.data?.riskView
    const apiUser = payload.data?.user
    if (!rv || !apiUser) {
      throw new Error('接口未返回风控视图')
    }
    const mapped = mapApiUser(apiUser)
    selectedUserForRisk.value = mapped
    const snap = buildRiskSnapshotFromView(rv)
    userRiskSnapshot.value = snap
    displayedUserRiskDetail.value = buildUserRiskDetailFromSnapshot(mapped, snap)
    riskDialogMainTab.value = props.hideBasicInfoTab ? 'order7' : 'basic'
    emit('userUpdated', mapped)
  }
  catch (error) {
    userRiskError.value = error instanceof Error ? error.message : '加载风控档案失败'
  }
  finally {
    riskDialogBootLoading.value = false
  }
}

/** 随 POST 带上当前档案中的三要素，供服务端与库内记录合并后调用上游 */
function buildAdminRiskCallBody(u: UserItem) {
  return {
    userName: u.name,
    phoneNumber: u.phone,
    idNumber: u.idNumber || '',
  }
}

async function fetchRiskSlotSnapshot(
  u: UserItem,
  row: RiskProductRow,
): Promise<{ snapshot: UserRiskSnapshot, user?: ApiUserItem }> {
  const response = await fetch(
    `${MALL_API_BASE}/users/${encodeURIComponent(u.id)}/risk-slot/${encodeURIComponent(row.slotKey)}`,
    {
      method: 'POST',
      headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        ...buildAdminRiskCallBody(u),
        ...(row.slotKey === 'cl_sms_send' || row.slotKey === 'cl_sms_notify'
          ? { allowSms: true }
          : {}),
      }),
    },
  )
  const payload = await response.json().catch(() => ({})) as {
    msg?: string
    data?: { row?: RiskProductRow, user?: ApiUserItem, snapshot?: UserRiskSnapshot }
  }
  if (!response.ok) {
    throw new Error(apiErrorMessage(payload, '请求失败'))
  }
  const newRow = payload.data?.row
  const snap = payload.data?.snapshot
  if (!newRow || !snap || !Array.isArray(snap.fourteenRows)) {
    throw new Error('接口未返回单条风控结果')
  }
  const snapshot: UserRiskSnapshot = {
    configured: Boolean(snap.configured),
    simulated: Boolean(snap.simulated),
    passed: Boolean(snap.passed),
    checkedAt: snap.checkedAt ? String(snap.checkedAt) : '',
    summaryMessage: snap.summaryMessage ? String(snap.summaryMessage) : '',
    fourteenRows: snap.fourteenRows,
    radarV4History: Array.isArray(snap.radarV4History) ? snap.radarV4History : undefined,
  }
  return { snapshot, user: payload.data?.user }
}

function applyRiskSlotFetchResult(u: UserItem, result: { snapshot: UserRiskSnapshot, user?: ApiUserItem }) {
  userRiskSnapshot.value = result.snapshot
  let viewUser = u
  if (result.user) {
    const mapped = mapApiUser(result.user)
    viewUser = mapped
    emit('userUpdated', mapped)
    selectedUserForRisk.value = mapped
  }
  displayedUserRiskDetail.value = buildUserRiskDetailFromSnapshot(viewUser, result.snapshot)
}

/** 依次调用先享后付下单对应的 7 项 risk-slot，与「手动查询」单条接口一致 */
async function runFullUserRiskCheck() {
  const u = selectedUserForRisk.value
  if (!u || fullRiskCheckLoading.value || manualRiskSlotLoading.value != null) {
    return
  }
  if (!userRiskSnapshot.value?.configured) {
    return
  }
  fullRiskCheckLoading.value = true
  let ok = 0
  let fail = 0
  const errors: string[] = []
  try {
    let cursorUser = u
    for (const slotKey of INSTALLMENT_ORDER_RISK_STEP_KEYS) {
      if (!riskSlotManualQueryEnabled(slotKey))
        continue
      const row: RiskProductRow = {
        slotKey,
        productLabel: INSTALLMENT_ORDER_RISK_STEP_LABELS[slotKey],
        state: 'skipped',
      }
      try {
        const result = await fetchRiskSlotSnapshot(cursorUser, row)
        applyRiskSlotFetchResult(cursorUser, result)
        cursorUser = selectedUserForRisk.value ?? cursorUser
        ok++
      }
      catch (e) {
        fail++
        const msg = e instanceof Error ? e.message : '失败'
        errors.push(`${INSTALLMENT_ORDER_RISK_STEP_LABELS[slotKey]}：${msg}`)
      }
    }
    if (fail === 0) {
      ElMessage.success(`已一键查询七项（${ok} 项），档案已更新`)
    }
    else if (ok === 0) {
      ElMessage.error(`一键查询七项均未成功。${errors[0] || ''}`)
    }
    else {
      ElMessage.warning(`七项中 ${ok} 项成功、${fail} 项失败${errors.length ? `（${errors[0]}）` : ''}`)
    }
  }
  catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '一键查询七项失败')
  }
  finally {
    fullRiskCheckLoading.value = false
  }
}

async function invokeManualRiskSlot(row: RiskProductRow) {
  const u = selectedUserForRisk.value
  if (!u || manualRiskSlotLoading.value != null || fullRiskCheckLoading.value) {
    return
  }
  if (!riskSlotManualQueryEnabled(row.slotKey)) {
    return
  }
  if (row.slotKey === 'cl_sms_send' || row.slotKey === 'cl_sms_notify') {
    try {
      await ElMessageBox.confirm(
        '该接口会向用户手机号发送短信并产生费用，确定执行？',
        '短信计费确认',
        {
          type: 'warning',
          confirmButtonText: '发送',
          cancelButtonText: '取消',
        },
      )
    }
    catch {
      return
    }
  }
  manualRiskSlotLoading.value = row.slotKey
  const prevSnap = row.slotKey === 'radar_v4_enc' && userRiskSnapshot.value
    ? {
        ...userRiskSnapshot.value,
        fourteenRows: userRiskSnapshot.value.fourteenRows.map(r => ({ ...r })),
        radarV4History: cloneRadarV4HistoryEntries(userRiskSnapshot.value.radarV4History),
      }
    : null
  try {
    const result = await fetchRiskSlotSnapshot(u, row)
    if (row.slotKey === 'radar_v4_enc') {
      result.snapshot = mergeRadarV4HistoryAfterManualFetch(prevSnap, result.snapshot)
    }
    applyRiskSlotFetchResult(u, result)
    const appended = row.slotKey === 'radar_v4_enc'
    ElMessage.success(
      appended
        ? `「${row.productLabel}」已调用，已追加至历史记录（共 ${userRiskSnapshot.value?.radarV4History?.length ?? 1} 条）`
        : `「${row.productLabel}」已调用并更新展示`,
    )
  }
  catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '调用失败')
  }
  finally {
    manualRiskSlotLoading.value = null
  }
}

async function invokeRadarSlotManual() {
  await invokeManualRiskSlot(radarV4CardItem.value.row)
}

async function retryUserRiskCheck() {
  const id = props.userId || selectedUserForRisk.value?.id
  if (!id) {
    return
  }
  await loadUserRiskDialogById(id)
}

function onUserRiskDialogClosed() {
  selectedUserForRisk.value = null
  displayedUserRiskDetail.value = null
  userRiskSnapshot.value = null
  userRiskError.value = ''
  manualRiskSlotLoading.value = null
  riskDialogMainTab.value = 'basic'
  radarHistoryExpanded.value = []
}
function mapApiUser(user: ApiUserItem): UserItem {
  const creditStatus = displayCreditFromSnapshotBasic(user.riskControlSnapshot ?? null)
  const quota = resolveMallCreditQuota(user)
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    quota,
    orderCount: Number(user.orderCount || 0),
    totalAmount: Number(user.totalAmount || 0),
    locationText: user.locationText || '-',
    registerAt: formatDateTime(user.registerAt),
    lastOrderAt: typeof user.lastOrderAt === 'string' && user.lastOrderAt.trim()
      ? user.lastOrderAt.trim()
      : undefined,
    idCardFront: user.idCardFront || '',
    idCardBack: user.idCardBack || '',
    idCardHandheld: user.idCardHandheld || '',
    idNumber: typeof user.idNumber === 'string' && user.idNumber.trim()
      ? user.idNumber.trim().toUpperCase()
      : undefined,
    creditStatus,
    riskControlSnapshot: user.riskControlSnapshot ?? undefined,
    riskUpstreamConfigured: user.riskUpstreamConfigured,
    adminPasswordPlain: typeof user.adminPasswordPlain === 'string' ? user.adminPasswordPlain : undefined,
    registerChannelCode: typeof user.registerChannelCode === 'string' ? user.registerChannelCode.trim() : undefined,
    registerChannelName: typeof user.registerChannelName === 'string' ? user.registerChannelName.trim() : undefined,
    registerChannelLabel: typeof user.registerChannelLabel === 'string' ? user.registerChannelLabel.trim() : undefined,
    adminRemark: typeof user.adminRemark === 'string' ? user.adminRemark : undefined,
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

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

watch(
  () => [props.modelValue, props.userId] as const,
  ([open, uid]) => {
    if (open && uid) {
      riskDialogMainTab.value = props.hideBasicInfoTab ? 'order7' : 'basic'
      void loadUserRiskDialogById(uid)
    }
    else if (open && !uid) {
      userRiskError.value = '未指定用户编号'
      riskDialogBootLoading.value = false
      userRiskSnapshot.value = null
      displayedUserRiskDetail.value = null
      selectedUserForRisk.value = null
    }
  },
  { immediate: true },
)

function handleUserRiskDialogClosed() {
  onUserRiskDialogClosed()
}
</script>
<template>
  <el-dialog
    v-model="dialogVisible"
    width="960px"
    append-to-body
    align-center
    class="risk-detail-dialog user-risk-dialog"
    destroy-on-close
    @closed="handleUserRiskDialogClosed"
  >
    <template #header>
      <div class="risk-detail-dialog__title">
        <span class="risk-detail-dialog__title-icon">
          <el-icon><DataAnalysis /></el-icon>
        </span>
        <span class="risk-detail-dialog__title-text">风控详情</span>
      </div>
    </template>

    <div
      v-if="riskDialogBootLoading"
      class="user-risk-state user-risk-state--muted"
    >
      <el-icon class="user-risk-state__spin is-loading">
        <DataAnalysis />
      </el-icon>
      <span>正在加载用户风控档案…</span>
    </div>

    <div
      v-else-if="userRiskError"
      class="user-risk-state user-risk-state--error"
    >
      <p>{{ userRiskError }}</p>
      <el-button
        type="primary"
        link
        @click="retryUserRiskCheck"
      >
        重试
      </el-button>
    </div>

    <div
      v-else-if="displayedUserRiskDetail && selectedUserForRisk && userRiskSnapshot"
      class="risk-detail-body"
    >
      <el-tabs v-model="riskDialogMainTab" class="user-risk-body-tabs">
        <el-tab-pane
          v-if="!hideBasicInfoTab"
          label="用户注册信息"
          name="basic"
        >
          <div class="user-risk-tab-pane-inner user-risk-basic-tab">
            <UserRegistrationInfoScroll
              show-embedded-head
              :user="selectedUserForRisk"
              :snapshot="userRiskSnapshot"
              :can-manage-users="riskBasicCanSeePasswordRow"
              :order-shipping-snapshot="contextOrderShipping"
              @close="dialogVisible = false"
            />
          </div>
        </el-tab-pane>
        <el-tab-pane label="下单七项" name="order7">
          <div class="user-risk-tab-pane-inner">
            <el-alert
              v-if="fullRiskCheckLoading"
              type="info"
              :closable="false"
              show-icon
              class="user-risk-full-check-banner"
            >
              正在依次批量调用先享后付下单 7 项接口（与单条「手动查询」相同），请稍候…
            </el-alert>

            <el-alert
              v-if="String(userRiskSnapshot.summaryMessage || '').trim()"
              class="risk-reason-alert"
              :type="displayedUserRiskDetail.riskStatus === 'failed' ? 'error' : 'warning'"
              :closable="false"
              show-icon
            >
              <template #title>
                后端汇总说明
              </template>
              {{ userRiskSnapshot.summaryMessage }}
            </el-alert>

            

            <el-alert
              v-if="!userRiskSnapshot.configured"
              type="warning"
              :closable="false"
              show-icon
              class="user-risk-config-hint"
            >
              当前<strong>未配置</strong>风控上游（<code>RISK_UPSTREAM_*</code>）。手动查询与全量核查均无法请求真实开放平台；请先配置环境变量并重启 API。
            </el-alert>

            <div class="user-risk-flat-section user-risk-flat-section--simple">
              <div class="user-risk-flat-section__head user-risk-flat-section__head--simple">
                <span class="user-risk-flat-section__title">先享后付下单风控（7 项）</span>
                <el-button
                  type="warning"
                  plain
                  class="user-risk-order7-batch-btn"
                  :loading="fullRiskCheckLoading"
                  :disabled="riskDialogBootLoading || manualRiskSlotLoading !== null || !userRiskSnapshot?.configured"
                  @click="runFullUserRiskCheck"
                >
                  一键查询七项
                </el-button>
              </div>
              <div
                class="user-risk-order7-grid"
                role="list"
                aria-label="先享后付下单风控七项"
              >
                <article
                  v-for="item in orderSevenCardItems"
                  :key="`${item.row.slotKey}-${item.globalIdx}`"
                  class="user-risk-order7-card"
                  role="listitem"
                >
                  <header class="user-risk-order7-card__head">
                    <span class="user-risk-simple-row__icon-wrap" aria-hidden="true">
                      <el-icon
                        v-if="item.row.state === 'ok'"
                        class="user-risk-simple-row__icon user-risk-simple-row__icon--ok"
                        :size="20"
                      >
                        <CircleCheck />
                      </el-icon>
                      <el-icon
                        v-else-if="item.row.state === 'fail'"
                        class="user-risk-simple-row__icon user-risk-simple-row__icon--fail"
                        :size="20"
                      >
                        <CircleClose />
                      </el-icon>
                      <el-icon
                        v-else
                        class="user-risk-simple-row__icon user-risk-simple-row__icon--muted"
                        :size="20"
                      >
                        <Minus />
                      </el-icon>
                    </span>
                    <span class="user-risk-order7-card__title">{{ item.globalIdx }}. {{ item.row.productLabel }}</span>
                  </header>
                  <p
                    v-if="item.row.state === 'skipped' && item.row.skippedReason"
                    class="user-risk-order7-card__note"
                  >
                    {{ item.row.skippedReason }}
                  </p>
                  <p
                    v-if="item.row.error"
                    class="user-risk-order7-card__err"
                  >
                    {{ item.row.error }}
                  </p>
                  <div
                    v-if="item.row.state !== 'skipped' && item.facts.length > 0"
                    class="user-risk-order7-card__facts"
                  >
                    <div
                      v-for="(fl, fli) in item.facts"
                      :key="fli"
                      class="user-risk-order7-fact"
                    >
                      <span class="user-risk-order7-fact__label">{{ fl.label }}</span>
                      <span
                        class="user-risk-order7-fact__value"
                        :class="{ 'user-risk-order7-fact__value--emphasis': fl.emphasis }"
                        :title="`${fl.label}：${fl.value}`"
                      >{{ fl.value }}</span>
                    </div>
                  </div>
                  <footer
                    v-if="riskSlotManualQueryEnabled(item.row.slotKey)"
                    class="user-risk-order7-card__foot"
                  >
                    <el-button
                      type="primary"
                      size="small"
                      class="user-risk-order7-card__btn"
                      :loading="manualRiskSlotLoading === item.row.slotKey"
                      :disabled="(manualRiskSlotLoading !== null && manualRiskSlotLoading !== item.row.slotKey) || fullRiskCheckLoading || !userRiskSnapshot.configured"
                      @click.stop="invokeManualRiskSlot(item.row)"
                    >
                      手动查询更新
                    </el-button>
                  </footer>
                </article>
              </div>
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane label="雷达风控" name="radar">
          <div class="user-risk-tab-pane-inner user-risk-radar-tab">
            <div class="user-risk-radar-card">
              <div class="user-risk-radar-card__head">
                <span class="user-risk-simple-row__icon-wrap user-risk-radar-card__icon" aria-hidden="true">
                  <el-icon
                    v-if="radarV4CardItem.row.state === 'ok'"
                    class="user-risk-simple-row__icon user-risk-simple-row__icon--ok"
                    :size="22"
                  >
                    <CircleCheck />
                  </el-icon>
                  <el-icon
                    v-else-if="radarV4CardItem.row.state === 'fail'"
                    class="user-risk-simple-row__icon user-risk-simple-row__icon--fail"
                    :size="22"
                  >
                    <CircleClose />
                  </el-icon>
                  <el-icon
                    v-else
                    class="user-risk-simple-row__icon user-risk-simple-row__icon--muted"
                    :size="22"
                  >
                    <Minus />
                  </el-icon>
                </span>
                <span class="user-risk-simple-row__title user-risk-radar-card__title">{{ radarV4CardItem.row.productLabel }}</span>
                <el-button
                  type="primary"
                  size="default"
                  class="user-risk-radar-fetch-btn"
                  :loading="manualRiskSlotLoading === 'radar_v4_enc'"
                  :disabled="(manualRiskSlotLoading !== null && manualRiskSlotLoading !== 'radar_v4_enc') || fullRiskCheckLoading || !userRiskSnapshot.configured"
                  @click="invokeRadarSlotManual"
                >
                  手动调取全景雷达
                </el-button>
              </div>
              <div class="user-risk-radar-card__body">
                <p
                  v-if="radarV4HistoryDisplayItems.length === 0 && radarV4CardItem.row.state === 'skipped' && radarV4CardItem.row.skippedReason"
                  class="user-risk-simple-row__note user-risk-radar-note"
                >
                  {{ radarV4CardItem.row.skippedReason }}
                </p>
                <p
                  v-if="radarV4HistoryDisplayItems.length > 0"
                  class="user-risk-radar-history-hint"
                >
                  共 {{ radarV4HistoryDisplayItems.length }} 次调取记录，按时间折叠展示；展开可对比不同时间的指标。手动调取会追加新记录，不会覆盖历史。
                </p>
                <el-collapse
                  v-if="radarV4HistoryDisplayItems.length > 0"
                  v-model="radarHistoryExpanded"
                  accordion
                  class="user-risk-radar-history-collapse"
                >
                  <el-collapse-item
                    v-for="(entry, entryIdx) in radarV4HistoryDisplayItems"
                    :key="entry.id"
                    :name="entry.id"
                  >
                    <template #title>
                      <span class="user-risk-radar-history-title">
                        <el-icon
                          v-if="entry.row.state === 'ok'"
                          class="user-risk-simple-row__icon user-risk-simple-row__icon--ok"
                          :size="18"
                        >
                          <CircleCheck />
                        </el-icon>
                        <el-icon
                          v-else-if="entry.row.state === 'fail'"
                          class="user-risk-simple-row__icon user-risk-simple-row__icon--fail"
                          :size="18"
                        >
                          <CircleClose />
                        </el-icon>
                        <el-icon
                          v-else
                          class="user-risk-simple-row__icon user-risk-simple-row__icon--muted"
                          :size="18"
                        >
                          <Minus />
                        </el-icon>
                        <span class="user-risk-radar-history-title__time">{{ entry.fetchedAtLabel }}</span>
                        <el-tag
                          v-if="entryIdx === 0 && !entry.isLegacy"
                          size="small"
                          type="success"
                          effect="plain"
                          class="user-risk-radar-history-title__tag"
                        >
                          最新
                        </el-tag>
                        <el-tag
                          v-else-if="entry.isLegacy"
                          size="small"
                          type="info"
                          effect="plain"
                          class="user-risk-radar-history-title__tag"
                        >
                          档案快照
                        </el-tag>
                      </span>
                    </template>
                    <p
                      v-if="entry.row.error"
                      class="user-risk-simple-row__err"
                    >
                      {{ entry.row.error }}
                    </p>
                    <RadarV4FactsPanel
                      v-if="radarHistoryExpanded.includes(entry.id) && entry.row.state !== 'skipped' && entry.facts.length > 0"
                      :facts="entry.facts"
                    />
                    <p
                      v-else-if="radarHistoryExpanded.includes(entry.id) && entry.row.state === 'skipped'"
                      class="user-risk-simple-row__note user-risk-radar-note"
                    >
                      {{ entry.row.skippedReason || '本次调取无有效数据' }}
                    </p>
                  </el-collapse-item>
                </el-collapse>
              </div>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <template #footer>
      <div
        v-if="riskDialogMainTab === 'order7'"
        class="user-risk-dialog-footer"
      >
        <div class="user-risk-dialog-footer__actions">
          <el-button @click="dialogVisible = false">
            关闭
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>
<style scoped>
.risk-detail-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
  /* 滚动仅交给 .el-dialog__body，避免双层 max-height 裁切底部内容（尤其雷达页） */
}

.user-risk-body-tabs {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.user-risk-body-tabs :deep(.el-tabs__header) {
  margin: 0 0 12px;
}

.user-risk-body-tabs :deep(.el-tabs__content) {
  overflow: visible;
  padding-bottom: 16px;
}

.user-risk-body-tabs :deep(.el-tab-pane) {
  overflow: visible;
}

.user-risk-tab-pane-inner {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.user-risk-basic-tab {
  gap: 12px;
}

.user-risk-basic-tab__meta {
  margin: 0 0 4px;
}

/* 与 UsersPage 用户预览弹窗一致：副标题行、小节标题 */
.user-preview-meta {
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

.user-risk-basic-intro {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: #64748b;
}

.user-risk-basic-desc {
  margin-top: 0;
}

/* 与 UsersPage「用户注册信息」基本信息区 el-descriptions 一致 */
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

.user-preview-meta__muted {
  color: #94a3b8;
}

/* 与 UsersPage 用户列表「备注」预览样式一致 */
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

.user-risk-api-card__slot-key {
  margin-left: 8px;
  font-size: 11px;
  color: #64748b;
  background: rgba(148, 163, 184, 0.15);
  padding: 1px 6px;
  border-radius: 4px;
}

.user-risk-radar-tab {
  gap: 0;
  padding-bottom: 28px;
}

.user-risk-radar-card {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  padding: 12px 14px 14px;
  margin-bottom: 4px;
}

.user-risk-radar-card__head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.user-risk-radar-card__icon {
  flex-shrink: 0;
  padding-top: 0;
  display: flex;
  align-items: center;
}

.user-risk-radar-card__title {
  flex: 1;
  min-width: 0;
  margin: 0;
}

.user-risk-radar-card__body {
  margin-top: 10px;
}

.user-risk-radar-fetch-btn {
  flex-shrink: 0;
  margin-left: auto;
  min-height: 44px;
  padding: 10px 28px;
  font-size: 15px;
  font-weight: 600;
  border-radius: 10px;
}

.user-risk-radar-note {
  margin-top: 0;
}

.user-risk-radar-history-hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: #64748b;
  line-height: 1.45;
}

.user-risk-radar-history-collapse {
  --el-collapse-border-color: transparent;
}

.user-risk-radar-history-collapse :deep(.el-collapse-item__header) {
  height: auto;
  line-height: 1.4;
  padding: 10px 12px;
  font-weight: 600;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  margin-bottom: 6px;
}

.user-risk-radar-history-collapse :deep(.el-collapse-item__wrap) {
  border-bottom: none;
}

.user-risk-radar-history-collapse :deep(.el-collapse-item__content) {
  padding: 0 4px 12px;
}

.user-risk-radar-history-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.user-risk-radar-history-title__time {
  font-size: 13px;
  color: #0f172a;
}

.user-risk-radar-history-title__tag {
  font-weight: 500;
}

.user-risk-radar-facts-wrap {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.user-risk-radar-report-note {
  margin: 0;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.55;
  color: #334155;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.user-risk-radar-sec {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.user-risk-radar-sec__head {
  padding: 0 2px;
}

.user-risk-radar-sec__title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: 0.02em;
}

.user-risk-radar-sec__sub {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: #64748b;
}

.user-risk-radar-table-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.user-risk-radar-table {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
  font-size: 12px;
  background: #fff;
}

.user-risk-radar-table--multi {
  table-layout: fixed;
}

.user-risk-radar-table--multi .user-risk-radar-table__label {
  width: 15%;
  max-width: none;
}

.user-risk-radar-table__pad {
  border-bottom: 1px solid #f1f5f9;
  background: #fafbfc;
}
.user-risk-radar-table thead th {
  text-align: left;
  padding: 8px 12px;
  font-weight: 600;
  color: #475569;
  background: linear-gradient(180deg, #f1f5f9 0%, #e8eef5 100%);
  border-bottom: 1px solid #cbd5e1;
  white-space: nowrap;
}

.user-risk-radar-table tbody td {
  padding: 8px 12px;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: top;
}

.user-risk-radar-table tbody tr:last-child td {
  border-bottom: none;
}

.user-risk-radar-table tbody tr:nth-child(even) td {
  background: #fafbfc;
}

.user-risk-radar-table__label {
  width: 46%;
  max-width: 280px;
  color: #334155;
  font-weight: 500;
}

.user-risk-radar-table__value {
  color: #0f172a;
  word-break: break-word;
}

.user-risk-radar-table__value--emphasis {
  font-weight: 700;
  color: #1d4ed8;
}

.user-risk-radar-table__empty {
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
  padding: 16px 12px;
}

.risk-desc-table {
  border-radius: 10px;
  overflow: hidden;
}

.risk-desc-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.risk-desc-label .el-icon {
  font-size: 14px;
  color: #64748b;
}

.risk-reason-alert {
  border-radius: 10px;
}

.risk-block__title {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 700;
  color: #1e293b;
  display: flex;
  align-items: center;
  gap: 8px;
}

.risk-block__title-bar {
  width: 4px;
  height: 14px;
  border-radius: 2px;
  background: linear-gradient(180deg, #6366f1, #8b5cf6);
}

.risk-factor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

@media (max-width: 520px) {
  .risk-factor-grid {
    grid-template-columns: 1fr;
  }
}

.risk-factor-cell {
  padding: 10px 12px;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.risk-factor-cell__label {
  font-size: 12px;
  color: #64748b;
  font-weight: 500;
}

.risk-factor-cell__value {
  font-size: 14px;
  color: #0f172a;
  font-weight: 600;
}

.risk-rules-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.risk-rule-card {
  border-radius: 12px;
  padding: 12px 14px;
  background: #fff;
  border: 1px solid #e2e8f0;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  border-left: 4px solid #94a3b8;
  transition: box-shadow 0.15s ease;
}

.risk-rule-card[data-hit='1'] {
  border-left-color: #ef4444;
  background: linear-gradient(90deg, rgba(254, 226, 226, 0.35) 0%, #fff 28%);
}

.risk-rule-card[data-hit='0'] {
  border-left-color: #10b981;
  background: linear-gradient(90deg, rgba(209, 250, 229, 0.35) 0%, #fff 28%);
}

.risk-rule-card:hover {
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.07);
}

.risk-rule-card__top {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.risk-rule-card__icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.risk-rule-card[data-hit='1'] .risk-rule-card__icon {
  background: rgba(239, 68, 68, 0.12);
  color: #dc2626;
}

.risk-rule-card[data-hit='0'] .risk-rule-card__icon {
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
}

.risk-rule-card__titles {
  flex: 1;
  min-width: 0;
}

.risk-rule-card__name {
  font-size: 14px;
  font-weight: 700;
  color: #1e293b;
  line-height: 1.35;
}

.risk-rule-card__code {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  font-family: ui-monospace, monospace;
}

.risk-rule-card__detail {
  margin: 10px 0 0 42px;
  font-size: 13px;
  color: #475569;
  line-height: 1.5;
}

.user-risk-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 44px 16px;
  flex-wrap: wrap;
  font-size: 14px;
}

.user-risk-state--muted {
  color: #64748b;
}

.user-risk-state--error {
  flex-direction: column;
  color: #b91c1c;
  font-weight: 500;
}

.user-risk-state__spin {
  font-size: 22px;
}

.user-risk-config-hint {
  border-radius: 10px;
}

.user-risk-fourteen-hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: #64748b;
  line-height: 1.45;
}

.user-risk-fourteen-hint code {
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 4px;
  background: #f1f5f9;
  color: #475569;
}

.user-risk-section-collapse {
  --el-collapse-border-color: transparent;
  margin-top: 8px;
}

.user-risk-section-collapse :deep(.el-collapse-item__header) {
  font-weight: 700;
  font-size: 14px;
  color: #0f172a;
  background: #f8fafc;
  border-radius: 10px;
  padding-left: 14px;
  margin-bottom: 4px;
  border: 1px solid #e2e8f0;
}

.user-risk-section-collapse :deep(.el-collapse-item__wrap) {
  border-bottom: none;
  background: transparent;
}

.user-risk-section-collapse :deep(.el-collapse-item__content) {
  padding-bottom: 12px;
}

.user-risk-collapse-title {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.user-risk-collapse-title__tag {
  font-weight: 500;
}

.user-risk-category-collapse {
  border: none;
}

.user-risk-category-collapse :deep(.el-collapse-item__header) {
  height: auto;
  line-height: 1.4;
  padding-top: 10px;
  padding-bottom: 10px;
  font-weight: 600;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  margin-bottom: 6px;
}

.user-risk-category-collapse :deep(.el-collapse-item__wrap) {
  border-bottom: none;
}

.user-risk-category-collapse-title {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.user-risk-category-collapse-title__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 6px;
  font-size: 12px;
  background: #6366f1;
  color: #fff;
}

.user-risk-slot-category__subtitle--nested {
  margin: 0 0 10px;
}

.user-risk-rules-hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: #64748b;
  line-height: 1.45;
}

.user-risk-api-card--fold {
  margin-bottom: 10px;
}

.user-risk-api-card--fold:last-child {
  margin-bottom: 0;
}

.user-risk-flat-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.user-risk-flat-section--simple {
  gap: 8px;
}

.user-risk-flat-section__head--simple {
  margin-bottom: 0;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  flex-wrap: wrap;
  gap: 12px;
}

.user-risk-order7-batch-btn {
  flex-shrink: 0;
}

.user-risk-simple-hint {
  margin: 0;
  font-size: 12px;
  color: #64748b;
  line-height: 1.45;
}

.user-risk-order7-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

@media (min-width: 1100px) {
  .user-risk-order7-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .user-risk-order7-grid {
    grid-template-columns: 1fr;
  }
}

.user-risk-order7-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
}

.user-risk-order7-card__head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.user-risk-order7-card__title {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: 13px;
  line-height: 1.35;
  color: #0f172a;
}

.user-risk-order7-card__note {
  margin: 0;
  font-size: 11px;
  color: #64748b;
  line-height: 1.4;
}

.user-risk-order7-card__err {
  margin: 0;
  font-size: 11px;
  color: #b91c1c;
  line-height: 1.4;
}

.user-risk-order7-card__facts {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 4px 10px;
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.4;
}

.user-risk-order7-fact {
  display: flex;
  flex-wrap: nowrap;
  align-items: baseline;
  gap: 4px 6px;
  min-width: 0;
}

.user-risk-order7-fact__label {
  flex-shrink: 0;
  color: #64748b;
  white-space: nowrap;
}

.user-risk-order7-fact__value {
  flex: 1;
  min-width: 0;
  color: #334155;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-risk-order7-fact__value--emphasis {
  font-weight: 600;
  color: #0f172a;
}

.user-risk-order7-card__foot {
  margin-top: auto;
  padding-top: 4px;
}

.user-risk-order7-card__btn {
  width: 100%;
  font-weight: 600;
}

.user-risk-simple-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}

.user-risk-simple-row {
  display: flex;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid #f1f5f9;
  align-items: flex-start;
}

.user-risk-simple-list > .user-risk-simple-row:last-child {
  border-bottom: none;
}

.user-risk-simple-row--solo {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  margin-bottom: 12px;
}

.user-risk-simple-row__icon-wrap {
  flex-shrink: 0;
  padding-top: 2px;
}

.user-risk-simple-row__icon--ok {
  color: #16a34a;
}

.user-risk-simple-row__icon--fail {
  color: #dc2626;
}

.user-risk-simple-row__icon--muted {
  color: #94a3b8;
}

.user-risk-simple-row__body {
  flex: 1;
  min-width: 0;
}

.user-risk-simple-row__title-line {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.user-risk-simple-row__action-wrap {
  flex-shrink: 0;
  align-self: center;
  padding-left: 4px;
}

.user-risk-simple-row__action-btn {
  min-height: 38px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
}

.user-risk-simple-row__title {
  font-weight: 600;
  font-size: 14px;
  color: #0f172a;
}

.user-risk-simple-row__note {
  margin: 6px 0 0;
  font-size: 12px;
  color: #64748b;
  line-height: 1.45;
}

.user-risk-simple-row__err {
  margin: 6px 0 0;
  font-size: 12px;
  color: #b91c1c;
}

.user-risk-simple-row__facts {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.user-risk-simple-fact {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  font-size: 13px;
  line-height: 1.45;
}

.user-risk-simple-fact__label {
  color: #64748b;
}

.user-risk-simple-fact__value {
  color: #334155;
}

.user-risk-simple-fact__value--emphasis {
  font-weight: 600;
  color: #0f172a;
}

.user-risk-flat-section__head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.user-risk-flat-section__title {
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
}

.user-risk-flat-section__tag {
  flex-shrink: 0;
}

.user-risk-api-card--flat {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 10px;
  background: #fff;
}

.user-risk-api-card--flat:last-child {
  margin-bottom: 0;
}

.user-risk-api-card__summary--flat {
  cursor: default;
}

.user-risk-api-card__fold-body--flat {
  border-top: 1px solid #e2e8f0;
}

.user-risk-raw-block {
  margin-top: 10px;
}

.user-risk-raw-block__label {
  font-size: 12px;
  color: #64748b;
  margin-bottom: 6px;
}

.user-risk-json--scroll {
  max-height: 220px;
  overflow: auto;
}

.user-risk-rules-flat-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.user-risk-rule-flat-card {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}

.user-risk-rule-flat-card--bad {
  border-color: rgba(239, 68, 68, 0.45);
  background: #fffafa;
}

.user-risk-rule-flat-card__head.risk-rule-collapse-title-row {
  padding: 10px 14px;
  background: #f8fafc;
  align-items: flex-start;
}

.user-risk-rule-flat-card--bad .user-risk-rule-flat-card__head {
  background: #fef2f2;
}

.user-risk-rule-flat-card__body {
  padding: 10px 14px 14px;
  border-top: 1px solid #e2e8f0;
  background: #fff;
}

.user-risk-rule-flat-card--bad .user-risk-rule-flat-card__body {
  background: #fffafa;
}

.user-risk-api-card__summary {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  cursor: pointer;
  list-style: none;
  background: #f8fafc;
}

.user-risk-api-card__summary::-webkit-details-marker {
  display: none;
}

.user-risk-api-card__summary-left {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.user-risk-api-card__summary-right {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

.user-risk-api-card__chev {
  display: inline-block;
  font-size: 10px;
  color: #64748b;
  transform: rotate(0deg);
  transition: transform 0.15s ease;
  margin-top: 5px;
}

.user-risk-api-card--fold[open] .user-risk-api-card__chev {
  transform: rotate(90deg);
}

.user-risk-api-card__fold-body {
  padding: 12px 14px 14px;
  border-top: 1px solid #e2e8f0;
  background: #fff;
}

.user-risk-rules-inner-collapse {
  border: none;
}

.user-risk-rules-inner-collapse :deep(.el-collapse-item__header) {
  height: auto;
  line-height: 1.35;
  padding-top: 8px;
  padding-bottom: 8px;
  align-items: flex-start;
}

.user-risk-rules-inner-collapse :deep(.el-collapse-item__wrap) {
  border-bottom: 1px solid #f1f5f9;
}

.risk-rule-collapse-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  width: 100%;
  padding-right: 6px;
}

.risk-rule-collapse-title-row__icon {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
}

.risk-rule-collapse-title-row--bad .risk-rule-collapse-title-row__icon {
  background: rgba(239, 68, 68, 0.12);
  color: #dc2626;
}

.risk-rule-collapse-title-row__text {
  flex: 1;
  min-width: 140px;
  font-size: 13px;
  font-weight: 700;
  color: #1e293b;
}

.risk-rule-collapse-title-row__code {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  font-family: ui-monospace, monospace;
}

.risk-rule-collapse-title-row__slot {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  font-weight: 500;
  color: #94a3b8;
  font-family: ui-monospace, monospace;
}

.risk-rule-collapse-title-row__http {
  font-size: 11px;
  color: #64748b;
  font-family: ui-monospace, monospace;
}

.risk-rule-collapse-title-row__btn {
  margin-left: auto;
}

.risk-rule-collapse-body {
  padding-bottom: 6px;
}

.risk-rule-card__detail--open {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.user-risk-fourteen-categories {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.user-risk-slot-category {
  border-radius: 14px;
  padding: 14px 14px 16px;
  background: linear-gradient(165deg, #ffffff 0%, #f8fafc 100%);
  border: 1px solid #e2e8f0;
  box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
}

.user-risk-slot-category__header {
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px dashed #cbd5e1;
}

.user-risk-slot-category__title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.user-risk-slot-category__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 8px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 800;
  color: #fff;
  background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
  letter-spacing: 0.02em;
}

.user-risk-slot-category__title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.35;
}

.user-risk-slot-category__subtitle {
  margin: 8px 0 0;
  font-size: 12px;
  color: #64748b;
  line-height: 1.5;
}

.user-risk-fourteen-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.user-risk-api-card {
  border-radius: 12px;
  padding: 12px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
}

.user-risk-api-card__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px 14px;
  margin-bottom: 8px;
}

.user-risk-api-card__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.user-risk-api-card__btn {
  margin-left: 4px;
}

.user-risk-api-card__title {
  flex: 1;
  min-width: 160px;
  font-size: 14px;
  font-weight: 700;
  color: #1e293b;
}

.user-risk-api-card__http {
  font-size: 12px;
  color: #64748b;
  font-family: ui-monospace, monospace;
}

.user-risk-api-card__skip {
  margin: 0 0 8px;
  font-size: 12px;
  color: #64748b;
}

.user-risk-api-card__err {
  margin: 0 0 8px;
  font-size: 12px;
  color: #b91c1c;
}

.user-risk-api-card__facts {
  display: grid;
  grid-template-columns: minmax(104px, 150px) 1fr;
  gap: 8px 14px;
  padding: 12px 14px;
  margin-top: 6px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid #e2e8f0;
}

.user-risk-fact-row {
  display: contents;
}

.user-risk-fact-row__label {
  font-size: 12px;
  color: #64748b;
  font-weight: 600;
}

.user-risk-fact-row__value {
  font-size: 13px;
  color: #0f172a;
  word-break: break-word;
}

.user-risk-api-card__hint-soft {
  margin: 8px 0 0;
  font-size: 12px;
  color: #94a3b8;
}

.user-risk-raw-details {
  margin-top: 10px;
}

.user-risk-raw-details__summary {
  cursor: pointer;
  font-size: 12px;
  color: #4f46e5;
  user-select: none;
  list-style: none;
}

.user-risk-raw-details__summary::-webkit-details-marker {
  display: none;
}

.user-risk-json--nested {
  margin-top: 8px;
  max-height: 240px;
}

.user-risk-fact-row__value--emphasis {
  font-size: 15px;
  font-weight: 700;
  color: #0c4a6e;
}

.user-risk-json {
  margin: 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: #1e1e2e;
  color: #cdd6f4;
  font-family: ui-monospace, 'Cascadia Code', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  overflow-x: auto;
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid #313244;
  white-space: pre-wrap;
  word-break: break-word;
}

.user-risk-full-check-banner {
  margin-bottom: 14px;
}

.user-risk-dialog-footer {
  width: 100%;
}

.user-risk-dialog-footer__hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: #64748b;
  line-height: 1.45;
}

.user-risk-dialog-footer__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}
</style>
<style>
/* append-to-body 风控弹窗（与 OrderReviewPage 一致） */
.risk-detail-dialog.el-dialog {
  border-radius: 14px;
  overflow: hidden;
  max-width: min(960px, calc(100vw - 24px));
}

.risk-detail-dialog .el-dialog__header {
  padding: 16px 20px 14px;
  margin-right: 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.risk-detail-dialog .el-dialog__footer {
  padding: 12px 20px 18px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.risk-detail-dialog .el-dialog__body {
  padding: 18px 20px 22px;
  max-height: min(72vh, 720px);
  overflow-y: auto;
}

.user-risk-dialog.risk-detail-dialog .el-dialog__body {
  max-height: min(85vh, 900px);
  overflow-y: auto;
  overflow-x: hidden;
  padding-bottom: 40px;
  box-sizing: border-box;
}

.risk-detail-dialog__title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.risk-detail-dialog__title-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  font-size: 18px;
}

.risk-detail-dialog__title-text {
  font-size: 17px;
  font-weight: 700;
  color: #1e293b;
  letter-spacing: 0.02em;
}
</style>
