/** 未配置 `VITE_MALL_DEFAULT_CREDIT_QUOTA` 或非法时的兜底（与 API 缺省回退一致） */
const MALL_DEFAULT_CREDIT_QUOTA_FALLBACK = 2750

function resolveDefaultCreditQuotaFromEnv(): number {
  const raw = import.meta.env.VITE_MALL_DEFAULT_CREDIT_QUOTA
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return MALL_DEFAULT_CREDIT_QUOTA_FALLBACK
  }
  const n = Number(String(raw).trim())
  if (!Number.isFinite(n) || n < 0) {
    return MALL_DEFAULT_CREDIT_QUOTA_FALLBACK
  }
  return Math.round(n)
}

/** 前端兜底授信额度：构建时从 api/.env.[mode] 注入；包内 `VITE_MALL_DEFAULT_CREDIT_QUOTA` 可覆盖 */
export const MALL_DEFAULT_CREDIT_QUOTA = resolveDefaultCreditQuotaFromEnv()

/** 商品小计（单价×数量），与授信额度比较用；不含先享后付系数 */
export function computeMallCreditOrderPrincipal(unitPrice: number, quantity = 1): number {
  const sub = Number((Number(unitPrice) * quantity).toFixed(2))
  if (!Number.isFinite(sub) || sub < 0) {
    return 0
  }
  return sub
}

/** 先享后付展示/入账金额：与下单页、后端 `totalAmount` 一致（等于商品小计） */
export function computeMallInstallmentRepayTotal(unitPrice: number, quantity = 1): number {
  return computeMallCreditOrderPrincipal(unitPrice, quantity)
}

export function resolveMallCreditQuota(profile: { quota?: number } | null | undefined): number {
  const q = profile?.quota
  if (typeof q === 'number' && Number.isFinite(q) && q >= 0) {
    return Math.round(q)
  }
  return MALL_DEFAULT_CREDIT_QUOTA
}

export function isProductWithinMallCredit(unitPrice: number, quantity: number, profile: { quota?: number } | null | undefined): boolean {
  return computeMallCreditOrderPrincipal(unitPrice, quantity) <= resolveMallCreditQuota(profile)
}
