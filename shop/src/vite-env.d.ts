/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MALL_API_BASE?: string
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
