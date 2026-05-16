import { getAdminSession } from './useAdminAuth'

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
  if (session?.workspaceType) {
    headers.set('x-workspace-type', session.workspaceType)
  }
  // 调用方传入的 header 作为最终覆盖，便于按行定向切换租户/工作区。
  const override = new Headers(init)
  override.forEach((value, key) => {
    headers.set(key, value)
  })
  return headers
}
