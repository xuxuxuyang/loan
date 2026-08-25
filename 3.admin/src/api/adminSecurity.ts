import { apiErrorMessage, withMallTenantHeaders } from '../composables/useAdminApi'

const API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

export const ACTION_CODES = {
  REPAYMENT_MARK_PAID: 'repayment.mark_paid',
  REPAYMENT_CHANGE_DUE_DATE: 'repayment.change_due_date',
  REPAYMENT_NEGOTIATE: 'repayment.negotiate',
  REPAYMENT_SETTLE_AMOUNT: 'repayment.settle_amount',
  REPAYMENT_NEGOTIATION_PAID: 'repayment.negotiation_paid',
  USER_DELETE: 'user.delete',
  ORDER_DELETE: 'order.delete',
  USER_EXPORT: 'user.export',
} as const

export type AdminSecurityActionCode = typeof ACTION_CODES[keyof typeof ACTION_CODES]
export type AdminSecurityMode = 'off' | 'audit' | 'enforce'
export type AdminSecurityLogStatus = 'pending' | 'success' | 'failed' | 'blocked'

export interface AdminSecurityIntent {
  actionCode: AdminSecurityActionCode
  target: Record<string, unknown>
  input: Record<string, unknown>
}

export interface AdminSecurityStatus {
  mode: AdminSecurityMode
  tenantEnabled: boolean
  otpReady: boolean
  phoneMasked: string
}

export interface AdminSecurityChallenge {
  challengeId: string
  phoneMasked: string
  expiresAt: string
  resendAt: string
}

export interface AdminSecurityProof {
  proofToken: string
  expiresAt: string
  scope: string
  reusable: boolean
}

export interface AdminSecurityAuditLog {
  id: string
  requestId: string
  tenantId: string
  actor: { id?: string, username?: string, name?: string, role?: string, phoneMasked?: string }
  ip: string
  userAgent: string
  actionCode: string
  actionLabel: string
  category: string
  target: {
    userId?: string
    userName?: string
    phoneMasked?: string
    orderId?: string
    period?: number
    historyIndex?: number
    view?: string
  }
  summary: string
  changes: Array<{ label?: string, before?: unknown, after?: unknown }>
  verificationMode: string
  status: AdminSecurityLogStatus
  error: string
  createdAt: string
  completedAt?: string | null
}

export class AdminSecurityApiError extends Error {
  code: string
  status: number

  constructor(message: string, code = '', status = 400) {
    super(message)
    this.name = 'AdminSecurityApiError'
    this.code = code
    this.status = status
  }
}

export function adminSecurityProofHeaders(proofToken?: string): Record<string, string> {
  return proofToken ? { 'X-Admin-Security-Proof': proofToken } : {}
}

async function securityJson<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => ({})) as {
    success?: boolean
    code?: string
    msg?: string
    data?: T
  }
  if (!response.ok || payload.success === false) {
    throw new AdminSecurityApiError(
      apiErrorMessage(payload, fallback),
      String(payload.code || ''),
      response.status,
    )
  }
  return payload.data as T
}

export async function fetchAdminSecurityStatus() {
  const response = await fetch(`${API_BASE}/admin/security/status`, {
    headers: withMallTenantHeaders(),
  })
  return securityJson<AdminSecurityStatus>(response, '读取安全状态失败')
}

export async function createAdminSecurityChallenge(intent: AdminSecurityIntent) {
  const response = await fetch(`${API_BASE}/admin/security/challenges`, {
    method: 'POST',
    headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(intent),
  })
  return securityJson<AdminSecurityChallenge>(response, '发送验证码失败')
}

export async function verifyAdminSecurityChallenge(challengeId: string, code: string) {
  const response = await fetch(`${API_BASE}/admin/security/challenges/${encodeURIComponent(challengeId)}/verify`, {
    method: 'POST',
    headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ code }),
  })
  return securityJson<AdminSecurityProof>(response, '验证码校验失败')
}

export interface AdminSecurityAuditQuery {
  from?: string
  to?: string
  category?: string
  status?: string
  actorId?: string
  keyword?: string
  ip?: string
  page?: number
  pageSize?: number
}

export async function fetchAdminSecurityAuditLogs(query: AdminSecurityAuditQuery) {
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim())
      params.set(key, String(value))
  })
  const response = await fetch(`${API_BASE}/admin/security/audit-logs?${params}`, {
    headers: withMallTenantHeaders(),
  })
  return securityJson<{ items: AdminSecurityAuditLog[], total: number, page: number, pageSize: number }>(response, '读取操作记录失败')
}

export async function fetchAdminSecurityAuditLog(id: string) {
  const response = await fetch(`${API_BASE}/admin/security/audit-logs/${encodeURIComponent(id)}`, {
    headers: withMallTenantHeaders(),
  })
  return securityJson<AdminSecurityAuditLog>(response, '读取操作详情失败')
}
