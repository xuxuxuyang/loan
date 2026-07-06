const { buildZheyinTrafficEnvelope, readTrim } = require('./crypto')
const { toCreditResult } = require('./service')

const sentKeys = new Set()

function parseResponse(text) {
  if (!text) return {}
  try {
    return JSON.parse(text)
  }
  catch {
    return { raw: text }
  }
}

async function notifyZheyinTrafficCreditResult({ row, repository, config, httpClient, now }) {
  if (!row || !readTrim(row.orderId)) {
    return { sent: false, reason: 'invalid_row' }
  }
  if (!readTrim(config.creditNotifyUrl)) {
    return { sent: false, reason: 'notify_url_missing' }
  }
  const payload = toCreditResult(row, config)
  const key = `${payload.applyNo}:${payload.auditStatus}`
  if (sentKeys.has(key)) {
    return { sent: false, reason: 'duplicate_skipped', payload }
  }
  const timestamp = typeof now === 'function' ? String(now()) : String(Date.now())
  const envelope = buildZheyinTrafficEnvelope(payload, config, {
    requestNo: `NOTIFY-${payload.applyNo}-${payload.auditStatus}`,
  })
  const client = typeof httpClient === 'function'
    ? httpClient
    : (typeof fetch === 'function' ? fetch : null)
  if (!client) {
    return { sent: false, reason: 'fetch_unavailable', payload }
  }
  try {
    const resp = await client(config.creditNotifyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    })
    const text = typeof resp.text === 'function'
      ? await resp.text()
      : (typeof resp.json === 'function' ? JSON.stringify(await resp.json()) : '')
    const body = parseResponse(text)
    const code = body && body.code !== undefined ? String(body.code) : ''
    const accepted = Boolean(resp.ok) && (!code || code === '200')
    const log = {
      at: new Date(Number(timestamp) || Date.now()).toISOString(),
      auditStatus: payload.auditStatus,
      sent: accepted,
      reason: accepted ? 'ok' : 'remote_rejected',
      status: resp.status,
      body,
    }
    const notifyLogs = Array.isArray(row.notifyLogs) ? row.notifyLogs.slice(-19) : []
    const next = { ...row, notifyLogs: [...notifyLogs, log], updatedAt: log.at }
    if (accepted) sentKeys.add(key)
    if (repository && typeof repository.upsert === 'function') {
      await repository.upsert(next)
    }
    return { sent: accepted, reason: log.reason, status: resp.status, body, payload }
  }
  catch (err) {
    const error = err && err.message ? err.message : String(err)
    const log = {
      at: new Date(Number(timestamp) || Date.now()).toISOString(),
      auditStatus: payload.auditStatus,
      sent: false,
      reason: 'request_failed',
      error,
    }
    const notifyLogs = Array.isArray(row.notifyLogs) ? row.notifyLogs.slice(-19) : []
    if (repository && typeof repository.upsert === 'function') {
      await repository.upsert({ ...row, notifyLogs: [...notifyLogs, log], updatedAt: log.at })
    }
    return { sent: false, reason: 'request_failed', error, payload }
  }
}

module.exports = {
  notifyZheyinTrafficCreditResult,
}
