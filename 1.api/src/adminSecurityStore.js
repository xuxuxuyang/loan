const crypto = require('crypto')
const mongo = require('./mongo')

const COLLECTION_NAMES = Object.freeze({
  auditLogs: 'adminSecurityAuditLogs',
  challenges: 'adminSecurityChallenges',
  proofs: 'adminSecurityProofs',
})

function clone(value) {
  return value == null ? value : structuredClone(value)
}

function rateLimitReservationId(actorId, tenantId) {
  const key = `${String(tenantId || '')}\0${String(actorId || '')}`
  return `ASR${crypto.createHash('sha256').update(key).digest('hex')}`
}

function matchesAuditFilter(row, filter) {
  if (filter.tenantId && row.tenantId !== filter.tenantId) return false
  if (filter.category && row.category !== filter.category) return false
  if (filter.status && row.status !== filter.status) return false
  if (filter.actorId && row.actor?.id !== filter.actorId) return false
  if (filter.ip && row.ip !== filter.ip) return false
  if (filter.from && new Date(row.createdAt).getTime() < new Date(filter.from).getTime()) return false
  if (filter.to && new Date(row.createdAt).getTime() > new Date(filter.to).getTime()) return false
  if (filter.keyword) {
    const haystack = JSON.stringify({ actor: row.actor, target: row.target, summary: row.summary }).toLowerCase()
    if (!haystack.includes(String(filter.keyword).toLowerCase())) return false
  }
  return true
}

function auditPagination(filter = {}) {
  const rawPage = Number(filter.page)
  const rawPageSize = Number(filter.pageSize)
  return {
    page: Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1,
    pageSize: Number.isFinite(rawPageSize) && rawPageSize >= 1
      ? Math.min(100, Math.floor(rawPageSize))
      : 20,
  }
}

