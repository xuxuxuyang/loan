const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const { normalizeMallContactBatch } = require('./policy')

const COLLECTIONS = {
  uploads: 'mallContactUploads',
  batches: 'mallContactUploadBatches',
}

const DEFAULT_JSON_FILE = path.join(__dirname, '..', '..', 'data', 'mallContacts.json')

function defaultIdGenerator() {
  return `MCU${Date.now()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`
}

function ensureJsonFile(file) {
  const dir = path.dirname(file)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({ uploads: [], batches: [] }, null, 2), 'utf8')
  }
}

function readJsonState(file) {
  ensureJsonFile(file)
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    return {
      uploads: Array.isArray(raw.uploads) ? raw.uploads : [],
      batches: Array.isArray(raw.batches) ? raw.batches : [],
    }
  }
  catch {
    return { uploads: [], batches: [] }
  }
}

function writeJsonState(file, state) {
  ensureJsonFile(file)
  fs.writeFileSync(file, JSON.stringify({
    uploads: Array.isArray(state.uploads) ? state.uploads : [],
    batches: Array.isArray(state.batches) ? state.batches : [],
  }, null, 2), 'utf8')
}

function cloneDoc(doc) {
  return JSON.parse(JSON.stringify(doc || {}))
}

function normalizeUploadInput(input, uploadId, nowIso) {
  const body = input && typeof input === 'object' ? input : {}
  return {
    uploadId,
    phone: String(body.phone || '').trim(),
    userId: String(body.userId || '').trim(),
    orderId: String(body.orderId || '').trim(),
    status: 'uploading',
    totalContacts: Math.max(0, Math.floor(Number(body.totalContacts || 0) || 0)),
    contactsCount: 0,
    batchCount: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    completedAt: '',
  }
}

function normalizeBatchInput(input, nowIso) {
  const body = input && typeof input === 'object' ? input : {}
  const uploadId = String(body.uploadId || '').trim()
  const batchIndex = Math.max(0, Math.floor(Number(body.batchIndex || 0) || 0))
  return {
    id: `${uploadId}:${batchIndex}`,
    uploadId,
    batchIndex,
    contacts: normalizeMallContactBatch(body.contacts),
    createdAt: nowIso,
    updatedAt: nowIso,
  }
}

function toPublicUpload(doc) {
  if (!doc) {
    return null
  }
  const { _id, ...rest } = doc
  return cloneDoc(rest.uploadId ? rest : { ...rest, uploadId: _id })
}

function sortCompletedUploads(a, b) {
  return String(b.completedAt || '').localeCompare(String(a.completedAt || ''))
}

function hasPositiveContactsCount(upload) {
  return Math.max(0, Math.floor(Number(upload && upload.contactsCount || 0) || 0)) > 0
}

function normalizeContactsPage(input = {}) {
  const page = Math.max(1, Math.floor(Number(input.page || 1) || 1))
  const pageSize = Math.min(50, Math.max(1, Math.floor(Number(input.pageSize || 20) || 20)))
  return { page, pageSize }
}

function normalizeUploadHistoryPage(input = {}) {
  const page = Math.max(1, Math.floor(Number(input.page || 1) || 1))
  const pageSize = Math.min(20, Math.max(1, Math.floor(Number(input.pageSize || 10) || 10)))
  const contactsPreviewSize = Math.min(50, Math.max(1, Math.floor(Number(input.contactsPreviewSize || 20) || 20)))
  return { page, pageSize, contactsPreviewSize }
}

function summarizeUpload(upload) {
  const item = upload && typeof upload === 'object' ? upload : null
  if (!item) {
    return null
  }
  return {
    uploadId: String(item.uploadId || item._id || '').trim(),
    orderId: String(item.orderId || '').trim(),
    uploadedAt: String(item.completedAt || item.uploadedAt || '').trim(),
    contactsCount: Math.max(0, Math.floor(Number(item.contactsCount || 0) || 0)),
  }
}

function flattenBatchContacts(batches) {
  const out = []
  for (const batch of Array.isArray(batches) ? batches : []) {
    const contacts = Array.isArray(batch && batch.contacts) ? batch.contacts : []
    for (const contact of contacts) {
      out.push(cloneDoc(contact))
    }
  }
  return out
}

