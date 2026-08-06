const { readTrim } = require('./config')
const { HalfFlowTrafficError } = require('./crypto')

const MD5_PATTERN = /^[a-f0-9]{32}$/i
const MOBILE_PATTERN = /^1\d{10}$/
const ID_CARD_PATTERN = /^\d{17}[\dX]$/i

function hasValue(value) {
  if (value == null) return false
  return typeof value !== 'string' || readTrim(value) !== ''
}

function requireObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HalfFlowTrafficError(`${path} is required`)
  }
  return value
}

function requireFields(object, fields, path) {
  for (const field of fields) {
    if (!hasValue(object[field])) {
      throw new HalfFlowTrafficError(`${path}.${field} is required`)
    }
  }
}

function requireEnum(value, allowed, path) {
  if (!allowed.includes(Number(value))) {
    throw new HalfFlowTrafficError(`${path} is invalid`)
  }
}

function assertAdmissionPayload(payload) {
  const input = requireObject(payload, 'payload')
  const mobileMd5 = readTrim(input.mobileMd5).toLowerCase()
  const idCardMd5 = readTrim(input.idCardMd5).toLowerCase()
  if (!MD5_PATTERN.test(mobileMd5) || !MD5_PATTERN.test(idCardMd5)) {
    throw new HalfFlowTrafficError('mobileMd5 and idCardMd5 must be 32-character MD5 values')
  }
  return { idCardMd5, mobileMd5 }
}

function assertApplyPayload(payload) {
  const input = requireObject(payload, 'payload')
  requireFields(input, ['orderId', 'mobile', 'name', 'idCard'], 'payload')

  const mobile = readTrim(input.mobile)
  const idCard = readTrim(input.idCard)
  if (!MOBILE_PATTERN.test(mobile)) throw new HalfFlowTrafficError('mobile is invalid')
  if (!ID_CARD_PATTERN.test(idCard)) throw new HalfFlowTrafficError('idCard is invalid')

  const authInfo = requireObject(input.authInfo, 'authInfo')
  requireFields(authInfo, [
    'idCardFront', 'idCardBack', 'faceUrl', 'faceScore', 'faceTime', 'nativePlace',
    'effectiveDate', 'gender', 'birthday', 'nation', 'lssuing', 'age',
  ], 'authInfo')

  const baseInfo = requireObject(input.baseInfo, 'baseInfo')
  requireFields(baseInfo, [
    'marital', 'education', 'isOpType', 'province', 'city', 'area', 'address',
    'companyAddress', 'companyName', 'monthlyAverageIncome', 'industry',
  ], 'baseInfo')
  requireEnum(baseInfo.marital, [1, 2, 3, 4], 'baseInfo.marital')
  requireEnum(baseInfo.education, [1, 2, 3, 4, 5], 'baseInfo.education')
  requireEnum(baseInfo.isOpType, [1, 2, 4, 5, 6], 'baseInfo.isOpType')
  requireEnum(baseInfo.monthlyAverageIncome, [1, 2, 3], 'baseInfo.monthlyAverageIncome')
  requireEnum(baseInfo.industry, Array.from({ length: 21 }, (_, index) => index), 'baseInfo.industry')

  const deviceInfo = requireObject(input.deviceInfo, 'deviceInfo')
  requireFields(deviceInfo, ['lng', 'lat', 'osType'], 'deviceInfo')
  requireEnum(deviceInfo.osType, [1, 2], 'deviceInfo.osType')

  const contactInfos = requireObject(input.contactInfos, 'contactInfos')
  requireFields(contactInfos, [
    'commonName', 'commonPhone', 'commonRelationship',
    'emergentName', 'emergentPhone', 'emergentRelationship',
  ], 'contactInfos')
  if (!MOBILE_PATTERN.test(readTrim(contactInfos.commonPhone))) {
    throw new HalfFlowTrafficError('contactInfos.commonPhone is invalid')
  }
  if (!MOBILE_PATTERN.test(readTrim(contactInfos.emergentPhone))) {
    throw new HalfFlowTrafficError('contactInfos.emergentPhone is invalid')
  }
  requireEnum(contactInfos.commonRelationship, [1, 2, 3, 4, 5, 6, 7, 8], 'contactInfos.commonRelationship')
  requireEnum(contactInfos.emergentRelationship, [1, 2, 3, 4, 5, 6, 7, 8], 'contactInfos.emergentRelationship')

  return {
    ...input,
    orderId: readTrim(input.orderId),
    mobile,
    name: readTrim(input.name),
    idCard,
    domainUrl: readTrim(input.domainUrl),
  }
}

function assertAppLinkPayload(payload) {
  const input = requireObject(payload, 'payload')
  const orderId = readTrim(input.orderId)
  if (!orderId) throw new HalfFlowTrafficError('orderId is required')
  return { orderId, domainUrl: readTrim(input.domainUrl) }
}

module.exports = {
  assertAdmissionPayload,
  assertAppLinkPayload,
  assertApplyPayload,
}
