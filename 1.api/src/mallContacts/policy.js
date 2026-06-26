const MALL_CONTACTS_ERROR_CODE = 'CONTACTS_REQUIRED'

const CONTACTS_FIELD = 'mallContacts'
const UPLOAD_STATUS = {
  NOT_REQUIRED: 'not_required',
  PENDING: 'pending',
  COMPLETED: 'completed',
}

function ensureMallContactsState(target) {
  if (!target || typeof target !== 'object') {
    return {}
  }
  if (!target[CONTACTS_FIELD] || typeof target[CONTACTS_FIELD] !== 'object' || Array.isArray(target[CONTACTS_FIELD])) {
    target[CONTACTS_FIELD] = {}
  }
  return target[CONTACTS_FIELD]
}

function isInstallmentCardPackageContractTarget(order) {
  if (!order || typeof order !== 'object') {
    return false
  }
  if (order.payType !== 'installment') {
    return false
  }
  if (order.cardPackageIssued) {
    return false
  }
  return !String(order.cardPackageContractSignedAt || '').trim()
}

function markMallContactsRequiredForOrder(order, nowIso = new Date().toISOString()) {
  if (!isInstallmentCardPackageContractTarget(order)) {
    return false
  }
  const state = ensureMallContactsState(order)
  const changed = state.requiredBeforeContract !== true
    || !String(state.requiredAt || '').trim()
    || state.uploadStatus === undefined
  state.requiredBeforeContract = true
  if (!String(state.requiredAt || '').trim()) {
    state.requiredAt = nowIso
  }
  if (!String(state.uploadedAt || '').trim()) {
    state.uploadedAt = ''
  }
  if (!String(state.snapshotId || '').trim()) {
    state.snapshotId = ''
  }
  if (!Number.isFinite(Number(state.contactsCount))) {
    state.contactsCount = 0
  }
  if (state.uploadStatus !== UPLOAD_STATUS.COMPLETED) {
    state.uploadStatus = UPLOAD_STATUS.PENDING
  }
  return changed
}

function isMallContactsRequiredForOrder(order) {
  if (!isInstallmentCardPackageContractTarget(order)) {
    return false
  }
  const state = order && order[CONTACTS_FIELD]
  return Boolean(state && typeof state === 'object' && state.requiredBeforeContract === true)
}

function isMallContactsUploadCompleted(order) {
  const state = order && order[CONTACTS_FIELD]
  if (!state || typeof state !== 'object') {
    return false
  }
  return state.uploadStatus === UPLOAD_STATUS.COMPLETED
    && Boolean(String(state.uploadedAt || '').trim())
    && Boolean(String(state.snapshotId || '').trim())
}

function shouldBlockContractForMallContacts(order) {
  if (!isMallContactsRequiredForOrder(order) || isMallContactsUploadCompleted(order)) {
    return { block: false }
  }
  return {
    block: true,
    code: MALL_CONTACTS_ERROR_CODE,
    msg: '签署合同前需在安卓 App 内完成通讯录授权',
  }
}

function applyMallContactsUploadSummary(order, user, summary) {
  const upload = summary && typeof summary === 'object' ? summary : {}
  const uploadId = String(upload.uploadId || upload.snapshotId || '').trim()
  const completedAt = String(upload.completedAt || upload.uploadedAt || '').trim()
  const contactsCount = Math.max(0, Math.floor(Number(upload.contactsCount || 0) || 0))
  if (!uploadId || !completedAt) {
    return false
  }
  const orderState = ensureMallContactsState(order)
  orderState.requiredBeforeContract = orderState.requiredBeforeContract === true
  orderState.uploadStatus = UPLOAD_STATUS.COMPLETED
  orderState.uploadedAt = completedAt
  orderState.snapshotId = uploadId
  orderState.contactsCount = contactsCount

  if (user && typeof user === 'object') {
    const userState = ensureMallContactsState(user)
    userState.latestUploadedAt = completedAt
    userState.latestSnapshotId = uploadId
    userState.latestOrderId = String(order && order.id || '').trim()
    userState.contactsCount = contactsCount
  }
  return true
}

function buildMallContactsStatus(order, _user, latestUpload) {
  const state = order && order[CONTACTS_FIELD] && typeof order[CONTACTS_FIELD] === 'object'
    ? order[CONTACTS_FIELD]
    : {}
  const required = Boolean(state.requiredBeforeContract === true && isInstallmentCardPackageContractTarget(order))
  const upload = latestUpload && typeof latestUpload === 'object' ? latestUpload : {}
  const completedFromOrder = isMallContactsUploadCompleted(order)
  const completedFromUpload = String(upload.status || '') === UPLOAD_STATUS.COMPLETED
    || Boolean(String(upload.completedAt || '').trim())
  const completed = completedFromOrder || completedFromUpload
  return {
    required,
    completed,
    uploadStatus: completed
      ? UPLOAD_STATUS.COMPLETED
      : (required ? UPLOAD_STATUS.PENDING : UPLOAD_STATUS.NOT_REQUIRED),
    uploadedAt: String(state.uploadedAt || upload.completedAt || '').trim(),
    contactsCount: Math.max(0, Math.floor(Number(state.contactsCount || upload.contactsCount || 0) || 0)),
    snapshotId: String(state.snapshotId || upload.uploadId || upload.snapshotId || '').trim(),
  }
}

function normalizePhoneValue(value) {
  return String(value || '').replace(/\D/g, '')
}

function normalizeMallContactBatch(rawContacts) {
  if (!Array.isArray(rawContacts)) {
    return []
  }
  const out = []
  for (const raw of rawContacts) {
    if (!raw || typeof raw !== 'object') {
      continue
    }
    const phonesRaw = Array.isArray(raw.phones)
      ? raw.phones
      : [raw.phone, raw.mobile, raw.number].filter(Boolean)
    const phones = [...new Set(
      phonesRaw
        .map(normalizePhoneValue)
        .filter(item => item.length >= 5 && item.length <= 20),
    )]
    if (!phones.length) {
      continue
    }
    const displayName = String(raw.displayName || raw.name || '').trim().slice(0, 80)
    const item = {
      contactId: String(raw.contactId || raw.id || '').trim().slice(0, 80),
      displayName,
      phones,
      updatedAt: String(raw.updatedAt || '').trim(),
    }
    if (!item.contactId) {
      delete item.contactId
    }
    if (!item.displayName) {
      delete item.displayName
    }
    if (!item.updatedAt) {
      delete item.updatedAt
    }
    out.push(item)
  }
  return out
}

module.exports = {
  CONTACTS_FIELD,
  MALL_CONTACTS_ERROR_CODE,
  UPLOAD_STATUS,
  applyMallContactsUploadSummary,
  buildMallContactsStatus,
  ensureMallContactsState,
  isMallContactsRequiredForOrder,
  isMallContactsUploadCompleted,
  markMallContactsRequiredForOrder,
  normalizeMallContactBatch,
  shouldBlockContractForMallContacts,
}
