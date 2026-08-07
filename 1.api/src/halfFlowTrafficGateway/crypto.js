const crypto = require('node:crypto')

const { readTrim } = require('./config')

class HalfFlowTrafficError extends Error {
  constructor(message, status = 400, code = status) {
    super(message)
    this.name = 'HalfFlowTrafficError'
    this.status = status
    this.code = code
  }
}

function decodeCanonicalBase64(value, label) {
  const raw = readTrim(value)
  if (!raw || raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    throw new HalfFlowTrafficError(`${label} is not valid Base64`)
  }
  const decoded = Buffer.from(raw, 'base64')
  if (decoded.toString('base64') !== raw) {
    throw new HalfFlowTrafficError(`${label} is not canonical Base64`)
  }
  return decoded
}

function decodeAesKey(value) {
  const key = decodeCanonicalBase64(value, 'AES key')
  if (![16, 24, 32].includes(key.length)) {
    throw new HalfFlowTrafficError('AES key must decode to 16, 24, or 32 bytes', 500, 500)
  }
  return key
}

function aesCtrAlgorithm(key) {
  return `aes-${key.length * 8}-ctr`
}

function removeValidPkcs7Padding(plaintext) {
  if (!Buffer.isBuffer(plaintext) || plaintext.length === 0 || plaintext.length % 16 !== 0) return null
  const paddingLength = plaintext[plaintext.length - 1]
  if (paddingLength < 1 || paddingLength > 16 || paddingLength > plaintext.length) return null
  for (let index = plaintext.length - paddingLength; index < plaintext.length; index += 1) {
    if (plaintext[index] !== paddingLength) return null
  }
  return plaintext.subarray(0, plaintext.length - paddingLength)
}

function parseDecryptedJson(plaintext) {
  try {
    return JSON.parse(plaintext.toString('utf8'))
  }
  catch (originalError) {
    const unpadded = removeValidPkcs7Padding(plaintext)
    if (!unpadded) throw originalError
    return JSON.parse(unpadded.toString('utf8'))
  }
}

function encryptHalfFlowJson(payload, config, suppliedNonce) {
  const key = decodeAesKey(config && config.aesKey)
  const nonce = suppliedNonce || crypto.randomBytes(16)
  if (!Buffer.isBuffer(nonce) || nonce.length !== 16) {
    throw new HalfFlowTrafficError('nonce must be 16 bytes')
  }
  const cipher = crypto.createCipheriv(aesCtrAlgorithm(key), key, nonce)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ])
  return Buffer.concat([nonce, ciphertext]).toString('base64')
}

function decryptHalfFlowData(data, config) {
  const key = decodeAesKey(config && config.aesKey)
  const packed = decodeCanonicalBase64(data, 'data')
  if (packed.length <= 16) {
    throw new HalfFlowTrafficError('data must contain nonce and ciphertext')
  }
  try {
    const decipher = crypto.createDecipheriv(aesCtrAlgorithm(key), key, packed.subarray(0, 16))
    const plaintext = Buffer.concat([
      decipher.update(packed.subarray(16)),
      decipher.final(),
    ])
    const payload = parseDecryptedJson(plaintext)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('decrypted data must be an object')
    }
    return payload
  }
  catch (error) {
    throw new HalfFlowTrafficError(error && error.message ? error.message : 'data decrypt failed')
  }
}

function md5(value) {
  return crypto.createHash('md5').update(String(value), 'utf8').digest('hex')
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex')
}

module.exports = {
  HalfFlowTrafficError,
  decryptHalfFlowData,
  encryptHalfFlowJson,
  md5,
  sha256,
}
