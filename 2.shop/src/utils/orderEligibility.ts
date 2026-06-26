export interface MallOrderEligibilityInput {
  idNumber?: string
  phone?: string
  phoneLocationText?: string
  addressParts?: Array<string | undefined | null>
  today?: Date
  policy: MallOrderEligibilityPolicy
}

export interface MallOrderEligibilityResult {
  ok: boolean
  message: string
}

export interface MallOrderEligibilityConfigEnv {
  readonly VITE_MALL_ORDER_MIN_AGE?: string
  readonly VITE_MALL_ORDER_MAX_AGE?: string
  readonly VITE_MALL_ORDER_RESTRICTED_REGION_NAMES?: string
  readonly VITE_MALL_ORDER_RESTRICTED_ID_PREFIXES?: string
}

export interface MallOrderEligibilityPolicy {
  minAge: number
  maxAge: number
  restrictedRegionNames: string[]
  restrictedIdPrefixes: string[]
}

function normalizeText(value: unknown) {
  return String(value || '').trim()
}

function parsePositiveInteger(value: unknown): number | null {
  const n = Number(normalizeText(value))
  return Number.isInteger(n) && n > 0 ? n : null
}

function parseCsvList(value: unknown): string[] {
  return normalizeText(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

export function resolveMallOrderEligibilityPolicyFromEnv(env: MallOrderEligibilityConfigEnv): MallOrderEligibilityPolicy {
  const minAge = parsePositiveInteger(env.VITE_MALL_ORDER_MIN_AGE)
  const maxAge = parsePositiveInteger(env.VITE_MALL_ORDER_MAX_AGE)
  if (minAge === null || maxAge === null || minAge > maxAge) {
    throw new Error('Invalid mall order age policy env: VITE_MALL_ORDER_MIN_AGE/VITE_MALL_ORDER_MAX_AGE')
  }
  return {
    minAge,
    maxAge,
    restrictedRegionNames: parseCsvList(env.VITE_MALL_ORDER_RESTRICTED_REGION_NAMES),
    restrictedIdPrefixes: parseCsvList(env.VITE_MALL_ORDER_RESTRICTED_ID_PREFIXES),
  }
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

function normalizeDate(value: unknown): Date {
  const maybeDate = value as { getTime?: () => number } | null | undefined
  if (maybeDate && typeof maybeDate.getTime === 'function') {
    const time = maybeDate.getTime()
    if (Number.isFinite(time)) {
      return new Date(time)
    }
  }
  return new Date()
}

export function calculateAgeFromIdNumber(idNumberRaw: unknown, todayRaw: Date = new Date()): number | null {
  const idNumber = normalizeIdNumber(idNumberRaw)
  const birthDate = parseBirthDateFromId(idNumber)
  if (!birthDate) {
    return null
  }
  const today = normalizeDate(todayRaw)
  let age = today.getFullYear() - birthDate.getFullYear()
  const hasHadBirthday = today.getMonth() > birthDate.getMonth()
    || (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate())
  if (!hasHadBirthday) {
    age -= 1
  }
  return age
}

export function isRestrictedIdCardRegion(idNumberRaw: unknown, restrictedIdPrefixes: string[]): boolean {
  const idNumber = normalizeIdNumber(idNumberRaw)
  return restrictedIdPrefixes.some(prefix => idNumber.startsWith(prefix))
}

export function isRestrictedRegionText(value: unknown, restrictedRegionNames: string[]): boolean {
  const text = normalizeText(value)
  if (!text) {
    return false
  }
  return restrictedRegionNames.some(name => text.includes(name))
}

export function validateMallOrderBeforeRisk(input: MallOrderEligibilityInput): MallOrderEligibilityResult {
  const policy = input.policy
  const idNumber = normalizeIdNumber(input.idNumber)
  const age = calculateAgeFromIdNumber(idNumber, input.today)
  if (age === null) {
    return { ok: false, message: '身份证号码格式不正确，请核对后再下单' }
  }
  if (age < policy.minAge || age > policy.maxAge) {
    return { ok: false, message: `申请年龄需为${policy.minAge}周岁到${policy.maxAge}周岁，请核对后再下单` }
  }
  if (isRestrictedIdCardRegion(idNumber, policy.restrictedIdPrefixes)) {
    return { ok: false, message: '所属地区暂不支持下单' }
  }

  const locationText = [
    ...(Array.isArray(input.addressParts) ? input.addressParts : []),
    input.phoneLocationText,
  ].map(normalizeText).filter(Boolean).join(' ')
  if (isRestrictedRegionText(locationText, policy.restrictedRegionNames)) {
    return { ok: false, message: '当前收货地址暂不支持下单' }
  }

  return { ok: true, message: '' }
}
