<script setup lang="ts">
import { CircleCheck, CircleClose, Clock, Cpu, DataAnalysis, Document, User } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, ref, watch } from 'vue'
import { withAdminAuthHeaders } from '../composables/useAdminApi'
import type { OrderRiskDetail, RiskDetailRule } from '../stores/useOrdersStore'
import { buildRadarV4DetailFactLines } from '../utils/radarV4ReputationFacts'

export interface RiskProductRow {
  slotKey: string
  productLabel: string
  state: 'ok' | 'fail' | 'skipped'
  skippedReason?: string
  httpStatus?: number
  error?: string
  rawResponse?: unknown
}

export interface UserRiskSnapshot {
  configured: boolean
  simulated?: boolean
  passed: boolean
  checkedAt: string
  summaryMessage?: string
  fourteenRows: RiskProductRow[]
}

export interface ApiRiskView {
  snapshot: UserRiskSnapshot | null
  templateRows: RiskProductRow[]
  upstreamConfigured: boolean
}

const DEFAULT_USER_QUOTA = 3000

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

const RISK_CATEGORY_C_ADMIN_SKIP_HINT = 'C 类产品不在管理端单独触发；以下为档案快照（若有），可展开「原始数据」核对。'

const RISK_FACE_ADMIN_SKIP_HINT = '个体人脸活体验证不在管理端单独触发；以下为档案快照（若有），可展开「原始数据」核对。'

/** C 类与人脸：卡片侧不生成业务摘要行（与「跳过」展示一致） */
function riskSlotAdminPresentationSkipsFacts(slotKey: string): boolean {
  const k = String(slotKey || '').trim()
  return RISK_CATEGORY_C_SLOT_KEYS.has(k) || k === 'auth_person_face'
}

/** C 类 + 人脸：不提供「手动查询」 */
const RISK_SLOTS_MANUAL_QUERY_DISABLED = new Set<string>([
  ...RISK_CATEGORY_C_SLOT_KEYS,
  'auth_person_face',
])

function riskSlotManualQueryEnabled(slotKey: string): boolean {
  return !RISK_SLOTS_MANUAL_QUERY_DISABLED.has(String(slotKey || '').trim())
}

/** 管理端风控弹窗：C 类与人脸槽位固定展示为「跳过」（不改变库里快照，仅展示层） */
function riskSlotAdminPresentation(row: RiskProductRow): RiskProductRow {
  if (RISK_CATEGORY_C_SLOT_KEYS.has(row.slotKey)) {
    return {
      ...row,
      state: 'skipped',
      skippedReason: RISK_CATEGORY_C_ADMIN_SKIP_HINT,
      httpStatus: undefined,
      error: undefined,
    }
  }
  if (row.slotKey === 'auth_person_face') {
    return {
      ...row,
      state: 'skipped',
      skippedReason: RISK_FACE_ADMIN_SKIP_HINT,
      httpStatus: undefined,
      error: undefined,
    }
  }
  return row
}

function riskSlotShowsRawWhenSkipped(slotKey: string): boolean {
  return riskSlotAdminPresentationSkipsFacts(String(slotKey || '').trim())
}

/** 按十四槽位逐个套用管理端展示层统计（与下方 A/B/C 列表一致） */
function countPresentedRiskSlots(fourteenRows: RiskProductRow[] | undefined): {
  ok: number
  fail: number
  skipped: number
  tested: number
} {
  const byKey = new Map((Array.isArray(fourteenRows) ? fourteenRows : []).map(r => [r.slotKey, r]))
  let ok = 0
  let fail = 0
  let skipped = 0
  for (const slotKey of RISK_SLOT_DISPLAY_ORDER) {
    const raw = byKey.get(slotKey)
    const presented = raw
      ? riskSlotAdminPresentation(raw)
      : riskSlotAdminPresentation({
          slotKey,
          productLabel: slotKey,
          state: 'skipped',
          skippedReason: '快照中缺少该产品行（应为 14 项）',
        })
    if (presented.state === 'ok')
      ok++
    else if (presented.state === 'fail')
      fail++
    else
      skipped++
  }
  return { ok, fail, skipped, tested: ok + fail }
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
  idCardFront: string
  idCardBack: string
  idCardHandheld: string
  /** 18 位身份证号码（风控、下单用） */
  idNumber?: string
  creditStatus: '优秀' | '良好' | '一般' | '风险'
  /** 库内风控快照（管理端列表/详情接口可能返回） */
  riskControlSnapshot?: UserRiskSnapshot | null
  riskUpstreamConfigured?: boolean
}

interface ApiUserItem {
  id: string
  name: string
  phone: string
  quota?: number
  orderCount?: number
  totalAmount?: number
  locationText: string
  registerAt?: string
  idCardFront: string
  idCardBack: string
  idCardHandheld: string
  creditStatus?: UserItem['creditStatus']
  idNumber?: string
  riskControlSnapshot?: UserRiskSnapshot | null
  riskUpstreamConfigured?: boolean
}

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

const props = defineProps<{
  modelValue: boolean
  userId: string | null
}>()

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
const userRiskSectionCollapse = ref<string[]>(['fourteen'])
const fourteenCategoryAccordion = ref<string | number>('')
const rulesInnerCollapse = ref<string[]>([])

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

function splitFactorLine(line: string): { label: string; value: string } {
  const cn = line.indexOf('：')
  const en = line.indexOf(':')
  let idx = -1
  if (cn >= 0 && en >= 0) {
    idx = Math.min(cn, en)
  }
  else {
    idx = cn >= 0 ? cn : en
  }
  if (idx === -1) {
    return { label: line, value: '' }
  }
  return {
    label: line.slice(0, idx).trim(),
    value: line.slice(idx + 1).trim(),
  }
}

/** 开放平台摘要主标签 + 卡片底色：全成功绿、全失败红、部分成功橙 */
function riskOpenPlatformTagType(detail: OrderRiskDetail): 'success' | 'danger' | 'warning' | 'info' {
  const t = detail.testedSlotCount ?? 0
  const ok = detail.okSlotCount ?? 0
  const fail = detail.failSlotCount ?? 0
  if (t === 0)
    return 'info'
  if (fail === 0)
    return 'success'
  if (ok === 0)
    return 'danger'
  return 'warning'
}

