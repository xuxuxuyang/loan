const crypto = require('crypto')
const {
  ORDER_INSTALLMENT_RISK_STEP_KEYS,
  ORDER_INSTALLMENT_RISK_STEP_LABELS,
} = require('./upstreamClient')

const TTL_MS = 30 * 60 * 1000
const waves = new Map()

function normalizeId(id) {
  return String(id || '').trim().toUpperCase()
}

function normalizePhone(phone) {
  return String(phone || '').trim()
}

function normalizeName(name) {
  return String(name || '').trim()
}

function newWaveId() {
  return `rw_${crypto.randomBytes(16).toString('hex')}`
}

function pruneExpired() {
  const now = Date.now()
  for (const [id, w] of waves) {
    if (w.expiresAt <= now) waves.delete(id)
  }
}

function createWave({ userName, phoneNumber, idNumber }) {
  pruneExpired()
  const name = normalizeName(userName)
  const phone = normalizePhone(phoneNumber)
  const id = normalizeId(idNumber)
  if (!name || !phone || !id) {
    const err = new Error('缺少姓名、手机号或身份证号')
    err.statusCode = 400
    throw err
  }
  const waveId = newWaveId()
  const expiresAt = Date.now() + TTL_MS
  waves.set(waveId, {
    userName: name,
    phoneNumber: phone,
    idNumber: id,
    steps: {},
    expiresAt,
  })
  return {
    waveId,
    stepKeys: [...ORDER_INSTALLMENT_RISK_STEP_KEYS],
    stepLabels: { ...ORDER_INSTALLMENT_RISK_STEP_LABELS },
    expiresAt,
  }
}

function getWave(waveId) {
  pruneExpired()
  const w = waves.get(String(waveId || ''))
  if (!w) {
    const err = new Error('风控会话不存在或已过期')
    err.statusCode = 404
    throw err
  }
  if (w.expiresAt <= Date.now()) {
    waves.delete(String(waveId))
    const err = new Error('风控会话已过期')
    err.statusCode = 410
    throw err
  }
  return w
}

function recordStepResult(waveId, stepKey, stepResult) {
  const w = getWave(waveId)
  if (!ORDER_INSTALLMENT_RISK_STEP_KEYS.includes(stepKey)) {
    const err = new Error('未知的风控步骤')
    err.statusCode = 400
    throw err
  }
  w.steps[stepKey] = { ...stepResult, recordedAt: Date.now() }
  waves.set(String(waveId), w)
  return w
}

function allStepsOk(w) {
  for (const key of ORDER_INSTALLMENT_RISK_STEP_KEYS) {
    const s = w.steps[key]
    if (!s || s.ok !== true) return false
  }
  return true
}

/**
 * 下单时消费 wave：校验身份与 7 步全通过，成功后删除 wave。
 * @returns {{ ok: boolean, steps: object[], reason?: string }}
 */
function consumeForOrder(waveId, { userName, phoneNumber, idNumber }) {
  const name = normalizeName(userName)
  const phone = normalizePhone(phoneNumber)
  const id = normalizeId(idNumber)
  let w
  try {
    w = getWave(waveId)
  } catch (e) {
    return { ok: false, steps: [], reason: e.message || 'wave 无效' }
  }
  if (name !== w.userName || phone !== w.phoneNumber || id !== w.idNumber) {
    return { ok: false, steps: [], reason: '下单身份信息与风控会话不一致' }
  }
  if (!allStepsOk(w)) {
    const steps = ORDER_INSTALLMENT_RISK_STEP_KEYS.map((key) => ({
      key,
      label: ORDER_INSTALLMENT_RISK_STEP_LABELS[key],
      ...(w.steps[key] || { ok: false, reason: '未完成' }),
    }))
    return { ok: false, steps, reason: '分期风控未全部通过' }
  }
  const steps = ORDER_INSTALLMENT_RISK_STEP_KEYS.map((key) => ({
    key,
    label: ORDER_INSTALLMENT_RISK_STEP_LABELS[key],
    ...w.steps[key],
  }))
  waves.delete(String(waveId))
  return { ok: true, steps }
}

module.exports = {
  createWave,
  getWave,
  recordStepResult,
  consumeForOrder,
  ORDER_INSTALLMENT_RISK_STEP_KEYS,
}
