export interface IosRegisterRequest {
  phone: string
  smsCode: string
  password: string
  channel?: string
}

export interface IosMallUser {
  id: string
  name: string
  phone: string
  [key: string]: unknown
}

export type IosIdCardScene = 'front' | 'back' | 'handheld'

export interface IosInstallmentProfileStatus {
  complete: boolean
  canReuse: boolean
  nameMasked: string
  idNumberMasked: string
  hasIdCardFront: boolean
  hasIdCardBack: boolean
  hasIdCardHandheld: boolean
  emergencyContactsMasked: Array<{ nameMasked: string, phoneMasked: string }>
}

export interface IosInstallmentProfileUpdate {
  name: string
  idNumber: string
  idCardFront: string
  idCardBack: string
  idCardHandheld: string
  emergencyContacts: [
    { name: string, phone: string },
    { name: string, phone: string },
  ]
}

export interface IosRiskWave {
  waveId: string
  stepKeys: string[]
  expiresAt: number
}

export interface IosInstallmentOrderRequest {
  productId: number
  name: string
  spec: string
  quantity: number
  totalAmount: number
  installmentPeriods: number
  receiverName: string
  receiverPhone: string
  receiverAddress: string
  installmentRiskWaveId: string
}

export interface IosAuthorizedContact {
  contactId?: string
  displayName?: string
  phones: string[]
}

export interface IosAccountDeletionEligibility {
  canDelete: boolean
  blockers: Array<{ code: string, orderId?: string, msg: string }>
}

interface ApiEnvelope<T> {
  success: boolean
  code: number | string
  msg: string
  data: T
}

function iosMallApiBase(): string {
  const runtimeConfig = useRuntimeConfig()
  return String(runtimeConfig.public.mallApiBase || '/api').replace(/\/+$/, '')
}

function readIosApiError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const detail = error as { data?: { msg?: unknown }, message?: unknown }
    const responseMessage = String(detail.data?.msg || '').trim()
    if (responseMessage) return responseMessage
    const message = String(detail.message || '').trim()
    if (message) return message
  }
  return fallback
}

export function buildIosAuthHeaders(phone: string): Record<string, string> {
  const normalized = String(phone || '').replace(/\D/g, '')
  if (!/^1\d{10}$/.test(normalized)) return {}
  return { Authorization: `Bearer mock-token-${normalized}` }
}

export async function sendIosRegisterSms(phone: string): Promise<void> {
  try {
    await $fetch<ApiEnvelope<Record<string, never>>>(`${iosMallApiBase()}/ios/auth/register/sms/send`, {
      method: 'POST',
      body: { phone: String(phone || '').replace(/\D/g, '') },
    })
  }
  catch (error) {
    throw new Error(readIosApiError(error, '验证码发送失败，请稍后重试'))
  }
}

export async function registerIosMallAccount(payload: IosRegisterRequest): Promise<IosMallUser> {
  try {
    const response = await $fetch<ApiEnvelope<IosMallUser>>(`${iosMallApiBase()}/ios/auth/register`, {
      method: 'POST',
      body: {
        phone: String(payload.phone || '').replace(/\D/g, ''),
        smsCode: String(payload.smsCode || '').trim(),
        password: String(payload.password || ''),
        ...(payload.channel ? { channel: payload.channel } : {}),
      },
    })
    return response.data
  }
  catch (error) {
    throw new Error(readIosApiError(error, '注册失败，请稍后重试'))
  }
}

export async function getIosInstallmentProfile(phone: string): Promise<IosInstallmentProfileStatus> {
  try {
    const response = await $fetch<ApiEnvelope<IosInstallmentProfileStatus>>(`${iosMallApiBase()}/ios/installment/profile`, {
      method: 'GET',
      headers: buildIosAuthHeaders(phone),
    })
    return response.data
  }
  catch (error) {
    throw new Error(readIosApiError(error, '资料状态读取失败'))
  }
}

export async function saveIosInstallmentProfile(phone: string, payload: IosInstallmentProfileUpdate): Promise<IosInstallmentProfileStatus> {
  try {
    const response = await $fetch<ApiEnvelope<IosInstallmentProfileStatus>>(`${iosMallApiBase()}/ios/installment/profile`, {
      method: 'PUT',
      headers: buildIosAuthHeaders(phone),
      body: payload,
    })
    return response.data
  }
  catch (error) {
    throw new Error(readIosApiError(error, '资料保存失败'))
  }
}

export async function uploadIosIdCard(phone: string, file: File, scene: IosIdCardScene): Promise<string> {
  const formData = new FormData()
  formData.append('image', file)
  formData.append('scene', scene)
  try {
    const response = await $fetch<ApiEnvelope<{ url: string }>>(`${iosMallApiBase()}/ios/uploads/id-card`, {
      method: 'POST',
      headers: buildIosAuthHeaders(phone),
      body: formData,
    })
    return String(response.data.url || '').trim()
  }
  catch (error) {
    throw new Error(readIosApiError(error, '身份证图片上传失败'))
  }
}

