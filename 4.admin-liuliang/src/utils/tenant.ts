/** 与 shop / admin 商城业务一致：请求 API 时带上 x-tenant-id，读写同一 Mongo 租户库 */

export function resolveTenantId() {
  const envTenant = String(import.meta.env.VITE_TENANT_ID || '').trim().toLowerCase()
  if (envTenant) {
    return envTenant.replace(/[^a-z0-9_-]/g, '').slice(0, 64) || 'default'
  }
  return 'default'
}

export function withTrafficPartnerHeaders(extra: Record<string, string> = {}) {
  const headers = new Headers()
  headers.set('x-tenant-id', resolveTenantId())
  headers.set('x-workspace-type', 'tenant')
  for (const [key, value] of Object.entries(extra)) {
    headers.set(key, value)
  }
  return headers
}