function createMemoryAdminSecurityStore(options = {}) {
  const challenges = new Map()
  const proofs = new Map()
  const auditLogs = new Map()

  return {
    isReady: () => true,
    ensureIndexes: async () => {},
    async countChallengesSince({ actorId, since }) {
      const time = new Date(since).getTime()
      return [...challenges.values()].filter(row => row.actorId === actorId && new Date(row.createdAt).getTime() >= time).length
    },
    async findRecentChallenge({ actorId, tenantId, createdAfter }) {
      const time = new Date(createdAfter).getTime()
      return clone([...challenges.values()]
        .filter(row => row.actorId === actorId && row.tenantId === tenantId && new Date(row.createdAt).getTime() >= time)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null)
    },
    async reserveChallengeSend({ actorId, tenantId, now, resendMs, hourlyLimit, reservationId }) {
      const nowMs = new Date(now).getTime()
      const cutoffMs = nowMs - 3_600_000
      const id = rateLimitReservationId(actorId, tenantId)
      const existing = challenges.get(id)
      const activeReservations = (Array.isArray(existing?.sendReservations) ? existing.sendReservations : [])
        .map(value => new Date(value))
        .filter(value => value.getTime() > cutoffMs)
      const lastReservation = activeReservations[activeReservations.length - 1]
      const hourlyBlocked = activeReservations.length >= hourlyLimit
      const resendBlocked = lastReservation && nowMs - lastReservation.getTime() < resendMs
      if (hourlyBlocked || resendBlocked) {
        return { reserved: false, reason: hourlyBlocked ? 'hourly' : 'resend' }
      }
      activeReservations.push(new Date(nowMs))
      challenges.set(id, {
        id,
        kind: 'sms_rate_limit',
        actorId,
        tenantId,
        sendReservations: activeReservations,
        lastReservationId: reservationId,
        createdAt: existing?.createdAt || new Date(nowMs),
        expireAt: new Date(nowMs + 3_600_000 + resendMs),
      })
      return { reserved: true, reason: '' }
    },
    async insertChallenge(row) {
      challenges.set(row.id, clone(row))
      return clone(row)
    },
    async getChallenge(id) {
      return clone(challenges.get(id) || null)
    },
    async updateChallenge(id, patch) {
      const row = challenges.get(id)
      if (!row) return null
      Object.assign(row, clone(patch))
      return clone(row)
    },
    async claimChallengeVerification(id, verifiedAt, maxAttempts = 5) {
      const row = challenges.get(id)
      if (!row
        || row.status !== 'pending'
        || Number(row.attempts || 0) >= maxAttempts
        || new Date(row.expireAt).getTime() <= new Date(verifiedAt).getTime()) return null
      row.status = 'verified'
      row.verifiedAt = new Date(verifiedAt)
      return clone(row)
    },
    async recordChallengeFailure(id, failedAt, maxAttempts = 5) {
      const row = challenges.get(id)
      if (!row
        || row.status !== 'pending'
        || Number(row.attempts || 0) >= maxAttempts
        || new Date(row.expireAt).getTime() <= new Date(failedAt).getTime()) return null
      row.attempts = Number(row.attempts || 0) + 1
      const blockedNow = row.attempts >= maxAttempts
      if (blockedNow) {
        row.status = 'blocked'
        row.blockedAt = new Date(failedAt)
      }
      return { challenge: clone(row), blockedNow }
    },
    async incrementChallengeAttempts(id) {
      const row = challenges.get(id)
      if (!row) return null
      row.attempts = Number(row.attempts || 0) + 1
      return clone(row)
    },
    async insertProof(row) {
      proofs.set(row.proofHash, clone(row))
      return clone(row)
    },
    async getProof(proofHash) {
      return clone(proofs.get(proofHash) || null)
    },
    async claimProof(proofHash, reusable) {
      const row = proofs.get(proofHash)
      if (!row || (!reusable && row.consumedAt)) return null
      row.useCount = Number(row.useCount || 0) + 1
      if (!reusable) row.consumedAt = new Date(options.now ? options.now() : Date.now())
      return clone(row)
    },
    async insertAuditLog(row) {
      auditLogs.set(row.id, clone(row))
      return clone(row)
    },
    async updateAuditLog(id, patch) {
      const row = auditLogs.get(id)
      if (!row) return null
      Object.assign(row, clone(patch))
      return clone(row)
    },
    async getAuditLog(id) {
      return clone(auditLogs.get(id) || null)
    },
    async listAuditLogs(filter = {}) {
      const { page, pageSize } = auditPagination(filter)
      const rows = [...auditLogs.values()]
        .filter(row => matchesAuditFilter(row, filter))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      const start = (page - 1) * pageSize
      return { items: clone(rows.slice(start, start + pageSize)), total: rows.length, page, pageSize }
    },
  }
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function createMongoAdminSecurityStore(options = {}) {
  const getDb = options.getDb || mongo.getMongoDb
  const indexed = new Set()

  function collections() {
    const db = getDb()
    if (!db) return null
    return {
      db,
      auditLogs: db.collection(COLLECTION_NAMES.auditLogs),
      challenges: db.collection(COLLECTION_NAMES.challenges),
      proofs: db.collection(COLLECTION_NAMES.proofs),
    }
  }

  async function ensureIndexes() {
    const c = collections()
    if (!c) return false
    if (indexed.has(c.db.databaseName)) return true
    await Promise.all([
      c.auditLogs.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
      c.auditLogs.createIndex({ createdAt: -1 }),
      c.auditLogs.createIndex({ tenantId: 1, status: 1, actionCode: 1, createdAt: -1 }),
      c.challenges.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
      c.challenges.createIndex({ actorId: 1, createdAt: -1 }),
      c.proofs.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
    ])
    indexed.add(c.db.databaseName)
    return true
  }

  function requireCollections() {
    const c = collections()
    if (!c) throw new Error('MongoDB 未连接，后台安全存储不可用')
    return c
  }

  return {
    isReady: () => Boolean(collections()),
    ensureIndexes,
    async countChallengesSince({ actorId, since }) {
      return requireCollections().challenges.countDocuments({ actorId, createdAt: { $gte: new Date(since) } })
    },
    async findRecentChallenge({ actorId, tenantId, createdAfter }) {
      return requireCollections().challenges.findOne(
        { actorId, tenantId, createdAt: { $gte: new Date(createdAfter) } },
        { sort: { createdAt: -1 } },
      )
    },
    async reserveChallengeSend({ actorId, tenantId, now, resendMs, hourlyLimit, reservationId }) {
      const nowDate = new Date(now)
      const cutoffDate = new Date(nowDate.getTime() - 3_600_000)
      const reservationDocId = rateLimitReservationId(actorId, tenantId)
      const challenges = requireCollections().challenges
      const query = { _id: reservationDocId }
      const update = [
        {
          $set: {
            id: reservationDocId,
            kind: 'sms_rate_limit',
            actorId,
            tenantId,
            createdAt: { $ifNull: ['$createdAt', nowDate] },
            sendReservations: {
              $filter: {
                input: { $cond: [{ $isArray: '$sendReservations' }, '$sendReservations', []] },
                as: 'sentAt',
                cond: { $gt: ['$$sentAt', cutoffDate] },
              },
            },
          },
        },
        {
          $set: {
            _reservationAllowed: {
              $and: [
                { $lt: [{ $size: '$sendReservations' }, hourlyLimit] },
                {
                  $or: [
                    { $eq: [{ $size: '$sendReservations' }, 0] },
                    {
                      $gte: [
                        { $subtract: [nowDate, { $arrayElemAt: ['$sendReservations', -1] }] },
                        resendMs,
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
        {
          $set: {
            sendReservations: {
              $cond: [
                '$_reservationAllowed',
                { $concatArrays: ['$sendReservations', [nowDate]] },
                '$sendReservations',
              ],
            },
            lastReservationId: {
              $cond: ['$_reservationAllowed', reservationId, '$lastReservationId'],
            },
            expireAt: new Date(nowDate.getTime() + 3_600_000 + resendMs),
          },
        },
        { $unset: '_reservationAllowed' },
      ]
      let result
      try {
        result = await challenges.findOneAndUpdate(query, update, { upsert: true, returnDocument: 'after' })
      }
      catch (error) {
        if (Number(error?.code) !== 11000) throw error
        result = await challenges.findOneAndUpdate(query, update, { upsert: false, returnDocument: 'after' })
      }
      const row = result?.value || result || null
      const reserved = row?.lastReservationId === reservationId
      return {
        reserved,
        reason: reserved || Number(row?.sendReservations?.length || 0) < hourlyLimit ? 'resend' : 'hourly',
      }
    },
    async insertChallenge(row) {
      await requireCollections().challenges.insertOne({ ...row, _id: row.id })
      return row
    },
    async getChallenge(id) {
      return requireCollections().challenges.findOne({ _id: id })
    },
    async updateChallenge(id, patch) {
      const result = await requireCollections().challenges.findOneAndUpdate(
        { _id: id },
        { $set: patch },
        { returnDocument: 'after' },
      )
      return result?.value || result || null
    },
    async claimChallengeVerification(id, verifiedAt, maxAttempts = 5) {
      const result = await requireCollections().challenges.findOneAndUpdate(
        {
          _id: id,
          status: 'pending',
          attempts: { $lt: maxAttempts },
          expireAt: { $gt: new Date(verifiedAt) },
        },
        { $set: { status: 'verified', verifiedAt: new Date(verifiedAt) } },
        { returnDocument: 'after' },
      )
      return result?.value || result || null
    },
    async recordChallengeFailure(id, failedAt, maxAttempts = 5) {
      const failedDate = new Date(failedAt)
      const result = await requireCollections().challenges.findOneAndUpdate(
        {
          _id: id,
          status: 'pending',
          attempts: { $lt: maxAttempts },
          expireAt: { $gt: failedDate },
        },
        [
          { $set: { attempts: { $add: [{ $ifNull: ['$attempts', 0] }, 1] } } },
          {
            $set: {
              status: { $cond: [{ $gte: ['$attempts', maxAttempts] }, 'blocked', '$status'] },
              blockedAt: { $cond: [{ $gte: ['$attempts', maxAttempts] }, failedDate, '$blockedAt'] },
            },
          },
        ],
        { returnDocument: 'after' },
      )
      const challenge = result?.value || result || null
      if (!challenge) return null
      return {
        challenge,
        blockedNow: challenge.status === 'blocked' && Number(challenge.attempts || 0) === maxAttempts,
      }
    },
    async incrementChallengeAttempts(id) {
      const result = await requireCollections().challenges.findOneAndUpdate(
        { _id: id },
        { $inc: { attempts: 1 } },
        { returnDocument: 'after' },
      )
      return result?.value || result || null
    },
    async insertProof(row) {
      await requireCollections().proofs.insertOne({ ...row, _id: row.proofHash })
      return row
    },
    async getProof(proofHash) {
      return requireCollections().proofs.findOne({ _id: proofHash })
    },
    async claimProof(proofHash, reusable) {
      const query = { _id: proofHash, ...(reusable ? {} : { consumedAt: null }) }
      const update = { $inc: { useCount: 1 } }
      if (!reusable) update.$set = { consumedAt: new Date() }
      const result = await requireCollections().proofs.findOneAndUpdate(query, update, { returnDocument: 'after' })
      return result?.value || result || null
    },
    async insertAuditLog(row) {
      await requireCollections().auditLogs.insertOne({ ...row, _id: row.id })
      return row
    },
    async updateAuditLog(id, patch) {
      const result = await requireCollections().auditLogs.findOneAndUpdate(
        { _id: id },
        { $set: patch },
        { returnDocument: 'after' },
      )
      return result?.value || result || null
    },
    async getAuditLog(id) {
      return requireCollections().auditLogs.findOne({ _id: id })
    },
    async listAuditLogs(filter = {}) {
      const query = {}
      if (filter.tenantId) query.tenantId = filter.tenantId
      if (filter.category) query.category = filter.category
      if (filter.status) query.status = filter.status
      if (filter.actorId) query['actor.id'] = filter.actorId
      if (filter.ip) query.ip = filter.ip
      if (filter.from || filter.to) {
        query.createdAt = {}
        if (filter.from) query.createdAt.$gte = new Date(filter.from)
        if (filter.to) query.createdAt.$lte = new Date(filter.to)
      }
      if (filter.keyword) {
        const regex = new RegExp(escapeRegex(filter.keyword), 'i')
        query.$or = [
          { 'actor.username': regex },
          { 'actor.name': regex },
          { 'target.userName': regex },
          { 'target.phoneMasked': regex },
          { 'target.orderId': regex },
          { summary: regex },
        ]
      }
      const { page, pageSize } = auditPagination(filter)
      const coll = requireCollections().auditLogs
      const [items, total] = await Promise.all([
        coll.find(query).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
        coll.countDocuments(query),
      ])
      return { items, total, page, pageSize }
    },
  }
}

module.exports = {
  COLLECTION_NAMES,
  createMemoryAdminSecurityStore,
  createMongoAdminSecurityStore,
}
