const crypto = require('node:crypto')

/**
 * 将对象递归按键名升序序列化为紧凑 JSON 字符串（用于 jsonData）。
 * 数组元素保持顺序；对象键按 Unicode 升序排列。
 */
function stableStringify(value) {
  if (value === null || value === undefined) {
    return JSON.stringify(value)
  }
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    const inner = value.map(stableStringify).join(',')
    return `[${inner}]`
  }
  if (t === 'object') {
    const keys = Object.keys(value).sort()
    const inner = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')
    return `{${inner}}`
  }
  return JSON.stringify(value)
}

/**
 * sign = md5(appid#jsonData#time#appkey#rand)，输出小写十六进制。
 */
function computeSign(appid, jsonData, time, appkey, rand) {
  const raw = `${appid}#${jsonData}#${time}#${appkey}#${rand}`
  return crypto.createHash('md5').update(raw, 'utf8').digest('hex').toLowerCase()
}

function timingSafeEqualHex(a, b) {
  const sa = String(a || '').toLowerCase()
  const sb = String(b || '').toLowerCase()
  if (sa.length !== sb.length || !/^[0-9a-f]+$/.test(sa) || !/^[0-9a-f]+$/.test(sb)) {
    return false
  }
  try {
    const ba = Buffer.from(sa, 'hex')
    const bb = Buffer.from(sb, 'hex')
    return crypto.timingSafeEqual(ba, bb)
  }
  catch {
    return false
  }
}

module.exports = {
  stableStringify,
  computeSign,
  timingSafeEqualHex,
}
