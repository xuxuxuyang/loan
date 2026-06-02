/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MALL_API_BASE?: string
  readonly VITE_MALL_H5_ORIGIN?: string
  readonly VITE_MALL_DEFAULT_CREDIT_QUOTA?: string
  readonly VITE_TENANT_ID?: string
  readonly VITE_PLATFORM_USERNAMES?: string
  /** true 时订单侧栏角标回退为轮询全量 GET /orders */
  readonly VITE_ADMIN_LEGACY_ORDER_BADGE_POLL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
