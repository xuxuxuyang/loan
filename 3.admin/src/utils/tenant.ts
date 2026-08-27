const TENANT_FETCH_PATCHED = '__tenantFetchPatched__'
const ADMIN_SESSION_FAILURE_CODES = new Set([
  'ADMIN_LOGIN_SESSION_INVALID',
  'ADMIN_LOGIN_SESSION_EXPIRED',
])

type TenantFetchInterceptorOptions = {
  onAdminSessionInvalid?: (capturedToken: string, code: string) => void
}

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

function readAdminSessionToken(headers: Headers): string {
  const match = /^Bearer\s+(admin-session-v1\.[A-Za-z0-9_-]{43})$/i.exec(headers.get('Authorization')?.trim() || '')
  return match?.[1] || ''
}

async function reportInvalidAdminSession(
  response: Response,
  capturedToken: string,
  options: TenantFetchInterceptorOptions,
) {
  if (response.status !== 401 || !capturedToken || !options.onAdminSessionInvalid) return
  try {
    const payload = await response.clone().json() as { code?: unknown }
    const code = typeof payload?.code === 'string' ? payload.code.trim() : ''
    if (ADMIN_SESSION_FAILURE_CODES.has(code)) {
      options.onAdminSessionInvalid(capturedToken, code)
    }
  }
  catch {
    // Preserve the original response for callers when an error body is not JSON.
  }
}

export function installTenantFetchInterceptor(options: TenantFetchInterceptorOptions = {}) {
  const patched = (window as unknown as Record<string, unknown>)[TENANT_FETCH_PATCHED]
  if (patched) {
    return
  }
  const tenantId = resolveTenantId()
  const originalFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
    if (!headers.has('x-tenant-id')) {
      headers.set('x-tenant-id', tenantId)
    }
    const capturedToken = readAdminSessionToken(headers)
    const response = await originalFetch(input, {
      ...init,
      headers,
    })
    await reportInvalidAdminSession(response, capturedToken, options)
    return response
  }

  ;(window as unknown as Record<string, unknown>)[TENANT_FETCH_PATCHED] = true
}