export async function createIosInstallmentRiskWave(phone: string): Promise<IosRiskWave> {
  try {
    const response = await $fetch<ApiEnvelope<IosRiskWave>>(`${iosMallApiBase()}/ios/installment-risk/wave`, {
      method: 'POST',
      headers: buildIosAuthHeaders(phone),
      body: {},
    })
    return response.data
  }
  catch (error) {
    throw new Error(readIosApiError(error, '创建风控会话失败'))
  }
}

export async function runIosInstallmentRiskStep(phone: string, waveId: string, stepKey: string): Promise<{ ok: boolean, step?: { error?: string } }> {
  try {
    const response = await $fetch<ApiEnvelope<{ ok: boolean, step?: { error?: string } }>>(
      `${iosMallApiBase()}/ios/installment-risk/wave/${encodeURIComponent(waveId)}/step/${encodeURIComponent(stepKey)}`,
      { method: 'POST', headers: buildIosAuthHeaders(phone), body: {} },
    )
    return response.data
  }
  catch (error) {
    throw new Error(readIosApiError(error, '风控步骤执行失败'))
  }
}

export async function createIosInstallmentOrder(phone: string, payload: IosInstallmentOrderRequest): Promise<Record<string, unknown>> {
  try {
    const response = await $fetch<ApiEnvelope<{ order: Record<string, unknown> }>>(`${iosMallApiBase()}/ios/installment/orders`, {
      method: 'POST',
      headers: buildIosAuthHeaders(phone),
      body: payload,
    })
    return response.data.order
  }
  catch (error) {
    throw new Error(readIosApiError(error, '先享后付订单创建失败'))
  }
}

export async function uploadIosAuthorizedContacts(
  phone: string,
  orderId: string,
  contacts: IosAuthorizedContact[],
): Promise<{ completed: boolean, contactsCount: number, uploadedAt: string }> {
  if (!Array.isArray(contacts) || !contacts.some(item => Array.isArray(item.phones) && item.phones.some(value => String(value || '').replace(/\D/g, '').length >= 5))) {
    throw new Error('未获取到包含有效手机号的授权联系人')
  }
  const path = `${iosMallApiBase()}/ios/orders/${encodeURIComponent(orderId)}/contacts/upload`
  try {
    const started = await $fetch<ApiEnvelope<{ uploadId: string, batchSizeLimit: number }>>(`${path}/start`, {
      method: 'POST',
      headers: buildIosAuthHeaders(phone),
      body: { totalContacts: contacts.length },
    })
    const uploadId = String(started.data.uploadId || '').trim()
    const batchSize = Math.max(1, Number(started.data.batchSizeLimit) || 200)
    const chunks: IosAuthorizedContact[][] = []
    for (let offset = 0; offset < contacts.length; offset += batchSize) chunks.push(contacts.slice(offset, offset + batchSize))
    for (let index = 0; index < chunks.length; index += 1) {
      await $fetch(`${path}/batch`, {
        method: 'POST',
        headers: buildIosAuthHeaders(phone),
        body: { uploadId, batchIndex: index, contacts: chunks[index] },
      })
    }
    const completed = await $fetch<ApiEnvelope<{ completed: boolean, contactsCount: number, uploadedAt: string }>>(`${path}/complete`, {
      method: 'POST',
      headers: buildIosAuthHeaders(phone),
      body: { uploadId, expectedBatchCount: chunks.length },
    })
    return completed.data
  }
  catch (error) {
    throw new Error(readIosApiError(error, '联系人上传失败'))
  }
}

export async function getIosAccountDeletionEligibility(phone: string): Promise<IosAccountDeletionEligibility> {
  try {
    const response = await $fetch<ApiEnvelope<IosAccountDeletionEligibility>>(`${iosMallApiBase()}/ios/account/deletion-eligibility`, {
      method: 'GET',
      headers: buildIosAuthHeaders(phone),
    })
    return response.data
  }
  catch (error) {
    throw new Error(readIosApiError(error, '注销资格检查失败'))
  }
}

export async function deleteIosAccount(phone: string, currentPassword: string): Promise<{ mode: 'hard_deleted' | 'anonymized_with_legal_retention', retentionDays?: number }> {
  try {
    const response = await $fetch<ApiEnvelope<{ mode: 'hard_deleted' | 'anonymized_with_legal_retention', retentionDays?: number }>>(`${iosMallApiBase()}/ios/account/delete`, {
      method: 'POST',
      headers: buildIosAuthHeaders(phone),
      body: { currentPassword, confirm: true },
    })
    return response.data
  }
  catch (error) {
    throw new Error(readIosApiError(error, '账号注销失败'))
  }
}
