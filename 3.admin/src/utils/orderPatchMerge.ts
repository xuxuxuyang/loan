type PatchMergeOrderLike = {
  user?: string
  buyerPhone?: string
  mallUserId?: string
  userRemark?: string
  emergencyContactsComplete?: boolean | null
  registerChannelCode?: string
  registerChannelName?: string
  registerChannelLabel?: string
}

const USER_PLACEHOLDERS = new Set(['-', '—', 'бк'])

function hasDisplayUser(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : ''
  return Boolean(text) && !USER_PLACEHOLDERS.has(text)
}

function hasText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
}

export function mergePatchedOrder<T extends PatchMergeOrderLike>(prev: T, mapped: T): T {
  return {
    ...mapped,
    user: hasDisplayUser(mapped.user) ? mapped.user : prev.user,
    buyerPhone: hasText(mapped.buyerPhone) ? mapped.buyerPhone : prev.buyerPhone,
    mallUserId: hasText(mapped.mallUserId) ? mapped.mallUserId : prev.mallUserId,
    userRemark: hasText(mapped.userRemark) ? mapped.userRemark : (prev.userRemark || ''),
    registerChannelCode: hasText(mapped.registerChannelCode) ? mapped.registerChannelCode : prev.registerChannelCode,
    registerChannelName: hasText(mapped.registerChannelName) ? mapped.registerChannelName : prev.registerChannelName,
    registerChannelLabel: hasText(mapped.registerChannelLabel) ? mapped.registerChannelLabel : prev.registerChannelLabel,
    emergencyContactsComplete: mapped.emergencyContactsComplete !== undefined
      ? mapped.emergencyContactsComplete
      : prev.emergencyContactsComplete,
  }
}
