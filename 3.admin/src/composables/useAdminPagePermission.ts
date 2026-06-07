import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { adminSessionRevision, getAdminSession } from './useAdminAuth'
import {
  adminHasConfiguredPermissions,
  adminHasPermissionAction,
  permissionKeyForPath,
  type AdminPermissionAction,
} from './useAdminPermissions'

/**
 * 当前路由页面对应的权限 key 与各操作是否可见。
 * @param explicitKey 无 route.meta.permissionKey 时可显式传入
 * @param legacyWhenUnconfigured 未配置账号权限时的回退（保持旧角色逻辑）
 */
export function useAdminPagePermission(
  explicitKey?: string,
  legacyWhenUnconfigured: boolean | (() => boolean) = true,
) {
  const route = useRoute()

  const permissionKey = computed(() => {
    void adminSessionRevision.value
    const fromMeta = String(route.meta.permissionKey || '').trim()
    if (fromMeta)
      return fromMeta
    if (explicitKey)
      return explicitKey
    return permissionKeyForPath(route.path) || ''
  })

  function resolveLegacy() {
    return typeof legacyWhenUnconfigured === 'function'
      ? legacyWhenUnconfigured()
      : legacyWhenUnconfigured
  }

  function can(action: AdminPermissionAction) {
    return computed(() => {
      void adminSessionRevision.value
      const session = getAdminSession()
      const key = permissionKey.value
      if (!session)
        return false
      if (session.role === 'super_admin')
        return true
      if (!key)
        return resolveLegacy()
      if (!adminHasConfiguredPermissions(session))
        return resolveLegacy()
      return adminHasPermissionAction(session, key, action)
    })
  }

  return {
    permissionKey,
    canView: can('view'),
    canCreate: can('create'),
    canUpdate: can('update'),
    canDelete: can('delete'),
    canExport: can('export'),
    canPermission: can('permission'),
    canReply: can('reply'),
    canReview: can('review'),
    canIssueCard: can('issueCard'),
    canMarkPaid: can('markPaid'),
    canSwitchTenant: can('switchTenant'),
  }
}
