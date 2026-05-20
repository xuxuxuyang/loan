import { onUnmounted, ref, watch, type ComputedRef } from 'vue'
import { useRoute } from 'vue-router'
import { getAdminSession, isSuperAdminRole } from './useAdminAuth'
import { withMallTenantHeaders } from './useAdminApi'

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

/** 侧边栏「客服消息」：各会话 unread 之和 */
export const csMenuUnreadTotal = ref(0)

let pollTimer: ReturnType<typeof setInterval> | null = null

const POLL_MS = 5000

async function fetchCsUnreadSum() {
  const s = getAdminSession()
  if (!s?.token || (!isSuperAdminRole(s.role) && s.role !== 'reviewer')) {
    csMenuUnreadTotal.value = 0
    return
  }
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/cs/sessions`, {
      method: 'GET',
      headers: withMallTenantHeaders(),
    })
    const payload = await response.json() as {
      success?: boolean
      data?: Array<{ unread?: number }>
    }
    if (!response.ok || payload.success === false) {
      return
    }
    const list = Array.isArray(payload.data) ? payload.data : []
    csMenuUnreadTotal.value = list.reduce(
      (sum, row) => sum + Math.max(0, Number(row.unread || 0)),
      0,
    )
  }
  catch {
    /* 静默失败，保留上次数字 */
  }
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

/** 不在客服页、标签在前台时才轮询；客服页由 CsMessagesPage 拉会话并写入 csMenuUnreadTotal */
function applyCsBadgePolling(enabled: boolean, path: string) {
  stopPolling()
  if (!enabled) {
    csMenuUnreadTotal.value = 0
    return
  }
  if (path === '/cs-messages') {
    return
  }
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return
  }
  void fetchCsUnreadSum()
  pollTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return
    }
    void fetchCsUnreadSum()
  }, POLL_MS)
}

/**
 * 登录且角色可看客服时轮询未读数；无权或登出时清零并停止。
 */
export function useAdminCsUnreadBadge(enabled: ComputedRef<boolean>) {
  const route = useRoute()

  function reconcile() {
    applyCsBadgePolling(enabled.value, route.path)
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
    csMenuUnreadTotal.value = 0
  })

  return { refreshCsMenuUnread: fetchCsUnreadSum }
}
