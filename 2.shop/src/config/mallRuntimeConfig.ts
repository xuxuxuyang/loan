export interface MallRuntimeConfigEnv {
  readonly VITE_MALL_SITE_URL?: string
  readonly VITE_MALL_ICP_TEXT?: string
  readonly VITE_MALL_ICP_LINK?: string
  readonly VITE_MALL_TRACKING_LOOKUP_URL?: string
  readonly VITE_MALL_KEFU_QR_URL?: string
  readonly VITE_MALL_KEFU_DISPLAY_NAME?: string
}

export interface MallRuntimeConfigFallbacks {
  readonly bundledKefuQrUrl?: string
}

export interface MallRuntimeConfig {
  readonly siteUrl: string
  readonly icpText: string
  readonly icpLink: string
  readonly trackingLookupUrl: string
  readonly kefuQrUrl: string
  readonly kefuDisplayName: string
}

function cleanEnvValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function resolveMallRuntimeConfigFromEnv(
  env: MallRuntimeConfigEnv,
  fallbacks: MallRuntimeConfigFallbacks = {},
): MallRuntimeConfig {
  return {
    siteUrl: cleanEnvValue(env.VITE_MALL_SITE_URL),
    icpText: cleanEnvValue(env.VITE_MALL_ICP_TEXT),
    icpLink: cleanEnvValue(env.VITE_MALL_ICP_LINK),
    trackingLookupUrl: cleanEnvValue(env.VITE_MALL_TRACKING_LOOKUP_URL),
    kefuQrUrl: cleanEnvValue(env.VITE_MALL_KEFU_QR_URL) || cleanEnvValue(fallbacks.bundledKefuQrUrl),
    kefuDisplayName: cleanEnvValue(env.VITE_MALL_KEFU_DISPLAY_NAME),
  }
}
