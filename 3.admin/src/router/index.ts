import { createRouter, createWebHistory } from 'vue-router'
import type { AdminRole, AdminSession } from '../composables/useAdminAuth'
import { adminSessionRoleAllowed, getAdminSession, isAdminAuthenticated, isPlatformManagingTenantWorkspace } from '../composables/useAdminAuth'
import {
  adminHasConfiguredPermissions,
  adminHasMenuView,
  listAccessibleAdminRoutes,
  permissionKeyForPath,
  resolveAdminHomeRoute,
} from '../composables/useAdminPermissions'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    public?: boolean
    roles?: AdminRole[]
    platformOnly?: boolean
    /** true：仅超级管理员（不含主系统老板蹭 super_admin） */
    strictSuperAdminOnly?: boolean
    receivableOffsetDays?: number
    receivableDatePicker?: boolean
    permissionKey?: string
  }
}

const LoginPage = () => import('../views/LoginPage.vue')
const DashboardPage = () => import('../views/DashboardPage.vue')
const OrdersPage = () => import('../views/OrdersPage.vue')
const OrderReviewPage = () => import('../views/OrderReviewPage.vue')
const ReceivableByDatePage = () => import('../views/ReceivableByDatePage.vue')
const UsersPage = () => import('../views/UsersPage.vue')
const AccountManagePage = () => import('../views/AccountManagePage.vue')
const TenantManagePage = () => import('../views/TenantManagePage.vue')
const TenantMallUsersDataPage = () => import('../views/TenantMallUsersDataPage.vue')
const TrafficManagementPage = () => import('../views/TrafficManagementPage.vue')
const ProductsPage = () => import('../views/ProductsPage.vue')
const CsMessagesPage = () => import('../views/CsMessagesPage.vue')

/**
 * 登录后默认工作台：
 * - 老板 → 财务报表（需有 dashboard 权限）
 * - 审核员 → 未审核订单（需有 orders.review 权限）
 * - 催收员 → 今日待收（需有 orders.receivable.today 权限）
 * - 无首选页权限时 → 进入其它已配置权限中的第一个页面
 */
export function adminHomeRoute(session: AdminSession | null) {
  return resolveAdminHomeRoute(session)
}

