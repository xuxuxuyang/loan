import { createApp } from 'vue'
import { ElLoadingDirective } from 'element-plus'
import 'element-plus/es/components/loading/style/css'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
import 'nprogress/nprogress.css'
import './style.css'
import App from './App.vue'
import router from './router'
import { clearAdminSessionIfTokenMatches } from './composables/useAdminAuth'
import { clearAdminVisitedTags } from './composables/useAdminVisitedTags'
import { installTenantFetchInterceptor } from './utils/tenant'

const app = createApp(App)
app.use(router)
// 保留 v-loading 能力，组件本体改由按需自动注册。
app.directive('loading', ElLoadingDirective)
installTenantFetchInterceptor({
  onAdminSessionInvalid(capturedToken) {
    if (!clearAdminSessionIfTokenMatches(capturedToken)) return
    clearAdminVisitedTags()
    const current = router.currentRoute.value
    const redirect = current.name === 'login' ? '' : current.fullPath
    void router.replace({
      name: 'login',
      ...(redirect ? { query: { redirect } } : {}),
    }).catch(() => {})
  },
})
app.mount('#app')
