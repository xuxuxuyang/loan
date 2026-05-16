import { getAdminSession } from './useAdminAuth'

function resolveRequestWorkspaceType(session: ReturnType<typeof getAdminSession>) {
  const raw = String(session?.workspaceType || '').trim().toLowerCase()
  if (raw === 'tenant') {
    return 'tenant'
  }
  if (session?.scopeType === 'platform') {
    // 平台账号默认走自营业务库；总部管理接口由调用方显式覆盖为 core。
    return 'self'
  }
  if (raw === 'core' || raw === 'self') {
    return raw
  }
  return 'tenant'
}

export function withAdminAuthHeaders(init: HeadersInit = {}) {
  const session = getAdminSession()
  const headers = new Headers()
  if (session?.token) {
    headers.set('Authorization', `Bearer ${session.token}`)
  }
  if (session?.role) {
    headers.set('x-admin-role', session.role)
  }
  if (session?.tenantId) {
    headers.set('x-tenant-id', session.tenantId)
  }
  headers.set('x-workspace-type', resolveRequestWorkspaceType(session))
  // 调用方传入的 header 作为最终覆盖，便于按行定向切换租户/工作区。
  const override = new Headers(init)
  override.forEach((value, key) => {
    headers.set(key, value)
  })
  return headers
}
