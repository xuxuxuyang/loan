import { createRouter, createWebHistory } from 'vue-router'
import { getAdminSession, isAdminAuthenticated } from '../composables/useAdminAuth'

import AccountManagePage from '../views/AccountManagePage.vue'
import DashboardPage from '../views/DashboardPage.vue'
import LoginPage from '../views/LoginPage.vue'
import OrdersPage from '../views/OrdersPage.vue'
import OrderReviewPage from '../views/OrderReviewPage.vue'
import ProductsPage from '../views/ProductsPage.vue'
import UsersPage from '../views/UsersPage.vue'

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
      name: 'dashboard',
      component: DashboardPage,
      meta: { title: '数据大盘', roles: ['super_admin', 'reviewer', 'customer_service'] },
    },
    {
      path: '/orders',
      name: 'orders',
      component: OrdersPage,
      meta: { title: '订单管理', roles: ['super_admin', 'reviewer', 'customer_service'] },
    },
    {
      path: '/orders/review',
      name: 'order-review',
      component: OrderReviewPage,
      meta: { title: '审核订单', roles: ['super_admin', 'reviewer'] },
    },
    {
      path: '/users',
      name: 'users',
      component: UsersPage,
      meta: { title: '用户管理', roles: ['super_admin', 'reviewer', 'customer_service'] },
    },
    {
      path: '/accounts',
      name: 'accounts',
      component: AccountManagePage,
      meta: { title: '账号管理', roles: ['super_admin'] },
    },
    {
      path: '/products',
      name: 'products',
      component: ProductsPage,
      meta: { title: '产品管理', roles: ['super_admin'] },
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
  if (authed && to.name === 'login') {
    return { name: 'dashboard' }
  }
  const session = getAdminSession()
  const allowRoles = Array.isArray(to.meta.roles) ? to.meta.roles.map(String) : []
  if (allowRoles.length > 0 && (!session || !allowRoles.includes(session.role))) {
    return { name: 'dashboard' }
  }
  return true
})

export default router