function resolvePermissionDeniedRedirect(
  session: AdminSession | null,
  currentRouteName: string | symbol | null | undefined,
) {
  const accessible = listAccessibleAdminRoutes(session)
  const fallback = accessible.length
    ? { name: accessible[0].name }
    : adminHomeRoute(session)
  if (fallback.name === currentRouteName) {
    const alternate = accessible.find(item => item.name !== currentRouteName)
    if (alternate)
      return { name: alternate.name }
    return true
  }
  return fallback
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginPage,
      meta: { title: '登录', public: true },
    },
    {
      path: '/',
      redirect: () => {
        const session = getAdminSession()
        return session ? adminHomeRoute(session) : { name: 'dashboard-overview' as const }
      },
    },
    {
      path: '/platform',
      redirect: '/tenants',
    },
    {
      path: '/dashboard',
      name: 'dashboard-overview',
      component: DashboardPage,
      meta: { title: '财务报表', roles: ['super_admin'], permissionKey: 'dashboard' },
    },
    {
      path: '/dashboard/receivable/today',
      redirect: '/orders/receivable/today',
    },
    {
      path: '/dashboard/receivable/tomorrow',
      redirect: '/orders/receivable/tomorrow',
    },
    {
      path: '/orders',
      name: 'orders',
      component: OrdersPage,
      meta: { title: '已审核订单', roles: ['super_admin', 'reviewer', 'collector'], permissionKey: 'orders.approved' },
    },
    {
      path: '/orders/review',
      name: 'order-review',
      component: OrderReviewPage,
      meta: { title: '未审核订单', roles: ['super_admin', 'reviewer', 'collector'], permissionKey: 'orders.review' },
    },
    {
      path: '/orders/card-data',
      name: 'orders-card-data',
      component: OrdersPage,
      meta: { title: '订单数据', roles: ['super_admin', 'reviewer', 'collector'], permissionKey: 'orders.cardData' },
    },
    {
      path: '/orders/receivable/today',
      name: 'orders-receivable-today',
      component: ReceivableByDatePage,
      meta: { title: '今日待收', roles: ['super_admin', 'collector'], receivableOffsetDays: 0, permissionKey: 'orders.receivable.today' },
    },
    {
      path: '/orders/receivable/tomorrow',
      name: 'orders-receivable-tomorrow',
      component: ReceivableByDatePage,
      meta: { title: '明日待收', roles: ['super_admin', 'collector'], receivableOffsetDays: 1, permissionKey: 'orders.receivable.tomorrow' },
    },
    {
      path: '/orders/receivable/data',
      name: 'orders-receivable-data',
      component: ReceivableByDatePage,
      meta: { title: '待收数据', roles: ['super_admin', 'collector'], receivableDatePicker: true, permissionKey: 'orders.receivable.data' },
    },
    {
      path: '/users/card-package-issued',
      name: 'users-card-package-issued',
      component: UsersPage,
      meta: { title: '已发放卡包客户', roles: ['super_admin'], permissionKey: 'users.cardPackageIssued' },
    },
    {
      path: '/users/ordering',
      name: 'users-ordering',
      component: UsersPage,
      meta: { title: '下单用户', roles: ['super_admin'], permissionKey: 'users.ordering' },
    },
    {
      path: '/users/registered-whitelist',
      name: 'users-registered-whitelist',
      component: UsersPage,
      meta: { title: '注册白名单', roles: ['super_admin'], permissionKey: 'users.registeredWhitelist' },
    },
    {
      path: '/users/no-order',
      name: 'users-no-order',
      component: UsersPage,
      meta: { title: '未下单用户', roles: ['super_admin'], permissionKey: 'users.noOrder' },
    },
    {
      path: '/users',
      name: 'users',
      component: UsersPage,
      meta: { title: '注册用户', roles: ['super_admin'], permissionKey: 'users.registered' },
    },
    {
      path: '/accounts',
      name: 'accounts',
      component: AccountManagePage,
      meta: { title: '账号管理', roles: ['super_admin', 'boss'], permissionKey: 'accounts' },
    },
    {
      path: '/tenants',
      name: 'tenants',
      component: TenantManagePage,
      meta: { title: '子系统管理', roles: ['super_admin'], platformOnly: true, strictSuperAdminOnly: true, permissionKey: 'tenants.system' },
    },
    {
      path: '/tenants/mall-users-data',
      name: 'tenants-mall-users-data',
      component: TenantMallUsersDataPage,
      meta: { title: '子系统数据', roles: ['super_admin'], platformOnly: true, strictSuperAdminOnly: true, permissionKey: 'tenants.mallUsersData' },
    },
    {
      path: '/traffic',
      name: 'traffic',
      component: TrafficManagementPage,
      meta: { title: '流量管理', roles: ['super_admin'], permissionKey: 'traffic' },
    },
    {
      path: '/products/mall',
      name: 'products-mall',
      component: ProductsPage,
      meta: { title: '商城产品', roles: ['super_admin'], permissionKey: 'products.mall' },
    },
    {
      path: '/products/installment',
      name: 'products-installment',
      component: ProductsPage,
      meta: { title: '先享后付产品', roles: ['super_admin'], permissionKey: 'products.installment' },
    },
    {
      path: '/products',
      redirect: '/products/mall',
    },
    {
      path: '/cs-messages',
      name: 'cs-messages',
      component: CsMessagesPage,
      meta: { title: '客服消息', roles: ['super_admin', 'reviewer', 'collector'], permissionKey: 'cs.messages' },
    },
  ],
})

router.beforeEach((to) => {
  const authed = isAdminAuthenticated()
  const isPublic = Boolean(to.meta.public)

  if (!authed && !isPublic) {
    return {
      name: 'login',
      query: { redirect: to.fullPath },
    }
  }
  const session = getAdminSession()
  if (authed && to.name === 'login') {
    return adminHomeRoute(session)
  }
  const allowRoles = Array.isArray(to.meta.roles) ? to.meta.roles : []
  const strictSuperAdminOnly = Boolean(to.meta.strictSuperAdminOnly)
  if (
    allowRoles.length > 0
    && !adminHasConfiguredPermissions(session)
    && !adminSessionRoleAllowed(session?.role, allowRoles, {
      inheritBossAsSuperAdmin: !strictSuperAdminOnly,
    })
  ) {
    return resolvePermissionDeniedRedirect(session, to.name)
  }
  if (to.meta.platformOnly && session?.scopeType !== 'platform') {
    return adminHomeRoute(session)
  }
  /** 子系统工作区下禁止 deep-link 进总部专页，避免误以为在读子系统数据（须先「返回总部」） */
  if (to.meta.platformOnly && isPlatformManagingTenantWorkspace(session)) {
    return adminHomeRoute(session)
  }
  const permissionKey = String(to.meta.permissionKey || permissionKeyForPath(to.path) || '').trim()
  if (
    permissionKey
    && session?.permissions?.menus?.length
    && !adminHasMenuView(session, permissionKey)
  ) {
    return resolvePermissionDeniedRedirect(session, to.name)
  }
  return true
})

export default router
