/**
 * 与 UsersPage / UserRiskDetailDialog 中「用户注册信息 · 信誉报告」一致：
 * 先享后付下单七项 + 全景雷达（八项）面板数据。
 */
import {
  INSTALLMENT_ORDER_RISK_STEP_KEYS,
  INSTALLMENT_ORDER_RISK_STEP_LABELS,
} from '../constants/installmentOrderRisk'
import { getRiskFactLines, type RiskFactLine } from './riskRowFactLines'

export interface OrderSevenSlotRow {
  slotKey: string
  productLabel: string
  state: 'ok' | 'fail' | 'skipped'
  skippedReason?: string
  error?: string
  rawResponse?: unknown
}

export interface OrderSevenPanelSnapshot {
  fourteenRows: OrderSevenSlotRow[]
  passed?: boolean
  checkedAt?: string
  summaryMessage?: string
}

function formatDateTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const yyyy = date.getFullYear()
  const mm = `${date.getMonth() + 1}`.padStart(2, '0')
  const dd = `${date.getDate()}`.padStart(2, '0')
  const hh = `${date.getHours()}`.padStart(2, '0')
  const min = `${date.getMinutes()}`.padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

export function findFourteenRow(rows: OrderSevenSlotRow[] | undefined, slotKey: string): OrderSevenSlotRow | null {
  if (!Array.isArray(rows)) {
    return null
  }
  return rows.find(r => r.slotKey === slotKey) || null
}

function isRiskRowPlaceholderSkipped(row: OrderSevenSlotRow): boolean {
  return row.state === 'skipped'
    && (String(row.skippedReason || '').includes('无执行记录') || !String(row.skippedReason || '').trim())
}

export type OrderRiskStepDisplay = {
  slotKey: string
  label: string
  row: OrderSevenSlotRow | null
  outcome: 'pass' | 'fail' | 'skip' | 'empty'
  detail: string
  facts: RiskFactLine[]
}

const RADAR_SLOT_KEY = 'radar_v4_enc'

function buildOrderRiskPreviewStep(
  slotKey: string,
  defaultLabel: string,
  row: OrderSevenSlotRow | null,
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

export function buildOrderSubmitSevenPanel(snapshot: OrderSevenPanelSnapshot | null | undefined): {
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

export type DisplayCreditStatus = '良好' | '待风控' | '风险'

export function displayCreditStatusFromOrderSevenSnapshot(snapshot: OrderSevenPanelSnapshot | null | undefined): DisplayCreditStatus {
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
