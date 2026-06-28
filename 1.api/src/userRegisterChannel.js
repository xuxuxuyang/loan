function normalizeRegisterChannelCode(raw) {
  return String(raw || '').trim()
}

const TRAFFIC_CHANNEL_CODE_RE = /^[a-zA-Z0-9_-]{2,40}$/

function findTrafficChannelByCode(db, code) {
  const normalized = normalizeRegisterChannelCode(code)
  if (!normalized || !Array.isArray(db && db.trafficChannels)) {
    return null
  }
  return db.trafficChannels.find(ch => ch && normalizeRegisterChannelCode(ch.code) === normalized) || null
}

function makeRegisterChannelError(code, msg) {
  return { code, msg }
}

function readRegisterChannelCodeFromPayload(payload = {}) {
  return normalizeRegisterChannelCode(
    payload.channel != null
      ? payload.channel
      : (payload.registerChannelCode != null ? payload.registerChannelCode : ''),
  )
}

function resolveRegisterChannelForRegistration(db, payload = {}) {
  const code = readRegisterChannelCodeFromPayload(payload)
  if (!code || code === '__none__') {
    return { channel: null, error: null }
  }
  if (!TRAFFIC_CHANNEL_CODE_RE.test(code)) {
    return {
      channel: null,
      error: makeRegisterChannelError('register_channel_invalid', '推广链接失效，请重新打开'),
    }
  }
  const channel = findTrafficChannelByCode(db, code)
  if (!channel) {
    return {
      channel: null,
      error: makeRegisterChannelError('register_channel_not_found', '推广链接失效，请重新打开'),
    }
  }
  if (channel.disabled) {
    return {
      channel: null,
      error: makeRegisterChannelError('register_channel_disabled', '推广链接已停用，请重新打开'),
    }
  }
  return {
    channel: {
      code: normalizeRegisterChannelCode(channel.code),
      name: String(channel.name || channel.code || '').trim(),
    },
    error: null,
  }
}

function applyUserRegisterChannel(db, user, registerChannelCode) {
  if (!user || typeof user !== 'object') {
    const err = new Error('user_not_found')
    err.status = 404
    throw err
  }

  const code = normalizeRegisterChannelCode(registerChannelCode)
  if (!code || code === '__none__') {
    delete user.registerChannelCode
    delete user.registerChannelName
    return { channel: null, user }
  }

  const channel = findTrafficChannelByCode(db, code)
  if (!channel) {
    const err = new Error('register_channel_not_found')
    err.status = 400
    throw err
  }
  if (channel.disabled) {
    const err = new Error('register_channel_disabled')
    err.status = 400
    throw err
  }

  user.registerChannelCode = normalizeRegisterChannelCode(channel.code)
  user.registerChannelName = String(channel.name || channel.code || '').trim()
  return { channel, user }
}

module.exports = {
  normalizeRegisterChannelCode,
  findTrafficChannelByCode,
  resolveRegisterChannelForRegistration,
  applyUserRegisterChannel,
}
