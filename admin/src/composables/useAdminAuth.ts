export type AdminRole = 'super_admin' | 'reviewer' | 'customer_service' | 'collector'

export interface AdminSession {
  username: string
  role: AdminRole
  token: string
  loginAt: string
}

const STORAGE_KEY = 'mall-admin-session'

function safeParseSession(value: string | null): AdminSession | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<AdminSession>
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.token || !parsed.username || !parsed.role || !parsed.loginAt) return null
    return {
      token: String(parsed.token),
      username: String(parsed.username),
      role: parsed.role as AdminRole,
      loginAt: String(parsed.loginAt),
    }
  }
  catch {
    return null
  }
}

export function getAdminSession(): AdminSession | null {
  if (typeof window === 'undefined') return null
  return safeParseSession(window.localStorage.getItem(STORAGE_KEY))
}

export function setAdminSession(session: AdminSession) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function clearAdminSession() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(STORAGE_KEY)
}

export function isAdminAuthenticated() {
  return Boolean(getAdminSession())
}
