import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { captureRegisterChannelFromRoute } from './composables/useRegisterChannel'

import './assets/styles/tailwind.css'
import './assets/styles/main.scss'
/** 仅模板中使用的组件会按需注入样式；JS 调用的 ElMessageBox / ElMessage 需手动引入，否则弹层无布局与遮罩 */
import 'element-plus/es/components/message-box/style/css'
import 'element-plus/es/components/message/style/css'

router.beforeEach((to) => {
  captureRegisterChannelFromRoute(to.query as Record<string, unknown>)
  return true
})

const app = createApp(App)
app.use(router)
app.mount('#app')
