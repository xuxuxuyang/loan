import { nextTick } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { ensureMallProductsLoaded } from '../composables/useTeaProducts'

/** 商城 SPA：与原 Nuxt 页面等价的 tab + 登录/下单/个人信息子场景 */
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'index', component: () => import('../views/MallHomeView.vue') },
    { path: '/list', name: 'list', component: () => import('../views/MallListView.vue') },
    { path: '/my', name: 'my', component: () => import('../views/MallMyView.vue') },
    { path: '/login', name: 'login', component: () => import('../views/MallLoginView.vue') },
    { path: '/register', name: 'register', component: () => import('../views/MallRegisterView.vue') },
    { path: '/order-create', name: 'order-create', component: () => import('../views/MallOrderCreateView.vue') },
    { path: '/orders', name: 'orders', component: () => import('../views/MallOrdersView.vue') },
    { path: '/bank-card', name: 'bank-card', component: () => import('../views/MallBankCardView.vue') },
    { path: '/bill', name: 'bill', component: () => import('../views/MallBillView.vue') },
    { path: '/address', name: 'address', component: () => import('../views/MallAddressView.vue') },
    { path: '/card-package', name: 'card-package', component: () => import('../views/MallCardPackageView.vue') },
    // 兜底：未知路径交给首页底部 Tab 的体验更一致（亦可改为 404）
    { path: '/:pathMatch(.*)*', name: 'not-found', redirect: '/' },
  ],
})

/** 从登录或其它页进入首页 / 列表时，若首次拉取早于组件 onMounted，或 getCurrentInstance 异常，仍可触发一次商品请求 */
router.afterEach((to) => {
  if (import.meta.env.SSR) {
    return
  }
  if (to.name !== 'index' && to.name !== 'list') {
    return
  }
  nextTick(() => {
    void ensureMallProductsLoaded()
  })
})

export default router
