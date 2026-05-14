export type AdminRole = 'super_admin' | 'boss' | 'reviewer' | 'collector'

/** 与超级管理员同权（路由与敏感操作判断用） */
export function isSuperAdminRole(role?: AdminRole | string | null): boolean {
  return role === 'super_admin' || role === 'boss'
}

/** 路由 meta.roles / 侧栏菜单：列表含 super_admin 时，老板也可访问 */
export function adminSessionRoleAllowed(
  role: AdminRole | undefined,
  allowed: readonly AdminRole[] | undefined,
): boolean {
  if (!allowed?.length) return true
  if (!role) return false
  if (allowed.includes(role)) return true
  if (isSuperAdminRole(role) && allowed.includes('super_admin')) return true
  return false
}

/** 登录提示、顶栏等：后台角色中文名 */
export function adminRoleDisplayLabel(role?: AdminRole | string | null): string {
  if (role === 'super_admin') return '超级管理员'
  if (role === 'boss') return '老板'
  if (role === 'reviewer') return '审核员'
  if (role === 'collector') return '催收员'
  return '管理员'
}

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
    let r = String(parsed.role).trim()
    /** 历史「客服」角色已并入审核员 */
    if (r === 'customer_service' || r === 'customer-service') {
      r = 'reviewer'
    }
    if (r !== 'super_admin' && r !== 'boss' && r !== 'reviewer' && r !== 'collector') return null
    const role = r as AdminRole
    return {
      token: String(parsed.token),
      username: String(parsed.username),
      role,
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
