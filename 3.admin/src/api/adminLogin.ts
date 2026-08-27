import type { AdminPermissions } from '../composables/useAdminPermissions'
import { getAdminSession, type AdminRole } from '../composables/useAdminAuth'

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

export interface AdminLoginChallenge {
  challengeId: string
  phoneMasked: string
  expiresAt: string
  resendAt: string
}

export interface VerifiedAdminLogin {
  username: string
  name?: string
  token: string
  expiresAt: string
  adminRole: AdminRole
  roleLabel?: string
  scopeType?: 'platform' | 'tenant'
  tenantId?: string
  scopeTenantIds?: string[]
  permissions?: AdminPermissions
}

type ApiEnvelope<T> = {
  success?: boolean
  msg?: string
  data?: T
}

async function postAdminLogin<T>(path: string, body?: Record<string, string>, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const response = await fetch(`${MALL_API_BASE}${path}`, {
    method: 'POST',
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const rawText = await response.text()
  let result: ApiEnvelope<T> = {}
  try {
    result = JSON.parse(rawText) as ApiEnvelope<T>
  }
  catch {
    result = { msg: rawText || '请求失败，请检查接口地址' }
  }
  if (!response.ok || !result.data) {
    throw new Error(String(result.msg || '请求失败'))
  }
  return result.data
}

export async function createAdminLoginChallenge(credentials: { username: string, password: string }) {
  return postAdminLogin<AdminLoginChallenge>('/admin/login', credentials)
}

export async function verifyAdminLoginChallenge(challengeId: string, code: string) {
  return postAdminLogin<VerifiedAdminLogin>('/admin/login/verify', { challengeId, code })
}

/** Server revocation is best effort; callers always clear the browser session themselves. */
export async function revokeAdminLoginSession(token = getAdminSession()?.token) {
  if (!token) {
    return
  }
  await postAdminLogin<{ revoked: boolean }>('/admin/logout', undefined, token)
}
