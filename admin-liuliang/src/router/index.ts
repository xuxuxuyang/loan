import { createRouter, createWebHistory } from 'vue-router'
import { getTrafficPartnerSession, isTrafficPartnerAuthenticated } from '../composables/useTrafficPartnerAuth'

const LoginPage = () => import('../views/LoginPage.vue')
const StatsPage = () => import('../views/StatsPage.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginPage,
      meta: { public: true, title: '登录' },
    },
    {
      path: '/',
      name: 'stats',
      component: StatsPage,
      meta: { title: '引流数据' },
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

router.beforeEach((to) => {
  const publicRoute = Boolean(to.meta.public)
  if (!publicRoute && !isTrafficPartnerAuthenticated()) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'login' && isTrafficPartnerAuthenticated()) {
    return { name: 'stats' }
  }
  const session = getTrafficPartnerSession()
  if (session?.name && to.meta.title) {
    document.title = `${to.meta.title} · ${session.name}`
  }
  else if (to.meta.title) {
    document.title = String(to.meta.title)
  }
})

export default router
