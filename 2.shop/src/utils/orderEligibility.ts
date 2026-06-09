export interface MallOrderEligibilityInput {
  idNumber?: string
  phone?: string
  phoneLocationText?: string
  addressParts?: Array<string | undefined | null>
  today?: Date
}

export interface MallOrderEligibilityResult {
  ok: boolean
  message: string
}

const MIN_ORDER_AGE = 22
const MAX_ORDER_AGE = 49

const RESTRICTED_REGION_NAMES = ['新疆', '西藏', '内蒙古', '青海', '宁波']
const RESTRICTED_ID_PREFIXES = ['65', '54', '15', '63', '3302']

function normalizeText(value: unknown) {
  return String(value || '').trim()
}

function normalizeIdNumber(value: unknown) {
  return normalizeText(value).toUpperCase()
}

function parseBirthDateFromId(idNumber: string): Date | null {
  if (!/^\d{17}[\dX]$/.test(idNumber)) {
    return null
  }
  const birth = idNumber.slice(6, 14)
  const year = Number(birth.slice(0, 4))
  const month = Number(birth.slice(4, 6))
  const day = Number(birth.slice(6, 8))
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null
  }
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}

export function calculateAgeFromIdNumber(idNumberRaw: unknown, todayRaw: Date = new Date()): number | null {
  const idNumber = normalizeIdNumber(idNumberRaw)
  const birthDate = parseBirthDateFromId(idNumber)
  if (!birthDate) {
    return null
  }
  const today = todayRaw instanceof Date && !Number.isNaN(todayRaw.getTime()) ? todayRaw : new Date()
  let age = today.getFullYear() - birthDate.getFullYear()
  const hasHadBirthday = today.getMonth() > birthDate.getMonth()
    || (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate())
  if (!hasHadBirthday) {
    age -= 1
  }
  return age
}

export function isRestrictedIdCardRegion(idNumberRaw: unknown): boolean {
  const idNumber = normalizeIdNumber(idNumberRaw)
  return RESTRICTED_ID_PREFIXES.some(prefix => idNumber.startsWith(prefix))
}

export function isRestrictedRegionText(value: unknown): boolean {
  const text = normalizeText(value)
  if (!text) {
    return false
  }
  return RESTRICTED_REGION_NAMES.some(name => text.includes(name))
}

export function validateMallOrderBeforeRisk(input: MallOrderEligibilityInput): MallOrderEligibilityResult {
  const idNumber = normalizeIdNumber(input.idNumber)
  const age = calculateAgeFromIdNumber(idNumber, input.today)
  if (age === null) {
    return { ok: false, message: '身份证号码格式不正确，请核对后再下单' }
  }
  if (age < MIN_ORDER_AGE || age > MAX_ORDER_AGE) {
    return { ok: false, message: '当前年龄暂不支持下单' }
  }
  if (isRestrictedIdCardRegion(idNumber)) {
    return { ok: false, message: '所属地区暂不支持下单' }
  }

  const locationText = [
    ...(Array.isArray(input.addressParts) ? input.addressParts : []),
    input.phoneLocationText,
  ].map(normalizeText).filter(Boolean).join(' ')
  if (isRestrictedRegionText(locationText)) {
    return { ok: false, message: '当前收货地址暂不支持下单' }
  }

  return { ok: true, message: '' }
}
