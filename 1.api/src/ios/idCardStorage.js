const { getOssConfig, uploadPublicImage } = require('../oss')

const IOS_ID_CARD_CACHE_CONTROL = 'private, no-store'
const IMAGE_FIELDS = [
  ['idCardFront', 'front'],
  ['idCardBack', 'back'],
  ['idCardHandheld', 'handheld'],
]

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function resolveConfiguredBaseUrl(config) {
  const publicBaseUrl = String(config.publicBaseUrl || '').trim().replace(/\/+$/, '')
  if (publicBaseUrl) return new URL(publicBaseUrl)
  const endpoint = String(config.endpoint || `oss-${config.region}.aliyuncs.com`).trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
  return new URL(`https://${config.bucket}.${endpoint}`)
}

function ownedSceneObjectKey(urlValue, phoneValue, sceneValue, config) {
  const phone = String(phoneValue || '').replace(/\D/g, '')
  if (!/^1\d{10}$/.test(phone)) return ''

  let parsed
  let configuredBase
  try {
    parsed = new URL(String(urlValue || '').trim())
    configuredBase = resolveConfiguredBaseUrl(config)
  }
  catch {
    return ''
  }
  if (parsed.origin !== configuredBase.origin || parsed.search || parsed.hash) return ''

  let pathname
  try {
    pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, '')
  }
  catch {
    return ''
  }
  const basePath = configuredBase.pathname.replace(/^\/+|\/+$/g, '')
  if (basePath) {
    if (!pathname.startsWith(`${basePath}/`)) return ''
    pathname = pathname.slice(basePath.length + 1)
  }

  const uploadPrefix = String(config.uploadPrefix || 'mall/id-cards').replace(/^\/+|\/+$/g, '')
  const envTag = String(config.envTag || '').replace(/^\/+|\/+$/g, '')
  const expectedPrefix = `${uploadPrefix}/${envTag}/id-cards`
  const scene = String(sceneValue || '').trim().toLowerCase()
  const objectKeyPattern = new RegExp(
    `^${escapeRegExp(expectedPrefix)}/\\d{4}/\\d{2}/\\d{2}/${escapeRegExp(phone)}/${escapeRegExp(scene)}_\\d+_[a-f0-9]+\\.(?:jpg|png|webp)$`,
    'i',
  )
  return objectKeyPattern.test(pathname) ? pathname : ''
}

function validateIosIdCardImageSet(images, phone, config = getOssConfig()) {
  const keys = {}
  for (const [field, scene] of IMAGE_FIELDS) {
    const key = ownedSceneObjectKey(images && images[field], phone, scene, config)
    if (!key) {
      return { ok: false, code: 'INVALID_ID_CARD_IMAGE_REFERENCE', msg: '身份证图片无效，请重新上传' }
    }
    keys[field] = key
  }
  if (new Set(Object.values(keys)).size !== IMAGE_FIELDS.length) {
    return { ok: false, code: 'INVALID_ID_CARD_IMAGE_REFERENCE', msg: '三张身份证图片不能重复' }
  }
  return { ok: true, keys }
}

async function uploadIosIdCardImage({ buffer, contentType, originalName, scene, phone }) {
  return uploadPublicImage({
    buffer,
    contentType,
    originalName,
    scene,
    phone,
    biz: 'id-cards',
    cacheControl: IOS_ID_CARD_CACHE_CONTROL,
  })
}

module.exports = {
  IOS_ID_CARD_CACHE_CONTROL,
  ownedSceneObjectKey,
  uploadIosIdCardImage,
  validateIosIdCardImageSet,
}
