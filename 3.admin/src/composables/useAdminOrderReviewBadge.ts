import { onUnmounted, ref, watch, type ComputedRef } from 'vue'
import { useRoute } from 'vue-router'
import { computeAdminOrderSidebarCounts } from '../stores/useOrdersStore'
import { getAdminSession } from './useAdminAuth'
import { withMallTenantHeaders } from './useAdminApi'

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

/** 设为 true 时才使用全量 GET /orders（仅作紧急回滚用，默认禁用以避免后台角标读全库） */
const USE_LEGACY_ORDER_BADGE_POLL = String(import.meta.env.VITE_ADMIN_LEGACY_ORDER_BADGE_POLL || '').trim() === 'true'

/**
 * 侧栏「未审核订单」：与审核页默认列表一致，仅统计「待审核」（不含「风控未通过」）。
 */
export const ordersMenuPendingReviewTotal = ref(0)

/**
 * 侧栏「已审核订单」：OrdersPage 主列表（已人工审核且卡包未发放）条数。
 */
export const ordersMenuReviewedListTotal = ref(0)

let pollTimer: ReturnType<typeof setInterval> | null = null

const POLL_SLOW_MS = 15000

/** 与主列表同屏加载的页：延后角标请求，避免与 overview / accounts / products 抢 Mongo 读 */
const DEFER_SIDEBAR_BADGE_MS_BY_PATH: { prefix: string, ms: number }[] = [
  { prefix: '/traffic', ms: 1200 },
  { prefix: '/accounts', ms: 2000 },
  { prefix: '/products', ms: 1500 },
]

async function fetchOrderSidebarBadgeCountsFromLightweight() {
  const response = await fetch(`${MALL_API_BASE}/admin/orders/sidebar-counts`, {
    method: 'GET',
    headers: withMallTenantHeaders(),
  })
  const payload = await response.json() as {
    success?: boolean
    data?: { pendingReview?: number, reviewedOrdersList?: number }
  }
  if (!response.ok || payload.success === false) {
    return false
  }
  ordersMenuPendingReviewTotal.value = Math.max(0, Number(payload.data?.pendingReview || 0))
  ordersMenuReviewedListTotal.value = Math.max(0, Number(payload.data?.reviewedOrdersList || 0))
  return true
}

async function fetchOrderSidebarBadgeCountsFromLegacyOrders() {
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

/** 轮询仅更新侧栏角标数字，不替换 useOrdersStore.orders，避免 GET 订单全量快照覆盖 PATCH 刚合并的数据。 */
async function fetchOrderSidebarBadgeCounts() {
  const s = getAdminSession()
  if (!s?.token) {
    ordersMenuPendingReviewTotal.value = 0
    ordersMenuReviewedListTotal.value = 0
    return
  }
  try {
    if (USE_LEGACY_ORDER_BADGE_POLL) {
      await fetchOrderSidebarBadgeCountsFromLegacyOrders()
      return
    }
    await fetchOrderSidebarBadgeCountsFromLightweight()
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
  const deferRule = DEFER_SIDEBAR_BADGE_MS_BY_PATH.find(rule => path.startsWith(rule.prefix))
  if (deferRule && deferRule.ms > 0) {
    window.setTimeout(() => {
      void fetchOrderSidebarBadgeCounts()
    }, deferRule.ms)
  }
  else {
    void fetchOrderSidebarBadgeCounts()
  }
  // 订单列表页在审核/操作后会主动 refresh，此处只拉一次，避免与 loadOrders 叠加 5s 轮询
  if (path.startsWith('/orders')) {
    return
  }
  pollTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return
    }
    void fetchOrderSidebarBadgeCounts()
  }, POLL_SLOW_MS)
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
  })
}
