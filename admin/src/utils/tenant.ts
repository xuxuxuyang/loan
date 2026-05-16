const TENANT_FETCH_PATCHED = '__tenantFetchPatched__'

function parseTenantFromHostname(hostname: string) {
  const host = String(hostname || '').trim().toLowerCase()
  if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return ''
  }
  const labels = host.split('.').filter(Boolean)
  if (labels.length < 3) {
    return ''
  }
  return labels[0]
}

export function resolveTenantId() {
  const envTenant = String(import.meta.env.VITE_TENANT_ID || '').trim().toLowerCase()
  const tenant = envTenant || parseTenantFromHostname(window.location.hostname) || 'default'
  return tenant.replace(/[^a-z0-9_-]/g, '').slice(0, 64) || 'default'
}

export function installTenantFetchInterceptor() {
  const patched = (window as unknown as Record<string, unknown>)[TENANT_FETCH_PATCHED]
  if (patched) {
    return
  }
  const tenantId = resolveTenantId()
  const originalFetch = window.fetch.bind(window)

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
    if (!headers.has('x-tenant-id')) {
      headers.set('x-tenant-id', tenantId)
    }
    return originalFetch(input, {
      ...init,
      headers,
    })
  }

  ;(window as unknown as Record<string, unknown>)[TENANT_FETCH_PATCHED] = true
}
