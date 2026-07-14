import { Capacitor } from '@capacitor/core'

export interface MallDeviceContact {
  contactId?: string
  displayName?: string
  phones: string[]
  updatedAt?: string
}

export const MALL_CONTACTS_REQUIRED_CODE = 'CONTACTS_REQUIRED'
export const MALL_ANDROID_CONTRACT_SCHEME = 'wenshuomall://contract'
export type MallContractClientPlatform = 'android' | 'ios_app' | 'web'

export function isNativeMallContactsPlatform(platform: string): boolean {
  return platform === 'android' || platform === 'ios'
}

export function chunkMallContacts<T>(contacts: T[], batchSize: number): T[][] {
  const list = Array.isArray(contacts) ? contacts : []
  const size = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : list.length || 1
  const chunks: T[][] = []
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size))
  }
  return chunks
}

export function hasUploadableMallContacts(contacts: unknown): contacts is MallDeviceContact[] {
  if (!Array.isArray(contacts)) {
    return false
  }
  return contacts.some((contact) => {
    if (!contact || typeof contact !== 'object') {
      return false
    }
    const phones = (contact as { phones?: unknown }).phones
    if (!Array.isArray(phones)) {
      return false
    }
    return phones.some(phone => String(phone || '').replace(/\D/g, '').length >= 5)
  })
}

export function resolveMallContractClientPlatform(input: {
  userAgent?: string
  platform?: string
  maxTouchPoints?: number
  nativePlatform?: string
}): MallContractClientPlatform {
  const ua = String(input.userAgent || '')
  const nativePlatform = String(input.nativePlatform || '')
  if (nativePlatform === 'ios') {
    return 'ios_app'
  }
  if (nativePlatform === 'android' || /Android/i.test(ua)) {
    return 'android'
  }
  return 'web'
}

export function currentMallContractClientPlatform(): MallContractClientPlatform {
  if (typeof navigator === 'undefined') {
    return 'web'
  }
  return resolveMallContractClientPlatform({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    nativePlatform: Capacitor.getPlatform(),
  })
}

export function isContactsRequiredApiError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const data = (error as { data?: { data?: { errorCode?: string }, msg?: string }, message?: string }).data
  if (data?.data?.errorCode === MALL_CONTACTS_REQUIRED_CODE) {
    return true
  }
  const msg = String(data?.msg || (error as { message?: string }).message || '')
  return msg.includes('通讯录授权') || msg.includes(MALL_CONTACTS_REQUIRED_CODE)
}

export function isContactsPermissionDeniedError(error: unknown): boolean {
  const msg = String(
    error && typeof error === 'object'
      ? (error as { data?: { msg?: string }, message?: string }).data?.msg || (error as { message?: string }).message || ''
      : '',
  )
  return /contacts_permission_denied|permission/i.test(msg)
}

export function isContactsPermissionLimitedError(error: unknown): boolean {
  const msg = String(
    error && typeof error === 'object'
      ? (error as { data?: { msg?: string }, message?: string }).data?.msg || (error as { message?: string }).message || ''
      : '',
  )
  return msg.includes('contacts_permission_limited')
}

export function buildMallAndroidContractUrl(orderId: string): string {
  const params = new URLSearchParams()
  const oid = String(orderId || '').trim()
  if (oid) {
    params.set('orderId', oid)
  }
  const qs = params.toString()
  return qs ? `${MALL_ANDROID_CONTRACT_SCHEME}?${qs}` : MALL_ANDROID_CONTRACT_SCHEME
}
