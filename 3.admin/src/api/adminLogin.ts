import type { AdminPermissions } from '../composables/useAdminPermissions'
import { getAdminSession, type AdminRole } from '../composables/useAdminAuth'
import {
  adminLoginApiErrorFromResponse,
  validateVerifiedAdminLogin,
  type VerifiedAdminLoginContract,
} from './adminLoginContract'

export { AdminLoginApiError } from './adminLoginContract'

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

export interface AdminLoginChallenge {
  challengeId: string
  phoneMasked: string
  expiresAt: string
  resendAt: string
}

export interface VerifiedAdminLogin extends Omit<VerifiedAdminLoginContract, 'adminRole' | 'permissions'> {
  adminRole: AdminRole
  permissions?: AdminPermissions
}

type ApiEnvelope<T> = {
  success?: boolean
  msg?: string
  code?: string
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
    throw adminLoginApiErrorFromResponse(result, response.status)
  }
  return result.data
}

export async function createAdminLoginChallenge(credentials: { username: string, password: string }) {
  return postAdminLogin<AdminLoginChallenge>('/admin/login', credentials)
}

export async function verifyAdminLoginChallenge(challengeId: string, code: string) {
  const result = await postAdminLogin<unknown>('/admin/login/verify', { challengeId, code })
  return validateVerifiedAdminLogin(result) as VerifiedAdminLogin
}

/** Server revocation is best effort; callers always clear the browser session themselves. */
export async function revokeAdminLoginSession(token = getAdminSession()?.token) {
  if (!token) {
    return
  }
  await postAdminLogin<{ revoked: boolean }>('/admin/logout', undefined, token)
}
