const crypto = require('crypto')
const mongo = require('./mongo')
const mongoConfig = require('./mongoConfig')

const COLLECTION_NAMES = Object.freeze({
  challenges: 'adminLoginChallenges',
  sessions: 'adminLoginSessions',
})

function clone(value) {
  return value == null ? value : structuredClone(value)
}

function unwrapFindOneAndUpdate(result) {
  if (!result) return null
  return Object.hasOwn(result, 'value') ? result.value : result
}

function rateLimitId(accountId, tenantId) {
  return `admin-login-rate-v1:${crypto.createHash('sha256')
    .update(`${String(accountId)}\0${String(tenantId)}`)
    .digest('hex')}`
}

function createMemoryAdminLoginSecurityStore() {
  const challenges = new Map()
  const sessions = new Map()
  const rateLimits = new Map()

  return {
    isReady: () => true,
    ensureIndexes: async () => true,
    dump() {
      return {
        challenges: clone([...challenges.values()]),
        sessions: clone([...sessions.values()]),
      }
    },
    async reserveChallengeSend({ accountId, tenantId, now, resendMs, hourlyLimit, reservationId }) {
      const key = rateLimitId(accountId, tenantId)
      const nowMs = new Date(now).getTime()
      const cutoffMs = nowMs - 3_600_000
      const existing = rateLimits.get(key) || { sends: [] }
      const sends = existing.sends
        .map(value => new Date(value))
        .filter(value => value.getTime() > cutoffMs)
      const lastSentAt = sends.at(-1)
      if (sends.length >= hourlyLimit) return { reserved: false, reason: 'hourly' }
      if (lastSentAt && nowMs - lastSentAt.getTime() < resendMs) return { reserved: false, reason: 'resend' }
      sends.push(new Date(nowMs))
      rateLimits.set(key, { accountId, tenantId, sends, reservationId })
      return { reserved: true, reason: '' }
    },
    async insertChallenge(row) {
      challenges.set(row.id, clone(row))
      return clone(row)
    },
    async getChallenge(id) {
      return clone(challenges.get(id) || null)
    },
    async expireChallenge(id, now) {
      const row = challenges.get(id)
      if (!row || row.kind !== 'challenge' || row.status !== 'pending' || new Date(row.expireAt).getTime() > new Date(now).getTime()) {
        return null
      }
      row.status = 'expired'
      row.expiredAt = new Date(now)
      return clone(row)
    },
    async recordChallengeFailure(id, now, maxAttempts) {
      const row = challenges.get(id)
      if (!row
        || row.kind !== 'challenge'
        || row.status !== 'pending'
        || Number(row.attempts || 0) >= maxAttempts
        || new Date(row.expireAt).getTime() <= new Date(now).getTime()) return null
      row.attempts = Number(row.attempts || 0) + 1
      if (row.attempts >= maxAttempts) {
        row.status = 'blocked'
        row.blockedAt = new Date(now)
      }
      return clone(row)
    },
    async claimChallenge(id, now, maxAttempts) {
      const row = challenges.get(id)
      if (!row
        || row.kind !== 'challenge'
        || row.status !== 'pending'
        || Number(row.attempts || 0) >= maxAttempts
        || new Date(row.expireAt).getTime() <= new Date(now).getTime()) return null
      row.status = 'verified'
      row.verifiedAt = new Date(now)
      return clone(row)
    },
    async markChallengeSendFailed(id) {
      const row = challenges.get(id)
      if (!row
        || row.kind !== 'challenge'
        || (row.status !== 'send_pending' && row.status !== 'pending')) return null
      row.status = 'send_failed'
      return clone(row)
    },
    async suspendPendingChallengesForResend({ accountId, tenantId, exceptId, replacementId, now }) {
      let modifiedCount = 0
      for (const row of challenges.values()) {
        if (row.kind !== 'challenge'
          || row.accountId !== accountId
          || row.tenantId !== tenantId
          || row.id === exceptId
          || row.status !== 'pending') continue
        row.status = 'resend_pending'
        row.replacementId = replacementId
        row.suspendedAt = new Date(now)
        modifiedCount += 1
      }
      return modifiedCount
    },
    async restoreSuspendedChallenges({ replacementId }) {
      let modifiedCount = 0
      for (const row of challenges.values()) {
        if (row.kind !== 'challenge'
          || row.status !== 'resend_pending'
          || row.replacementId !== replacementId) continue
        row.status = 'pending'
        delete row.replacementId
        delete row.suspendedAt
        modifiedCount += 1
      }
      return modifiedCount
    },
    async supersedeSuspendedChallenges({ replacementId, now }) {
      let modifiedCount = 0
      for (const row of challenges.values()) {
        if (row.kind !== 'challenge'
          || row.status !== 'resend_pending'
          || row.replacementId !== replacementId) continue
        row.status = 'superseded'
        row.supersededAt = new Date(now)
        modifiedCount += 1
      }
      return modifiedCount
    },
    async activateChallenge(id, now) {
      const row = challenges.get(id)
      if (!row || row.kind !== 'challenge' || row.status !== 'send_pending') return null
      row.status = 'pending'
      row.activatedAt = new Date(now)
      return clone(row)
    },
    async insertSession(row) {
      sessions.set(row.tokenHash, clone(row))
      return clone(row)
    },
    async findActiveSession(tokenHash, now) {
      const row = sessions.get(tokenHash)
      if (!row || row.revokedAt || new Date(row.expireAt).getTime() <= new Date(now).getTime()) return null
      return clone(row)
    },
    async getSession(tokenHash) {
      return clone(sessions.get(tokenHash) || null)
    },
    async revokeSession(tokenHash, now) {
      const row = sessions.get(tokenHash)
      if (!row || row.revokedAt) return null
      row.revokedAt = new Date(now)
      return clone(row)
    },
  }
}

