/**
 * 全景雷达 v4-MD5（radarV4Enc）管理端展示：面向业务管理者，仅使用中文指标名与取值。
 * 字段释义与开放平台《全景雷达》接口文档一致；若上游新增编码，可在此补充 `RADAR_V4_MANAGER_LABELS`。
 */

export interface RadarAdminFactLine {
  label: string
  value: string
  emphasis?: boolean
}

/** 接口文档：编码 → 中文指标名（管理者可读，不出现 A2216/B2217 等编码） */
export const RADAR_V4_MANAGER_LABELS: Record<string, string> = {
  A22160001: '申请准入分',
  A22160002: '申请准入置信度',
  A22160003: '申请命中机构数',
  A22160004: '申请命中消金类机构数',
  A22160005: '申请命中网络贷款类机构数',
  A22160006: '机构总查询次数',
  A22160007: '最近一次查询时间',
  A22160008: '近1个月机构总查询笔数',
  A22160009: '近3个月机构总查询笔数',
  A22160010: '近6个月机构总查询笔数',
  B22170001: '贷款行为分',
  B22170002: '近1个月贷款笔数',
  B22170003: '近3个月贷款笔数',
  B22170004: '近6个月贷款笔数',
  B22170005: '近12个月贷款笔数',
  B22170006: '近24个月贷款笔数',
  B22170007: '近1个月贷款总金额',
  B22170008: '近3个月贷款总金额',
  B22170009: '近6个月贷款总金额',
  B22170010: '近12个月贷款总金额',
  B22170011: '近24个月贷款总金额',
  B22170012: '近12个月贷款金额在1千及以下的笔数',
  B22170013: '近12个月贷款金额在1千至3千的笔数',
  B22170014: '近12个月贷款金额在3千至1万的笔数',
  B22170015: '近12个月贷款金额在1万以上的笔数',
  B22170016: '近1个月贷款机构数',
  B22170017: '近3个月贷款机构数',
  B22170018: '近6个月贷款机构数',
  B22170019: '近12个月贷款机构数',
  B22170020: '近24个月贷款机构数',
  B22170021: '近12个月消金类贷款机构数',
  B22170022: '近24个月消金类贷款机构数',
  B22170023: '近12个月网贷类贷款机构数',
  B22170024: '近24个月网贷类贷款机构数',
  B22170025: '近6个月M0+逾期贷款笔数',
  B22170026: '近12个月M0+逾期贷款笔数',
  B22170027: '近24个月M0+逾期贷款笔数',
  B22170028: '近6个月M1+逾期贷款笔数',
  B22170029: '近12个月M1+逾期贷款笔数',
  B22170030: '近24个月M1+逾期贷款笔数',
  B22170031: '近6个月累计逾期金额',
  B22170032: '近12个月累计逾期金额',
  B22170033: '近24个月累计逾期金额',
  B22170034: '正常还款订单数占贷款总订单数比例',
  B22170035: '近1个月失败扣款笔数',
  B22170036: '近3个月失败扣款笔数',
  B22170037: '近6个月失败扣款笔数',
  B22170038: '近12个月失败扣款笔数',
  B22170039: '近24个月失败扣款笔数',
  B22170040: '近1个月履约贷款总金额',
  B22170041: '近3个月履约贷款总金额',
  B22170042: '近6个月履约贷款总金额',
  B22170043: '近12个月履约贷款总金额',
  B22170044: '近24个月履约贷款总金额',
  B22170045: '近1个月履约贷款次数',
  B22170046: '近3个月履约贷款次数',
  B22170047: '近6个月履约贷款次数',
  B22170048: '近12个月履约贷款次数',
  B22170049: '近24个月履约贷款次数',
  B22170050: '最近一次履约距今天数',
  B22170051: '贷款行为置信度',
  B22170052: '贷款已结清订单数',
  B22170053: '信用贷款时长',
  B22170054: '最近一次贷款放款时间',
  C22180001: '网贷授信额度',
  C22180002: '网贷额度置信度',
  C22180003: '网络贷款类机构数',
  C22180004: '网络贷款类产品数',
  C22180005: '网络贷款机构最大授信额度',
  C22180006: '网络贷款机构平均授信额度',
  C22180007: '消金贷款类机构数',
  C22180008: '消金贷款类产品数',
  C22180009: '消金贷款类机构最大授信额度',
  C22180010: '消金贷款类机构平均授信额度',
  C22180011: '消金建议授信额度',
  C22180012: '消金额度置信度',
}

/** @deprecated 请使用 RADAR_V4_MANAGER_LABELS */
export const RADAR_V4_CODE_HINTS = RADAR_V4_MANAGER_LABELS

