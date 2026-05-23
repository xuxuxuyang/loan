/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MALL_API_BASE?: string
  readonly VITE_MALL_DEFAULT_CREDIT_QUOTA?: string
  /** 安卓 APK 直链（如 OSS 静态托管 URL），供「我的 → App下载」打开 */
  readonly VITE_MALL_APP_APK_URL?: string
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