function createMongoAdminLoginSecurityStore(options = {}) {
  const getMongoClient = options.getMongoClient || mongo.getMongoClient
  const getMongoConfig = options.getMongoConfig || mongoConfig.getMongoConfig
  const indexed = new Set()

  function collections() {
    const client = getMongoClient()
    if (!client) return null
    const config = getMongoConfig() || {}
    // Login security always uses the configured root database, never tenant context.
    const db = config.dbName ? client.db(config.dbName) : client.db()
    return {
      db,
      challenges: db.collection(COLLECTION_NAMES.challenges),
      sessions: db.collection(COLLECTION_NAMES.sessions),
    }
  }

  function requireCollections() {
    const current = collections()
    if (!current) throw new Error('MongoDB is unavailable for admin login security')
    return current
  }

  async function ensureIndexes() {
    const current = collections()
    if (!current) return false
    if (indexed.has(current.db.databaseName)) return true
    await Promise.all([
      current.challenges.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
      current.challenges.createIndex({ accountId: 1, tenantId: 1, createdAt: -1 }),
      current.sessions.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
      current.sessions.createIndex({ tokenHash: 1 }, { unique: true }),
      current.sessions.createIndex({ accountId: 1, revokedAt: 1, expireAt: 1 }),
    ])
    indexed.add(current.db.databaseName)
    return true
  }

  return {
    isReady: () => Boolean(collections()),
    ensureIndexes,
    async reserveChallengeSend({ accountId, tenantId, now, resendMs, hourlyLimit, reservationId }) {
      const nowDate = new Date(now)
      const cutoffDate = new Date(nowDate.getTime() - 3_600_000)
      const id = rateLimitId(accountId, tenantId)
      const challenges = requireCollections().challenges
      const update = [
        {
          $set: {
            id,
            kind: 'rate_limit',
            accountId,
            tenantId,
            createdAt: { $ifNull: ['$createdAt', nowDate] },
            sends: {
              $filter: {
                input: { $cond: [{ $isArray: '$sends' }, '$sends', []] },
                as: 'sentAt',
                cond: { $gt: ['$$sentAt', cutoffDate] },
              },
            },
          },
        },
        {
          $set: {
            _allowed: {
              $and: [
                { $lt: [{ $size: '$sends' }, hourlyLimit] },
                {
                  $or: [
                    { $eq: [{ $size: '$sends' }, 0] },
                    { $gte: [{ $subtract: [nowDate, { $arrayElemAt: ['$sends', -1] }] }, resendMs] },
                  ],
                },
              ],
            },
          },
        },
        {
          $set: {
            sends: { $cond: ['$_allowed', { $concatArrays: ['$sends', [nowDate]] }, '$sends'] },
            lastReservationId: { $cond: ['$_allowed', reservationId, '$lastReservationId'] },
            expireAt: new Date(nowDate.getTime() + 3_600_000 + resendMs),
          },
        },
        { $unset: '_allowed' },
      ]
      let result
      try {
        result = await challenges.findOneAndUpdate({ _id: id }, update, { upsert: true, returnDocument: 'after' })
      }
      catch (error) {
        if (Number(error?.code) !== 11000) throw error
        result = await challenges.findOneAndUpdate({ _id: id }, update, { upsert: false, returnDocument: 'after' })
      }
      const row = unwrapFindOneAndUpdate(result)
      const reserved = row?.lastReservationId === reservationId
      return {
        reserved,
        reason: reserved || Number(row?.sends?.length || 0) < hourlyLimit ? 'resend' : 'hourly',
      }
    },
    async insertChallenge(row) {
      await requireCollections().challenges.insertOne({ ...row, _id: row.id })
      return row
    },
    async getChallenge(id) {
      return requireCollections().challenges.findOne({ _id: id, kind: 'challenge' })
    },
    async expireChallenge(id, now) {
      const result = await requireCollections().challenges.findOneAndUpdate(
        { _id: id, kind: 'challenge', status: 'pending', expireAt: { $lte: new Date(now) } },
        { $set: { status: 'expired', expiredAt: new Date(now) } },
        { returnDocument: 'after' },
      )
      return unwrapFindOneAndUpdate(result)
    },
    async recordChallengeFailure(id, now, maxAttempts) {
      const failedAt = new Date(now)
      const result = await requireCollections().challenges.findOneAndUpdate(
        {
          _id: id,
          kind: 'challenge',
          status: 'pending',
          attempts: { $lt: maxAttempts },
          expireAt: { $gt: failedAt },
        },
        [
          { $set: { attempts: { $add: [{ $ifNull: ['$attempts', 0] }, 1] } } },
          {
            $set: {
              status: { $cond: [{ $gte: ['$attempts', maxAttempts] }, 'blocked', '$status'] },
              blockedAt: { $cond: [{ $gte: ['$attempts', maxAttempts] }, failedAt, '$blockedAt'] },
            },
          },
        ],
        { returnDocument: 'after' },
      )
      return unwrapFindOneAndUpdate(result)
    },
    async claimChallenge(id, now, maxAttempts) {
      const verifiedAt = new Date(now)
      const result = await requireCollections().challenges.findOneAndUpdate(
        {
          _id: id,
          kind: 'challenge',
          status: 'pending',
          attempts: { $lt: maxAttempts },
          expireAt: { $gt: verifiedAt },
        },
        { $set: { status: 'verified', verifiedAt } },
        { returnDocument: 'after' },
      )
      return unwrapFindOneAndUpdate(result)
    },
    async markChallengeSendFailed(id) {
      const result = await requireCollections().challenges.findOneAndUpdate(
        { _id: id, kind: 'challenge', status: { $in: ['send_pending', 'pending'] } },
        { $set: { status: 'send_failed' } },
        { returnDocument: 'after' },
      )
      return unwrapFindOneAndUpdate(result)
    },
    async suspendPendingChallengesForResend({ accountId, tenantId, exceptId, replacementId, now }) {
      const result = await requireCollections().challenges.updateMany(
        {
          kind: 'challenge',
          accountId,
          tenantId,
          status: 'pending',
          _id: { $ne: exceptId },
        },
        {
          $set: {
            status: 'resend_pending',
            replacementId,
            suspendedAt: new Date(now),
          },
        },
      )
      return Number(result?.modifiedCount || 0)
    },
    async restoreSuspendedChallenges({ replacementId }) {
      const result = await requireCollections().challenges.updateMany(
        { kind: 'challenge', status: 'resend_pending', replacementId },
        {
          $set: { status: 'pending' },
          $unset: { replacementId: '', suspendedAt: '' },
        },
      )
      return Number(result?.modifiedCount || 0)
    },
    async supersedeSuspendedChallenges({ replacementId, now }) {
      const result = await requireCollections().challenges.updateMany(
        { kind: 'challenge', status: 'resend_pending', replacementId },
        { $set: { status: 'superseded', supersededAt: new Date(now) } },
      )
      return Number(result?.modifiedCount || 0)
    },
    async activateChallenge(id, now) {
      const activatedAt = new Date(now)
      const result = await requireCollections().challenges.findOneAndUpdate(
        { _id: id, kind: 'challenge', status: 'send_pending' },
        { $set: { status: 'pending', activatedAt } },
        { returnDocument: 'after' },
      )
      return unwrapFindOneAndUpdate(result)
    },
    async insertSession(row) {
      await requireCollections().sessions.insertOne({ ...row, _id: row.id })
      return row
    },
    async findActiveSession(tokenHash, now) {
      return requireCollections().sessions.findOne({
        tokenHash,
        revokedAt: null,
        expireAt: { $gt: new Date(now) },
      })
    },
    async getSession(tokenHash) {
      return requireCollections().sessions.findOne({ tokenHash })
    },
    async revokeSession(tokenHash, now) {
      const result = await requireCollections().sessions.findOneAndUpdate(
        { tokenHash, revokedAt: null },
        { $set: { revokedAt: new Date(now) } },
        { returnDocument: 'after' },
      )
      return unwrapFindOneAndUpdate(result)
    },
  }
}

module.exports = {
  COLLECTION_NAMES,
  createMemoryAdminLoginSecurityStore,
  createMongoAdminLoginSecurityStore,
}
