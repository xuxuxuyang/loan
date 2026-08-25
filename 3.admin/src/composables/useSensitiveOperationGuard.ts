import { reactive } from 'vue'
import {
  createAdminSecurityChallenge,
  fetchAdminSecurityStatus,
  verifyAdminSecurityChallenge,
  type AdminSecurityIntent,
  type AdminSecurityProof,
  type AdminSecurityStatus,
} from '../api/adminSecurity'
import { getAdminSession } from './useAdminAuth'

export interface SensitiveOperationDisplay {
  actionLabel: string
  user?: string
  orderId?: string
  period?: number
  changes?: Array<{ label: string, before: unknown, after: unknown }>
  danger?: boolean
}

export interface SensitiveOperationRequest extends AdminSecurityIntent {
  display: SensitiveOperationDisplay
}

interface RepaymentProofCache extends AdminSecurityProof {
  contextKey: string
}

interface SensitiveDialogState {
  visible: boolean
  request: SensitiveOperationRequest | null
  status: AdminSecurityStatus | null
  challengeId: string
  phoneMasked: string
  resendAt: string
  code: string
  sending: boolean
  verifying: boolean
  error: string
  verifiedProofToken: string
  verifiedExpiresAt: string
}

export class SensitiveOperationCancelledError extends Error {
  constructor() {
    super('已取消敏感操作')
    this.name = 'SensitiveOperationCancelledError'
  }
}

export function isSensitiveOperationCancelled(error: unknown) {
  return error instanceof SensitiveOperationCancelledError
}

export const sensitiveOperationDialog = reactive<SensitiveDialogState>({
  visible: false,
  request: null,
  status: null,
  challengeId: '',
  phoneMasked: '',
  resendAt: '',
  code: '',
  sending: false,
  verifying: false,
  error: '',
  verifiedProofToken: '',
  verifiedExpiresAt: '',
})

let repaymentProof: RepaymentProofCache | null = null
let pendingResolve: ((proofToken: string) => void) | null = null
let pendingReject: ((error: Error) => void) | null = null

function currentSecurityContextKey() {
  const session = getAdminSession()
  return [session?.username, session?.tenantId, session?.workspaceType].map(item => String(item || '')).join('|')
}

function isRepaymentIntent(intent: AdminSecurityIntent) {
  return intent.actionCode.startsWith('repayment.')
}

function activeRepaymentProof() {
  if (!repaymentProof)
    return null
  if (repaymentProof.contextKey !== currentSecurityContextKey() || Date.parse(repaymentProof.expiresAt) <= Date.now()) {
    repaymentProof = null
    return null
  }
  return repaymentProof
}

function resetDialogRequest() {
  sensitiveOperationDialog.visible = false
  sensitiveOperationDialog.request = null
  sensitiveOperationDialog.status = null
  sensitiveOperationDialog.challengeId = ''
  sensitiveOperationDialog.phoneMasked = ''
  sensitiveOperationDialog.resendAt = ''
  sensitiveOperationDialog.code = ''
  sensitiveOperationDialog.sending = false
  sensitiveOperationDialog.verifying = false
  sensitiveOperationDialog.error = ''
  sensitiveOperationDialog.verifiedProofToken = ''
  sensitiveOperationDialog.verifiedExpiresAt = ''
}

function settleDialog(proofToken: string) {
  const resolve = pendingResolve
  pendingResolve = null
  pendingReject = null
  resetDialogRequest()
  resolve?.(proofToken)
}

export function clearSensitiveOperationProof() {
  repaymentProof = null
}

export async function confirmSensitiveOperation(request: SensitiveOperationRequest): Promise<string> {
  const status = await fetchAdminSecurityStatus()
  if (status.mode !== 'enforce')
    return ''
  if (!status.otpReady)
    throw new Error('敏感操作安全服务尚未就绪，请联系管理员')
  if (!status.phoneMasked)
    throw new Error('当前后台账号未绑定有效手机号')

  if (pendingReject)
    pendingReject(new SensitiveOperationCancelledError())

  const cached = isRepaymentIntent(request) ? activeRepaymentProof() : null
  resetDialogRequest()
  sensitiveOperationDialog.visible = true
  sensitiveOperationDialog.request = request
  sensitiveOperationDialog.status = status
  sensitiveOperationDialog.phoneMasked = status.phoneMasked
  if (cached) {
    sensitiveOperationDialog.verifiedProofToken = cached.proofToken
    sensitiveOperationDialog.verifiedExpiresAt = cached.expiresAt
  }

  return new Promise<string>((resolve, reject) => {
    pendingResolve = resolve
    pendingReject = reject
  })
}

export async function sendSensitiveOperationCode() {
  const request = sensitiveOperationDialog.request
  if (!request || sensitiveOperationDialog.sending)
    return
  sensitiveOperationDialog.sending = true
  sensitiveOperationDialog.error = ''
  try {
    const challenge = await createAdminSecurityChallenge({
      actionCode: request.actionCode,
      target: request.target,
      input: request.input,
    })
    sensitiveOperationDialog.challengeId = challenge.challengeId
    sensitiveOperationDialog.phoneMasked = challenge.phoneMasked
    sensitiveOperationDialog.resendAt = challenge.resendAt
    sensitiveOperationDialog.code = ''
  }
  catch (error) {
    sensitiveOperationDialog.error = error instanceof Error ? error.message : '验证码发送失败'
  }
  finally {
    sensitiveOperationDialog.sending = false
  }
}

export async function verifySensitiveOperationCode() {
  if (!sensitiveOperationDialog.challengeId || sensitiveOperationDialog.verifying)
    return
  if (!/^\d{6}$/.test(sensitiveOperationDialog.code)) {
    sensitiveOperationDialog.error = '请输入六位验证码'
    return
  }
  sensitiveOperationDialog.verifying = true
  sensitiveOperationDialog.error = ''
  try {
    const proof = await verifyAdminSecurityChallenge(
      sensitiveOperationDialog.challengeId,
      sensitiveOperationDialog.code,
    )
    if (proof.reusable && proof.scope === 'repayment') {
      repaymentProof = { ...proof, contextKey: currentSecurityContextKey() }
    }
    settleDialog(proof.proofToken)
  }
  catch (error) {
    sensitiveOperationDialog.error = error instanceof Error ? error.message : '验证码校验失败'
  }
  finally {
    sensitiveOperationDialog.verifying = false
  }
}

export function confirmSensitiveOperationWithCachedProof() {
  const token = sensitiveOperationDialog.verifiedProofToken
  if (token)
    settleDialog(token)
}

export function cancelSensitiveOperation() {
  const reject = pendingReject
  pendingResolve = null
  pendingReject = null
  resetDialogRequest()
  reject?.(new SensitiveOperationCancelledError())
}
