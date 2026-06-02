import { buildRadarV4DetailFactLines } from './radarV4ReputationFacts'

/** 与风控详情弹窗一致：单条接口摘要行 */
export interface RiskFactLine {
  label: string
  value: string
  emphasis?: boolean
}

export interface RiskProductRowLike {
  slotKey: string
  rawResponse?: unknown
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

function unwrapRiskPayload(raw: unknown): Record<string, unknown> | null {
  const d = unwrapRiskDataObject(raw)
  if (!d) return null
  const inner = asRiskRecord(d.data)
  if (!inner) return d
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

/** 从开放平台原始 JSON 解析可读摘要（与 UserRiskDetailDialog 一致） */
export function getRiskFactLines(row: RiskProductRowLike): RiskFactLine[] {
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
