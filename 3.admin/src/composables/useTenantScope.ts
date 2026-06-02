import { computed } from 'vue'
import { adminSessionRevision, getAdminSession, setAdminSession } from './useAdminAuth'
import { withAdminAuthHeaders } from './useAdminApi'

export interface TenantSummary {
  tenantId: string
  label: string
  tenantName?: string
  userCount?: number
  orderCount?: number
  productCount?: number
}

function normalizeTenantId(raw: string) {
  const value = String(raw || '').trim().toLowerCase()
  if (!value) return 'default'
  return value.replace(/[^a-z0-9_-]/g, '').slice(0, 64) || 'default'
}

function tenantLabel(tenantId: string) {
  return tenantId === 'default' ? '主系统' : tenantId
}

export function useTenantScope() {
  const session = computed(() => {
    void adminSessionRevision.value
    return getAdminSession()
  })
  const isPlatform = computed(() => session.value?.scopeType === 'platform')
  const workspaceType = computed<'core' | 'self' | 'tenant'>(() => {
    const raw = String(session.value?.workspaceType || '').trim().toLowerCase()
    if (raw === 'core' || raw === 'self' || raw === 'tenant') {
      return raw
    }
    return isPlatform.value ? 'core' : 'tenant'
  })
  const allowedTenants = computed<string[]>(() => {
    const list = session.value?.scopeTenantIds || []
    if (!list.length) {
      return [normalizeTenantId(session.value?.tenantId || 'default')]
    }
    return list
  })

  const selectedTenantId = computed(() => {
    const current = normalizeTenantId(session.value?.tenantId || 'default')
    if (!isPlatform.value) {
      return current
    }
    if (allowedTenants.value.includes('*')) {
      return current
    }
    return allowedTenants.value.includes(current) ? current : normalizeTenantId(allowedTenants.value[0] || 'default')
  })

  const tenantOptions = computed<TenantSummary[]>(() => {
    if (!isPlatform.value) {
      const tenantId = normalizeTenantId(session.value?.tenantId || 'default')
      return [{ tenantId, label: tenantLabel(tenantId), tenantName: tenantLabel(tenantId) }]
    }
    if (allowedTenants.value.includes('*')) {
      const current = selectedTenantId.value
      return [{ tenantId: current, label: tenantLabel(current), tenantName: tenantLabel(current) }]
    }
    return allowedTenants.value.map(item => ({
      tenantId: normalizeTenantId(item),
      label: tenantLabel(normalizeTenantId(item)),
      tenantName: tenantLabel(normalizeTenantId(item)),
    }))
  })

  async function fetchTenantOptions(apiBase: string, _headers?: HeadersInit): Promise<TenantSummary[]> {
    if (!isPlatform.value) {
      return tenantOptions.value
    }
    try {
      const resp = await fetch(`${apiBase.replace(/\/$/, '')}/platform/tenants`, {
        method: 'GET',
        /** 子系统清单在 core 库；勿用默认 self，否则平台超管会扫错库 */
        headers: withAdminAuthHeaders({ 'x-workspace-type': 'core' }),
      })
      const payload = await resp.json() as { success?: boolean, data?: Array<Record<string, unknown>> }
      if (!resp.ok || payload.success === false || !Array.isArray(payload.data)) {
        return tenantOptions.value
      }
      return payload.data.map((item) => {
        const tenantId = normalizeTenantId(String(item.tenantId || 'default'))
        const tenantNameRaw = String(item.tenantName || '').trim()
        const tenantName = tenantNameRaw || tenantLabel(tenantId)
        return {
          tenantId,
          label: tenantName,
          tenantName,
          userCount: Number(item.userCount || 0),
          orderCount: Number(item.orderCount || 0),
          productCount: Number(item.productCount || 0),
        }
      })
    }
    catch {
      return tenantOptions.value
    }
  }

  function switchTenant(tenantId: string) {
    const sess = session.value
    if (!sess) return
    const next = normalizeTenantId(tenantId)
    if (!isPlatform.value) return
    if (!allowedTenants.value.includes('*') && !allowedTenants.value.includes(next)) return
    setAdminSession({
      ...sess,
      workspaceType: 'tenant',
      tenantId: next,
    })
  }

  function switchWorkspace(nextWorkspaceType: 'core' | 'self' | 'tenant') {
    const sess = session.value
    if (!sess || !isPlatform.value) return
    if (nextWorkspaceType === 'tenant') {
      setAdminSession({
        ...sess,
        workspaceType: 'tenant',
      })
      return
    }
    setAdminSession({
      ...sess,
      workspaceType: nextWorkspaceType,
      tenantId: 'default',
    })
  }

  return {
    isPlatform,
    workspaceType,
    selectedTenantId,
    tenantOptions,
    fetchTenantOptions,
    switchTenant,
    switchWorkspace,
  }
}
