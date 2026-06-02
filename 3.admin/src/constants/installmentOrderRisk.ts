/** 与 api `ORDER_INSTALLMENT_RISK_STEP_KEYS` / 商城先享后付下单风控一致 */
export const INSTALLMENT_ORDER_RISK_STEP_KEYS = [
  'mobile2',
  'ds_phone_time',
  'ds_phone_state',
  'court_detail_pro',
  'execution_pro',
  'personal3',
  'probe_c_enc',
] as const

export type InstallmentOrderRiskStepKey = (typeof INSTALLMENT_ORDER_RISK_STEP_KEYS)[number]

export const INSTALLMENT_ORDER_RISK_STEP_LABELS: Record<InstallmentOrderRiskStepKey, string> = {
  mobile2: '运营商二要素验证',
  ds_phone_time: '手机号在网时长',
  ds_phone_state: '运营商状态',
  court_detail_pro: '法院信息-个人高级版',
  execution_pro: '法院被执行人-高级版',
  personal3: '个人三要素对比',
  probe_c_enc: '探针C-MD5',
}

export const INSTALLMENT_ORDER_RISK_STEP_COUNT = INSTALLMENT_ORDER_RISK_STEP_KEYS.length
