import { createApp } from 'vue'
import { addCollection } from '@iconify/vue'
import type { IconifyJSON } from '@iconify/vue'
import tablerIcons from '@iconify-json/tabler/icons.json'
import App from './App.vue'
import router from './router'
import { captureRegisterChannelFromRoute } from './composables/useRegisterChannel'
import { installTenantFetchInterceptor } from './utils/tenant'

import './assets/styles/tailwind.css'
import './assets/styles/main.scss'

/** 离线注册 Tabler，避免运行时请求 api.iconify.design（本地易出现 CORS / net::ERR_FAILED） */
addCollection(tablerIcons as IconifyJSON)

router.beforeEach((to) => {
  captureRegisterChannelFromRoute(to.query as Record<string, unknown>)
  return true
})

const app = createApp(App)
app.use(router)
installTenantFetchInterceptor()
app.mount('#app')
