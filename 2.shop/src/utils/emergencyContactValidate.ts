/**
 * 与 api/src/index.js 中紧急联系人校验规则保持一致。
 */

export function normalizeEmergencyContactPersonName(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\u00b7|・|･/g, '·')
}

/** 仅汉字或英文字母，可含间隔「·」与空格；禁止数字与其它符号 */
export function isValidEmergencyContactPersonName(raw: string): boolean {
  const s = normalizeEmergencyContactPersonName(raw)
  if (!s || s.length > 32) {
    return false
  }
  if (/\d/.test(s)) {
    return false
  }
  if (!/^[\u4e00-\u9fff\u3400-\u4DBFa-zA-Z· ]+$/.test(s)) {
    return false
  }
  if (!/[\u4e00-\u9fff\u3400-\u4DBFa-zA-Z]/.test(s)) {
    return false
  }
  return true
}

export function isValidEmergencyContactPhoneDigits(raw: string): boolean {
  const p = String(raw ?? '').replace(/\D/g, '')
  return /^1\d{10}$/.test(p)
}