function riskOpenPlatformHeroToneClass(detail: OrderRiskDetail): string {
  const t = riskOpenPlatformTagType(detail)
  if (t === 'success')
    return 'risk-hero--tone-success'
  if (t === 'danger')
    return 'risk-hero--tone-danger'
  if (t === 'warning')
    return 'risk-hero--tone-warning'
  return 'risk-hero--tone-neutral'
}

/** 已测项进度条：部分失败用 warning 呈橙色，与主标签一致 */
function riskTestedProgressStatus(detail: OrderRiskDetail): 'success' | 'exception' | 'warning' | undefined {
  const t = detail.testedSlotCount ?? 0
  const ok = detail.okSlotCount ?? 0
  const fail = detail.failSlotCount ?? 0
  if (t === 0)
    return undefined
  if (fail === 0)
    return 'success'
  if (ok === 0)
    return 'exception'
  return 'warning'
}
function formatRiskJson(raw: unknown): string {
  if (raw === undefined || raw === null) {
    return 'null'
  }
  try {
    return JSON.stringify(raw, null, 2)
  }
  catch {
    return String(raw)
  }
}

interface RiskFactLine {
  label: string
  value: string
  /** 管理员视角下的核心结论（加大字号） */
  emphasis?: boolean
}

function formatYesNo(v: unknown): string {
  if (v === true || String(v).toLowerCase() === 'true') return '是'
  if (v === false || String(v).toLowerCase() === 'false') return '否'
  return String(v ?? '—')
}

function shouldShowRemark(v: unknown): boolean {
  const s = String(v ?? '').trim()
  if (!s) return false
  if (/^success$/i.test(s)) return false
  return true
}

function formatCarrierCorp(v: unknown): string {
  const n = Number(v)
  if (n === 1) return '中国移动'
  if (n === 2) return '中国联通'
  if (n === 3) return '中国电信'
  if (v === undefined || v === null || String(v).trim() === '') return '—'
  return String(v)
}

/** 运营商状态 state：开放平台为数字；旧模拟可能为字符串 */
function formatDsPhoneState(v: unknown): string {
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'normal') return '在网（文档口径）'
    return v
  }
  const n = Number(v)
  if (n === 0) return '在网'
  if (n === 1) return '停机'
  if (n === 2) return '在网不可用'
  if (Number.isNaN(n)) return '—'
  return String(v)
}

/** 兼容库内旧快照及上游沙箱在摘要字段带「模拟：」前缀 */
function stripSandboxRiskSummaryPrefix(text: string): string {
  return text.replace(/^模拟[:：]\s*/, '').trim()
}

function unwrapRiskDataObject(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const d = o.data
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    return d as Record<string, unknown>
  }
  return o
}

/** 部分开放平台响应为 data → 再包一层 data（业务对象在内层） */
function unwrapRiskPayload(raw: unknown): Record<string, unknown> | null {
  const d = unwrapRiskDataObject(raw)
  if (!d) return null
  const inner = asRiskRecord(d.data)
  if (!inner) return d
  /** 与内层 data 并列的信封字段；若误判为「业务键」会阻止展开（如全景雷达含 msgcode） */
  const meta = new Set([
    'code', 'msg', 'message', 'success', 'info', 'time', 'data',
    'msgcode', 'request_id', 'requestId',
  ])
  const outerBiz = Object.keys(d).filter(k => !meta.has(k))
  if (outerBiz.length > 0) return d
  return inner
}

function asRiskRecord(v: unknown): Record<string, unknown> | null {
  if (v !== null && typeof v === 'object' && !Array.isArray(v))
    return v as Record<string, unknown>
  return null
}

