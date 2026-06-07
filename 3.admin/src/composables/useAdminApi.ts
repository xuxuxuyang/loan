import type { AdminPermissions } from './useAdminPermissions'
import { getAdminSession, setAdminSession } from './useAdminAuth'

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

function normalizeProfilePermissions(raw: unknown): AdminPermissions | undefined {
  if (!raw || typeof raw !== 'object')
    return undefined
  const input = raw as { menus?: unknown, actions?: unknown }
  const menus = Array.isArray(input.menus)
    ? input.menus.map(item => String(item || '').trim()).filter(Boolean)
    : []
  if (!menus.length)
    return undefined
  const actions: Record<string, string[]> = {}
  if (input.actions && typeof input.actions === 'object') {
    Object.entries(input.actions as Record<string, unknown>).forEach(([key, list]) => {
      const menuKey = String(key || '').trim()
      if (!menuKey)
        return
      const next = Array.isArray(list)
        ? list.map(item => String(item || '').trim()).filter(Boolean)
        : []
      if (next.length)
        actions[menuKey] = next
    })
  }
  return { menus, actions }
}

/** 从 /admin/profile 同步姓名与权限（权限变更后无需重新登录即可刷新侧栏） */
export async function syncAdminSessionProfile(): Promise<boolean> {
  const current = getAdminSession()
  if (!current)
    return false
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/profile`, {
      headers: withAdminAuthHeaders(),
    })
    const result = await response.json() as {
      data?: { name?: string, permissions?: AdminPermissions }
    }
    if (!response.ok || !result?.data)
      return false
    const name = String(result.data.name || '').trim()
    const permissions = normalizeProfilePermissions(result.data.permissions)
    const next = { ...current }
    let changed = false
    if (name && name !== String(current.name || '').trim()) {
      next.name = name
      changed = true
    }
    if (permissions && JSON.stringify(permissions) !== JSON.stringify(current.permissions || null)) {
      next.permissions = permissions
      changed = true
    }
    if (!changed)
      return false
    setAdminSession(next)
    return true
  }
  catch {
    return false
  }
}

/** @deprecated 使用 syncAdminSessionProfile */
export async function syncAdminSessionDisplayName(): Promise<boolean> {
  return syncAdminSessionProfile()
}

/**
 * 请求头工作区约定（与 api mongo 分库一致）：
 * - **withMallTenantHeaders**：商城业务（users、products、orders、admin/traffic-channels、admin/cs、账单/待收 等），须与 H5 的 tenant + x-tenant-id 一致。
 * - 平台账号在 **子系统工作区**（`isPlatformManagingTenantWorkspace`）时，业务接口须统一用 `withMallTenantHeaders`；勿再按 `scopeType === 'platform'` 直连 `/platform/accounts` 等 core 接口（见 `shouldUseHeadquartersPlatformApi`）。
 * - **withAdminAuthHeaders({ 'x-workspace-type': 'core' })**：总部元数据（platform/tenants、platform/accounts、platform/dashboard 等）→ mall__core。
 * - **withAdminAuthHeaders()**：平台默认 self → mall__self；仅当确实有「平台自营库」需求时使用，勿用于对上述商城业务的管理。
 * - **登录**：LoginPage 不加工作区头。
 */
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
  if (session?.username) {
    // Bearer 仅用 mock-token-手机号，无法用手机号在多库中可靠区分身份（易误命中平台或其它子系统同号账号）
    headers.set('x-admin-username', session.username)
  }
  if (session?.tenantId) {
    headers.set('x-tenant-id', session.tenantId)
  }
  headers.set('x-workspace-type', resolveRequestWorkspaceType(session))
  // 调用方传入的 header 作为最终覆盖，便于按行定向切换子系统/工作区。
  const override = new Headers(init)
  override.forEach((value, key) => {
    headers.set(key, value)
  })
  return headers
}

/**
 * 与商城 H5、主子系统 default 共用根库 `mall` 中的业务数据（users / products / orders / trafficChannels / csSessions 等）。
 * 平台账号在 withAdminAuthHeaders 中默认 x-workspace-type 为 self（mall__self），与 H5 不一致，
 * 管「注册用户、商品」等须显式传 tenant。
 */
export function withMallTenantHeaders(extra: Record<string, string> = {}) {
  return withAdminAuthHeaders({
    'x-workspace-type': 'tenant',
    ...extra,
  })
}
