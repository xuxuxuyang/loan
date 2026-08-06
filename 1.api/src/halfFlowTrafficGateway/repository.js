const mongo = require('../mongo')

const { HalfFlowTrafficError } = require('./crypto')

const COLLECTION_NAME = 'halfFlowTrafficApplications'

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function createMemoryHalfFlowTrafficRepository(seed = []) {
  const rows = Array.isArray(seed) ? seed.map(clone) : []
  return {
    async findByHashes(mobileMd5, idCardMd5) {
      return clone(rows.find(row => row && row.mobileMd5 === mobileMd5 && row.idCardMd5 === idCardMd5) || null)
    },
    async findByEitherHash(mobileMd5, idCardMd5) {
      return clone(rows.find(row => row && (row.mobileMd5 === mobileMd5 || row.idCardMd5 === idCardMd5)) || null)
    },
    async findByOrderId(orderId) {
      return clone(rows.find(row => row && row.orderId === orderId) || null)
    },
    async save(row) {
      const next = clone(row)
      const index = rows.findIndex(item => item && item.id === next.id)
      if (index >= 0) rows[index] = { ...rows[index], ...next }
      else rows.unshift(next)
      return clone(rows[index >= 0 ? index : 0])
    },
    async claimCreditNotification({ id, orderStatus, claimId, claimedAt, staleBefore }) {
      const row = rows.find(item => item && item.id === id)
      if (!row) return false
      if (row.lastNotifyStatus === 'success' && Number(row.lastNotifiedOrderStatus) === Number(orderStatus)) {
        return false
      }
      const pendingSameStatus = row.lastNotifyStatus === 'pending'
        && Number(row.lastNotifiedOrderStatus) === Number(orderStatus)
      if (pendingSameStatus && Date.parse(row.notifyClaimedAt) >= Date.parse(staleBefore)) return false
      row.lastNotifyStatus = 'pending'
      row.lastNotifiedOrderStatus = orderStatus
      row.notifyClaimId = claimId
      row.notifyClaimedAt = claimedAt
      row.updatedAt = claimedAt
      return true
    },
    async finalizeCreditNotification({ id, claimId, orderStatus, sent, log, completedAt }) {
      const row = rows.find(item => item && item.id === id)
      if (!row || row.lastNotifyStatus !== 'pending' || row.notifyClaimId !== claimId) return false
      row.notifyLogs = [...(Array.isArray(row.notifyLogs) ? row.notifyLogs.slice(-19) : []), clone(log)]
      row.lastNotifyStatus = sent ? 'success' : 'failed'
      row.lastNotifiedOrderStatus = orderStatus
      row.lastNotifyAt = completedAt
      row.notifyClaimId = ''
      row.notifyClaimedAt = ''
      row.updatedAt = completedAt
      return true
    },
    async reserveMallUser({ id, pendingMallUserId, preparedAt }) {
      const row = rows.find(item => item && item.id === id)
      if (!row || row.mallUserId || row.pendingMallUserId) return false
      row.pendingMallUserId = pendingMallUserId
      row.pendingMallUserPreparedAt = preparedAt
      row.updatedAt = preparedAt
      return true
    },
    async consumeLoginToken({ id, tokenHash, consumedAt }) {
      const row = rows.find(item => item && item.id === id)
      if (!row || row.loginTokenHash !== tokenHash || row.loginTokenConsumedAt) return false
      row.loginTokenConsumedAt = consumedAt
      row.updatedAt = consumedAt
      return true
    },
    async list() {
      return clone(rows)
    },
  }
}

function createMongoHalfFlowTrafficRepository() {
  function collection() {
    const database = mongo.getMongoDb()
    if (!database) throw new HalfFlowTrafficError('database unavailable', 503, 503)
    return database.collection(COLLECTION_NAME)
  }

  return {
    findByHashes(mobileMd5, idCardMd5) {
      return collection().findOne({ mobileMd5, idCardMd5 })
    },
    findByEitherHash(mobileMd5, idCardMd5) {
      return collection().findOne({ $or: [{ mobileMd5 }, { idCardMd5 }] })
    },
    findByOrderId(orderId) {
      return collection().findOne({ orderId })
    },
    async save(row) {
      await collection().updateOne({ id: row.id }, { $set: row }, { upsert: true })
      return row
    },
    async claimCreditNotification({ id, orderStatus, claimId, claimedAt, staleBefore }) {
      const result = await collection().updateOne({
        id,
        $and: [
          {
            $or: [
              { lastNotifyStatus: { $ne: 'success' } },
              { lastNotifiedOrderStatus: { $ne: orderStatus } },
            ],
          },
          {
            $or: [
              { lastNotifyStatus: { $ne: 'pending' } },
              { lastNotifiedOrderStatus: { $ne: orderStatus } },
              { notifyClaimedAt: { $exists: false } },
              { notifyClaimedAt: '' },
              { notifyClaimedAt: { $lt: staleBefore } },
            ],
          },
        ],
      }, {
        $set: {
          lastNotifyStatus: 'pending',
          lastNotifiedOrderStatus: orderStatus,
          notifyClaimId: claimId,
          notifyClaimedAt: claimedAt,
          updatedAt: claimedAt,
        },
      })
      return result.modifiedCount === 1
    },
    async finalizeCreditNotification({ id, claimId, orderStatus, sent, log, completedAt }) {
      const result = await collection().updateOne({
        id,
        lastNotifyStatus: 'pending',
        notifyClaimId: claimId,
      }, {
        $push: {
          notifyLogs: {
            $each: [log],
            $slice: -20,
          },
        },
        $set: {
          lastNotifyStatus: sent ? 'success' : 'failed',
          lastNotifiedOrderStatus: orderStatus,
          lastNotifyAt: completedAt,
          notifyClaimId: '',
          notifyClaimedAt: '',
          updatedAt: completedAt,
        },
      })
      return result.modifiedCount === 1
    },
    async reserveMallUser({ id, pendingMallUserId, preparedAt }) {
      const result = await collection().updateOne({
        id,
        $and: [
          {
            $or: [
              { mallUserId: { $exists: false } },
              { mallUserId: null },
              { mallUserId: '' },
            ],
          },
          {
            $or: [
              { pendingMallUserId: { $exists: false } },
              { pendingMallUserId: null },
              { pendingMallUserId: '' },
            ],
          },
        ],
      }, {
        $set: {
          pendingMallUserId,
          pendingMallUserPreparedAt: preparedAt,
          updatedAt: preparedAt,
        },
      })
      return result.modifiedCount === 1
    },
    async consumeLoginToken({ id, tokenHash, consumedAt }) {
      const result = await collection().updateOne({
        id,
        loginTokenHash: tokenHash,
        $or: [
          { loginTokenConsumedAt: '' },
          { loginTokenConsumedAt: null },
          { loginTokenConsumedAt: { $exists: false } },
        ],
      }, {
        $set: { loginTokenConsumedAt: consumedAt, updatedAt: consumedAt },
      })
      return result.modifiedCount === 1
    },
  }
}

module.exports = {
  COLLECTION_NAME,
  createMemoryHalfFlowTrafficRepository,
  createMongoHalfFlowTrafficRepository,
}
