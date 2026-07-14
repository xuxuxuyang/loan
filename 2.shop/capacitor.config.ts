import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.wenshuo.mall',
  appName: '文硕商城',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  ios: {
    contentInset: 'always',
  },
  plugins: {
    CapacitorUpdater: {
      /** manual 模式：由 useAppOtaUpdate 拉取 OSS latest.json 并更新 */
      autoUpdate: false,
    },
  },
}

export default config
