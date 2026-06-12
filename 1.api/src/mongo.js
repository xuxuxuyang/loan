const { MongoClient } = require('mongodb')
const mongoConfig = require('./mongoConfig')
const { getCurrentTenantId, getCurrentWorkspaceType, DEFAULT_TENANT_ID } = require('./tenantContext')

/** 集合名约定：后续仓储实现可直接引用 */
const COLLECTIONS = {
  products: 'products',
  orders: 'orders',
  users: 'users',
  adminAccounts: 'adminAccounts',
  addresses: 'addresses',
  bankCards: 'bankCards',
  bills: 'bills',
  trafficChannels: 'trafficChannels',
  trafficPartners: 'trafficPartners',
  partnerGatewayApplications: 'partnerGatewayApplications',
  csSessions: 'csSessions',
  lakalaPayments: 'lakalaPayments',
}

/** 旧版整库单文档（启动时若存在则迁移到分集合后删除） */
const APP_STATE = 'appState'
/** 分集合模式下的元数据（_meta + updatedAt），单文档 _id: main */
const APP_META = 'app_meta'

/** 与 store 一致：分集合持久化时的实体键顺序（供健康检查等使用） */
const SHARDED_ENTITY_KEYS = [
  'products',
  'orders',
  'users',
  'adminAccounts',
  'addresses',
  'bankCards',
  'bills',
  'trafficChannels',
  'trafficPartners',
  'partnerGatewayApplications',
  'csSessions',
  'lakalaPayments',
]

let client = null
let connectPromise = null
let lastConnectError = null

function registerShutdownOnce() {
  if (registerShutdownOnce.done) {
    return
  }
  registerShutdownOnce.done = true
  const onSignal = async () => {
    try {
      await closeMongo()
    }
    catch {
      // ignore
    }
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
}
registerShutdownOnce.done = false

/**
 * 建立 Mongo 连接；未配置 MONGODB_URI 时返回 null。
 * 可重复调用，共用同一 Client。
 */
async function connectMongo() {
  if (!mongoConfig.isMongoConfigured()) {
    lastConnectError = null
    return null
  }
  if (client) {
    return client
  }
  if (connectPromise) {
    return connectPromise
  }

  const { uri, maxPoolSize } = mongoConfig.getMongoConfig()
  const clientOptions = {}
  if (maxPoolSize) {
    clientOptions.maxPoolSize = maxPoolSize
  }
  connectPromise = new MongoClient(uri, clientOptions)
    .connect()
    .then((c) => {
      client = c
      connectPromise = null
      lastConnectError = null
      registerShutdownOnce()
      return c
    })
    .catch((err) => {
      connectPromise = null
      client = null
      lastConnectError = err instanceof Error ? err.message : String(err)
      throw err
    })

  return connectPromise
}

function getMongoClient() {
  return client
}

/** 未连接或未配置时返回 null */
function getMongoDb() {
  if (!client) {
    return null
  }
  const { dbName } = mongoConfig.getMongoConfig()
  const rootDb = dbName ? client.db(dbName) : client.db()
  const workspaceType = getCurrentWorkspaceType()
  if (workspaceType === 'core') {
    return client.db(`${rootDb.databaseName}__core`)
  }
  if (workspaceType === 'self') {
    return client.db(`${rootDb.databaseName}__self`)
  }
  const tenantId = getCurrentTenantId()
  if (!tenantId || tenantId === DEFAULT_TENANT_ID) {
    return rootDb
  }
  const scopedName = `${rootDb.databaseName}__tenant_${tenantId}`
  return client.db(scopedName)
}

async function closeMongo() {
  if (!client) {
    return
  }
  const c = client
  client = null
  await c.close()
}

/** 同步快照：是否已连上、最近一次失败原因（配置但未连上时） */
function getMongoHealthSummary() {
  const base = mongoConfig.getMongoConfigSummary()
  return {
    ...base,
    connected: Boolean(client),
    lastError: base.configured && !client ? lastConnectError : null,
  }
}

module.exports = {
  COLLECTIONS,
  APP_STATE,
  APP_META,
  SHARDED_ENTITY_KEYS,
  connectMongo,
  getMongoClient,
  getMongoDb,
  closeMongo,
  getMongoHealthSummary,
}
