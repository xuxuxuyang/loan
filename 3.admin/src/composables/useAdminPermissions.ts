import type { AdminSession } from './useAdminAuth'
import { adminSessionRoleAllowed } from './useAdminAuth'

export interface AdminPermissions {
  menus: string[]
  actions: Record<string, string[]>
}

/** 侧栏路径 → 权限目录 key（与 1.api adminPermissions.js 一致） */
export const ADMIN_PATH_PERMISSION_KEY: Record<string, string> = {
  '/cs-messages': 'cs.messages',
  '/orders/review': 'orders.review',
  '/orders': 'orders.approved',
  '/orders/card-data': 'orders.cardData',
  '/orders/receivable/today': 'orders.receivable.today',
  '/orders/receivable/tomorrow': 'orders.receivable.tomorrow',
  '/orders/receivable/data': 'orders.receivable.data',
  '/users': 'users.registered',
  '/users/registered-whitelist': 'users.registeredWhitelist',
  '/users/no-order': 'users.noOrder',
  '/users/ordering': 'users.ordering',
  '/users/card-package-issued': 'users.cardPackageIssued',
  '/products/installment': 'products.installment',
  '/products/mall': 'products.mall',
  '/accounts': 'accounts',
  '/traffic': 'traffic',
  '/dashboard': 'dashboard',
  '/dashboard/plan': 'dashboardSimulation',
  '/tenants': 'tenants.system',
  '/tenants/mall-users-data': 'tenants.mallUsersData',
}

/** 权限 key → 路由（用于默认首页） */
export const ADMIN_PERMISSION_KEY_ROUTE: Record<string, { name: string, path: string }> = {
  'cs.messages': { name: 'cs-messages', path: '/cs-messages' },
  'orders.review': { name: 'order-review', path: '/orders/review' },
  'orders.approved': { name: 'orders', path: '/orders' },
  'orders.cardData': { name: 'orders-card-data', path: '/orders/card-data' },
  'orders.receivable.today': { name: 'orders-receivable-today', path: '/orders/receivable/today' },
  'orders.receivable.tomorrow': { name: 'orders-receivable-tomorrow', path: '/orders/receivable/tomorrow' },
  'orders.receivable.data': { name: 'orders-receivable-data', path: '/orders/receivable/data' },
  'users.registered': { name: 'users', path: '/users' },
  'users.registeredWhitelist': { name: 'users-registered-whitelist', path: '/users/registered-whitelist' },
  'users.noOrder': { name: 'users-no-order', path: '/users/no-order' },
  'users.ordering': { name: 'users-ordering', path: '/users/ordering' },
  'users.cardPackageIssued': { name: 'users-card-package-issued', path: '/users/card-package-issued' },
  'products.installment': { name: 'products-installment', path: '/products/installment' },
  'products.mall': { name: 'products-mall', path: '/products/mall' },
  'accounts': { name: 'accounts', path: '/accounts' },
  'traffic': { name: 'traffic', path: '/traffic' },
  'dashboard': { name: 'dashboard-overview', path: '/dashboard' },
  'dashboardSimulation': { name: 'dashboard-plan', path: '/dashboard/plan' },
  'tenants.system': { name: 'tenants', path: '/tenants' },
  'tenants.mallUsersData': { name: 'tenants-mall-users-data', path: '/tenants/mall-users-data' },
}

/** 默认首页优先级：与权限配置树自上而下一致 */
export const ADMIN_HOME_PERMISSION_ORDER = [
  'cs.messages',
  'orders.review',
  'orders.approved',
  'orders.cardData',
  'orders.receivable.today',
  'orders.receivable.tomorrow',
  'orders.receivable.data',
  'users.registered',
  'users.registeredWhitelist',
  'users.noOrder',
  'users.ordering',
  'users.cardPackageIssued',
  'products.installment',
  'products.mall',
  'accounts',
  'traffic',
  'dashboard',
  'dashboardSimulation',
  'tenants.system',
  'tenants.mallUsersData',
] as const

/** 各角色首选默认首页（须已配置对应「查看」权限，否则回退到其它已配置权限页） */
const ROLE_PREFERRED_HOME_PERMISSION: Partial<Record<AdminSession['role'], string>> = {
  super_admin: 'accounts',
  boss: 'dashboard',
  reviewer: 'orders.review',
  collector: 'orders.receivable.today',
}

export function permissionKeyForPath(path: string): string | undefined {
  const normalized = String(path || '').trim().replace(/\/+$/, '') || '/'
  return ADMIN_PATH_PERMISSION_KEY[normalized]
}