function getRiskFactLines(row: RiskProductRow): RiskFactLine[] {
  const raw = row.rawResponse
  if (raw === null || raw === undefined) return []

  if (row.slotKey === 'id_card_ocr' && typeof raw === 'object' && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>
    const lines: RiskFactLine[] = []
    for (const side of ['人像面', '国徽面'] as const) {
      const part = r[side]
      if (!part || typeof part !== 'object' || Array.isArray(part)) continue
      const p = part as Record<string, unknown>
      if (p.skipped) {
        lines.push({
          label: side,
          value: `未查询${p.reason ? `（${String(p.reason)}）` : ''}`,
        })
        continue
      }
      const ok = p.ok !== false && !p.error
      lines.push({
        label: side,
        value: ok ? '已完成查询' : `未成功${p.error ? `（${String(p.error)}）` : ''}`,
        emphasis: ok,
      })
    }
    return lines
  }

  const data = unwrapRiskPayload(raw)
  const lines: RiskFactLine[] = []

  const push = (label: string, v: unknown, emphasis?: boolean) => {
    if (v === undefined || v === null || String(v).trim() === '') return
    lines.push({ label, value: stripSandboxRiskSummaryPrefix(String(v)), emphasis })
  }

  if (!data) return lines

  switch (row.slotKey) {
    case 'ds_phone_state':
      lines.push({ label: '运营商', value: formatCarrierCorp(data.corporation), emphasis: true })
      lines.push({ label: '号码状态', value: formatDsPhoneState(data.state), emphasis: true })
      push('查询手机号', data.phoneNumber ?? data.mobile)
      if (shouldShowRemark(data.remark)) push('补充说明', data.remark)
      break
    case 'ds_phone_time':
      lines.push({ label: '运营商', value: formatCarrierCorp(data.corporation), emphasis: true })
      push('在网时长', data.time ?? data.bucket ?? data.monthsInNetwork, true)
      push('查询手机号', data.phoneNumber ?? data.mobile)
      if (shouldShowRemark(data.remark)) push('补充说明', data.remark)
      break
    case 'court_detail_pro': {
      const cdRaw = data.CourtDetail ?? data.courtDetail ?? data.court_detail
      let cd: Record<string, unknown> | null = null
      if (cdRaw && typeof cdRaw === 'object' && !Array.isArray(cdRaw))
        cd = cdRaw as Record<string, unknown>

      push('姓名', data.userName ?? cd?.userName)
      push('手机号', data.phoneNumber ?? cd?.phoneNumber ?? cd?.mobile)
      push('证件号', data.idNumberMask ?? data.idNumber ?? cd?.idNumberMask ?? cd?.idNumber)

      const countRaw = cd?.count ?? data.caseCount
      const entryRaw = cd?.entryList ?? cd?.entry_list ?? data.entryList
      const countNum = Number(countRaw)
      const listLen = Array.isArray(entryRaw) ? entryRaw.length : null

      if (Number.isFinite(countNum))
        lines.push({ label: '涉诉案件数', value: String(countNum), emphasis: true })
      else if (data.caseCount !== undefined)
        push('涉诉案件数', data.caseCount, true)

      if (data.hit !== undefined) {
        lines.push({ label: '是否命中公开涉诉', value: formatYesNo(data.hit), emphasis: true })
      }
      else if (Number.isFinite(countNum) || listLen !== null) {
        const hit = (Number.isFinite(countNum) && countNum > 0) || (listLen !== null && listLen > 0)
        lines.push({ label: '是否命中公开涉诉', value: hit ? '是' : '否', emphasis: true })
      }

      push('结论摘要', data.summary ?? data.message ?? cd?.summary ?? cd?.message)

      const hasPlainConclusion = lines.some(l => l.label === '结论摘要' && String(l.value || '').trim() !== '')
      if (
        !hasPlainConclusion
        && Number.isFinite(countNum)
        && countNum === 0
        && (listLen === null || listLen === 0)
      ) {
        lines.push({
          label: '结论',
          value: '未查询到公开涉诉记录',
          emphasis: true,
        })
      }
      break
    }
    case 'execution_pro': {
      const exRaw = data.ExecutionPro ?? data.executionPro ?? data.execution_pro ?? data.Execution
        ?? data.ExecutionDetail ?? data.executionDetail ?? data.execution_detail
      const ex = asRiskRecord(exRaw)

      push('姓名', data.userName ?? ex?.userName)
      push('手机号', data.phoneNumber ?? ex?.phoneNumber ?? ex?.mobile)
      push('证件号', data.idNumberMask ?? data.idNumber ?? ex?.idNumberMask ?? ex?.idNumber)

      const countRaw = ex?.count ?? data.caseCount ?? data.executionCount
      const entryRaw = ex?.entryList ?? ex?.entry_list ?? data.entryList
      const countNum = Number(countRaw)
      const listLen = Array.isArray(entryRaw) ? entryRaw.length : null

      if (Number.isFinite(countNum))
        lines.push({ label: '被执行人记录数', value: String(countNum), emphasis: true })

      const rule = asRiskRecord(data.Rule ?? data.rule)

      if (data.executedHit !== undefined) {
        lines.push({ label: '是否命中被执行人', value: formatYesNo(data.executedHit), emphasis: true })
      }
      else if (rule && rule.result !== undefined && rule.result !== null && String(rule.result).trim() !== '') {
        const rr = String(rule.result).toLowerCase()
        const hit = rr === '1' || rr === 'true' || rr === 'hit'
        lines.push({ label: '是否命中被执行人', value: hit ? '是' : '否', emphasis: true })
      }
      else if (Number.isFinite(countNum) || listLen !== null) {
        const hit = (Number.isFinite(countNum) && countNum > 0) || (listLen !== null && listLen > 0)
        lines.push({ label: '是否命中被执行人', value: hit ? '是' : '否', emphasis: true })
      }

      push('结论摘要', data.summary ?? data.message ?? ex?.summary ?? ex?.message ?? rule?.summary ?? rule?.message)

      const hasPlainConclusion = lines.some(l => l.label === '结论摘要' && String(l.value || '').trim() !== '')
      if (
        !hasPlainConclusion
        && Number.isFinite(countNum)
        && countNum === 0
        && (listLen === null || listLen === 0)
      ) {
        lines.push({
          label: '结论',
          value: '未查询到被执行人公开记录',
          emphasis: true,
        })
      }
      break
    }
    case 'personal3': {
      push('姓名', data.name ?? data.userName)
      push('手机号', data.mobile ?? data.phoneNumber)
      push('证件号', data.id_card ?? data.idNumber)
      const pr = data.result ?? data.checkResult ?? data.check_result ?? data.verifyResult ?? data.res
      if (pr !== undefined && pr !== null && String(pr).trim() !== '') {
        const r = String(pr)
        const map: Record<string, string> = {
          '1': '三要素一致',
          '2': '三要素不一致',
          '0': '无法核验或异常',
        }
        lines.push({ label: '核验结论', value: map[r] || r, emphasis: true })
      }
      push('说明', data.message ?? data.msg ?? data.desc)
      break
    }
    case 'mobile2': {
      push('姓名', data.name ?? data.userName)
      push('手机号', data.mobile ?? data.phoneNumber ?? data.maskMobile)
      const mr = data.result
      if (mr !== undefined && mr !== null && String(mr).trim() !== '') {
        const rs = String(mr)
        const map: Record<string, string> = {
          '1': '一致',
          '2': '不一致',
          '3': '异常或无结果',
        }
        lines.push({
          label: '机主与姓名是否一致',
          value: map[rs] ?? rs,
          emphasis: true,
        })
      }
      else if (data.match !== undefined) {
        lines.push({ label: '机主与姓名是否一致', value: formatYesNo(data.match), emphasis: true })
      }
      push('运营商说明', data.carrier ?? data.operator ?? data.operatorMsg ?? data.message)
      if (shouldShowRemark(data.remark)) push('补充说明', data.remark)
      break
    }
    case 'probe_c_enc': {
      push('评估说明', data.detail ?? data.message ?? data.summary ?? data.desc ?? data.remark)
      if (data.score !== undefined)
        lines.push({ label: '评分', value: String(data.score), emphasis: true })
      if (data.level !== undefined)
        lines.push({ label: '等级', value: String(data.level), emphasis: true })
      const od = data.currently_overdue ?? data.currentlyOverdue
      if (od !== undefined && od !== null && String(od).trim() !== '') {
        const hit = od === true || od === '1' || od === 1 || String(od).toLowerCase() === 'true'
        lines.push({ label: '当前是否存在逾期', value: hit ? '是' : '否', emphasis: true })
      }
      const ae = data.acc_exc ?? data.accExc
      if (ae !== undefined && ae !== null && String(ae).trim() !== '' && String(ae) !== '0') {
        const s = typeof ae === 'object' ? JSON.stringify(ae) : String(ae)
        if (s.length > 240)
          push('资信风险提示', `${s.slice(0, 240)}…`)
        else
          push('资信风险提示', s)
      }
      break
    }
    case 'radar_v4_enc': {
      let radar: Record<string, unknown> = { ...data }
      const innerLayer = asRiskRecord(data.data)
      if (
        innerLayer
        && (
          innerLayer.apply_report_detail != null
          || innerLayer.behavior_report_detail != null
          || innerLayer.current_report_detail != null
        )
      ) {
        radar = { ...data, ...innerLayer }
      }
      let desc = radar.detail ?? radar.message ?? radar.summary ?? radar.desc ?? radar.remark
      const cur = asRiskRecord(radar.current_report_detail ?? radar.currentReportDetail)
      if ((!desc || String(desc).trim() === '') && cur)
        desc = cur.summary ?? cur.detail ?? cur.message ?? cur.desc
      const applyRaw = radar.apply_report_detail ?? radar.applyReportDetail
      const applyObj = asRiskRecord(applyRaw)
      if ((!desc || String(desc).trim() === '') && applyObj)
        desc = applyObj.summary ?? applyObj.remark ?? applyObj.detail ?? applyObj.message
      if ((!desc || String(desc).trim() === '') && Array.isArray(applyRaw) && applyRaw.length > 0) {
        const first = applyRaw[0]
        if (first && typeof first === 'object' && !Array.isArray(first)) {
          const fo = first as Record<string, unknown>
          desc = fo.summary ?? fo.remark ?? fo.detail ?? fo.message ?? fo.desc
        }
      }
      const beh = asRiskRecord(radar.behavior_report_detail ?? radar.behaviorReportDetail)
      if ((!desc || String(desc).trim() === '') && beh)
        desc = beh.summary ?? beh.detail ?? beh.message ?? beh.remark
      if (desc && String(desc).trim() !== '')
        push('评估说明', desc)
      for (const f of buildRadarV4DetailFactLines(radar))
        lines.push(f)
      break
    }
    case 'cl_sms_send':
    case 'cl_sms_notify':
      push('接收手机号', data.phone)
      push('说明', data.reason ?? data.note)
      break
    case 'create_contract':
      push('合同编号', data.contractNo, true)
      push('当前状态', data.status, true)
      push('合同标题', data.title ?? data.contractName)
      break
    case 'auth_person_face': {
      const faceUrl = data.faceUrl ?? data.face_url
      const res = data.result ?? data.authResult ?? data.auth_result
      if (data.passed !== undefined) {
        lines.push({ label: '人脸核验是否通过', value: formatYesNo(data.passed), emphasis: true })
      }
      else if (res !== undefined && res !== null && String(res).trim() !== '') {
        const rs = String(res)
        const map: Record<string, string> = {
          '1': '已通过',
          '2': '未通过',
          '0': '处理中或未认证',
        }
        lines.push({ label: '人脸核验结果', value: map[rs] ?? rs, emphasis: true })
      }
      else if (faceUrl && String(faceUrl).trim() !== '') {
        lines.push({
          label: '人脸核验',
          value: '已生成核验入口，待用户完成刷脸',
          emphasis: true,
        })
      }
      push('说明', data.message ?? data.msg)
      break
    }
    default: {
      const tech = new Set([
        'code', 'msgcode', 'info', 'msg', 'success', 'time', 'sign', 'nostr', 'appid', 'request_id',
      ])
      const labelZh: Record<string, string> = {
        userName: '姓名',
        phoneNumber: '手机号',
        mobile: '手机号',
        idNumber: '证件号',
        idNumberMask: '证件号（脱敏）',
        summary: '摘要',
      }
      const keys = Object.keys(data).filter(k => !tech.has(k)).slice(0, 12)
      for (const k of keys) {
        const val = data[k]
        if (val !== null && typeof val === 'object') continue
        push(labelZh[k] || k, val)
      }
      break
    }
  }

  return lines
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

interface RiskSlotCategorySection {
  id: string
  title: string
  subtitle: string
  items: RiskSlotCardItem[]
}

/** 十四项卡片：按 A/B/C 分类排序，预解析可读字段 */
const fourteenRowsByCategory = computed((): RiskSlotCategorySection[] => {
  const rows = userRiskSnapshot.value?.fourteenRows
  if (!Array.isArray(rows) || rows.length === 0)
    return []
  const byKey = new Map(rows.map(r => [r.slotKey, r]))
  let globalIdx = 0
  return RISK_SLOT_CATEGORY_GROUPS.map(cat => ({
    id: cat.id,
    title: cat.title,
    subtitle: cat.subtitle,
    items: cat.slotKeys.map((slotKey) => {
      globalIdx += 1
      const row = byKey.get(slotKey)
      if (!row) {
        const fallback: RiskProductRow = {
          slotKey,
          productLabel: slotKey,
          state: 'skipped',
          skippedReason: '快照中缺少该产品行（应为 14 项）',
        }
        const displayRow = riskSlotAdminPresentation(fallback)
        return {
          globalIdx,
          slotKey,
          row: displayRow,
          facts: [] as RiskFactLine[],
        }
      }
      const displayRow = riskSlotAdminPresentation(row)
      return {
        globalIdx,
        slotKey,
        row: displayRow,
        facts: riskSlotAdminPresentationSkipsFacts(slotKey) ? [] : getRiskFactLines(row),
      }
    }),
  }))
})

function truncateText(s: string, max: number) {
  if (s.length <= max) {
    return s
  }
  return `${s.slice(0, max)}…`
}

function buildUserRiskDetailFromSnapshot(user: UserItem, snap: UserRiskSnapshot): OrderRiskDetail {
  const rawOrdered = orderRiskRowsForDisplay(snap.fourteenRows || [])
  const rows = rawOrdered.map(r => riskSlotAdminPresentation(r))
  const slotCounts = countPresentedRiskSlots(snap.fourteenRows)
  const okCount = slotCounts.ok
  const failCount = slotCounts.fail
  const skippedCount = slotCounts.skipped
  const testedCount = slotCounts.tested

  let decision = '尚未调用开放平台风控接口'
  let riskStatus: 'passed' | 'failed' = 'passed'
  if (testedCount === 0) {
    decision = '尚未实测（打开时已加载库内档案；无数据时可点「手动查询」刷新单条或「全量风控核查」）'
    riskStatus = 'passed'
  }
  else if (failCount > 0) {
    decision =
      skippedCount > 0
        ? `已测 ${testedCount} 项，其中 ${failCount} 项返回失败，${skippedCount} 项跳过`
        : `已测 ${testedCount} 项，其中 ${failCount} 项返回失败`
    riskStatus = 'failed'
  }
  else {
    decision =
      skippedCount > 0
        ? `已测 ${testedCount} 项均已成功，${skippedCount} 项跳过`
        : `已测 ${testedCount} 项，当前均已返回成功`
    riskStatus = 'passed'
  }

  const factors = [
    `信誉状态（后台档案）：${user.creditStatus}`,
    `平台当前额度：¥${user.quota}`,
    `累计消费金额：¥${user.totalAmount}`,
    `历史订单数：${user.orderCount}`,
    `身份证档案：${user.idNumber ? '已填写' : '未填写'}`,
  ]

  const rules: RiskDetailRule[] = rows.map((row, idx) => ({
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
        ? (row.skippedReason || '未调用上游')
        : truncateText(
            [
              row.error ? `请求异常：${row.error}` : '',
              formatRiskFactsPlain(row),
            ].filter(Boolean).join('\n'),
            1200,
          ),
  }))

  const modelVersion = snap.configured
    ? '风控上游已启用（真实调用华东云等）'
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
        : (testedCount === 0 ? '以下为档案字段与占位行，实测数据仅在调用接口后出现' : ''),
    modelVersion,
    factors,
    rules,
    testedSlotCount: testedCount,
    okSlotCount: okCount,
    failSlotCount: failCount,
    skippedSlotCount: skippedCount,
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
      headers: withAdminAuthHeaders(),
    })
    const payload = await response.json().catch(() => ({})) as {
      msg?: string
      data?: { user?: ApiUserItem, riskView?: ApiRiskView }
    }
    if (!response.ok) {
      throw new Error(payload.msg || `加载失败: ${response.status}`)
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
    userRiskSectionCollapse.value = ['fourteen']
    fourteenCategoryAccordion.value = ''
    rulesInnerCollapse.value = []
    emit('userUpdated', mapped)
  }
  catch (error) {
    userRiskError.value = error instanceof Error ? error.message : '加载风控档案失败'
  }
  finally {
    riskDialogBootLoading.value = false
  }
}

