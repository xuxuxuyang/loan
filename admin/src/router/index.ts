import { createRouter, createWebHistory } from 'vue-router'

import DashboardPage from '../views/DashboardPage.vue'
import OrdersPage from '../views/OrdersPage.vue'
import UsersPage from '../views/UsersPage.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'dashboard',
      component: DashboardPage,
      meta: { title: '数据大盘' },
    },
    {
      path: '/orders',
      name: 'orders',
      component: OrdersPage,
      meta: { title: '订单管理' },
    },
    {
      path: '/users',
      name: 'users',
      component: UsersPage,
      meta: { title: '用户管理' },
    },
  ],
})

export default router