export type AdminPermissionAction =
  | 'view'
  | 'reply'
  | 'review'
  | 'issueCard'
  | 'fillTracking'
  | 'markPaid'
  | 'delayRepayment'
  | 'settleAmount'
  | 'negotiateRepayment'
  | 'revokePaid'
  | 'updateStatus'
  | 'updateContract'
  | 'setQuota'
  | 'remark'
  | 'blacklist'
  | 'riskCheck'
  | 'resetPassword'
  | 'toggleOnSale'
  | 'uploadImage'
  | 'toggleStatus'
  | 'changeRole'
  | 'editChannel'
  | 'bindPortalAccount'
  | 'purgeTenantData'
  | 'export'
  | 'remove'
  | 'create'
  | 'update'
  | 'delete'
  | 'permission'
  | 'switchTenant'

/** 账号是否具备某菜单下的具体操作权限（与 1.api hasAdminPermission 一致） */
export function adminHasPermissionAction(
  session: AdminSession | null | undefined,
  permissionKey: string,
  action: AdminPermissionAction | string,
): boolean {
  if (!session)
    return false
  if (session.role === 'super_admin')
    return true
  const key = String(permissionKey || '').trim()
  const act = String(action || 'view').trim() || 'view'
  if (!key)
    return false
  const permissions = session.permissions
  if (!permissions?.menus?.length)
    return false
  if (!permissions.menus.includes(key))
    return false
  const allowed = permissions.actions?.[key]
  return Array.isArray(allowed) && allowed.includes(act)
}

export function adminHasMenuView(
  session: AdminSession | null | undefined,
  permissionKey: string,
): boolean {
  if (!session)
    return false
  const permissions = session.permissions
  if (!permissions?.menus?.length)
    return true
  const key = String(permissionKey || '').trim()
  if (!key)
    return true
  if (!permissions.menus.includes(key))
    return false
  const actions = permissions.actions?.[key]
  if (Array.isArray(actions))
    return actions.includes('view')
  return true
}

export function adminHasConfiguredPermissions(session: AdminSession | null | undefined): boolean {
  return Boolean(session?.permissions?.menus?.length)
}

export function adminCanAccessMenuPath(
  session: AdminSession | null | undefined,
  path: string,
  allowedRoles?: readonly AdminSession['role'][],
  options?: { inheritBossAsSuperAdmin?: boolean },
): boolean {
  if (!session)
    return false
  const key = permissionKeyForPath(path)
  if (adminHasConfiguredPermissions(session)) {
    if (!key)
      return false
    return adminHasMenuView(session, key)
  }
  if (allowedRoles?.length && !adminSessionRoleAllowed(session.role, allowedRoles, options))
    return false
  return true
}

export function listAccessibleAdminRoutes(session: AdminSession | null | undefined) {
  if (!session || !adminHasConfiguredPermissions(session))
    return []
  const routes: Array<{ name: string, path: string, permissionKey: string }> = []
  const pushKey = (permissionKey: string) => {
    if (!adminHasMenuView(session, permissionKey))
      return
    const route = ADMIN_PERMISSION_KEY_ROUTE[permissionKey]
    if (!route || routes.some(item => item.name === route.name))
      return
    routes.push({ ...route, permissionKey })
  }
  ADMIN_HOME_PERMISSION_ORDER.forEach(pushKey)
  session.permissions!.menus.forEach((key) => {
    pushKey(String(key || '').trim())
  })
  return routes
}

function routeForPermissionKey(permissionKey: string) {
  return ADMIN_PERMISSION_KEY_ROUTE[String(permissionKey || '').trim()]
}

/** 登录默认页：优先角色首选页（需有权限），否则进入其它已配置权限中的第一个页面 */
export function resolveAdminHomeRoute(session: AdminSession | null | undefined) {
  if (!session)
    return { name: 'dashboard-overview' as const }

  const preferredKey = ROLE_PREFERRED_HOME_PERMISSION[session.role]
  const preferredRoute = preferredKey ? routeForPermissionKey(preferredKey) : undefined

  if (adminHasConfiguredPermissions(session)) {
    if (preferredKey && preferredRoute && adminHasMenuView(session, preferredKey))
      return { name: preferredRoute.name }
    const accessible = listAccessibleAdminRoutes(session)
    if (accessible.length)
      return { name: accessible[0].name }
    return preferredRoute
      ? { name: preferredRoute.name }
      : { name: 'accounts' as const }
  }

  if (preferredRoute)
    return { name: preferredRoute.name }
  return { name: 'accounts' as const }
}
