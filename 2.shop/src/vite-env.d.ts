/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MALL_API_BASE?: string
  readonly VITE_MALL_DEFAULT_CREDIT_QUOTA?: string
  /** 安卓 APK 直链（如 OSS 静态托管 URL），供「我的 → App下载」打开 */
  readonly VITE_MALL_APP_APK_URL?: string
  /** Production site URL used by copy such as the iOS home-screen guide. */
  readonly VITE_MALL_SITE_URL?: string
  /** ICP record text. Leave empty to hide the ICP footer. */
  readonly VITE_MALL_ICP_TEXT?: string
  /** ICP record link. Defaults to the MIIT query website. */
  readonly VITE_MALL_ICP_LINK?: string
  /** Third-party parcel tracking lookup URL. */
  readonly VITE_MALL_TRACKING_LOOKUP_URL?: string
  /** Remote customer-service QR URL. Empty uses the bundled src/assets/kefu.png. */
  readonly VITE_MALL_KEFU_QR_URL?: string
  /** Display name shown below the customer-service QR code. */
  readonly VITE_MALL_KEFU_DISPLAY_NAME?: string
  /** OTA upload base URL used by build:ota; runtime code does not read it directly. */
  readonly VITE_APP_OTA_BASE_URL?: string
  /** 原生 App OTA：latest.json 地址（仅 Capacitor Android/iOS 启动时读取） */
  readonly VITE_APP_OTA_MANIFEST_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'qrcode' {
  export function toDataURL(text: string, options?: { width?: number, margin?: number }): Promise<string>
}

interface AdsByGoogleQueue extends Array<unknown> {
  loaded?: boolean
}

interface Window {
  adsbygoogle?: AdsByGoogleQueue
  ttq?: { track: (...args: unknown[]) => void }
  fbq?: (...args: unknown[]) => void
  bge?: (...args: unknown[]) => void
  kwaiq?: { instance: (id: string | undefined) => { track: (e: string) => void } }
  uetq?: unknown[]
  JSCallAndroid?: { adClick?: (payload: string) => void }
}
