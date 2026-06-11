import bundledKefuQrUrl from '~/assets/kefu.png?url'
import { resolveMallRuntimeConfigFromEnv } from './mallRuntimeConfig'

export const MALL_RUNTIME_CONFIG = resolveMallRuntimeConfigFromEnv(import.meta.env, {
  bundledKefuQrUrl,
})