/** 依次调用 8 项可测风控接口（人脸/OCR/短信/物流/合同共 6 项不请求） */
/** 随 POST 带上当前档案中的三要素，供服务端与库内记录合并后调用上游 */
function buildAdminRiskCallBody(u: UserItem) {
  return {
    userName: u.name,
    phoneNumber: u.phone,
    idNumber: u.idNumber || '',
  }
}

async function runFullUserRiskCheck() {
  const u = selectedUserForRisk.value
  if (!u || fullRiskCheckLoading.value) {
    return
  }
  fullRiskCheckLoading.value = true
  try {
    const response = await fetch(`${MALL_API_BASE}/users/${encodeURIComponent(u.id)}/risk-check`, {
      method: 'POST',
      headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(buildAdminRiskCallBody(u)),
    })
    const payload = await response.json().catch(() => ({})) as { msg?: string, data?: { snapshot?: UserRiskSnapshot, user?: ApiUserItem } }
    if (!response.ok) {
      throw new Error(payload.msg || `全量核查失败: ${response.status}`)
    }
    const snap = payload.data?.snapshot
    if (!snap || !Array.isArray(snap.fourteenRows)) {
      throw new Error('接口未返回十四项风控明细')
    }
    userRiskSnapshot.value = snap
    const apiUser = payload.data?.user
    let viewUser = u
    if (apiUser) {
      const mapped = mapApiUser(apiUser)
      viewUser = mapped
      emit('userUpdated', mapped)
      if (selectedUserForRisk.value?.id === mapped.id) {
        selectedUserForRisk.value = mapped
      }
    }
    displayedUserRiskDetail.value = buildUserRiskDetailFromSnapshot(viewUser, snap)
    ElMessage.success('全量风控核查已完成，档案已按策略更新')
  }
  catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '全量核查失败')
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
  try {
    const response = await fetch(
      `${MALL_API_BASE}/users/${encodeURIComponent(u.id)}/risk-slot/${encodeURIComponent(row.slotKey)}`,
      {
        method: 'POST',
        headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
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
      throw new Error(payload.msg || `请求失败: ${response.status}`)
    }
    const newRow = payload.data?.row
    const snap = payload.data?.snapshot
    if (!newRow || !snap || !Array.isArray(snap.fourteenRows)) {
      throw new Error('接口未返回单条风控结果')
    }
    userRiskSnapshot.value = {
      configured: Boolean(snap.configured),
      simulated: Boolean(snap.simulated),
      passed: Boolean(snap.passed),
      checkedAt: snap.checkedAt ? String(snap.checkedAt) : '',
      summaryMessage: snap.summaryMessage ? String(snap.summaryMessage) : '',
      fourteenRows: snap.fourteenRows,
    }
    const apiUser = payload.data?.user
    let viewUser = u
    if (apiUser) {
      const mapped = mapApiUser(apiUser)
      viewUser = mapped
      emit('userUpdated', mapped)
      selectedUserForRisk.value = mapped
    }
    displayedUserRiskDetail.value = buildUserRiskDetailFromSnapshot(viewUser, userRiskSnapshot.value)
    ElMessage.success(`「${row.productLabel}」已调用并更新展示`)
  }
  catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '调用失败')
  }
  finally {
    manualRiskSlotLoading.value = null
  }
}

