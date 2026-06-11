function normalizeRegisterChannelCode(raw) {
  return String(raw || '').trim()
}

function findTrafficChannelByCode(db, code) {
  const normalized = normalizeRegisterChannelCode(code)
  if (!normalized || !Array.isArray(db && db.trafficChannels)) {
    return null
  }
  return db.trafficChannels.find(ch => ch && normalizeRegisterChannelCode(ch.code) === normalized) || null
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
  applyUserRegisterChannel,
}
