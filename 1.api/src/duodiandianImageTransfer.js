const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 8000
const DEFAULT_UPLOAD_TIMEOUT_MS = 8000

function readTrim(value) {
  return String(value || '').trim()
}

function positiveNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function sanitizeNamePart(value, fallback) {
  return readTrim(value).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || fallback
}

function extForMime(mime) {
  if (mime === 'image/png') return '.png'
  if (mime === 'image/webp') return '.webp'
  return '.jpg'
}

function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return ''
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  return ''
}

function promiseWithTimeout(promise, timeoutMs, message, abortController = null) {
  let timer = null
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (abortController && typeof abortController.abort === 'function') {
        abortController.abort()
      }
      reject(new Error(message))
    }, positiveNumber(timeoutMs, 1000))
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

async function readResponseBufferLimited(response, maxBytes) {
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader()
    const chunks = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      total += chunk.length
      if (total > maxBytes) {
        if (typeof reader.cancel === 'function') {
          await reader.cancel().catch(() => {})
        }
        throw new Error('duodiandian image too large')
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks, total)
  }
  if (typeof response.arrayBuffer === 'function') {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxBytes) {
      throw new Error('duodiandian image too large')
    }
    return buffer
  }
  throw new Error('duodiandian image response body unavailable')
}

async function transferDuodiandianImage(input = {}, deps = {}) {
  const url = readTrim(input.url)
  const scene = sanitizeNamePart(input.scene, 'image')
  const phone = readTrim(input.phone).replace(/\D/g, '')
  const applyNo = sanitizeNamePart(input.applyNo, 'apply')
  let parsed
  try {
    parsed = new URL(url)
  }
  catch {
    throw new Error('duodiandian image url invalid')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('duodiandian image url protocol unsupported')
  }
  const fetchImpl = typeof deps.fetchImpl === 'function' ? deps.fetchImpl : (typeof fetch === 'function' ? fetch : null)
  if (!fetchImpl) {
    throw new Error('fetch unavailable for duodiandian image')
  }
  const uploadImage = typeof deps.uploadImage === 'function' ? deps.uploadImage : null
  if (!uploadImage) {
    throw new Error('duodiandian image upload is not configured')
  }
  const maxBytes = positiveNumber(deps.maxBytes || process.env.DUODIANDIAN_IMAGE_MAX_BYTES, DEFAULT_MAX_BYTES)
  const timeoutMs = positiveNumber(deps.timeoutMs || process.env.DUODIANDIAN_IMAGE_DOWNLOAD_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
  const uploadTimeoutMs = positiveNumber(deps.uploadTimeoutMs || process.env.DUODIANDIAN_IMAGE_UPLOAD_TIMEOUT_MS, DEFAULT_UPLOAD_TIMEOUT_MS)
  const controller = new AbortController()
  let response
  let buffer
  try {
    response = await promiseWithTimeout(
      fetchImpl(url, { method: 'GET', signal: controller.signal }),
      timeoutMs,
      'duodiandian image download timeout',
      controller,
    )
    if (!response || !response.ok) {
      throw new Error(`duodiandian image download failed: ${response && response.status ? response.status : 'no_response'}`)
    }
    buffer = await promiseWithTimeout(
      readResponseBufferLimited(response, maxBytes),
      timeoutMs,
      'duodiandian image read timeout',
      controller,
    )
  }
  catch (err) {
    throw new Error(`duodiandian image download failed: ${err && err.message ? err.message : String(err)}`)
  }
  const detectedMime = detectImageMime(buffer)
  if (!detectedMime) {
    throw new Error('duodiandian image format unsupported')
  }
  const declaredMime = readTrim(response.headers && typeof response.headers.get === 'function' ? response.headers.get('content-type') : '').split(';')[0].toLowerCase()
  if (declaredMime && !['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'].includes(declaredMime)) {
    throw new Error(`duodiandian image content-type unsupported: ${declaredMime}`)
  }
  const ext = extForMime(detectedMime)
  const uploaded = await promiseWithTimeout(uploadImage({
    buffer,
    contentType: detectedMime,
    originalName: `duodiandian-${applyNo}-${scene}${ext}`,
    scene,
    phone,
    biz: 'duodiandian-id-cards',
  }), uploadTimeoutMs, 'duodiandian image upload timeout')
  return {
    originalUrl: url,
    url: uploaded && uploaded.url,
    key: uploaded && uploaded.key,
    contentType: detectedMime,
    size: buffer.length,
    transferredAt: new Date(typeof deps.now === 'function' ? Number(deps.now()) : Date.now()).toISOString(),
  }
}

module.exports = {
  transferDuodiandianImage,
  detectImageMime,
}
