import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { captureRegisterChannelFromRoute } from './composables/useRegisterChannel'

import './assets/styles/tailwind.css'
import './assets/styles/main.scss'

router.beforeEach((to) => {
  captureRegisterChannelFromRoute(to.query as Record<string, unknown>)
  return true
})

const app = createApp(App)
app.use(router)
app.mount('#app')
