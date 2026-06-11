/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MALL_API_BASE?: string
  readonly VITE_MALL_H5_ORIGIN?: string
  readonly VITE_MALL_DEFAULT_CREDIT_QUOTA?: string
  readonly VITE_TENANT_ID?: string
  readonly VITE_PLATFORM_USERNAMES?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
