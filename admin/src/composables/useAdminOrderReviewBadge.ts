import { onUnmounted, ref, watch, type ComputedRef } from 'vue'
import { useRoute } from 'vue-router'
import { computeAdminOrderSidebarCounts } from '../stores/useOrdersStore'
import { getAdminSession } from './useAdminAuth'
import { withMallTenantHeaders } from './useAdminApi'

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

/**
 * 侧栏「未审核订单」：与审核页一致，含「待审核」与「风控未通过」（仍处于 reviewing 人工队列）。
 */
export const ordersMenuPendingReviewTotal = ref(0)

/**
 * 侧栏「已审核订单」：OrdersPage 主列表（已人工审核且卡包未发放）条数。
 */
export const ordersMenuReviewedListTotal = ref(0)

let pollTimer: ReturnType<typeof setInterval> | null = null

const POLL_FAST_MS = 2500
const POLL_SLOW_MS = 12000

/** 轮询仅更新侧栏角标数字，不替换 useOrdersStore.orders，避免 GET 订单全量快照覆盖 PATCH 刚合并的数据。 */

async function fetchOrderSidebarBadgeCounts() {
  const s = getAdminSession()
  if (!s?.token) {
    ordersMenuPendingReviewTotal.value = 0
    ordersMenuReviewedListTotal.value = 0
    return
  }
  try {
    const response = await fetch(`${MALL_API_BASE}/orders`, {
      method: 'GET',
      headers: withMallTenantHeaders(),
    })
    const payload = await response.json() as {
      success?: boolean
      data?: unknown[]
    }
    if (!response.ok || payload.success === false) {
      return
    }
    const list = Array.isArray(payload.data) ? payload.data : []
    const { pendingReview, reviewedOrdersList } = computeAdminOrderSidebarCounts(list)
    ordersMenuPendingReviewTotal.value = pendingReview
    ordersMenuReviewedListTotal.value = reviewedOrdersList
  }
  catch {
    /* 静默失败，保留上次数字 */
  }
}

/** 列表变更或审核操作后调用，立即同步侧栏「订单管理」未审核与已审核列表角标，不必等轮询 */
export function refreshOrdersMenuPendingReview() {
  return fetchOrderSidebarBadgeCounts()
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function applyOrderBadgePolling(enabled: boolean, path: string) {
  stopPolling()
  if (!enabled) {
    ordersMenuPendingReviewTotal.value = 0
    ordersMenuReviewedListTotal.value = 0
    return
  }
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return
  }
  void fetchOrderSidebarBadgeCounts()
  const ms = path.startsWith('/orders') ? POLL_FAST_MS : POLL_SLOW_MS
  pollTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return
    }
    void fetchOrderSidebarBadgeCounts()
  }, ms)
}

/**
 * 登录后轮询侧栏订单角标；登出时清零并停止（不按角色限制拉取）。
 * 非订单模块页使用较长间隔，减少与客服页等场景的并发请求。
 */
export function useAdminOrderReviewBadge(enabled: ComputedRef<boolean>) {
  const route = useRoute()

  function reconcile() {
    applyOrderBadgePolling(enabled.value, route.path)
  }

  watch([enabled, () => route.path], reconcile, { immediate: true })

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', reconcile)
  }

  onUnmounted(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', reconcile)
    }
    stopPolling()
    ordersMenuPendingReviewTotal.value = 0
    ordersMenuReviewedListTotal.value = 0
  })

  return { refreshOrdersMenuPendingReview }
}
