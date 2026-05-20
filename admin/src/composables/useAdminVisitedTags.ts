import { ref } from 'vue'
import type { Router, RouteLocationNormalizedLoaded } from 'vue-router'
import { adminHomeRoute } from '../router'
import { getAdminSession } from './useAdminAuth'

/** 顶部多标签中的一页（与路由 fullPath 对应，同一路径只保留一个） */
export interface AdminVisitedTag {
  fullPath: string
  title: string
  /** 工作台「首页」，不可关闭，随角色解析到默认页 */
  affix?: boolean
}

const MAX_TABS = 20

export const adminVisitedTags = ref<AdminVisitedTag[]>([])

function routeTitle(route: RouteLocationNormalizedLoaded) {
  return String(route.meta.title || (route.name != null ? String(route.name) : '') || '页面').trim() || '页面'
}

function resolvedAdminHomeFullPath(router: Router) {
  return router.resolve(adminHomeRoute(getAdminSession())).fullPath
}

function ensureAffixHome(router: Router) {
  const homePath = resolvedAdminHomeFullPath(router)
  const tags = adminVisitedTags.value
  if (tags.length === 0) {
    adminVisitedTags.value = [{ fullPath: homePath, title: '首页', affix: true }]
    return
  }
  const first = tags[0]
  if (first.affix) {
    if (first.fullPath !== homePath) {
      adminVisitedTags.value = [{ ...first, fullPath: homePath }, ...tags.slice(1)]
    }
    return
  }
  adminVisitedTags.value = [{ fullPath: homePath, title: '首页', affix: true }, ...tags]
}

/**
 * 与当前路由同步：已存在的 fullPath 只激活（不重复追加），否则追加新标签。
 */
export function syncAdminVisitedTag(router: Router, route: RouteLocationNormalizedLoaded) {
  if (route.meta.public || route.name === 'login') {
    return
  }

  ensureAffixHome(router)

  const title = routeTitle(route)
  const list = adminVisitedTags.value
  const idx = list.findIndex((t) => t.fullPath === route.fullPath)

  if (idx !== -1) {
    const cur = list[idx]
    // 首项 affix 常与角色默认页同一路径（如老板「首页」即 /dashboard）；须用当前页 meta.title 与侧栏菜单一致
    if (cur.title !== title) {
      const copy = [...list]
      copy[idx] = { ...cur, title }
      adminVisitedTags.value = copy
    }
    return
  }

  const affix0 = list[0]?.affix ? list[0] : null
  const rest = affix0 ? list.slice(1) : list
  const appended: AdminVisitedTag[] = [...rest, { fullPath: route.fullPath, title }]
  const maxRest = MAX_TABS - (affix0 ? 1 : 0)
  const trimmedRest = appended.length > maxRest ? appended.slice(-maxRest) : appended
  adminVisitedTags.value = affix0 ? [affix0, ...trimmedRest] : trimmedRest
}

/** 关闭标签；若关闭的是当前页，则跳到左侧邻近标签（或首页）。返回待跳转的 fullPath，无需跳转则返回 null。 */
export function removeAdminVisitedTag(router: Router, fullPath: string, activeFullPath: string) {
  const tags = adminVisitedTags.value
  const i = tags.findIndex((t) => t.fullPath === fullPath)
  if (i === -1 || tags[i].affix) {
    return null
  }

  const wasActive = activeFullPath === fullPath
  const next = tags.filter((_, j) => j !== i)
  adminVisitedTags.value = next

  if (!wasActive) {
    return null
  }

  const left = next[Math.max(0, i - 1)]
  return left?.fullPath ?? resolvedAdminHomeFullPath(router)
}

export function clearAdminVisitedTags() {
  adminVisitedTags.value = []
}
