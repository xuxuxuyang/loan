import { nextTick } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import {
  ensureMallProductsLoaded,
  ensureMallShowcaseProductsLoaded,
  ensureShopHomeProductsLoaded,
  isMallCategoryKey,
} from '../composables/useTeaProducts'

function loadRouteView<T>(loader: () => Promise<{ default: T }>) {
  return () => loader().then(module => module.default)
}

/** 商城 SPA：与原 Nuxt 页面等价的 tab + 登录/下单/个人信息子场景 */
const MallHomeView = loadRouteView(() => import('../views/MallHomeView.vue'))
const MallInstallmentView = loadRouteView(() => import('../views/MallInstallmentView.vue'))
const MallListView = loadRouteView(() => import('../views/MallListView.vue'))
const MallMyView = loadRouteView(() => import('../views/MallMyView.vue'))
const MallLoginView = loadRouteView(() => import('../views/MallLoginView.vue'))
const MallRegisterView = loadRouteView(() => import('../views/MallRegisterView.vue'))
const MallProductDetailView = loadRouteView(() => import('../views/MallProductDetailView.vue'))
const MallOrderCreateView = loadRouteView(() => import('../views/MallOrderCreateView.vue'))
const MallOrdersView = loadRouteView(() => import('../views/MallOrdersView.vue'))
const MallBankCardView = loadRouteView(() => import('../views/MallBankCardView.vue'))
const MallBillView = loadRouteView(() => import('../views/MallBillView.vue'))
const MallBillRiskResultView = loadRouteView(() => import('../views/MallBillRiskResultView.vue'))
const MallAddressView = loadRouteView(() => import('../views/MallAddressView.vue'))
const MallCardPackageView = loadRouteView(() => import('../views/MallCardPackageView.vue'))
const MallCsChatView = loadRouteView(() => import('../views/MallCsChatView.vue'))
const MallPrivacyPolicyView = loadRouteView(() => import('../views/MallPrivacyPolicyView.vue'))
const MallUserAgreementView = loadRouteView(() => import('../views/MallUserAgreementView.vue'))
const MallSearchView = loadRouteView(() => import('../views/MallSearchView.vue'))
const MallTrafficLoginView = loadRouteView(() => import('../views/MallTrafficLoginView.vue'))
const MallAppDownloadView = loadRouteView(() => import('../views/MallAppDownloadView.vue'))

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
    { path: '/bill-risk-result', name: 'bill-risk-result', component: MallBillRiskResultView },
    { path: '/address', name: 'address', component: MallAddressView },
    { path: '/card-package', name: 'card-package', component: MallCardPackageView },
    { path: '/cs-chat', name: 'cs-chat', component: MallCsChatView },
    { path: '/privacy-policy', name: 'privacy-policy', component: MallPrivacyPolicyView },
    { path: '/user-agreement', name: 'user-agreement', component: MallUserAgreementView },
    { path: '/search', name: 'search', component: MallSearchView },
    { path: '/traffic-login', name: 'traffic-login', component: MallTrafficLoginView },
    { path: '/app-download', name: 'app-download', component: MallAppDownloadView },
    // 兜底：未知路径交给首页底部 Tab 的体验更一致（亦可改为 404）
    { path: '/:pathMatch(.*)*', name: 'not-found', redirect: '/' },
  ],
})

/** 从登录或其它页进入首页 / 列表时，若首次拉取早于组件 onMounted，或 getCurrentInstance 异常，仍可触发一次商品请求 */
router.afterEach((to) => {
  if (import.meta.env.SSR) {
    return
  }
  if (to.name !== 'index' && to.name !== 'list' && to.name !== 'installment') {
    return
  }
  nextTick(() => {
    if (to.name === 'installment' || to.name === 'index') {
      void ensureMallProductsLoaded()
    }
    else {
      const raw = typeof to.query.category === 'string' ? to.query.category : 'installment'
      const category = isMallCategoryKey(raw) ? raw : 'installment'
      if (category === 'installment') {
        void ensureMallProductsLoaded()
      }
      else if (category === 'all') {
        void ensureShopHomeProductsLoaded()
      }
      else {
        void ensureMallShowcaseProductsLoaded()
      }
    }
  })
})

export default router
