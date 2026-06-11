const assert = require('node:assert/strict')
const test = require('node:test')
const crypto = require('node:crypto')

const gateway = require('../src/duodiandianGateway')

const config = {
  partner: 'p-duodiandian',
  partnerCode: 'duodiandian',
  signKey: 'sign-secret',
  encKey: '1234567890abcdef',
  h5Origin: 'https://shop.example.com',
  channelCode: 'env-ddd',
  channelName: '哆点点',
  routePrefix: '/open/partners/env-ddd',
  gatewayRemark: '哆点点测试',
  portalUsername: 'env-ddd-portal',
  portalPassword: 'portal-secret',
  timestampSkewMs: 60_000,
}

function aesAlgorithm(key) {
  const len = Buffer.byteLength(key)
  if (len === 16) return 'aes-128-ecb'
  if (len === 24) return 'aes-192-ecb'
  if (len === 32) return 'aes-256-ecb'
  throw new Error('bad key')
}

function encryptBusinessData(payload, key = config.encKey) {
  const cipher = crypto.createCipheriv(aesAlgorithm(key), Buffer.from(key), null)
  cipher.setAutoPadding(true)
  return Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]).toString('hex').toUpperCase()
}

function signBusinessData(payload, timestamp, signKey = config.signKey) {
  const pairs = Object.keys(payload)
    .filter((key) => payload[key] !== undefined && payload[key] !== null && payload[key] !== '')
    .sort()
    .map((key) => `${key}=${payload[key]}`)
  const signStr = `${pairs.join('&')}${pairs.length ? '&' : ''}key=${signKey}&timestamp=${timestamp}`
  return crypto.createHash('md5').update(signStr, 'utf8').digest('hex')
}

function envelope(payload, overrides = {}) {
  const timestamp = overrides.timestamp || String(Date.now())
  return {
    partner: overrides.partner || config.partner,
    data: overrides.data || encryptBusinessData(payload, overrides.encKey || config.encKey),
    timestamp,
    sign: overrides.sign || signBusinessData(payload, timestamp, overrides.signKey || config.signKey),
  }
}

test('decrypts and verifies a valid duodiandian envelope', () => {
  const payload = { applyNo: 'A001', userPhone: '13800138000', h5Type: 'DETAIL' }
  const result = gateway.parseDuodiandianEnvelope(envelope(payload), config, { now: Date.now() })
  assert.deepEqual(result, payload)
})

test('rejects wrong partner, expired timestamps, bad signatures and bad AES payloads', () => {
  const payload = { applyNo: 'A001', userPhone: '13800138000' }
  assert.throws(() => gateway.parseDuodiandianEnvelope(envelope(payload, { partner: 'other' }), config), /partner/i)
  assert.throws(() => gateway.parseDuodiandianEnvelope(envelope(payload, { timestamp: String(Date.now() - 120_000) }), config, { now: Date.now() }), /timestamp/i)
  assert.throws(() => gateway.parseDuodiandianEnvelope(envelope(payload, { sign: 'bad' }), config), /sign/i)
  assert.throws(() => gateway.parseDuodiandianEnvelope(envelope(payload, { data: '001122' }), config), /decrypt|AES|data/i)
})

test('creates a duodiandian application without exposing or mutating other channels', () => {
  const db = {
    users: [{ id: 'U1', phone: '13800138000', registerChannelCode: 'other' }],
    trafficChannels: [{ code: 'other', name: 'Other', clickCount: 3 }],
    trafficPartners: [],
    partnerGatewayApplications: [],
  }
  const app = gateway.upsertDuodiandianApplication(db, {
    applyNo: 'A001',
    userPhone: '13900139000',
    name: 'Alice',
    idNo: '110101199001011234',
  }, config)
  assert.equal(app.partnerCode, 'duodiandian')
  assert.equal(app.channel, 'env-ddd')
  assert.equal(app.applyNo, 'A001')
  assert.equal(app.userPhone, '13900139000')
  assert.equal(db.users[0].registerChannelCode, 'other')
  assert.deepEqual(db.trafficChannels.map((ch) => ch.code).sort(), ['env-ddd', 'other'])
})

