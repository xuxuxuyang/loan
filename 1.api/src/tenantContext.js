const { AsyncLocalStorage } = require('node:async_hooks')

const tenantStorage = new AsyncLocalStorage()
const DEFAULT_TENANT_ID = 'default'
const WORKSPACE_TYPES = new Set(['core', 'self', 'tenant'])

function normalizeTenantId(raw) {
  const value = String(raw || '').trim().toLowerCase()
  if (!value) {
    return DEFAULT_TENANT_ID
  }
  return value.replace(/[^a-z0-9_-]/g, '').slice(0, 64) || DEFAULT_TENANT_ID
}

function normalizeWorkspaceType(raw) {
  const value = String(raw || '').trim().toLowerCase()
  if (!value || !WORKSPACE_TYPES.has(value)) {
    return 'tenant'
  }
  return value
}

function buildTenantStore(tenantId, workspaceType = 'tenant') {
  const type = normalizeWorkspaceType(workspaceType)
  return {
    tenantId: type === 'tenant' ? normalizeTenantId(tenantId) : DEFAULT_TENANT_ID,
    workspaceType: type,
  }
}

function runWithTenant(tenantId, fn) {
  return tenantStorage.run(buildTenantStore(tenantId, 'tenant'), fn)
}

function runWithWorkspace(workspaceType, tenantId, fn) {
  return tenantStorage.run(buildTenantStore(tenantId, workspaceType), fn)
}

function setCurrentTenant(tenantId) {
  tenantStorage.enterWith(buildTenantStore(tenantId, 'tenant'))
}

function setCurrentWorkspace(workspaceType, tenantId) {
  tenantStorage.enterWith(buildTenantStore(tenantId, workspaceType))
}

function getCurrentTenantId() {
  const store = tenantStorage.getStore()
  const type = normalizeWorkspaceType(store && store.workspaceType ? store.workspaceType : 'tenant')
  if (type !== 'tenant') {
    return DEFAULT_TENANT_ID
  }
  return normalizeTenantId(store && store.tenantId ? store.tenantId : DEFAULT_TENANT_ID)
}

function getCurrentWorkspaceType() {
  const store = tenantStorage.getStore()
  return normalizeWorkspaceType(store && store.workspaceType ? store.workspaceType : 'tenant')
}

module.exports = {
  DEFAULT_TENANT_ID,
  WORKSPACE_TYPES,
  normalizeTenantId,
  normalizeWorkspaceType,
  runWithTenant,
  runWithWorkspace,
  setCurrentTenant,
  setCurrentWorkspace,
  getCurrentTenantId,
  getCurrentWorkspaceType,
}
