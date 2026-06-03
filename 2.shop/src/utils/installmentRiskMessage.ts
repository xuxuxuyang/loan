/** 与 api 先享后付 7 步风控 step.label 一致，仅用于从用户可见文案中剔除 */
const INSTALLMENT_RISK_STEP_LABELS = [
  '运营商二要素验证',
  '手机号在网时长',
  '运营商状态',
  '法院信息-个人高级版',
  '法院被执行人-高级版',
  '个人三要素对比',
  '探针C-MD5',
] as const

/** 上游 reason 里常见的步骤简称前缀（探针C：、运营商二要素： 等） */
const RISK_REASON_PREFIX_RE = /^[^：\n]{1,48}[：:]\s*/

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 将服务端风控失败原文转为用户可见结论（不含探针/步骤等项目名）。
 */
export function formatInstallmentRiskUserMessage(raw: string): string {
  let text = String(raw || '').trim()
  if (!text)
    return '系统审核不通过'

  for (const label of INSTALLMENT_RISK_STEP_LABELS) {
    const re = new RegExp(`[（(]\\s*${escapeRegExp(label)}\\s*[）)]\\s*[：:]?`, 'g')
    text = text.replace(re, '')
  }

  let prev = ''
  while (text !== prev && RISK_REASON_PREFIX_RE.test(text)) {
    prev = text
    text = text.replace(RISK_REASON_PREFIX_RE, '')
  }

  text = text.trim()
  return text || '系统审核不通过'
}

/** 先享后付下单风控失败 Toast 文案 */
export function installmentRiskRejectToast(detail?: string, heading = '审核未通过'): string {
  return `${heading}：${formatInstallmentRiskUserMessage(detail || '')}`
}
