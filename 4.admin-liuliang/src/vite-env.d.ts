/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MALL_API_BASE?: string
  /** 商城 H5 根地址，用于拼推广链接 ?channel= */
  readonly VITE_MALL_H5_ORIGIN?: string
  /** 与主系统 shop/admin 一致，读写同一 Mongo 租户库 */
  readonly VITE_TENANT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
