import { getTrafficPartnerSession } from './useTrafficPartnerAuth'
import { withTrafficPartnerHeaders } from '../utils/tenant'

export const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

export async function trafficPartnerFetch(path: string, init: RequestInit = {}) {
  const session = getTrafficPartnerSession()
  const extra: Record<string, string> = {}
  if (init.body && !new Headers(init.headers).has('Content-Type')) {
    extra['Content-Type'] = 'application/json'
  }
  const headers = withTrafficPartnerHeaders(extra)
  const override = new Headers(init.headers)
  override.forEach((value, key) => {
    headers.set(key, value)
  })
  if (session?.token) {
    headers.set('Authorization', `Bearer ${session.token}`)
  }
  const response = await fetch(`${MALL_API_BASE}${path}`, { ...init, headers })
  const rawText = await response.text()
  let result: { success?: boolean, msg?: string, data?: unknown } = {}
  try {
    result = JSON.parse(rawText)
  }
  catch {
    result = { msg: rawText || `请求失败: ${response.status}` }
  }
  if (!response.ok || result.success === false) {
    throw new Error(result.msg || `请求失败: ${response.status}`)
  }
  return result
}
