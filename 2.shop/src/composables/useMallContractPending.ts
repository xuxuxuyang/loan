import type { Router } from 'vue-router'
import { Capacitor } from '@capacitor/core'
import { resolveTenantId } from '~/utils/tenant'
import { normalizeMallAccount, useMallAuth } from './useMallAuth'

let pendingCheckRunning = false

function resolveMallApiBase() {
  const runtimeConfig = useRuntimeConfig()
  return runtimeConfig.public.mallApiBase || '/api'
}

function mallTenantQueryProps() {
  if (import.meta.env.SSR)
    return {} as Record<string, string>
  return { tenantId: resolveTenantId() }
}

export async function checkNativeMallPendingContract(router: Router): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android' || pendingCheckRunning) {
    return false
  }
  pendingCheckRunning = true
  try {
    const { loginPhone, profile, syncFromStorage } = useMallAuth()
    await syncFromStorage()
    const phone = normalizeMallAccount(loginPhone.value || profile.value?.phone || '')
    if (!/^1\d{10}$/.test(phone)) {
      return false
    }
    const res = await $fetch<{ success: boolean, data: null | { orderId?: string } }>(
      `${resolveMallApiBase()}/mall/contract-pending`,
      { method: 'GET', query: { phone, ...mallTenantQueryProps() } },
    )
    const orderId = String(res.data?.orderId || '').trim()
    if (!orderId) {
      return false
    }
    await router.replace({
      path: '/card-package',
      query: {
        contractOrderId: orderId,
        autoContract: '1',
      },
    })
    return true
  }
  catch (err) {
    console.warn('[mall-contract-pending] check failed', err)
    return false
  }
  finally {
    pendingCheckRunning = false
  }
}