test('requires callback partnerOrderNo to belong to a duodiandian application', () => {
  const db = { partnerGatewayApplications: [] }
  gateway.upsertDuodiandianApplication(db, { applyNo: 'A001', userPhone: '13900139000' }, config)
  gateway.bindPartnerOrderNo(db, 'A001', 'P001', config)
  const updated = gateway.recordDuodiandianCallback(db, 'orderStatus', {
    applyNo: 'A001',
    partnerOrderNo: 'P001',
    status: 'AUDIT_PASS',
  }, config)
  assert.equal(updated.externalStatus, 'AUDIT_PASS')
  assert.throws(() => gateway.recordDuodiandianCallback(db, 'orderStatus', {
    applyNo: 'A001',
    partnerOrderNo: 'P999',
    status: 'AUDIT_PASS',
  }, config), /绑定|bound|partnerOrderNo/i)
})

test('builds only the duodiandian H5 link and never accepts caller supplied channel', () => {
  const db = { partnerGatewayApplications: [] }
  gateway.upsertDuodiandianApplication(db, { applyNo: 'A001', userPhone: '13900139000' }, config)
  const url = gateway.buildDuodiandianH5Url(db, { applyNo: 'A001', userPhone: '13900139000', channel: 'other' }, config)
  const parsed = new URL(url)
  assert.equal(parsed.origin, 'https://shop.example.com')
  assert.equal(parsed.searchParams.get('channel'), 'env-ddd')
  assert.equal(parsed.searchParams.get('applyNo'), 'A001')
  assert.equal(parsed.searchParams.get('partner'), 'duodiandian')
  assert.equal(parsed.searchParams.get('channel'), 'env-ddd')
})


test('uses env style config for channel seed and portal account', () => {
  const db = { trafficChannels: [], trafficPartners: [], partnerGatewayApplications: [] }
  const ch = gateway.ensureDuodiandianChannel(db, config)
  const partner = gateway.ensureDuodiandianPortalPartner(db, config)
  assert.equal(ch.code, 'env-ddd')
  assert.equal(ch.name, '哆点点')
  assert.equal(ch.remark, '哆点点测试')
  assert.equal(partner.username, 'env-ddd-portal')
  assert.equal(partner.password, 'portal-secret')
  assert.deepEqual(partner.channelCodes, ['env-ddd'])
})

test('registers routes under configured route prefix', () => {
  const paths = []
  const router = { post(path) { paths.push(path) } }
  gateway.registerDuodiandianGatewayRoutes(router, { readDb() { return {} }, writeDb() {}, configProvider: () => config })
  assert(paths.every(path => path.startsWith('/open/partners/env-ddd/')))
  assert(paths.includes('/open/partners/env-ddd/getUrl'))
  assert(paths.includes('/open/partners/env-ddd/order/replayPlan/notify'))
  assert(paths.includes('/open/partners/env-ddd/order/replay/notify'))
})

test('check prefix filters internal duplicate users without leaking matched phone md5', () => {
  const db = {
    users: [
      { id: 'U1', phone: '15257084456', registerChannelCode: 'natural' },
      { id: 'U2', phone: '13900139000', registerChannelCode: 'other' },
    ],
    orders: [],
    partnerGatewayApplications: [],
  }
  const result = gateway.buildDuodiandianCheckPrefixResult(db, { phone_pre: '15257084' }, config)
  assert.equal(result.check_ret, 'N')
  assert.deepEqual(result.phone_md5, [])
})

test('check prefix allows clean prefixes and still does not expose phone md5', () => {
  const db = {
    users: [{ id: 'U1', phone: '15257084456', registerChannelCode: 'natural' }],
    orders: [],
    partnerGatewayApplications: [],
  }
  const result = gateway.buildDuodiandianCheckPrefixResult(db, { phone_pre: '18800001' }, config)
  assert.equal(result.check_ret, 'Y')
  assert.deepEqual(result.phone_md5, [])
})

test('matches only the duodiandian public path for no-api middleware handling', () => {
  assert.equal(gateway.isDuodiandianPublicPath('/open/partners/env-ddd/getUrl', config), true)
  assert.equal(gateway.isDuodiandianPublicPath('/open/partners/env-ddd/order/status/notify', config), true)
  assert.equal(gateway.isDuodiandianPublicPath('/api/open/partners/env-ddd/getUrl', config), false)
  assert.equal(gateway.isDuodiandianPublicPath('/open/partners/other/getUrl', config), false)
  assert.equal(gateway.isDuodiandianPublicPath('/open/partners/env-ddd-other/getUrl', config), false)
})
