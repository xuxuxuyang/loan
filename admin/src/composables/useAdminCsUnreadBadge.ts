import { onUnmounted, ref, watch, type ComputedRef } from 'vue'
import { useRoute } from 'vue-router'
import { getAdminSession, isSuperAdminRole } from './useAdminAuth'
import { withAdminAuthHeaders } from './useAdminApi'

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

/** 侧边栏「客服消息」：各会话 unread 之和 */
export const csMenuUnreadTotal = ref(0)

let pollTimer: ReturnType<typeof setInterval> | null = null

async function fetchCsUnreadSum() {
  const s = getAdminSession()
  if (!s?.token || (!isSuperAdminRole(s.role) && s.role !== 'reviewer')) {
    csMenuUnreadTotal.value = 0
    return
  }
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/cs/sessions`, {
      method: 'GET',
      headers: withAdminAuthHeaders(),
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

function startPolling() {
  stopPolling()
  void fetchCsUnreadSum()
  pollTimer = setInterval(() => void fetchCsUnreadSum(), 3500)
}

/**
 * 登录且角色可看客服时轮询未读数；无权或登出时清零并停止。
 */
export function useAdminCsUnreadBadge(enabled: ComputedRef<boolean>) {
  const route = useRoute()

  watch(
    enabled,
    (on) => {
      if (on) {
        startPolling()
      }
      else {
        stopPolling()
        csMenuUnreadTotal.value = 0
      }
    },
    { immediate: true },
  )

  watch(
    () => route.path,
    (path) => {
      if (enabled.value && path === '/cs-messages') {
        void fetchCsUnreadSum()
      }
    },
  )

  onUnmounted(() => {
    stopPolling()
    csMenuUnreadTotal.value = 0
  })

  return { refreshCsMenuUnread: fetchCsUnreadSum }
}
