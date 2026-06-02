import { getAdminSession } from '../composables/useAdminAuth'
import { resolveTenantId } from './tenant'

/** 从 contract-flow 的 getContract 根节点解析 iframe 地址（与商城 useCardPackageContractMeta 一致） */
export function contractEmbedUrlFromRoot(root: Record<string, unknown> | null | undefined): string {
  if (!root || typeof root !== 'object') {
    return ''
  }
  const data = root.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ''
  }
  const row = data as Record<string, unknown>
  const users = Array.isArray(row.signUser) ? (row.signUser as Record<string, unknown>[]) : []
  const first = users.find(user => user && String(user.signUrl || '').trim())
  if (first) {
    return String(first.signUrl).trim()
  }
  return String(row.signUrl || row.sign_url || row.previewUrl || row.preview_url || row.embeddedUrl || row.embedded_url || '').trim()
}

/**
 * 卡包合同 iframe：补足 tenantId query；并与 VITE_MALL_API_BASE 对齐同源（与 shop 一致）。
 */
export function normalizeCardPackageContractEmbedUrl(embedUrl: string, mallApiBase: string): string {
  const raw = String(embedUrl || '').trim()
  if (!raw || typeof window === 'undefined') {
    return raw
  }

  const session = getAdminSession()
  const tid = String(session?.tenantId || '').trim().toLowerCase() || resolveTenantId()

  try {
    const pageBase = window.location.href
    let u = new URL(raw, pageBase)

    const mb = String(mallApiBase || '/api').trim()
    let apiOrigin: string
    if (mb.startsWith('http://') || mb.startsWith('https://')) {
      apiOrigin = new URL(mb.endsWith('/') ? mb.slice(0, -1) : mb).origin
    }
    else {
      apiOrigin = new URL(mb.startsWith('/') ? mb : `/${mb}`, pageBase).origin
    }

    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.pathname.startsWith('/api') && u.origin !== apiOrigin) {
      u = new URL(`${u.pathname}${u.search}${u.hash}`, `${apiOrigin}/`)
    }

    const cur = u.searchParams.get('tenantId')
    if (!cur?.trim()) {
      u.searchParams.set('tenantId', tid)
    }

    return u.toString()
  }
  catch {
    try {
      const withQ = raw.includes('?') ? '&' : '?'
      return `${raw}${withQ}tenantId=${encodeURIComponent(tid)}`
    }
    catch {
      return raw
    }
  }
}

export function mallTenantQueryForContractApi(): Record<string, string> {
  const session = getAdminSession()
  const tid = String(session?.tenantId || '').trim().toLowerCase() || resolveTenantId()
  return { tenantId: tid }
}
