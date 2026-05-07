import { getAdminSession } from './useAdminAuth'

export function withAdminAuthHeaders(init: HeadersInit = {}) {
  const session = getAdminSession()
  const headers = new Headers(init)
  if (session?.token) {
    headers.set('Authorization', `Bearer ${session.token}`)
  }
  if (session?.role) {
    headers.set('x-admin-role', session.role)
  }
  return headers
}
