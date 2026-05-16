const { normalizeTenantId, normalizeWorkspaceType, DEFAULT_TENANT_ID } = require('./tenantContext')

const TENANT_HEADER_CANDIDATES = [
  'x-tenant-id',
  'x-tenant',
  'x-org-id',
  'x-client-id',
]
const WORKSPACE_HEADER_CANDIDATES = [
  'x-workspace-type',
  'x-workspace',
]

function firstHeaderValue(headers, keys) {
  if (!headers || typeof headers !== 'object') {
    return ''
  }
  for (const key of keys) {
    const value = headers[key]
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim()
    }
  }
  return ''
}

function deriveTenantFromHost(host) {
  const h = String(host || '').trim().toLowerCase()
  if (!h) {
    return ''
  }
  const pureHost = h.split(':')[0]
  if (!pureHost || pureHost === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(pureHost)) {
    return ''
  }
  const labels = pureHost.split('.').filter(Boolean)
  if (labels.length < 3) {
    return ''
  }
  return labels[0]
}

function resolveTenantIdFromRequest(ctx) {
  if (!ctx) {
    return DEFAULT_TENANT_ID
  }
  const fromHeader = firstHeaderValue(ctx.headers, TENANT_HEADER_CANDIDATES)
  if (fromHeader) {
    return normalizeTenantId(fromHeader)
  }
  const fromQuery = ctx.query && (ctx.query.tenantId || ctx.query.tenant || ctx.query.orgId || ctx.query.clientId)
  if (fromQuery) {
    return normalizeTenantId(fromQuery)
  }
  const fromHost = deriveTenantFromHost(ctx.host || (ctx.headers && ctx.headers.host))
  if (fromHost) {
    return normalizeTenantId(fromHost)
  }
  return DEFAULT_TENANT_ID
}

function resolveWorkspaceTypeFromRequest(ctx) {
  if (!ctx) {
    return 'tenant'
  }
  const fromHeader = firstHeaderValue(ctx.headers, WORKSPACE_HEADER_CANDIDATES)
  if (fromHeader) {
    return normalizeWorkspaceType(fromHeader)
  }
  const fromQuery = ctx.query && (ctx.query.workspaceType || ctx.query.workspace)
  if (fromQuery) {
    return normalizeWorkspaceType(fromQuery)
  }
  return 'tenant'
}

module.exports = {
  TENANT_HEADER_CANDIDATES,
  WORKSPACE_HEADER_CANDIDATES,
  resolveTenantIdFromRequest,
  resolveWorkspaceTypeFromRequest,
}
