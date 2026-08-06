const crypto = require('node:crypto')

const { encryptHalfFlowJson } = require('./crypto')

const MAX_RESPONSE_BYTES = 4096
const MAX_LOG_MESSAGE_LENGTH = 200

function toHalfFlowCreditNotifyPayload(row) {
  return {
    orderId: row.orderId,
    orderStatus: 3,
    money: Math.round(Number(row.creditAmountYuan) * 100),
    expireTime: Date.parse(row.creditExpireAt),
  }
}

function parseResponse(text) {
  try {
    return text ? JSON.parse(text) : {}
  }
  catch {
    return {}
  }
}

function sanitizeLogText(value) {
  return String(value == null ? '' : value)
    .slice(0, MAX_LOG_MESSAGE_LENGTH)
}

async function readLimitedResponseText(response) {
  if (response && response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader()
    const chunks = []
    let size = 0
    let truncated = false
    while (true) {
      const part = await reader.read()
      if (part.done) break
      const chunk = Buffer.from(part.value || [])
      const remaining = MAX_RESPONSE_BYTES - size
      if (chunk.length > remaining) {
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining))
        truncated = true
        await reader.cancel().catch(() => {})
        break
      }
      chunks.push(chunk)
      size += chunk.length
    }
    return { text: Buffer.concat(chunks).toString('utf8'), truncated }
  }

  const raw = response && typeof response.text === 'function' ? await response.text() : ''
  const buffer = Buffer.from(String(raw || ''), 'utf8')
  return {
    text: buffer.subarray(0, MAX_RESPONSE_BYTES).toString('utf8'),
    truncated: buffer.length > MAX_RESPONSE_BYTES,
  }
}

function nowIso(now) {
  const value = typeof now === 'function' ? Number(now()) : Date.now()
  return new Date(Number.isFinite(value) ? value : Date.now()).toISOString()
}

async function appendNotifyLog({
  row,
  repository,
  payload,
  sent,
  reason,
  status,
  remoteCode,
  responseTruncated,
  claimId,
  now,
}) {
  const at = nowIso(now)
  const log = {
    at,
    orderStatus: payload.orderStatus,
    sent,
    reason,
    ...(status == null ? {} : { status }),
    ...(remoteCode ? { remoteCode: sanitizeLogText(remoteCode) } : {}),
    ...(responseTruncated ? { responseTruncated: true } : {}),
  }
  const finalized = await repository.finalizeCreditNotification({
    id: row.id,
    claimId,
    orderStatus: payload.orderStatus,
    sent,
    log,
    completedAt: at,
  })
  if (finalized) {
    Object.assign(row, {
      notifyLogs: [...(Array.isArray(row.notifyLogs) ? row.notifyLogs.slice(-19) : []), log],
      lastNotifyStatus: sent ? 'success' : 'failed',
      lastNotifiedOrderStatus: payload.orderStatus,
      lastNotifyAt: at,
      notifyClaimId: '',
      notifyClaimedAt: '',
      updatedAt: at,
    })
  }
  return finalized
}

async function notifyHalfFlowCreditResult({ row, repository, config, httpClient, now }) {
  const payload = toHalfFlowCreditNotifyPayload(row)
  const claimedAt = nowIso(now)
  const staleAfterMs = Math.max(Number(config.notifyTimeoutMs) * 2, 60_000)
  const staleBefore = new Date(Date.parse(claimedAt) - staleAfterMs).toISOString()
  const claimId = crypto.randomUUID()
  const claimed = await repository.claimCreditNotification({
    id: row.id,
    orderStatus: payload.orderStatus,
    claimId,
    claimedAt,
    staleBefore,
  })
  if (!claimed) {
    const latest = await repository.findByOrderId(row.orderId)
    const reason = latest
      && latest.lastNotifyStatus === 'success'
      && Number(latest.lastNotifiedOrderStatus) === payload.orderStatus
      ? 'duplicate_skipped'
      : 'notification_in_progress'
    return { sent: false, reason, payload }
  }

  const activeRow = await repository.findByOrderId(row.orderId) || row

  const client = typeof httpClient === 'function'
    ? httpClient
    : (typeof fetch === 'function' ? fetch : null)
  if (!client) {
    const finalized = await appendNotifyLog({
      row: activeRow,
      repository,
      payload,
      sent: false,
      reason: 'fetch_unavailable',
      claimId,
      now,
    })
    return { sent: false, reason: finalized ? 'fetch_unavailable' : 'claim_lost', payload }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(config.notifyTimeoutMs))
  try {
    const response = await client(config.creditNotifyUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        ChannelCode: config.channelCode,
      },
      body: JSON.stringify({ data: encryptHalfFlowJson(payload, config) }),
      signal: controller.signal,
    })
    const responseText = await readLimitedResponseText(response)
    const body = parseResponse(responseText.text)
    const accepted = Boolean(response.ok) && String(body.code) === '0'
    const finalized = await appendNotifyLog({
      row: activeRow,
      repository,
      payload,
      sent: accepted,
      reason: accepted ? 'ok' : 'remote_rejected',
      status: response.status,
      remoteCode: body.code == null ? '' : String(body.code),
      responseTruncated: responseText.truncated,
      claimId,
      now,
    })
    if (!finalized) return { sent: false, reason: 'claim_lost', payload }
    return { sent: accepted, reason: accepted ? 'ok' : 'remote_rejected', payload }
  }
  catch (error) {
    const finalized = await appendNotifyLog({
      row: activeRow,
      repository,
      payload,
      sent: false,
      reason: 'request_failed',
      claimId,
      now,
    })
    return { sent: false, reason: finalized ? 'request_failed' : 'claim_lost', payload }
  }
  finally {
    clearTimeout(timer)
  }
}

module.exports = {
  notifyHalfFlowCreditResult,
  toHalfFlowCreditNotifyPayload,
}
