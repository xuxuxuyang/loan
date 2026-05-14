import { createRouter, createWebHistory } from 'vue-router'
import type { AdminSession } from '../composables/useAdminAuth'
import { adminSessionRoleAllowed, getAdminSession, isAdminAuthenticated } from '../composables/useAdminAuth'
import AccountManagePage from '../views/AccountManagePage.vue'
import CsMessagesPage from '../views/CsMessagesPage.vue'
import DashboardPage from '../views/DashboardPage.vue'
import ReceivableByDatePage from '../views/ReceivableByDatePage.vue'
import LoginPage from '../views/LoginPage.vue'
import OrdersPage from '../views/OrdersPage.vue'
import OrderReviewPage from '../views/OrderReviewPage.vue'
import ProductsPage from '../views/ProductsPage.vue'
import TrafficManagementPage from '../views/TrafficManagementPage.vue'
import UsersPage from '../views/UsersPage.vue'

function adminHomeRoute(session: AdminSession | null) {
  if (session?.role === 'reviewer' || session?.role === 'collector')
    return { name: 'orders' as const }
  return { name: 'dashboard-overview' as const }
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
      redirect: '/dashboard',
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
      meta: { title: '账号管理', roles: ['super_admin'] },
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
  return true
})

export default router
