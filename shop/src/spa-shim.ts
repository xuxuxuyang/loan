/**
 * 纯 SPA 运行时辅助（与原 Nuxt 无关）：cookie / 简易全局状态 / 远端配置占位 / $fetch
 */
import Cookies from 'js-cookie'
import { ref, watch, type Ref } from 'vue'

const sharedState = new Map<string, Ref<unknown>>()

export function useState<T>(key: string, init: () => T): Ref<T> {
  if (!sharedState.has(key)) {
    sharedState.set(key, ref(init()) as Ref<unknown>)
  }
  return sharedState.get(key)! as Ref<T>
}

export function useCookie<T extends string>(
  key: string,
  options: { maxAge?: number; default: () => T },
): Ref<T> {
  const expiresDays = options.maxAge ? options.maxAge / 86400 : 365
  const initial = (Cookies.get(key) as T | undefined) ?? options.default()
  const v = ref(initial) as Ref<T>
  watch(
    v,
    (nv) => {
      const s = nv == null ? '' : String(nv)
      if (!s) {
        Cookies.remove(key)
      }
      else {
        Cookies.set(key, s, { expires: expiresDays })
      }
    },
    { flush: 'post' },
  )
  return v
}

export function useRuntimeConfig() {
  /** 本地 dev 默认走同源 `/api`，由 Vite proxy 转到 mall-api（见 vite.config）；生产请配 VITE_MALL_API_BASE */
  const mallApiBase
    = import.meta.env.VITE_MALL_API_BASE
      || (import.meta.env.DEV ? '/api' : 'http://localhost:3110/api')
  return {
    public: {
      mallApiBase,
    },
  }
}

export { $fetch } from 'ofetch'
