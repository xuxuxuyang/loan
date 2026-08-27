export type AdminLoginRole = 'super_admin' | 'boss' | 'reviewer' | 'collector'

export interface VerifiedAdminLoginContract {
  username: string
  token: string
  expiresAt: string
  adminRole: AdminLoginRole
  name?: string
  roleLabel?: string
  scopeType?: 'platform' | 'tenant'
  tenantId?: string
  scopeTenantIds?: string[]
  permissions?: unknown
}

const ADMIN_LOGIN_ROLES = new Set<AdminLoginRole>(['super_admin', 'boss', 'reviewer', 'collector'])
const TERMINAL_CHALLENGE_CODES = new Set([
  'ADMIN_LOGIN_CHALLENGE_EXPIRED',
  'ADMIN_LOGIN_CHALLENGE_INVALID',
  'ADMIN_LOGIN_CHALLENGE_BLOCKED',
])

export class AdminLoginApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(
    message: string,
    status: number,
    code: string,
  ) {
    super(message)
    this.name = 'AdminLoginApiError'
    this.status = status
    this.code = code
  }
}

export function adminLoginApiErrorFromResponse(
  payload: { msg?: unknown, code?: unknown },
  status: number,
): AdminLoginApiError {
  const message = typeof payload.msg === 'string' && payload.msg.trim()
    ? payload.msg.trim()
    : '请求失败'
  const code = typeof payload.code === 'string' && payload.code.trim()
    ? payload.code.trim()
    : 'ADMIN_LOGIN_REQUEST_FAILED'
  return new AdminLoginApiError(message, status, code)
}

function responseInvalid(message = '登录响应无效，请重新登录'): never {
  throw new AdminLoginApiError(message, 502, 'ADMIN_LOGIN_RESPONSE_INVALID')
}

function nonEmptyString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized || null
}

export function validateVerifiedAdminLogin(input: unknown, nowMs = Date.now()): VerifiedAdminLoginContract {
  if (!input || typeof input !== 'object') {
    return responseInvalid()
  }
  const raw = input as Record<string, unknown>
  const username = nonEmptyString(raw.username)
  const token = nonEmptyString(raw.token)
  const expiresAt = nonEmptyString(raw.expiresAt)
  const role = nonEmptyString(raw.adminRole)
  if (!username || !token || !expiresAt || !role) {
    return responseInvalid()
  }
  if (!/^admin-session-v1\.[A-Za-z0-9_-]+$/.test(token)) {
    return responseInvalid()
  }
  if (!ADMIN_LOGIN_ROLES.has(role as AdminLoginRole)) {
    return responseInvalid()
  }
  const expiresAtMs = Date.parse(expiresAt)
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    return responseInvalid()
  }
  return {
    ...raw,
    username,
    token,
    expiresAt,
    adminRole: role as AdminLoginRole,
  } as VerifiedAdminLoginContract
}

export function shouldExpireChallengeForError(error: unknown): boolean {
  return error instanceof AdminLoginApiError && TERMINAL_CHALLENGE_CODES.has(error.code)
}

export function shouldClearCapturedSession(currentToken: string | null | undefined, capturedToken: string | null | undefined): boolean {
  return Boolean(currentToken && capturedToken && currentToken === capturedToken)
}