function riskProductRowForRule(rule: RiskDetailRule): RiskProductRow {
  const row = userRiskSnapshot.value?.fourteenRows?.find(r => r.slotKey === rule.slotKey)
  if (row)
    return row
  return {
    slotKey: rule.slotKey || '',
    productLabel: rule.name,
    state: 'skipped',
    skippedReason: '档案中暂无该槽位',
  }
}

function ruleSlotRawResponse(rule: RiskDetailRule): unknown {
  if (!rule.slotKey || !userRiskSnapshot.value?.fourteenRows)
    return null
  const row = userRiskSnapshot.value.fourteenRows.find(r => r.slotKey === rule.slotKey)
  return row?.rawResponse ?? null
}

async function invokeManualRiskSlotFromRule(rule: RiskDetailRule) {
  if (!rule.slotKey) {
    ElMessage.warning('该条未绑定开放平台槽位')
    return
  }
  if (!riskSlotManualQueryEnabled(rule.slotKey)) {
    return
  }
  await invokeManualRiskSlot(riskProductRowForRule(rule))
}

function ruleStatusTagType(rule: RiskDetailRule): 'success' | 'danger' | 'info' {
  if (rule.hit)
    return 'danger'
  if (rule.rowState === 'skipped')
    return 'info'
  return 'success'
}

