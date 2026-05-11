/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MALL_API_BASE?: string
  /** 与后端 MALL_REGISTER_SKIP_SMS 联调；生产构建勿设 */
  readonly VITE_MALL_REGISTER_SKIP_SMS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
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
