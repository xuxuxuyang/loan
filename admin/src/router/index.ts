import { createRouter, createWebHistory } from 'vue-router'
import type { AdminSession } from '../composables/useAdminAuth'
import { adminSessionRoleAllowed, getAdminSession, isAdminAuthenticated, isPlatformManagingTenantWorkspace } from '../composables/useAdminAuth'

const LoginPage = () => import('../views/LoginPage.vue')
const DashboardPage = () => import('../views/DashboardPage.vue')
const OrdersPage = () => import('../views/OrdersPage.vue')
const OrderReviewPage = () => import('../views/OrderReviewPage.vue')
const ReceivableByDatePage = () => import('../views/ReceivableByDatePage.vue')
const UsersPage = () => import('../views/UsersPage.vue')
const AccountManagePage = () => import('../views/AccountManagePage.vue')
const TenantManagePage = () => import('../views/TenantManagePage.vue')
const TrafficManagementPage = () => import('../views/TrafficManagementPage.vue')
const ProductsPage = () => import('../views/ProductsPage.vue')
const CsMessagesPage = () => import('../views/CsMessagesPage.vue')

function adminHomeRoute(session: AdminSession | null) {
  if (!session) {
    return { name: 'dashboard-overview' as const }
  }
  /** 审核员/催收员固定进订单侧；避免 scopeType 被标成 platform 时误进非订单首页造成路由死循环 */
  if (session.role === 'reviewer' || session.role === 'collector') {
    return { name: 'orders' as const }
  }
  /** 平台账号切到具体子系统库后，默认进入订单端（与子系统后台使用习惯一致） */
  if (session.scopeType === 'platform' && session.workspaceType === 'tenant') {
    return { name: 'orders' as const }
  }
  if (session.scopeType === 'platform' && session.workspaceType === 'self') {
    return { name: 'orders' as const }
  }
  if (session.scopeType === 'platform') {
    return { name: 'tenants' as const }
  }
  /** 子系统侧（老板/子系统域账号）：不可进 platformOnly 的总部路由，默认与大屏订单端一致 */
  return { name: 'orders' as const }
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
      meta: { title: '订单管理', roles: ['super_admin', 'reviewer', 'collector'] },
    },
    {
      path: '/orders/review',
      name: 'order-review',
      component: OrderReviewPage,
      meta: { title: '审核订单', roles: ['super_admin', 'reviewer', 'collector'] },
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
      meta: { title: '子系统管理', roles: ['super_admin'], platformOnly: true },
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
  if (allowRoles.length > 0 && !adminSessionRoleAllowed(session?.role, allowRoles)) {
    return adminHomeRoute(session)
  }
  if (to.meta.platformOnly && session?.scopeType !== 'platform') {
    return adminHomeRoute(session)
  }
  /** 子系统工作区下禁止 deep-link 进总部专页，避免误以为在读子系统数据（须先「返回总部」） */
  if (to.meta.platformOnly && isPlatformManagingTenantWorkspace(session)) {
    return { name: 'orders' as const }
  }
  return true
})

export default router
