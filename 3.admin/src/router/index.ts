import { createRouter, createWebHistory } from 'vue-router'
import type { AdminRole, AdminSession } from '../composables/useAdminAuth'
import { adminSessionRoleAllowed, getAdminSession, isAdminAuthenticated, isPlatformManagingTenantWorkspace } from '../composables/useAdminAuth'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    public?: boolean
    roles?: AdminRole[]
    platformOnly?: boolean
    /** true：仅超级管理员（不含主系统老板蹭 super_admin） */
    strictSuperAdminOnly?: boolean
    receivableOffsetDays?: number
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
 * 各角色登录后默认工作台（根路径 `/`、登录完毕、或无权限回退）。
 * - 超级管理员 → 账号管理
 * - 老板 → 财务报表
 * - 审核员 → 未审核订单
 * - 催收员 → 今日待收
 */
export function adminHomeRoute(session: AdminSession | null) {
  if (!session) {
    return { name: 'dashboard-overview' as const }
  }
  if (session.role === 'collector') {
    return { name: 'orders-receivable-today' as const }
  }
  if (session.role === 'reviewer') {
    return { name: 'order-review' as const }
  }
  if (session.role === 'boss') {
    return { name: 'dashboard-overview' as const }
  }
  /** super_admin：统一进账号管理（含总部/子系统工作区切换后） */
  return { name: 'accounts' as const }
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
      meta: { title: '财务报表', roles: ['super_admin'] },
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
      meta: { title: '已审核订单', roles: ['super_admin', 'reviewer', 'collector'] },
    },
    {
      path: '/orders/review',
      name: 'order-review',
      component: OrderReviewPage,
      meta: { title: '未审核订单', roles: ['super_admin', 'reviewer', 'collector'] },
    },
    {
      path: '/orders/card-data',
      name: 'orders-card-data',
      component: OrdersPage,
      meta: { title: '订单数据', roles: ['super_admin', 'reviewer', 'collector'] },
    },
    {
      path: '/orders/receivable/today',
      name: 'orders-receivable-today',
      component: ReceivableByDatePage,
      meta: { title: '今日待收', roles: ['super_admin', 'collector'], receivableOffsetDays: 0 },
    },
    {
      path: '/orders/receivable/tomorrow',
      name: 'orders-receivable-tomorrow',
      component: ReceivableByDatePage,
      meta: { title: '明日待收', roles: ['super_admin', 'collector'], receivableOffsetDays: 1 },
    },
    {
      path: '/users/ordering',
      name: 'users-ordering',
      component: UsersPage,
      meta: { title: '下单用户', roles: ['super_admin'] },
    },
    {
      path: '/users/no-order',
      name: 'users-no-order',
      component: UsersPage,
      meta: { title: '未下单用户', roles: ['super_admin'] },
    },
    {
      path: '/users',
      name: 'users',
      component: UsersPage,
      meta: { title: '注册用户', roles: ['super_admin'] },
    },
    {
      path: '/accounts',
      name: 'accounts',
      component: AccountManagePage,
      meta: { title: '账号管理', roles: ['super_admin', 'boss'] },
    },
    {
      path: '/tenants',
      name: 'tenants',
      component: TenantManagePage,
      meta: { title: '子系统管理', roles: ['super_admin'], platformOnly: true, strictSuperAdminOnly: true },
    },
    {
      path: '/tenants/mall-users-data',
      name: 'tenants-mall-users-data',
      component: TenantMallUsersDataPage,
      meta: { title: '子系统数据', roles: ['super_admin'], platformOnly: true, strictSuperAdminOnly: true },
    },
    {
      path: '/traffic',
      name: 'traffic',
      component: TrafficManagementPage,
      meta: { title: '流量管理', roles: ['super_admin'] },
    },
    {
      path: '/products/mall',
      name: 'products-mall',
      component: ProductsPage,
      meta: { title: '商城产品', roles: ['super_admin'] },
    },
    {
      path: '/products/installment',
      name: 'products-installment',
      component: ProductsPage,
      meta: { title: '先享后付产品', roles: ['super_admin'] },
    },
    {
      path: '/products',
      redirect: '/products/mall',
    },
    {
      path: '/cs-messages',
      name: 'cs-messages',
      component: CsMessagesPage,
      meta: { title: '客服消息', roles: ['super_admin', 'reviewer'] },
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
    && !adminSessionRoleAllowed(session?.role, allowRoles, {
      inheritBossAsSuperAdmin: !strictSuperAdminOnly,
    })
  ) {
    return adminHomeRoute(session)
  }
  if (to.meta.platformOnly && session?.scopeType !== 'platform') {
    return adminHomeRoute(session)
  }
  /** 子系统工作区下禁止 deep-link 进总部专页，避免误以为在读子系统数据（须先「返回总部」） */
  if (to.meta.platformOnly && isPlatformManagingTenantWorkspace(session)) {
    return adminHomeRoute(session)
  }
  return true
})

export default router
