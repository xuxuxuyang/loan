/**
 * 订单审核通过前置：用户档案中需已具备「先享后付下单七项」与「全景雷达」的实测数据
 *（与 UserRiskDetailDialog / orderSubmitSevenPanel 判定规则一致）。
 */
import { buildOrderSubmitSevenPanel, type OrderSevenPanelSnapshot } from './orderSubmitSevenPanel'

/** GET /users/:id 返回的 riskView（与 UserRiskDetailDialog.ApiRiskView 一致） */
export interface AdminUserRiskViewPayload {
  snapshot: {
    configured?: boolean
    passed?: boolean
    checkedAt?: string
    summaryMessage?: string
    fourteenRows?: OrderSevenPanelSnapshot['fourteenRows']
  } | null
  templateRows: OrderSevenPanelSnapshot['fourteenRows']
  upstreamConfigured: boolean
}

/**
 * 将接口 riskView 合并为与弹窗一致的 fourteenRows（template 14 槽 + snapshot 覆盖）。
 */
export function mergeApiRiskViewToOrderSevenSnapshot(rv: AdminUserRiskViewPayload): OrderSevenPanelSnapshot {
  const snap = rv.snapshot
  const template = Array.isArray(rv.templateRows) && rv.templateRows.length === 14
    ? rv.templateRows.map(r => ({ ...r }))
    : []
  let fourteenRows: OrderSevenPanelSnapshot['fourteenRows']
  if (template.length === 14 && snap && Array.isArray(snap.fourteenRows)) {
    for (const pr of snap.fourteenRows) {
      if (!pr || typeof pr !== 'object' || !pr.slotKey)
        continue
      const idx = template.findIndex(b => b.slotKey === pr.slotKey)
      if (idx >= 0)
        template[idx] = { ...pr }
    }
    fourteenRows = template
  }
  else {
    fourteenRows = (snap && Array.isArray(snap.fourteenRows) ? snap.fourteenRows : []) as OrderSevenPanelSnapshot['fourteenRows']
  }
  return {
    fourteenRows,
    passed: typeof snap?.passed === 'boolean' ? snap.passed : undefined,
    checkedAt: snap?.checkedAt ? String(snap.checkedAt) : undefined,
    summaryMessage: snap?.summaryMessage ? String(snap.summaryMessage) : undefined,
  }
}

/** 七项与雷达均有非「占位未测」结论时，才允许审核通过 */
export function orderRiskDataReadyForAdminApprove(snapshot: OrderSevenPanelSnapshot | null | undefined): boolean {
  const panel = buildOrderSubmitSevenPanel(snapshot)
  const sevenReady = panel.steps.every(s => s.outcome !== 'empty')
  const radarReady = panel.radarStep.outcome !== 'empty'
  return sevenReady && radarReady
}
