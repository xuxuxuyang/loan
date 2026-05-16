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

const PLATFORM_USERNAMES = String(import.meta.env.VITE_PLATFORM_USERNAMES || 'xuyang')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean)

export function isPlatformBootstrapUser(username?: string | null): boolean {
  const uname = String(username || '').trim()
  return Boolean(uname) && PLATFORM_USERNAMES.includes(uname)
}

function inferScopeTypeFromLegacySession(parsed: Partial<AdminSession>, role: AdminRole): 'platform' | 'tenant' {
  const raw = String(parsed.scopeType || '').trim()
  if (raw === 'platform') return 'platform'
  if (raw === 'tenant') return 'tenant'
  // 兼容历史会话：平台用户名白名单 + super_admin 兜底为 platform（通过 VITE_PLATFORM_USERNAMES 配置）
  if (role === 'super_admin' && isPlatformBootstrapUser(String(parsed.username || '').trim())) {
    return 'platform'
  }
  return 'tenant'
}

export interface AdminSession {
  username: string
  role: AdminRole
  token: string
  loginAt: string
  scopeType?: 'platform' | 'tenant'
  workspaceType?: 'core' | 'self' | 'tenant'
  tenantId?: string
  scopeTenantIds?: string[]
}

/** 平台总览账号已切到 mall__tenant_x（与 withMallTenantHeaders 一致） */
export function isPlatformManagingTenantWorkspace(session: AdminSession | null | undefined): boolean {
  if (!session || session.scopeType !== 'platform')
    return false
  return String(session.workspaceType || '').trim().toLowerCase() === 'tenant'
}

/**
 * 是否应对接 mall__core 上的 /platform/*（总部账号等）。
 * 平台账号在子系统工作区时必须为 false，避免误读主系统数据。
 */
export function shouldUseHeadquartersPlatformApi(session: AdminSession | null | undefined): boolean {
  if (!session || session.scopeType !== 'platform')
    return false
  return !isPlatformManagingTenantWorkspace(session)
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
      scopeType: inferScopeTypeFromLegacySession(parsed, role),
      workspaceType: ((): 'core' | 'self' | 'tenant' => {
        const raw = String(parsed.workspaceType || '').trim().toLowerCase()
        if (raw === 'core' || raw === 'self' || raw === 'tenant') {
          return raw
        }
        return inferScopeTypeFromLegacySession(parsed, role) === 'platform' ? 'core' : 'tenant'
      })(),
      tenantId: String(parsed.tenantId || '').trim() || 'default',
      scopeTenantIds: Array.isArray(parsed.scopeTenantIds)
        ? parsed.scopeTenantIds.map(item => String(item || '').trim()).filter(Boolean)
        : undefined,
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
