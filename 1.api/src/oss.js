const crypto = require('node:crypto')
const OSS = require('ali-oss')

let cachedClient = null

function trimEnv(name) {
  return String(process.env[name] || '').trim()
}

function getOssConfig() {
  const uploadPrefixRaw = trimEnv('OSS_UPLOAD_PREFIX').replace(/^\/+|\/+$/g, '')
  const envTagRaw = trimEnv('OSS_ENV_TAG').toLowerCase().replace(/[^a-z0-9_-]/g, '')
  const maxImageMegaPixelsRaw = Number(trimEnv('OSS_IDCARD_MAX_IMAGE_MEGAPIXELS') || '20')
  const maxImageMegaPixels = Number.isFinite(maxImageMegaPixelsRaw) && maxImageMegaPixelsRaw > 0
    ? maxImageMegaPixelsRaw
    : 20
  return {
    region: trimEnv('OSS_REGION'),
    bucket: trimEnv('OSS_BUCKET'),
    accessKeyId: trimEnv('OSS_ACCESS_KEY_ID'),
    accessKeySecret: trimEnv('OSS_ACCESS_KEY_SECRET'),
    endpoint: trimEnv('OSS_ENDPOINT'),
    publicBaseUrl: trimEnv('OSS_PUBLIC_BASE_URL').replace(/\/+$/, ''),
    uploadPrefix: uploadPrefixRaw || 'mall/id-cards',
    envTag: envTagRaw || trimEnv('NODE_ENV').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'development',
    maxImageMegaPixels,
  }
}

function isOssConfigured() {
  const c = getOssConfig()
  return Boolean(c.region && c.bucket && c.accessKeyId && c.accessKeySecret)
}

function getOssClient() {
  if (cachedClient) {
    return cachedClient
  }
  const c = getOssConfig()
  if (!c.region || !c.bucket || !c.accessKeyId || !c.accessKeySecret) {
    return null
  }
  const opts = {
    region: c.region,
    bucket: c.bucket,
    accessKeyId: c.accessKeyId,
    accessKeySecret: c.accessKeySecret,
  }
  if (c.endpoint) {
    opts.endpoint = c.endpoint
  }
  cachedClient = new OSS(opts)
  return cachedClient
}

function normalizeScene(scene) {
  const t = String(scene || '').trim().toLowerCase()
  if (t === 'front' || t === 'back' || t === 'handheld') {
    return t
  }
  return 'unknown'
}

function normalizeExt(mime, originalName) {
  const byMime = String(mime || '').toLowerCase()
  if (byMime.includes('png')) return '.png'
  if (byMime.includes('webp')) return '.webp'
  const name = String(originalName || '').toLowerCase()
  if (name.endsWith('.png')) return '.png'
  if (name.endsWith('.webp')) return '.webp'
  return '.jpg'
}

function sanitizeSegment(input, fallback) {
  const t = String(input || '').trim().toLowerCase().replace(/[^a-z0-9/_-]/g, '-').replace(/\/+/g, '/')
  const s = t.replace(/^\/+|\/+$/g, '')
  return s || fallback
}

function buildObjectKey({ scene, phone, ext, biz }) {
  const c = getOssConfig()
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = `${d.getMonth() + 1}`.padStart(2, '0')
  const dd = `${d.getDate()}`.padStart(2, '0')
  const cleanPhone = String(phone || '').replace(/\D/g, '')
  const phonePart = /^1\d{10}$/.test(cleanPhone) ? cleanPhone : 'anonymous'
  const bizPart = sanitizeSegment(biz, 'misc')
  const scenePart = sanitizeSegment(scene, 'unknown')
  const rand = crypto.randomBytes(6).toString('hex')
  return `${c.uploadPrefix}/${c.envTag}/${bizPart}/${yyyy}/${mm}/${dd}/${phonePart}/${scenePart}_${Date.now()}_${rand}${ext}`
}

function resolvePublicUrl(key) {
  const c = getOssConfig()
  if (c.publicBaseUrl) {
    return `${c.publicBaseUrl}/${String(key).replace(/^\/+/, '')}`
  }
  const endpoint = c.endpoint || `oss-${c.region}.aliyuncs.com`
  const host = endpoint.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  return `https://${c.bucket}.${host}/${String(key).replace(/^\/+/, '')}`
}

async function uploadIdCardImage({ buffer, contentType, originalName, scene, phone }) {
  return uploadPublicImage({
    buffer,
    contentType,
    originalName,
    scene: normalizeScene(scene),
    phone,
    biz: 'id-cards',
  })
}

async function uploadPublicImage({
  buffer,
  contentType,
  originalName,
  scene,
  phone,
  biz,
  cacheControl = 'public, max-age=31536000',
}) {
  const client = getOssClient()
  if (!client) {
    const err = new Error('oss_not_configured')
    err.code = 'oss_not_configured'
    throw err
  }
  const objectKey = buildObjectKey({
    scene: String(scene || '').trim() || 'unknown',
    phone,
    biz: String(biz || '').trim() || 'misc',
    ext: normalizeExt(contentType, originalName),
  })
  await client.put(objectKey, buffer, {
    headers: {
      'Content-Type': String(contentType || 'image/jpeg'),
      'Cache-Control': cacheControl,
    },
  })
  return {
    key: objectKey,
    url: resolvePublicUrl(objectKey),
  }
}

function ownedIdCardObjectKey(urlValue, phoneValue) {
  const raw = String(urlValue || '').trim()
  const phone = String(phoneValue || '').replace(/\D/g, '')
  if (!raw || !/^1\d{10}$/.test(phone) || raw.includes('*') || raw.includes('..')) return ''
  let pathname
  try {
    pathname = decodeURIComponent(new URL(raw).pathname).replace(/^\/+/, '')
  }
  catch {
    return ''
  }
  const config = getOssConfig()
  const expectedPrefix = `${config.uploadPrefix}/${config.envTag}/id-cards/`
  if (!pathname.startsWith(expectedPrefix) || !pathname.includes(`/${phone}/`)) return ''
  return pathname
}

async function deleteOwnedIdCardImage(urlValue, phoneValue) {
  const objectKey = ownedIdCardObjectKey(urlValue, phoneValue)
  if (!objectKey) throw new Error('unsafe_id_card_object_key')
  const client = getOssClient()
  if (!client) throw new Error('oss_not_configured')
  await client.delete(objectKey)
  return { deleted: true, key: objectKey }
}

module.exports = {
  getOssConfig,
  isOssConfigured,
  uploadPublicImage,
  uploadIdCardImage,
  ownedIdCardObjectKey,
  deleteOwnedIdCardImage,
}
