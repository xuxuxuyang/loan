const crypto = require('node:crypto')

class ZheyinTrafficError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'ZheyinTrafficError'
    this.status = status
  }
}

function readTrim(value) {
  return String(value || '').trim()
}

function md5(value) {
  return crypto.createHash('md5').update(String(value), 'utf8').digest('hex')
}

function assertAesSecret(key, name) {
  const len = Buffer.byteLength(String(key || ''), 'utf8')
  if (len !== 16 && len !== 24 && len !== 32) {
    throw new ZheyinTrafficError(`invalid ${name} length`, 500)
  }
}

function aesAlgorithmForKey(key) {
  const len = Buffer.byteLength(String(key || ''), 'utf8')
  if (len === 16) return 'aes-128-cbc'
  if (len === 24) return 'aes-192-cbc'
  if (len === 32) return 'aes-256-cbc'
  throw new ZheyinTrafficError('invalid AES key length', 500)
}

function encryptJsonToBase64(payload, config) {
  assertAesSecret(config.aesKey, 'AES key')
  assertAesSecret(config.aesIv, 'AES iv')
  const cipher = crypto.createCipheriv(
    aesAlgorithmForKey(config.aesKey),
    Buffer.from(config.aesKey, 'utf8'),
    Buffer.from(config.aesIv, 'utf8'),
  )
  cipher.setAutoPadding(true)
  return Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]).toString('base64')
}

function decryptBase64Json(data, config) {
  const rawData = readTrim(data)
  if (!rawData) {
    throw new ZheyinTrafficError('data is required')
  }
  assertAesSecret(config.aesKey, 'AES key')
  assertAesSecret(config.aesIv, 'AES iv')
  try {
    const decipher = crypto.createDecipheriv(
      aesAlgorithmForKey(config.aesKey),
      Buffer.from(config.aesKey, 'utf8'),
      Buffer.from(config.aesIv, 'utf8'),
    )
    decipher.setAutoPadding(true)
    const text = Buffer.concat([
      decipher.update(Buffer.from(rawData, 'base64')),
      decipher.final(),
    ]).toString('utf8')
    return JSON.parse(text)
  }
  catch (err) {
    throw new ZheyinTrafficError(`AES data decrypt failed: ${err.message || err}`)
  }
}

function buildZheyinTrafficEnvelope(payload, config, options = {}) {
  const requestNo = readTrim(options.requestNo) || crypto.randomBytes(16).toString('hex')
  const data = encryptJsonToBase64(payload, config)
  return {
    channel: config.channel,
    data,
    requestNo,
  }
}

function parseZheyinTrafficEnvelope(body, config, options = {}) {
  const channel = readTrim(body && body.channel)
  if (channel !== readTrim(config.channel)) {
    throw new ZheyinTrafficError('invalid channel')
  }
  if (!readTrim(body && body.requestNo)) {
    throw new ZheyinTrafficError('requestNo is required')
  }
  const payload = decryptBase64Json(body && body.data, config)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ZheyinTrafficError('decrypted data must be an object')
  }
  return payload
}

module.exports = {
  ZheyinTrafficError,
  readTrim,
  md5,
  encryptJsonToBase64,
  decryptBase64Json,
  buildZheyinTrafficEnvelope,
  parseZheyinTrafficEnvelope,
}
