import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.wenshuo.mall',
  appName: '文硕商城',
  webDir: 'dist',
  server: {
    /** API 为 http://IP 时必须用 http，否则 WebView 会拦截 https 页面访问 http 接口 */
    androidScheme: 'http',
  },
}

export default config
