import { onUnmounted, ref, watch, type ComputedRef } from 'vue'
import { useRoute } from 'vue-router'
import { computeAdminOrderSidebarCounts } from '../stores/useOrdersStore'
import { getAdminSession, isSuperAdminRole } from './useAdminAuth'
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

/** 轮询仅更新侧栏角标数字，不替换 useOrdersStore.orders，避免 GET 订单全量快照覆盖 PATCH 刚合并的数据。 */

async function fetchOrderSidebarBadgeCounts() {
  const s = getAdminSession()
  if (!s?.token) {
    ordersMenuPendingReviewTotal.value = 0
    ordersMenuReviewedListTotal.value = 0
    return
  }
  const role = s.role
  /** 与侧栏 ordersSidebarBadgeEnabled 一致：老板与 super_admin 同权拉角标 */
  if (!isSuperAdminRole(role) && role !== 'reviewer' && role !== 'collector') {
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

function startPolling() {
  stopPolling()
  void fetchOrderSidebarBadgeCounts()
  pollTimer = setInterval(() => void fetchOrderSidebarBadgeCounts(), 2500)
}

/**
 * 登录且角色可访问订单模块时轮询未审核队列数量；无权或登出时清零并停止。
 */
export function useAdminOrderReviewBadge(enabled: ComputedRef<boolean>) {
  const route = useRoute()

  watch(
    enabled,
    (on) => {
      if (on) {
        startPolling()
      }
      else {
        stopPolling()
        ordersMenuPendingReviewTotal.value = 0
        ordersMenuReviewedListTotal.value = 0
      }
    },
    { immediate: true },
  )

  watch(
    () => route.path,
    (path) => {
      if (enabled.value && path.startsWith('/orders')) {
        void fetchOrderSidebarBadgeCounts()
      }
    },
  )

  onUnmounted(() => {
    stopPolling()
    ordersMenuPendingReviewTotal.value = 0
    ordersMenuReviewedListTotal.value = 0
  })

  return { refreshOrdersMenuPendingReview }
}
