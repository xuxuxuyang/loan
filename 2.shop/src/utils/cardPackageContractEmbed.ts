import { resolveTenantId } from './tenant'

/**
 * 卡包合同 iframe：补足 tenantId query；并与 `VITE_MALL_API_BASE` 对齐同源。
 * —— 服务端若误用 X-Forwarded-Host（前端域名）拼装签署链接，会先指到静态站且无 tenant，
 * —— $fetch(contract-flow) 仍可能命中正确 API。
 */
export function normalizeCardPackageContractEmbedUrl(embedUrl: string, mallApiBase: string): string {
  const raw = String(embedUrl || '').trim()
  if (!raw || import.meta.env.SSR || typeof window === 'undefined')
    return raw

  const tid = resolveTenantId()

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

    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.pathname.startsWith('/api') && u.origin !== apiOrigin)
      u = new URL(`${u.pathname}${u.search}${u.hash}`, `${apiOrigin}/`)

    const cur = u.searchParams.get('tenantId')
    if (!cur?.trim())
      u.searchParams.set('tenantId', tid)

    return u.toString()
  }
  catch {
    try {
      const withQ = raw.includes('?') ? '&' : '?'
      const join = `${raw}${withQ}tenantId=${encodeURIComponent(tid)}`
      return join
    }
    catch {
      return raw
    }
  }
}