function sortRadarCodes(codes: string[]): string[] {
  return [...codes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

const RADAR_V4_ORDER_A = sortRadarCodes(
  Object.keys(RADAR_V4_MANAGER_LABELS).filter(k => k.startsWith('A2216')),
)
const RADAR_V4_ORDER_B = sortRadarCodes(
  Object.keys(RADAR_V4_MANAGER_LABELS).filter(k => k.startsWith('B2217')),
)
const RADAR_V4_ORDER_C = sortRadarCodes(
  Object.keys(RADAR_V4_MANAGER_LABELS).filter(k => k.startsWith('C2218')),
)

/** 管理者优先关注的结论项（加粗） */
const RADAR_V4_MANAGER_EMPHASIS = new Set([
  'A22160001', 'A22160002',
  'B22170001', 'B22170025', 'B22170026', 'B22170027', 'B22170028', 'B22170029', 'B22170030',
  'B22170031', 'B22170032', 'B22170033', 'B22170034', 'B22170051',
  'C22180001', 'C22180009', 'C22180010', 'C22180011', 'C22180012',
])

function asObject(v: unknown): Record<string, unknown> | null {
  if (v !== null && typeof v === 'object' && !Array.isArray(v))
    return v as Record<string, unknown>
  return null
}

/** 申请行为：文档为 object；部分环境可能为数组，取首条对象合并展示 */
function resolveApplyReportDetail(raw: unknown): { obj: Record<string, unknown> | null; arrayLen: number } {
  const o = asObject(raw)
  if (o) return { obj: o, arrayLen: 0 }
  if (!Array.isArray(raw)) return { obj: null, arrayLen: 0 }
  const first = asObject(raw[0])
  return { obj: first, arrayLen: raw.length }
}

function pickValue(source: Record<string, unknown> | null, code: string): unknown {
  if (!source) return undefined
  if (!Object.prototype.hasOwnProperty.call(source, code)) return undefined
  return source[code]
}

function formatManagerValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  const s = String(v).trim()
  return s === '' ? '—' : s
}

function pushOrderedSection(
  out: RadarAdminFactLine[],
  title: string,
  subtitle: string,
  order: string[],
  apply: Record<string, unknown> | null,
  beh: Record<string, unknown> | null,
  cur: Record<string, unknown> | null,
) {
  const lines: RadarAdminFactLine[] = []
  for (const code of order) {
    const label = RADAR_V4_MANAGER_LABELS[code]
    if (!label) continue
    let v: unknown
    if (code.startsWith('A2216')) v = pickValue(apply, code)
    else if (code.startsWith('B2217')) v = pickValue(beh, code)
    else if (code.startsWith('C2218')) v = pickValue(cur, code)
    if (v === undefined || v === null) continue
    lines.push({
      label,
      value: formatManagerValue(v),
      emphasis: RADAR_V4_MANAGER_EMPHASIS.has(code),
    })
  }
  if (lines.length === 0) return
  out.push({ label: title, value: subtitle, emphasis: true })
  out.push(...lines)
}

export interface BuildRadarV4DetailFactLinesOptions {
  /** 预留：若需限制行数可改小；默认展示文档中全部已返回项 */
  maxEncodedRows?: number
}

/**
 * 生成管理者可读的多行事实（中文名 + 取值，不出现编码）。
 */
export function buildRadarV4DetailFactLines(
  radar: Record<string, unknown>,
  _options?: BuildRadarV4DetailFactLinesOptions,
): RadarAdminFactLine[] {
  const out: RadarAdminFactLine[] = []

  const { obj: applyObj, arrayLen: applyArrayLen } = resolveApplyReportDetail(
    radar.apply_report_detail ?? radar.applyReportDetail,
  )
  const beh = asObject(radar.behavior_report_detail ?? radar.behaviorReportDetail)
  const cur = asObject(radar.current_report_detail ?? radar.currentReportDetail)

  out.push({
    label: '报告说明',
    value:
      '以下为全景雷达中与资信评估直接相关的指标：近期申请与查询、历史借贷与还款（含逾期与履约）、当前授信与机构分布。分数与区间含义以开放平台口径为准；逾期、失败扣款等若大于零请重点核查。',
  })

  pushOrderedSection(
    out,
    '一、近期申请与查询',
    '反映多头申请、机构查询强度与最近一次查询时间',
    RADAR_V4_ORDER_A,
    applyObj,
    beh,
    cur,
  )

  pushOrderedSection(
    out,
    '二、借贷与还款行为',
    '反映贷款频次、金额区间、机构类型、逾期、扣款失败与履约情况',
    RADAR_V4_ORDER_B,
    applyObj,
    beh,
    cur,
  )

  pushOrderedSection(
    out,
    '三、当前授信与机构',
    '反映网贷与消金授信额度、机构与产品数量及建议授信',
    RADAR_V4_ORDER_C,
    applyObj,
    beh,
    cur,
  )

  if (applyArrayLen > 1) {
    out.push({
      label: '申请明细条数',
      value: `接口返回 ${applyArrayLen} 条申请类记录，上表已合并展示首条中的指标；更多条目请展开下方「原始数据」查看`,
    })
  }

  if (radar.radarScore !== undefined)
    out.push({ label: '综合雷达评分（若有）', value: String(radar.radarScore), emphasis: true })
  else if (radar.score !== undefined)
    out.push({ label: '综合雷达评分（若有）', value: String(radar.score), emphasis: true })

  if (radar.level !== undefined)
    out.push({ label: '综合等级（若有）', value: String(radar.level), emphasis: true })

  const rid = radar.request_id ?? radar.requestId
  if (rid !== undefined && rid !== null && String(rid).trim() !== '') {
    out.push({
      label: '平台回执号（备查）',
      value: String(rid).trim(),
    })
  }

  const hasMetricSection = out.some(l =>
    l.label === '一、近期申请与查询'
    || l.label === '二、借贷与还款行为'
    || l.label === '三、当前授信与机构',
  )
  if (!hasMetricSection) {
    out.push({
      label: '提示',
      value: '当前返回中未识别到标准的申请/行为/信用三层结构，请展开「原始数据」核对渠道或字段是否有变更。',
    })
  }

  return out
}

/** 与 RISK_CONTROL_API.md 一致：用于其它模块按编码取中文段落名 */
export function radarV4SectionZh(code: string): string {
  if (/^A2216/i.test(code)) return '申请侧'
  if (/^B2217/i.test(code)) return '行为侧'
  if (/^C2218/i.test(code)) return '现状侧'
  return '其它'
}