function createMallContactsStore(options = {}) {
  const mongo = options.mongo || require('../mongo')
  const jsonFile = options.jsonFile || DEFAULT_JSON_FILE
  const idGenerator = typeof options.idGenerator === 'function' ? options.idGenerator : defaultIdGenerator

  function getMongoDb() {
    return mongo && typeof mongo.getMongoDb === 'function' ? mongo.getMongoDb() : null
  }

  async function startUpload(input = {}) {
    const uploadId = String(input.uploadId || idGenerator()).trim()
    const nowIso = String(input.nowIso || new Date().toISOString())
    const upload = normalizeUploadInput(input, uploadId, nowIso)
    const dbm = getMongoDb()
    if (dbm) {
      await dbm.collection(COLLECTIONS.uploads).replaceOne(
        { _id: uploadId },
        { ...cloneDoc(upload), _id: uploadId },
        { upsert: true },
      )
      return cloneDoc(upload)
    }

    const state = readJsonState(jsonFile)
    const idx = state.uploads.findIndex(item => String(item.uploadId || '') === uploadId)
    if (idx >= 0) {
      state.uploads[idx] = upload
    }
    else {
      state.uploads.push(upload)
    }
    writeJsonState(jsonFile, state)
    return cloneDoc(upload)
  }

  async function saveBatch(input = {}) {
    const nowIso = String(input.nowIso || new Date().toISOString())
    const batch = normalizeBatchInput(input, nowIso)
    if (!batch.uploadId) {
      throw new Error('uploadId_required')
    }
    const dbm = getMongoDb()
    if (dbm) {
      await dbm.collection(COLLECTIONS.batches).replaceOne(
        { _id: batch.id },
        { ...cloneDoc(batch), _id: batch.id },
        { upsert: true },
      )
      await dbm.collection(COLLECTIONS.uploads).updateOne(
        { _id: batch.uploadId },
        { $set: { updatedAt: nowIso } },
      )
      return cloneDoc(batch)
    }

    const state = readJsonState(jsonFile)
    const idx = state.batches.findIndex(item => String(item.id || '') === batch.id)
    if (idx >= 0) {
      state.batches[idx] = batch
    }
    else {
      state.batches.push(batch)
    }
    const upload = state.uploads.find(item => String(item.uploadId || '') === batch.uploadId)
    if (upload) {
      upload.updatedAt = nowIso
    }
    writeJsonState(jsonFile, state)
    return cloneDoc(batch)
  }

  async function completeUpload(input = {}) {
    const uploadId = String(input.uploadId || '').trim()
    if (!uploadId) {
      throw new Error('uploadId_required')
    }
    const nowIso = String(input.nowIso || new Date().toISOString())
    const expectedBatchCount = Number(input.expectedBatchCount)
    const dbm = getMongoDb()
    if (dbm) {
      const uploadDoc = await dbm.collection(COLLECTIONS.uploads).findOne({ _id: uploadId })
      if (!uploadDoc) {
        throw new Error('upload_not_found')
      }
      const batchDocs = await dbm.collection(COLLECTIONS.batches)
        .find({ uploadId })
        .sort({ batchIndex: 1 })
        .toArray()
      if (Number.isFinite(expectedBatchCount) && expectedBatchCount > 0 && batchDocs.length !== expectedBatchCount) {
        throw new Error('contact_batches_incomplete')
      }
      const contactsCount = batchDocs.reduce((sum, item) => sum + (Array.isArray(item.contacts) ? item.contacts.length : 0), 0)
      if (contactsCount <= 0) {
        throw new Error('contact_upload_empty')
      }
      const next = {
        ...toPublicUpload(uploadDoc),
        status: 'completed',
        contactsCount,
        batchCount: batchDocs.length,
        updatedAt: nowIso,
        completedAt: nowIso,
      }
      await dbm.collection(COLLECTIONS.uploads).replaceOne(
        { _id: uploadId },
        { ...cloneDoc(next), _id: uploadId },
        { upsert: true },
      )
      return cloneDoc(next)
    }

    const state = readJsonState(jsonFile)
    const upload = state.uploads.find(item => String(item.uploadId || '') === uploadId)
    if (!upload) {
      throw new Error('upload_not_found')
    }
    const batches = state.batches
      .filter(item => String(item.uploadId || '') === uploadId)
      .sort((a, b) => Number(a.batchIndex || 0) - Number(b.batchIndex || 0))
    if (Number.isFinite(expectedBatchCount) && expectedBatchCount > 0 && batches.length !== expectedBatchCount) {
      throw new Error('contact_batches_incomplete')
    }
    const contactsCount = batches.reduce((sum, item) => sum + (Array.isArray(item.contacts) ? item.contacts.length : 0), 0)
    if (contactsCount <= 0) {
      throw new Error('contact_upload_empty')
    }
    upload.status = 'completed'
    upload.contactsCount = contactsCount
    upload.batchCount = batches.length
    upload.updatedAt = nowIso
    upload.completedAt = nowIso
    writeJsonState(jsonFile, state)
    return cloneDoc(upload)
  }

  async function getLatestCompletedSummary(input = {}) {
    const phone = String(input.phone || '').trim()
    const orderId = String(input.orderId || '').trim()
    const dbm = getMongoDb()
    if (dbm) {
      const query = { status: 'completed', contactsCount: { $gt: 0 } }
      if (phone) query.phone = phone
      if (orderId) query.orderId = orderId
      const doc = await dbm.collection(COLLECTIONS.uploads)
        .find(query)
        .sort({ completedAt: -1 })
        .limit(1)
        .next()
      return toPublicUpload(doc)
    }

    const state = readJsonState(jsonFile)
    return cloneDoc(
      state.uploads
        .filter(item => String(item.status || '') === 'completed')
        .filter(hasPositiveContactsCount)
        .filter(item => !phone || String(item.phone || '') === phone)
        .filter(item => !orderId || String(item.orderId || '') === orderId)
        .sort(sortCompletedUploads)[0] || null,
    )
  }

  async function getUpload(uploadId) {
    const id = String(uploadId || '').trim()
    if (!id) {
      return null
    }
    const dbm = getMongoDb()
    if (dbm) {
      return toPublicUpload(await dbm.collection(COLLECTIONS.uploads).findOne({ _id: id }))
    }
    const state = readJsonState(jsonFile)
    return cloneDoc(state.uploads.find(item => String(item.uploadId || '') === id) || null)
  }

  async function listLatestCompletedContacts(input = {}) {
    const phone = String(input.phone || '').trim()
    const { page, pageSize } = normalizeContactsPage(input)
    const empty = { upload: null, list: [], total: 0, page, pageSize }
    if (!phone) {
      return empty
    }
    const dbm = getMongoDb()
    if (dbm) {
      const uploadDoc = await dbm.collection(COLLECTIONS.uploads)
        .find({ phone, status: 'completed', contactsCount: { $gt: 0 } })
        .sort({ completedAt: -1 })
        .limit(1)
        .next()
      const upload = toPublicUpload(uploadDoc)
      if (!upload) {
        return empty
      }
      const uploadId = String(upload.uploadId || '').trim()
      const contacts = await dbm.collection(COLLECTIONS.batches)
        .aggregate([
          { $match: { uploadId } },
          { $sort: { batchIndex: 1 } },
          { $unwind: '$contacts' },
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
          { $replaceRoot: { newRoot: '$contacts' } },
        ])
        .toArray()
      const total = Math.max(0, Math.floor(Number(upload.contactsCount || 0) || 0))
      return {
        upload: summarizeUpload(upload),
        list: contacts.map(cloneDoc),
        total,
        page,
        pageSize,
      }
    }

    const state = readJsonState(jsonFile)
    const upload = state.uploads
      .filter(item => String(item.status || '') === 'completed')
      .filter(hasPositiveContactsCount)
      .filter(item => String(item.phone || '') === phone)
      .sort(sortCompletedUploads)[0] || null
    if (!upload) {
      return empty
    }
    const uploadId = String(upload.uploadId || '').trim()
    const batches = state.batches
      .filter(item => String(item.uploadId || '') === uploadId)
      .sort((a, b) => Number(a.batchIndex || 0) - Number(b.batchIndex || 0))
    const contacts = flattenBatchContacts(batches)
    const total = contacts.length
    return {
      upload: summarizeUpload(upload),
      list: contacts.slice((page - 1) * pageSize, page * pageSize),
      total,
      page,
      pageSize,
    }
  }

  async function listCompletedUploadContacts(input = {}) {
    const phone = String(input.phone || '').trim()
    const uploadId = String(input.uploadId || '').trim()
    const { page, pageSize } = normalizeContactsPage(input)
    const empty = { upload: null, list: [], total: 0, page, pageSize }
    if (!phone || !uploadId) {
      return empty
    }
    const dbm = getMongoDb()
    if (dbm) {
      const uploadDoc = await dbm.collection(COLLECTIONS.uploads).findOne({
        _id: uploadId,
        phone,
        status: 'completed',
        contactsCount: { $gt: 0 },
      })
      const upload = toPublicUpload(uploadDoc)
      if (!upload) {
        return empty
      }
      const contacts = await dbm.collection(COLLECTIONS.batches)
        .aggregate([
          { $match: { uploadId } },
          { $sort: { batchIndex: 1 } },
          { $unwind: '$contacts' },
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
          { $replaceRoot: { newRoot: '$contacts' } },
        ])
        .toArray()
      return {
        upload: summarizeUpload(upload),
        list: contacts.map(cloneDoc),
        total: Math.max(0, Math.floor(Number(upload.contactsCount || 0) || 0)),
        page,
        pageSize,
      }
    }

    const state = readJsonState(jsonFile)
    const upload = state.uploads
      .filter(item => String(item.status || '') === 'completed')
      .filter(hasPositiveContactsCount)
      .find(item => String(item.uploadId || '') === uploadId && String(item.phone || '') === phone) || null
    if (!upload) {
      return empty
    }
    const batches = state.batches
      .filter(item => String(item.uploadId || '') === uploadId)
      .sort((a, b) => Number(a.batchIndex || 0) - Number(b.batchIndex || 0))
    const contacts = flattenBatchContacts(batches)
    return {
      upload: summarizeUpload(upload),
      list: contacts.slice((page - 1) * pageSize, page * pageSize),
      total: contacts.length,
      page,
      pageSize,
    }
  }

  async function listCompletedContactUploads(input = {}) {
    const phone = String(input.phone || '').trim()
    const { page, pageSize, contactsPreviewSize } = normalizeUploadHistoryPage(input)
    const empty = { records: [], total: 0, page, pageSize, contactsPreviewSize }
    if (!phone) {
      return empty
    }
    const dbm = getMongoDb()
    if (dbm) {
      const query = { phone, status: 'completed', contactsCount: { $gt: 0 } }
      const total = await dbm.collection(COLLECTIONS.uploads).countDocuments(query)
      const uploads = await dbm.collection(COLLECTIONS.uploads)
        .find(query)
        .sort({ completedAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray()
      const records = []
      for (const item of uploads) {
        const upload = toPublicUpload(item)
        const uploadId = String(upload && upload.uploadId || '').trim()
        const contacts = uploadId
          ? await dbm.collection(COLLECTIONS.batches)
              .aggregate([
                { $match: { uploadId } },
                { $sort: { batchIndex: 1 } },
                { $unwind: '$contacts' },
                { $limit: contactsPreviewSize },
                { $replaceRoot: { newRoot: '$contacts' } },
              ])
              .toArray()
          : []
        records.push({
          upload: summarizeUpload(upload),
          list: contacts.map(cloneDoc),
          total: Math.max(0, Math.floor(Number(upload && upload.contactsCount || 0) || 0)),
          page: 1,
          pageSize: contactsPreviewSize,
        })
      }
      return { records, total, page, pageSize, contactsPreviewSize }
    }

    const state = readJsonState(jsonFile)
    const uploads = state.uploads
      .filter(item => String(item.status || '') === 'completed')
      .filter(hasPositiveContactsCount)
      .filter(item => String(item.phone || '') === phone)
      .sort(sortCompletedUploads)
    const records = uploads.slice((page - 1) * pageSize, page * pageSize).map((upload) => {
      const uploadId = String(upload.uploadId || '').trim()
      const batches = state.batches
        .filter(item => String(item.uploadId || '') === uploadId)
        .sort((a, b) => Number(a.batchIndex || 0) - Number(b.batchIndex || 0))
      const contacts = flattenBatchContacts(batches)
      return {
        upload: summarizeUpload(upload),
        list: contacts.slice(0, contactsPreviewSize),
        total: contacts.length,
        page: 1,
        pageSize: contactsPreviewSize,
      }
    })
    return { records, total: uploads.length, page, pageSize, contactsPreviewSize }
  }

  return {
    startUpload,
    saveBatch,
    completeUpload,
    getLatestCompletedSummary,
    getUpload,
    listLatestCompletedContacts,
    listCompletedUploadContacts,
    listCompletedContactUploads,
  }
}

module.exports = {
  COLLECTIONS,
  createMallContactsStore,
}
