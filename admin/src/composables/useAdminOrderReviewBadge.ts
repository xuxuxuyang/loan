import { onUnmounted, ref, watch, type ComputedRef } from 'vue'
import { useRoute } from 'vue-router'
import { getAdminSession } from './useAdminAuth'
import { withAdminAuthHeaders } from './useAdminApi'

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

/**
 * 侧栏「订单管理」：风控通过且仍处人工审核队列的订单数（与审核页「待审核」口径一致）。
 * 对应 GET /orders 在 status=reviewing 且 adminStatus=待审核 时的筛选结果。
 */
export const ordersMenuPendingReviewTotal = ref(0)

let pollTimer: ReturnType<typeof setInterval> | null = null

async function fetchPendingReviewCount() {
  const s = getAdminSession()
  if (!s?.token) {
    ordersMenuPendingReviewTotal.value = 0
    return
  }
  const role = s.role
  if (role !== 'super_admin' && role !== 'reviewer' && role !== 'collector') {
    ordersMenuPendingReviewTotal.value = 0
    return
  }
  try {
    const qs = new URLSearchParams({
      status: 'reviewing',
      adminStatus: '待审核',
    })
    const response = await fetch(`${MALL_API_BASE}/orders?${qs.toString()}`, {
      method: 'GET',
      headers: withAdminAuthHeaders(),
    })
    const payload = await response.json() as {
      success?: boolean
      data?: unknown[]
    }
    if (!response.ok || payload.success === false) {
      return
    }
    const list = Array.isArray(payload.data) ? payload.data : []
    ordersMenuPendingReviewTotal.value = list.length
  }
  catch {
    /* 静默失败，保留上次数字 */
  }
}

/** 列表变更或审核操作后调用，立即同步侧栏「订单管理」未审核（风控通过）角标，不必等轮询 */
export function refreshOrdersMenuPendingReview() {
  return fetchPendingReviewCount()
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function startPolling() {
  stopPolling()
  void fetchPendingReviewCount()
  pollTimer = setInterval(() => void fetchPendingReviewCount(), 2500)
}

/**
 * 登录且角色可访问订单模块时轮询待审核（风控通过）数量；无权或登出时清零并停止。
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
      }
    },
    { immediate: true },
  )

  watch(
    () => route.path,
    (path) => {
      if (enabled.value && path.startsWith('/orders')) {
        void fetchPendingReviewCount()
      }
    },
  )

  onUnmounted(() => {
    stopPolling()
    ordersMenuPendingReviewTotal.value = 0
  })

  return { refreshOrdersMenuPendingReview }
}
