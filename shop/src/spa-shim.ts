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
  /**
   * 未设置 VITE_MALL_API_BASE 时一律走同源 `/api`：
   * - 开发：由 Vite proxy 转到本机 mall-api（见 vite.config）
   * - 生产：由 Nginx 反代到本机 Node（手机访问时不能用 localhost）
   * 仅当 API 与站点不同域时，才在构建时设置 VITE_MALL_API_BASE
   */
  const mallApiBase = import.meta.env.VITE_MALL_API_BASE || '/api'
  return {
    public: {
      mallApiBase,
    },
  }
}

export { $fetch } from 'ofetch'
