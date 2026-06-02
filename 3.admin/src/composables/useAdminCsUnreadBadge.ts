import { onUnmounted, ref, watch, type ComputedRef } from 'vue'
import { useRoute } from 'vue-router'
import { getAdminSession, isSuperAdminRole } from './useAdminAuth'
import { withMallTenantHeaders } from './useAdminApi'

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

/** 侧边栏「客服消息」：是否有未读（布尔，不展示条数） */
export const csMenuHasUnread = ref(false)

let pollTimer: ReturnType<typeof setInterval> | null = null

/** 与订单侧栏角标一致，非客服页低频轮询 */
const POLL_MS = 15000

async function fetchCsBadge() {
  const s = getAdminSession()
  if (!s?.token || (!isSuperAdminRole(s.role) && s.role !== 'reviewer')) {
    csMenuHasUnread.value = false
    return
  }
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/cs/badge`, {
      method: 'GET',
      headers: withMallTenantHeaders(),
    })
    const payload = await response.json() as {
      success?: boolean
      data?: { hasUnread?: boolean }
    }
    if (!response.ok || payload.success === false) {
      return
    }
    csMenuHasUnread.value = Boolean(payload.data?.hasUnread)
  }
  catch {
    /* 静默失败，保留上次状态 */
  }
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

/** 不在客服页、标签在前台时才轮询；客服页由 CsMessagesPage 拉会话并写入 csMenuHasUnread */
function applyCsBadgePolling(enabled: boolean, path: string) {
  stopPolling()
  if (!enabled) {
    csMenuHasUnread.value = false
    return
  }
  if (path === '/cs-messages') {
    return
  }
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return
  }
  void fetchCsBadge()
  pollTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return
    }
    void fetchCsBadge()
  }, POLL_MS)
}

/**
 * 登录且角色可看客服时轮询未读状态；无权或登出时清零并停止。
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
    csMenuHasUnread.value = false
  })

  return { refreshCsMenuUnread: fetchCsBadge }
}
