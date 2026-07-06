const mongo = require('../mongo')

const COLLECTION_NAME = 'zheyinTrafficApplications'

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function createMemoryZheyinTrafficRepository(seed = []) {
  const rows = Array.isArray(seed) ? seed.map(clone) : []
  return {
    async findByAdmission(respSeq) {
      return clone(rows.find(row => row && row.admissionRespSeq === respSeq) || null)
    },
    async findByOrderId(orderId) {
      return clone(rows.find(row => row && row.orderId === orderId) || null)
    },
    async findByHashes(phoneMd5, idCardMd5) {
      return clone(rows.find(row => row && row.phoneMd5 === phoneMd5 && row.idCardMd5 === idCardMd5) || null)
    },
    async upsert(row) {
      const next = clone(row)
      const idx = rows.findIndex(item => item && item.id === next.id)
      if (idx >= 0) rows[idx] = { ...rows[idx], ...next }
      else rows.unshift(next)
      return clone(next)
    },
    async list() {
      return clone(rows)
    },
  }
}

function createMongoZheyinTrafficRepository() {
  async function collection() {
    const dbm = mongo.getMongoDb()
    if (!dbm) return null
    return dbm.collection(COLLECTION_NAME)
  }
  const memory = createMemoryZheyinTrafficRepository()
  return {
    async findByAdmission(respSeq) {
      const coll = await collection()
      if (!coll) return memory.findByAdmission(respSeq)
      return coll.findOne({ admissionRespSeq: respSeq })
    },
    async findByOrderId(orderId) {
      const coll = await collection()
      if (!coll) return memory.findByOrderId(orderId)
      return coll.findOne({ orderId })
    },
    async findByHashes(phoneMd5, idCardMd5) {
      const coll = await collection()
      if (!coll) return memory.findByHashes(phoneMd5, idCardMd5)
      return coll.findOne({ phoneMd5, idCardMd5 })
    },
    async upsert(row) {
      const coll = await collection()
      if (!coll) return memory.upsert(row)
      await coll.updateOne({ id: row.id }, { $set: row }, { upsert: true })
      return row
    },
  }
}

module.exports = {
  COLLECTION_NAME,
  createMemoryZheyinTrafficRepository,
  createMongoZheyinTrafficRepository,
}
