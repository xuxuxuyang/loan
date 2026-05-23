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

/** 管理端默认授信额度：构建时从 api/.env.[mode] 注入；包内 `VITE_MALL_DEFAULT_CREDIT_QUOTA` 可覆盖 */
export const MALL_DEFAULT_CREDIT_QUOTA = resolveDefaultCreditQuotaFromEnv()

export function resolveMallCreditQuota(profile: { quota?: number } | null | undefined): number {
  const q = profile?.quota
  if (typeof q === 'number' && Number.isFinite(q) && q >= 0) {
    return Math.round(q)
  }
  return MALL_DEFAULT_CREDIT_QUOTA
}
