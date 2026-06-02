import { createApp } from 'vue'
import 'element-plus/es/components/message/style/css'
import './style.css'
import App from './App.vue'
import router from './router'

createApp(App).use(router).mount('#app')
