import { nextTick } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import {
  ensureMallProductsLoaded,
  ensureMallShowcaseProductsLoaded,
  ensureShopHomeProductsLoaded,
} from '../composables/useTeaProducts'

/** 商城 SPA：与原 Nuxt 页面等价的 tab + 登录/下单/个人信息子场景 */
const MallHomeView = () => import('../views/MallHomeView.vue')
const MallInstallmentView = () => import('../views/MallInstallmentView.vue')
const MallListView = () => import('../views/MallListView.vue')
const MallMyView = () => import('../views/MallMyView.vue')
const MallLoginView = () => import('../views/MallLoginView.vue')
const MallRegisterView = () => import('../views/MallRegisterView.vue')
const MallProductDetailView = () => import('../views/MallProductDetailView.vue')
const MallOrderCreateView = () => import('../views/MallOrderCreateView.vue')
const MallOrdersView = () => import('../views/MallOrdersView.vue')
const MallBankCardView = () => import('../views/MallBankCardView.vue')
const MallBillView = () => import('../views/MallBillView.vue')
const MallAddressView = () => import('../views/MallAddressView.vue')
const MallCardPackageView = () => import('../views/MallCardPackageView.vue')
const MallCsChatView = () => import('../views/MallCsChatView.vue')
const MallPrivacyPolicyView = () => import('../views/MallPrivacyPolicyView.vue')
const MallUserAgreementView = () => import('../views/MallUserAgreementView.vue')
const MallSearchView = () => import('../views/MallSearchView.vue')

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'index', component: MallHomeView },
    { path: '/installment', name: 'installment', component: MallInstallmentView },
    { path: '/list', name: 'list', component: MallListView },
    { path: '/my', name: 'my', component: MallMyView },
    { path: '/login', name: 'login', component: MallLoginView },
    { path: '/register', name: 'register', component: MallRegisterView },
    { path: '/product/:id', name: 'product-detail', component: MallProductDetailView },
    { path: '/order-create', name: 'order-create', component: MallOrderCreateView },
    { path: '/orders', name: 'orders', component: MallOrdersView },
    { path: '/bank-card', name: 'bank-card', component: MallBankCardView },
    { path: '/bill', name: 'bill', component: MallBillView },
    { path: '/address', name: 'address', component: MallAddressView },
    { path: '/card-package', name: 'card-package', component: MallCardPackageView },
    { path: '/cs-chat', name: 'cs-chat', component: MallCsChatView },
    { path: '/privacy-policy', name: 'privacy-policy', component: MallPrivacyPolicyView },
    { path: '/user-agreement', name: 'user-agreement', component: MallUserAgreementView },
    { path: '/search', name: 'search', component: MallSearchView },
    // 兜底：未知路径交给首页底部 Tab 的体验更一致（亦可改为 404）
    { path: '/:pathMatch(.*)*', name: 'not-found', redirect: '/' },
  ],
})

/** 从登录或其它页进入首页 / 列表时，若首次拉取早于组件 onMounted，或 getCurrentInstance 异常，仍可触发一次商品请求 */
router.afterEach((to) => {
  if (import.meta.env.SSR) {
    return
  }
  if (to.name !== 'index' && to.name !== 'list' && to.name !== 'installment' && to.name !== 'search') {
    return
  }
  nextTick(() => {
    if (to.name === 'installment') {
      void ensureMallProductsLoaded()
    }
    else if (to.name === 'search' || to.name === 'index') {
      void ensureShopHomeProductsLoaded({ refresh: true })
    }
    else {
      void ensureMallShowcaseProductsLoaded()
    }
  })
})

export default router
