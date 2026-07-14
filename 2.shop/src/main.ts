import { createApp } from 'vue'
import { Capacitor } from '@capacitor/core'
import { addCollection } from '@iconify/vue'
import type { IconifyJSON } from '@iconify/vue'
import tablerIcons from '@iconify-json/tabler/icons.json'
import App from './App.vue'
import router from './router'
import { runAppOtaCheck } from './composables/useAppOtaUpdate'
import { checkNativeMallPendingContract } from './composables/useMallContractPending'
import { captureRegisterChannelFromRoute } from './composables/useRegisterChannel'
import { installTenantFetchInterceptor } from './utils/tenant'

import './assets/styles/tailwind.css'
import './assets/styles/webview-compat.scss'
import './assets/styles/main.scss'

if (typeof document !== 'undefined' && Capacitor.getPlatform() === 'ios') {
  document.documentElement.classList.add('capacitor-ios')
}

/** 离线注册 Tabler，避免运行时请求 api.iconify.design（本地易出现 CORS / net::ERR_FAILED） */
addCollection(tablerIcons as IconifyJSON)

router.beforeEach((to) => {
  captureRegisterChannelFromRoute(to.query as Record<string, unknown>)
  return true
})

function registerMallServiceWorker() {
  if (import.meta.env.DEV || typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return
  }
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[pwa] service worker registration failed', err)
    })
  })
}

async function bootstrap() {
  if (!import.meta.env.SSR) {
    void runAppOtaCheck()
  }

  const app = createApp(App)
  app.use(router)
  installTenantFetchInterceptor()
  app.mount('#app')
  void checkNativeMallPendingContract(router)
}

registerMallServiceWorker()

void bootstrap()