function ruleStatusLabel(rule: RiskDetailRule): string {
  if (rule.hit)
    return '接口异常'
  if (rule.rowState === 'skipped')
    return '跳过'
  return '成功'
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
  userRiskSectionCollapse.value = ['fourteen']
  fourteenCategoryAccordion.value = ''
  rulesInnerCollapse.value = []
}
function mapApiUser(user: ApiUserItem): UserItem {
  const creditStatus = user.creditStatus || '良好'
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
    locationText: user.locationText || '-',
    registerAt: formatDateTime(user.registerAt),
    idCardFront: user.idCardFront || '',
    idCardBack: user.idCardBack || '',
    idCardHandheld: user.idCardHandheld || '',
    idNumber: typeof user.idNumber === 'string' && user.idNumber.trim()
      ? user.idNumber.trim().toUpperCase()
      : undefined,
    creditStatus,
    riskControlSnapshot: user.riskControlSnapshot ?? undefined,
    riskUpstreamConfigured: user.riskUpstreamConfigured,
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
)

function handleUserRiskDialogClosed() {
  onUserRiskDialogClosed()
}
</script>
<template>
  <el-dialog
    v-model="dialogVisible"
    width="820px"
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
      <el-alert
        v-if="fullRiskCheckLoading"
        type="info"
        :closable="false"
        show-icon
        class="user-risk-full-check-banner"
      >
        正在依次调用 8 项可测风控接口并写入档案（另有 6 项按策略不请求），请稍候…
      </el-alert>
      <div
        class="risk-hero risk-hero--real"
        :class="riskOpenPlatformHeroToneClass(displayedUserRiskDetail)"
      >
        <div class="risk-hero__main risk-hero__main--stack">
          <span class="risk-hero__label">开放平台接口实测</span>
          <el-tag
            :type="riskOpenPlatformTagType(displayedUserRiskDetail)"
            effect="dark"
            round
            size="large"
            class="risk-hero__decision-tag"
          >
            {{ displayedUserRiskDetail.decision }}
          </el-tag>
        </div>
        <div
          v-if="displayedUserRiskDetail.testedSlotCount != null"
          class="risk-real-chips"
        >
          <el-tag
            type="info"
            effect="plain"
            round
          >
            已测 {{ displayedUserRiskDetail.testedSlotCount }} / 14
          </el-tag>
          <el-tag
            type="success"
            effect="plain"
            round
          >
            成功 {{ displayedUserRiskDetail.okSlotCount }}
          </el-tag>
          <el-tag
            v-if="(displayedUserRiskDetail.failSlotCount ?? 0) > 0"
            type="danger"
            effect="plain"
            round
          >
            失败 {{ displayedUserRiskDetail.failSlotCount }}
          </el-tag>
          <el-tag
            type="info"
            effect="plain"
            round
          >
            跳过 {{ displayedUserRiskDetail.skippedSlotCount }}
          </el-tag>
        </div>
        <div
          v-if="(displayedUserRiskDetail.testedSlotCount ?? 0) > 0"
          class="risk-success-rate"
        >
          <span class="risk-success-rate__label">已测项成功率</span>
          <el-progress
            :percentage="displayedUserRiskDetail.riskScore"
            :status="riskTestedProgressStatus(displayedUserRiskDetail)"
            :stroke-width="10"
            striped
          />
        </div>
      </div>

      <el-descriptions
        :column="2"
        border
        size="small"
        class="risk-desc-table"
      >
        <el-descriptions-item>
          <template #label>
            <span class="risk-desc-label"><el-icon><Document /></el-icon>用户编号</span>
          </template>
          {{ displayedUserRiskDetail.orderId }}
        </el-descriptions-item>
        <el-descriptions-item>
          <template #label>
            <span class="risk-desc-label"><el-icon><User /></el-icon>用户</span>
          </template>
          {{ selectedUserForRisk.name }}（{{ selectedUserForRisk.phone }}）
        </el-descriptions-item>
        <el-descriptions-item>
          <template #label>
            <span class="risk-desc-label"><el-icon><Cpu /></el-icon>模型版本</span>
          </template>
          {{ displayedUserRiskDetail.modelVersion }}
        </el-descriptions-item>
        <el-descriptions-item>
          <template #label>
            <span class="risk-desc-label"><el-icon><Clock /></el-icon>检查时间</span>
          </template>
          {{ displayedUserRiskDetail.checkedAt }}
        </el-descriptions-item>
      </el-descriptions>

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
        v-else-if="String(displayedUserRiskDetail.reason || '').trim()"
        class="risk-reason-alert"
        type="info"
        :closable="false"
        show-icon
      >
        <template #title>
          提示
        </template>
        {{ displayedUserRiskDetail.reason }}
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

      <el-collapse
        v-model="userRiskSectionCollapse"
        class="user-risk-section-collapse"
      >
        <el-collapse-item
          title="用户档案（后台字段，非开放平台返回）"
          name="profile"
        >
          <div class="risk-factor-grid">
            <div
              v-for="(factor, idx) in displayedUserRiskDetail.factors"
              :key="`${displayedUserRiskDetail.orderId}-f-${idx}`"
              class="risk-factor-cell"
            >
              <span class="risk-factor-cell__label">{{ splitFactorLine(factor).label }}</span>
              <span class="risk-factor-cell__value">{{ splitFactorLine(factor).value || factor }}</span>
            </div>
          </div>
        </el-collapse-item>

        <el-collapse-item name="fourteen">
          <template #title>
            <span class="user-risk-collapse-title">
              十四项风控结果（按 A/B/C，档案快照）
              <el-tag
                type="info"
                effect="plain"
                round
                size="small"
                class="user-risk-collapse-title__tag"
              >
                可折叠明细
              </el-tag>
            </span>
          </template>
          <p class="user-risk-fourteen-hint">
            与后端文档 <code>RISK_FOURTEEN_SLOTS.md</code> 分类一致。打开弹窗时会<strong>自动请求</strong>用户详情并<strong>回显库内档案</strong>；「手动查询」用于<strong>刷新单条</strong>并写回库（<strong>C 类与人脸认证</strong>在管理端固定「跳过」展示，不提供手动查询）。「全量风控核查」时，后端<strong>仅实际调用 8 项</strong>可测接口，另有 <strong>6 项</strong>按策略不请求，快照中仍显示为「跳过」。
          </p>
          <el-collapse
            v-model="fourteenCategoryAccordion"
            accordion
            class="user-risk-category-collapse"
          >
            <el-collapse-item
              v-for="cat in fourteenRowsByCategory"
              :key="cat.id"
              :name="cat.id"
            >
              <template #title>
                <span class="user-risk-category-collapse-title">
                  <b class="user-risk-category-collapse-title__badge">{{ cat.id }}</b>
                  {{ cat.title }}
                  <el-tag
                    size="small"
                    type="info"
                    effect="plain"
                    round
                  >
                    {{ cat.items.length }} 项
                  </el-tag>
                </span>
              </template>
              <p class="user-risk-slot-category__subtitle user-risk-slot-category__subtitle--nested">
                {{ cat.subtitle }}
              </p>
              <div class="user-risk-fourteen-list">
                <details
                  v-for="item in cat.items"
                  :key="`${item.row.slotKey}-${item.globalIdx}`"
                  class="user-risk-api-card user-risk-api-card--fold"
                >
                  <summary class="user-risk-api-card__summary">
                    <span class="user-risk-api-card__summary-left">
                      <span class="user-risk-api-card__chev" aria-hidden="true">▸</span>
                      <span class="user-risk-api-card__title">{{ item.globalIdx }}. {{ item.row.productLabel }}</span>
                    </span>
                    <span
                      class="user-risk-api-card__summary-right"
                      @click.stop
                    >
                      <el-tag
                        v-if="item.row.state === 'ok'"
                        type="success"
                        effect="plain"
                        round
                        size="small"
                      >
                        成功
                      </el-tag>
                      <el-tag
                        v-else-if="item.row.state === 'fail'"
                        type="danger"
                        effect="plain"
                        round
                        size="small"
                      >
                        失败
                      </el-tag>
                      <el-tag
                        v-else
                        type="info"
                        effect="plain"
                        round
                        size="small"
                      >
                        跳过
                      </el-tag>
                      <span
                        v-if="item.row.httpStatus != null"
                        class="user-risk-api-card__http"
                      >HTTP {{ item.row.httpStatus }}</span>
                      <el-button
                        v-if="riskSlotManualQueryEnabled(item.row.slotKey)"
                        type="primary"
                        size="small"
                        plain
                        class="user-risk-api-card__btn"
                        :loading="manualRiskSlotLoading === item.row.slotKey"
                        :disabled="(manualRiskSlotLoading !== null && manualRiskSlotLoading !== item.row.slotKey) || fullRiskCheckLoading || !userRiskSnapshot.configured"
                        @click.stop="invokeManualRiskSlot(item.row)"
                      >
                        手动查询
                      </el-button>
                    </span>
                  </summary>
                  <div class="user-risk-api-card__fold-body">
                    <p
                      v-if="item.row.state === 'skipped' && item.row.skippedReason"
                      class="user-risk-api-card__skip"
                    >
                      {{ item.row.skippedReason }}
                    </p>
                    <p
                      v-if="item.row.error"
                      class="user-risk-api-card__err"
                    >
                      {{ item.row.error }}
                    </p>
                    <div
                      v-if="item.row.state !== 'skipped' && item.facts.length > 0"
                      class="user-risk-api-card__facts"
                    >
                      <div
                        v-for="(fl, fli) in item.facts"
                        :key="fli"
                        class="user-risk-fact-row"
                      >
                        <span class="user-risk-fact-row__label">{{ fl.label }}</span>
                        <span
                          class="user-risk-fact-row__value"
                          :class="{ 'user-risk-fact-row__value--emphasis': fl.emphasis }"
                        >{{ fl.value }}</span>
                      </div>
                    </div>
                    <p
                      v-else-if="item.row.state !== 'skipped' && item.row.rawResponse != null && item.facts.length === 0"
                      class="user-risk-api-card__hint-soft"
                    >
                      暂无业务摘要，请展开「原始数据」或由技术人员核对。
                    </p>
                    <details
                      v-if="item.row.rawResponse != null && (item.row.state !== 'skipped' || riskSlotShowsRawWhenSkipped(item.row.slotKey))"
                      class="user-risk-raw-details"
                    >
                      <summary class="user-risk-raw-details__summary">原始数据（仅供技术核对）</summary>
                      <pre class="user-risk-json user-risk-json--nested">{{ formatRiskJson(item.row.rawResponse) }}</pre>
                    </details>
                  </div>
                </details>
              </div>
            </el-collapse-item>
          </el-collapse>
        </el-collapse-item>

        <el-collapse-item name="rules">
          <template #title>
            <span class="user-risk-collapse-title">
              规则命中（按接口汇总，与档案快照一致）
              <el-tag
                type="info"
                effect="plain"
                round
                size="small"
                class="user-risk-collapse-title__tag"
              >
                {{ displayedUserRiskDetail.rules.length }} 条
              </el-tag>
            </span>
          </template>
          <p class="user-risk-rules-hint">
            每条对应一项开放平台槽位已写入库的摘要；展开后可查看详情、原始 JSON。支持「手动查询」的槽位用于<strong>重新拉取该接口</strong>并写回档案（<strong>C 类与人脸认证</strong>除外）。
          </p>
          <el-collapse
            v-model="rulesInnerCollapse"
            class="user-risk-rules-inner-collapse"
          >
            <el-collapse-item
              v-for="rule in displayedUserRiskDetail.rules"
              :key="rule.code"
              :name="rule.code"
            >
              <template #title>
                <div
                  class="risk-rule-collapse-title-row"
                  :class="{ 'risk-rule-collapse-title-row--bad': rule.hit }"
                >
                  <span class="risk-rule-collapse-title-row__icon">
                    <el-icon v-if="rule.hit">
                      <CircleClose />
                    </el-icon>
                    <el-icon v-else>
                      <CircleCheck />
                    </el-icon>
                  </span>
                  <span class="risk-rule-collapse-title-row__text">
                    {{ rule.name }}
                    <span class="risk-rule-collapse-title-row__code">{{ rule.code }}</span>
                    <span
                      v-if="rule.slotKey"
                      class="risk-rule-collapse-title-row__slot"
                    >{{ rule.slotKey }}</span>
                  </span>
                  <el-tag
                    :type="ruleStatusTagType(rule)"
                    effect="plain"
                    round
                    size="small"
                  >
                    {{ ruleStatusLabel(rule) }}
                  </el-tag>
                  <span
                    v-if="rule.httpStatus != null"
                    class="risk-rule-collapse-title-row__http"
                  >HTTP {{ rule.httpStatus }}</span>
                  <el-button
                    v-if="rule.slotKey && riskSlotManualQueryEnabled(rule.slotKey)"
                    type="primary"
                    size="small"
                    plain
                    class="risk-rule-collapse-title-row__btn"
                    :loading="manualRiskSlotLoading === rule.slotKey"
                    :disabled="(manualRiskSlotLoading !== null && manualRiskSlotLoading !== rule.slotKey) || fullRiskCheckLoading || !userRiskSnapshot.configured"
                    @click.stop="invokeManualRiskSlotFromRule(rule)"
                  >
                    手动查询
                  </el-button>
                </div>
              </template>
              <div class="risk-rule-collapse-body">
                <p class="risk-rule-card__detail risk-rule-card__detail--open">
                  {{ rule.detail }}
                </p>
                <p
                  v-if="rule.error"
                  class="user-risk-api-card__err"
                >
                  {{ rule.error }}
                </p>
                <details
                  v-if="ruleSlotRawResponse(rule) != null && (rule.rowState !== 'skipped' || (rule.slotKey && riskSlotShowsRawWhenSkipped(rule.slotKey)))"
                  class="user-risk-raw-details"
                >
                  <summary class="user-risk-raw-details__summary">原始数据（接口返回，仅供技术核对）</summary>
                  <pre class="user-risk-json user-risk-json--nested">{{ formatRiskJson(ruleSlotRawResponse(rule)) }}</pre>
                </details>
              </div>
            </el-collapse-item>
          </el-collapse>
        </el-collapse-item>
      </el-collapse>
    </div>

    <template #footer>
      <div class="user-risk-dialog-footer">
        <p class="user-risk-dialog-footer__hint">
          「全量风控核查」将<strong>仅实际请求 8 项</strong>开放平台接口（A 类运营商相关 3 项 + B 类实名包内除人脸外 5 项）；<strong>人脸认证、身份证 OCR、短信、物流、电子合同共 6 项不发起请求</strong>（与下列「跳过」一致）。打开时已加载库内快照；若需更新单条，可在「十四项」或「规则命中」内对支持项点击「手动查询」。
        </p>
        <div class="user-risk-dialog-footer__actions">
          <el-button @click="dialogVisible = false">
            关闭
          </el-button>
          <el-button
            type="warning"
            plain
            :loading="fullRiskCheckLoading"
            :disabled="riskDialogBootLoading || manualRiskSlotLoading !== null || !userRiskSnapshot?.configured"
            @click="runFullUserRiskCheck"
          >
            全量风控核查
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
  max-height: min(72vh, 760px);
  overflow-y: auto;
  padding-right: 4px;
}

.risk-hero {
  display: grid;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 12px;
  background: linear-gradient(135deg, #f8fafc 0%, #eef2ff 48%, #faf5ff 100%);
  border: 1px solid rgba(99, 102, 241, 0.18);
}

.risk-hero.risk-hero--tone-neutral {
  background: linear-gradient(135deg, #f8fafc 0%, #eef2ff 48%, #faf5ff 100%);
  border-color: rgba(99, 102, 241, 0.18);
}

.risk-hero.risk-hero--tone-success {
  background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 42%, #f0fdf4 100%);
  border-color: rgba(16, 185, 129, 0.4);
}

.risk-hero.risk-hero--tone-danger {
  background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 42%, #fff1f2 100%);
  border-color: rgba(239, 68, 68, 0.42);
}

.risk-hero.risk-hero--tone-warning {
  background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 42%, #fff7ed 100%);
  border-color: rgba(245, 158, 11, 0.48);
}

.risk-hero__decision-tag {
  font-weight: 600;
}

.risk-hero__main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
}

.risk-hero__label {
  font-size: 13px;
  color: #64748b;
  font-weight: 500;
}

.risk-hero__status {
  margin-left: 4px;
}

.risk-hero__main--stack {
  flex-direction: column;
  align-items: flex-start;
}

.risk-real-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.risk-success-rate {
  width: 100%;
}

.risk-success-rate__label {
  display: block;
  font-size: 12px;
  color: #64748b;
  margin-bottom: 6px;
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
