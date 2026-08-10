const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const Koa = require('koa')
const Router = require('@koa/router')
const bodyParser = require('koa-bodyparser')

const modulePath = path.join(__dirname, '..', 'src', 'ios', 'index.js')

function success(data) {
  return { success: true, code: 0, msg: 'ok', data }
}

function listen(app) {
  const server = http.createServer(app.callback())
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

async function request(server, method, requestPath, body, tokenPhone = '') {
  const address = server.address()
  const headers = { 'Content-Type': 'application/json' }
  if (tokenPhone) headers.Authorization = `Bearer mock-token-${tokenPhone}`
  const response = await fetch(`http://127.0.0.1:${address.port}${requestPath}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let responseBody = text
  try {
    responseBody = JSON.parse(text)
  }
  catch {
    // Keep non-JSON framework responses visible in assertion output.
  }
  return { status: response.status, body: responseBody }
}

function createRouteFixture() {
  const db = { users: [], orders: [], addresses: [], bankCards: [], products: [], lakalaPayments: [], csSessions: [] }
  let writes = 0
  let createdPayload = null
  const uploadedIdCards = []
  const riskWaves = new Map()
  let riskSequence = 0
  let orderWrites = 0
  let contactSequence = 0
  let accountDeletionWrites = 0
  const deletedContactAccounts = []
  const deletedImages = []
  const contactUploads = new Map()
  const contactsStore = {
    async startUpload(input) {
      const upload = { ...input, uploadId: `fixture-contact-${++contactSequence}`, status: 'uploading', batches: [] }
      contactUploads.set(upload.uploadId, upload)
      return upload
    },
    async getUpload(uploadId) {
      return contactUploads.get(uploadId) || null
    },
    async saveBatch({ uploadId, batchIndex, contacts }) {
      const upload = contactUploads.get(uploadId)
      if (!upload) throw new Error('upload_not_found')
      const seen = new Set()
      const normalized = []
      for (const contact of Array.isArray(contacts) ? contacts : []) {
        const phones = Array.isArray(contact && contact.phones) ? contact.phones : []
        const validPhones = phones.map(value => String(value || '').replace(/\D/g, '')).filter(value => /^1\d{10}$/.test(value))
        const phone = validPhones.find(value => !seen.has(value))
        if (!phone) continue
        seen.add(phone)
        normalized.push({ displayName: String(contact.displayName || ''), phones: [phone] })
      }
      const batch = { batchIndex, contacts: normalized }
      upload.batches[batchIndex] = batch
      return batch
    },
    async completeUpload({ uploadId }) {
      const upload = contactUploads.get(uploadId)
      const contactsCount = upload ? upload.batches.flatMap(item => item ? item.contacts : []).length : 0
      if (!contactsCount) throw new Error('contact_upload_empty')
      return { ...upload, status: 'completed', contactsCount, completedAt: new Date().toISOString() }
    },
  }
  const deps = {
    readDb: () => db,
    success,
    fail() {},
    normalizePhone: value => String(value || '').replace(/\D/g, ''),
    resolveUser(ctx, currentDb) {
      const raw = String(ctx.headers.authorization || '').replace(/^Bearer mock-token-/i, '')
      return currentDb.users.find(item => item.phone === raw) || null
    },
    async sendRegisterSms() {},
    verifyRegisterSms: (_phone, code) => ({ ok: code === '123456', reason: '验证码无效' }),
    resolveRegisterChannel: () => ({ channel: null }),
    createUser(currentDb, payload) {
      createdPayload = { ...payload }
      const user = {
        id: `U${currentDb.users.length + 1}`,
        name: payload.name,
        phone: payload.phone,
        idCardFront: payload.idCardFront || '',
        idCardBack: payload.idCardBack || '',
        idCardHandheld: payload.idCardHandheld || '',
        emergencyContacts: payload.emergencyContacts || [],
        passwordHash: `hash:${payload.password}`,
        adminPasswordPlain: payload.password,
      }
      currentDb.users.push(user)
      return user
    },
    writeUsers: () => { writes += 1 },
    idCardUploadMiddleware: async (ctx, next) => {
      if (ctx.request.body && ctx.request.body.image) {
        ctx.file = {
          buffer: Buffer.from(String(ctx.request.body.image)),
          mimetype: 'image/jpeg',
          originalname: 'identity.jpg',
        }
      }
      await next()
    },
    async uploadIdCard(payload) {
      uploadedIdCards.push(payload)
      return { url: `https://img.example/${payload.scene}.jpg` }
    },
    validateIdCardImages: () => ({ ok: true }),
    getRiskStepKeys: () => ['identity', 'credit'],
    createRiskWave(identity) {
      const waveId = `fixture-wave-${++riskSequence}`
      riskWaves.set(waveId, { identity, steps: {} })
      return { waveId, stepKeys: ['identity', 'credit'], expiresAt: Date.now() + 60_000 }
    },
    runRiskStep: async ({ stepKey }) => stepKey === 'credit_fail'
      ? { ok: false, reason: 'credit rejected' }
      : { ok: true },
    recordRiskStep(waveId, stepKey, result) {
      const wave = riskWaves.get(waveId)
      if (!wave) throw new Error('wave missing')
      wave.steps[stepKey] = result
      return wave
    },
    consumeRiskWave(waveId, identity) {
      const wave = riskWaves.get(waveId)
      if (!wave) return { ok: false, steps: [], reason: 'wave missing' }
      const sameIdentity = JSON.stringify(wave.identity) === JSON.stringify(identity)
      const allPassed = ['identity', 'credit'].every(key => wave.steps[key] && wave.steps[key].ok)
      if (!sameIdentity || !allPassed) return { ok: false, steps: [], reason: 'risk not passed' }
      riskWaves.delete(waveId)
      return { ok: true, steps: Object.entries(wave.steps).map(([key, value]) => ({ key, ...value })) }
    },
    normalizeProduct: product => ({ ...product }),
    normalizeQuota: value => Number(value || 0),
    isOrderSettled: () => true,
    buildInstallmentPlan: totalAmount => [{ period: 1, amount: totalAmount, paid: false }],
    writeOrders: () => { orderWrites += 1 },
    flushPersist: async () => {},
    contactsStore,
    applyContactsSummary(order, user, summary) {
      order.iosContactsUploadCompleted = true
      order.iosContactsCount = summary.contactsCount
      user.iosContactsUploadCompleted = true
    },
    writeUsersAndOrders: () => { orderWrites += 1 },
    verifyPassword: (plain, hash) => hash === `hash:${plain}`,
    async deleteContactsByAccount(identity) {
      deletedContactAccounts.push({ ...identity })
    },
    async deleteIdCardImage(url, phone) {
      deletedImages.push({ url, phone })
    },
    writeAccountDeletion: () => { accountDeletionWrites += 1 },
  }
  const router = new Router()
  const { registerIosAppRoutes } = require(modulePath)
  registerIosAppRoutes(router, deps)
  const app = new Koa()
  app.use(bodyParser())
  app.use(router.routes())
  app.use(router.allowedMethods())
  return {
    app,
    db,
    deps,
    getCreatedPayload: () => createdPayload,
    getWrites: () => writes,
    getUploadedIdCards: () => uploadedIdCards,
    getOrderWrites: () => orderWrites,
    getAccountDeletionWrites: () => accountDeletionWrites,
    getDeletedContactAccounts: () => deletedContactAccounts,
    getDeletedImages: () => deletedImages,
  }
}

test('iOS routes live in an independent dependency-injected module', () => {
  assert.equal(fs.existsSync(modulePath), true, 'src/ios/index.js must exist')
  const { registerIosAppRoutes } = require(modulePath)

  assert.equal(typeof registerIosAppRoutes, 'function')
  assert.throws(
    () => registerIosAppRoutes({ get() {}, post() {}, put() {} }, {}),
    /missing dependency: readDb/,
  )
})

test('iOS profile helpers validate a complete payload and expose only masked data', () => {
  const maskingPath = path.join(__dirname, '..', 'src', 'ios', 'masking.js')
  const validationPath = path.join(__dirname, '..', 'src', 'ios', 'validation.js')
  assert.equal(fs.existsSync(maskingPath), true, 'src/ios/masking.js must exist')
  assert.equal(fs.existsSync(validationPath), true, 'src/ios/validation.js must exist')

  const { buildProfileStatus } = require(maskingPath)
  const { validateInstallmentProfile } = require(validationPath)
  const payload = {
    name: '张三',
    idNumber: '11010119900101123x',
    idCardFront: 'https://img.example/front.jpg',
    idCardBack: 'https://img.example/back.jpg',
    idCardHandheld: 'https://img.example/handheld.jpg',
    emergencyContacts: [
      { name: '李四', phone: '13800138001' },
      { name: '王五', phone: '13900138002' },
    ],
  }

  const validated = validateInstallmentProfile(payload, '13800138000')
  assert.equal(validated.ok, true)
  assert.equal(validated.value.idNumber, '11010119900101123X')

  const status = buildProfileStatus(validated.value)
  assert.deepEqual(status, {
    complete: true,
    canReuse: true,
    nameMasked: '张*',
    idNumberMasked: '110***********123X',
    hasIdCardFront: true,
    hasIdCardBack: true,
    hasIdCardHandheld: true,
    emergencyContactsMasked: [
      { nameMasked: '李*', phoneMasked: '138****8001' },
      { nameMasked: '王*', phoneMasked: '139****8002' },
    ],
  })
  assert.equal(JSON.stringify(status).includes('front.jpg'), false)
  assert.equal(JSON.stringify(status).includes('13800138001'), false)
})

test('iOS profile validation rejects incomplete or unsafe contact data', () => {
  const validationPath = path.join(__dirname, '..', 'src', 'ios', 'validation.js')
  assert.equal(fs.existsSync(validationPath), true, 'src/ios/validation.js must exist')
  const { validateInstallmentProfile } = require(validationPath)
  const base = {
    name: '张三',
    idNumber: '11010119900101123X',
    idCardFront: 'front',
    idCardBack: 'back',
    idCardHandheld: 'handheld',
    emergencyContacts: [
      { name: '李四', phone: '13800138001' },
      { name: '王五', phone: '13900138002' },
    ],
  }

  assert.equal(validateInstallmentProfile({ ...base, idCardBack: '' }, '13800138000').ok, false)
  assert.equal(validateInstallmentProfile({
    ...base,
    emergencyContacts: [base.emergencyContacts[0], { name: '王五', phone: '13800138001' }],
  }, '13800138000').ok, false)
  assert.equal(validateInstallmentProfile({
    ...base,
    emergencyContacts: [{ name: '本人', phone: '13800138000' }, base.emergencyContacts[1]],
  }, '13800138000').ok, false)
})

test('iOS identity image references must belong to the current user and declared scenes', () => {
  const storagePath = path.join(__dirname, '..', 'src', 'ios', 'idCardStorage.js')
  assert.equal(fs.existsSync(storagePath), true, 'src/ios/idCardStorage.js must exist')
  const {
    IOS_ID_CARD_CACHE_CONTROL,
    uploadIosIdCardImage,
    validateIosIdCardImageSet,
  } = require(storagePath)
  const config = {
    bucket: 'private-bucket',
    endpoint: 'https://oss-cn-test.aliyuncs.com',
    envTag: 'production',
    publicBaseUrl: 'https://private.example.com',
    region: 'cn-test',
    uploadPrefix: 'mall/id-cards',
  }
  const phone = '13800138000'
  const base = `https://private.example.com/mall/id-cards/production/id-cards/2026/08/10/${phone}`
  const images = {
    idCardFront: `${base}/front_100_abcdef.jpg`,
    idCardBack: `${base}/back_101_abcdef.jpg`,
    idCardHandheld: `${base}/handheld_102_abcdef.jpg`,
  }

  assert.equal(validateIosIdCardImageSet(images, phone, config).ok, true)
  assert.equal(validateIosIdCardImageSet({ ...images, idCardFront: images.idCardBack }, phone, config).ok, false)
  assert.equal(validateIosIdCardImageSet({
    ...images,
    idCardFront: images.idCardFront.replace(phone, '13900139000'),
  }, phone, config).ok, false)
  assert.equal(validateIosIdCardImageSet({ ...images, idCardHandheld: images.idCardFront }, phone, config).ok, false)
  assert.equal(validateIosIdCardImageSet({
    ...images,
    idCardFront: images.idCardFront.replace('private.example.com', 'evil.example.com'),
  }, phone, config).ok, false)
  assert.equal(IOS_ID_CARD_CACHE_CONTROL, 'private, no-store')
  assert.match(uploadIosIdCardImage.toString(), /cacheControl:\s*IOS_ID_CARD_CACHE_CONTROL/)
})

test('iOS registration accepts only phone, SMS code, password, and channel', async (t) => {
  const fixture = createRouteFixture()
  const server = await listen(fixture.app)
  t.after(() => server.close())

  const result = await request(server, 'POST', '/ios/auth/register', {
    phone: '13800138000',
    smsCode: '123456',
    password: 'secret12',
    channel: 'appstore',
    name: '不应写入',
    idNumber: '11010119900101123X',
    idCardFront: 'front',
    emergencyContacts: [{ name: '李四', phone: '13800138001' }],
  })

  assert.equal(result.status, 200)
  assert.equal(result.body.success, true)
  assert.equal(fixture.getWrites(), 1)
  assert.deepEqual(fixture.getCreatedPayload(), {
    phone: '13800138000',
    smsCode: '123456',
    password: 'secret12',
    channel: 'appstore',
    name: '商城用户',
    idCardFront: '',
    idCardBack: '',
    idCardHandheld: '',
    emergencyContacts: [],
  })
  assert.equal(result.body.data.passwordHash, undefined)
  assert.equal(fixture.db.users[0].adminPasswordPlain, undefined)
})

test('iOS registration rejects passwords with leading or trailing spaces', async (t) => {
  const fixture = createRouteFixture()
  const server = await listen(fixture.app)
  t.after(() => server.close())

  const result = await request(server, 'POST', '/ios/auth/register', {
    phone: '13800138000',
    smsCode: '123456',
    password: ' secret12 ',
  })

  assert.equal(result.status, 400)
  assert.equal(result.body.code, 'INVALID_PASSWORD')
  assert.equal(fixture.db.users.length, 0)
})

test('iOS registration rejects invalid SMS without creating a user', async (t) => {
  const fixture = createRouteFixture()
  const server = await listen(fixture.app)
  t.after(() => server.close())

  const result = await request(server, 'POST', '/ios/auth/register', {
    phone: '13800138000',
    smsCode: '000000',
    password: 'secret12',
  })

  assert.equal(result.status, 400)
  assert.equal(result.body.code, 'INVALID_SMS_CODE')
  assert.equal(fixture.db.users.length, 0)
  assert.equal(fixture.getWrites(), 0)
})

test('iOS profile update is atomic and returns only a masked summary', async (t) => {
  const fixture = createRouteFixture()
  fixture.db.users.push({
    id: 'U-existing',
    name: '商城用户',
    phone: '13800138000',
    idCardFront: '',
    idCardBack: '',
    idCardHandheld: '',
    emergencyContacts: [],
  })
  const server = await listen(fixture.app)
  t.after(() => server.close())

  const invalid = await request(server, 'PUT', '/ios/installment/profile', {
    name: '张三',
    idNumber: '11010119900101123X',
    idCardFront: 'front',
    idCardBack: '',
    idCardHandheld: 'handheld',
    emergencyContacts: [
      { name: '李四', phone: '13800138001' },
      { name: '王五', phone: '13900138002' },
    ],
  }, '13800138000')
  assert.equal(invalid.status, 400)
  assert.equal(fixture.db.users[0].name, '商城用户')
  assert.equal(fixture.getWrites(), 0)

  const valid = await request(server, 'PUT', '/ios/installment/profile', {
    name: '张三',
    idNumber: '11010119900101123X',
    idCardFront: 'front',
    idCardBack: 'back',
    idCardHandheld: 'handheld',
    emergencyContacts: [
      { name: '李四', phone: '13800138001' },
      { name: '王五', phone: '13900138002' },
    ],
  }, '13800138000')
  assert.equal(valid.status, 200)
  assert.equal(valid.body.data.complete, true)
  assert.equal(valid.body.data.idNumberMasked, '110***********123X')
  assert.equal(JSON.stringify(valid.body).includes('11010119900101123X'), false)
  assert.equal(fixture.getWrites(), 1)

  const readResult = await request(server, 'GET', '/ios/installment/profile', undefined, '13800138000')
  assert.equal(readResult.body.data.emergencyContactsMasked[0].phoneMasked, '138****8001')
  assert.equal(JSON.stringify(readResult.body).includes('13800138001'), false)
})

test('iOS profile update rejects unowned identity image references without modifying the user', async (t) => {
  const { validateIosIdCardImageSet } = require('../src/ios/idCardStorage')
  const fixture = createRouteFixture()
  const config = {
    bucket: 'private-bucket',
    endpoint: 'https://oss-cn-test.aliyuncs.com',
    envTag: 'production',
    publicBaseUrl: 'https://private.example.com',
    region: 'cn-test',
    uploadPrefix: 'mall/id-cards',
  }
  fixture.deps.validateIdCardImages = (images, phone) => validateIosIdCardImageSet(images, phone, config)
  fixture.db.users.push({
    id: 'U-profile-owner',
    name: '商城用户',
    phone: '13800138000',
    idCardFront: '',
    idCardBack: '',
    idCardHandheld: '',
    emergencyContacts: [],
  })
  const server = await listen(fixture.app)
  t.after(() => server.close())
  const ownerBase = 'https://private.example.com/mall/id-cards/production/id-cards/2026/08/10/13800138000'
  const result = await request(server, 'PUT', '/ios/installment/profile', {
    name: '张三',
    idNumber: '11010119900101123X',
    idCardFront: ownerBase.replace('13800138000', '13900139000') + '/front_100_abcdef.jpg',
    idCardBack: `${ownerBase}/back_101_abcdef.jpg`,
    idCardHandheld: `${ownerBase}/handheld_102_abcdef.jpg`,
    emergencyContacts: [
      { name: '李四', phone: '13800138001' },
      { name: '王五', phone: '13900138002' },
    ],
  }, '13800138000')

  assert.equal(result.status, 400)
  assert.equal(result.body.code, 'INVALID_ID_CARD_IMAGE_REFERENCE')
  assert.equal(fixture.db.users[0].name, '商城用户')
  assert.equal(fixture.getWrites(), 0)
})

test('iOS identity upload requires the current user and accepts only a declared scene', async (t) => {
  const fixture = createRouteFixture()
  fixture.db.users.push({ id: 'U-upload', phone: '13800138000', name: '商城用户' })
  const server = await listen(fixture.app)
  t.after(() => server.close())

  const unauthorized = await request(server, 'POST', '/ios/uploads/id-card', {
    image: 'private-image',
    scene: 'front',
  })
  assert.equal(unauthorized.status, 401)
  assert.equal(fixture.getUploadedIdCards().length, 0)

  const invalidScene = await request(server, 'POST', '/ios/uploads/id-card', {
    image: 'private-image',
    scene: 'avatar',
  }, '13800138000')
  assert.equal(invalidScene.status, 400)
  assert.equal(fixture.getUploadedIdCards().length, 0)

  const uploaded = await request(server, 'POST', '/ios/uploads/id-card', {
    image: 'private-image',
    scene: 'handheld',
    phone: '13900139000',
  }, '13800138000')
  assert.equal(uploaded.status, 200)
  assert.equal(uploaded.body.data.url, 'https://img.example/handheld.jpg')
  assert.equal(fixture.getUploadedIdCards()[0].phone, '13800138000')
})

test('iOS risk waves are owned by the current user and failed risk never creates an order', async (t) => {
  const fixture = createRouteFixture()
  fixture.db.users.push({
    id: 'U-risk-owner',
    phone: '13800138000',
    name: '张三',
    idNumber: '11010119900101123X',
    idCardFront: 'front',
    idCardBack: 'back',
    idCardHandheld: 'handheld',
    emergencyContacts: [{ name: '李四', phone: '13800138001' }, { name: '王五', phone: '13900138002' }],
    quota: 5000,
  })
  fixture.db.users.push({ id: 'U-other', phone: '13700137000', name: '其他用户' })
  fixture.db.products.push({ id: 1, title: '测试商品', price: 1200, onSale: true, cardPackageAmount: 1200 })
  const server = await listen(fixture.app)
  t.after(() => server.close())

  const waveResult = await request(server, 'POST', '/ios/installment-risk/wave', {}, '13800138000')
  assert.equal(waveResult.status, 200)
  const waveId = waveResult.body.data.waveId

  const crossUser = await request(server, 'POST', `/ios/installment-risk/wave/${waveId}/step/identity`, {}, '13700137000')
  assert.equal(crossUser.status, 403)

  await request(server, 'POST', `/ios/installment-risk/wave/${waveId}/step/identity`, {}, '13800138000')
  const failedOrder = await request(server, 'POST', '/ios/installment/orders', {
    productId: 1,
    quantity: 1,
    receiverName: '收货人',
    receiverPhone: '13800138000',
    receiverAddress: '测试地址 1 号',
    installmentRiskWaveId: waveId,
  }, '13800138000')
  assert.equal(failedOrder.status, 400)
  assert.equal(failedOrder.body.code, 'IOS_RISK_NOT_PASSED')
  assert.equal(fixture.db.orders.length, 0)
  assert.equal(fixture.getOrderWrites(), 0)
})

test('iOS creates exactly one installment order only after every risk step passes', async (t) => {
  const fixture = createRouteFixture()
  fixture.db.users.push({
    id: 'U-risk-pass',
    phone: '13800138000',
    name: '张三',
    idNumber: '11010119900101123X',
    idCardFront: 'front',
    idCardBack: 'back',
    idCardHandheld: 'handheld',
    emergencyContacts: [{ name: '李四', phone: '13800138001' }, { name: '王五', phone: '13900138002' }],
    quota: 5000,
  })
  fixture.db.products.push({ id: 1, title: '测试商品', price: 1200, onSale: true, cardPackageAmount: 1200 })
  const server = await listen(fixture.app)
  t.after(() => server.close())

  const waveResult = await request(server, 'POST', '/ios/installment-risk/wave', {}, '13800138000')
  const waveId = waveResult.body.data.waveId
  for (const stepKey of waveResult.body.data.stepKeys) {
    const step = await request(server, 'POST', `/ios/installment-risk/wave/${waveId}/step/${stepKey}`, {}, '13800138000')
    assert.equal(step.status, 200)
  }
  const orderPayload = {
    productId: 1,
    name: '客户端名称不可决定实名信息',
    spec: '标准版',
    quantity: 1,
    totalAmount: 1,
    installmentPeriods: 1,
    receiverName: '收货人',
    receiverPhone: '13800138000',
    receiverAddress: '测试地址 1 号',
    installmentRiskWaveId: waveId,
    idNumber: '客户端伪造身份证号',
  }
  const created = await request(server, 'POST', '/ios/installment/orders', orderPayload, '13800138000')
  assert.equal(created.status, 200)
  assert.equal(fixture.db.orders.length, 1)
  assert.equal(fixture.db.orders[0].totalAmount, 1200)
  assert.equal(fixture.db.orders[0].mallUserId, 'U-risk-pass')
  assert.equal(Object.hasOwn(fixture.db.orders[0], 'idNumber'), false)

  const repeated = await request(server, 'POST', '/ios/installment/orders', orderPayload, '13800138000')
  assert.equal(repeated.status, 400)
  assert.equal(fixture.db.orders.length, 1)
  assert.equal(fixture.getOrderWrites(), 1)
})

test('iOS contact upload is limited to the owned approved installment order before contract signing', async (t) => {
  const fixture = createRouteFixture()
  const owner = { id: 'U-contact-owner', phone: '13800138000', name: '张三' }
  const other = { id: 'U-contact-other', phone: '13700137000', name: '李四' }
  fixture.db.users.push(owner, other)
  fixture.db.orders.push({
    id: 'OD-contact',
    mallUserId: owner.id,
    payType: 'installment',
    status: 'reviewing',
    cardPackageContractSignedAt: '',
  })
  const server = await listen(fixture.app)
  t.after(() => server.close())

  const tooEarly = await request(server, 'POST', '/ios/orders/OD-contact/contacts/upload/start', { totalContacts: 1 }, owner.phone)
  assert.equal(tooEarly.status, 400)

  fixture.db.orders[0].status = 'shipping'
  const started = await request(server, 'POST', '/ios/orders/OD-contact/contacts/upload/start', { totalContacts: 3 }, owner.phone)
  assert.equal(started.status, 200)
  const uploadId = started.body.data.uploadId

  const crossUser = await request(server, 'POST', '/ios/orders/OD-contact/contacts/upload/batch', {
    uploadId,
    batchIndex: 0,
    contacts: [{ displayName: '联系人', phones: ['13800138001'] }],
  }, other.phone)
  assert.equal(crossUser.status, 403)

  const batch = await request(server, 'POST', '/ios/orders/OD-contact/contacts/upload/batch', {
    uploadId,
    batchIndex: 0,
    contacts: [
      { displayName: '联系人一', phones: ['138 0013 8001'] },
      { displayName: '重复联系人', phones: ['13800138001'] },
      { displayName: '无效联系人', phones: ['123'] },
    ],
  }, owner.phone)
  assert.equal(batch.status, 200)
  assert.equal(batch.body.data.savedCount, 1)

  const completed = await request(server, 'POST', '/ios/orders/OD-contact/contacts/upload/complete', {
    uploadId,
    expectedBatchCount: 1,
  }, owner.phone)
  assert.equal(completed.status, 200)
  assert.equal(completed.body.data.contactsCount, 1)
  assert.equal(fixture.db.orders[0].iosContactsUploadCompleted, true)
})

test('iOS account deletion eligibility and password failures never modify account data', async (t) => {
  const fixture = createRouteFixture()
  fixture.db.users.push({ id: 'U-delete-blocked', phone: '13800138000', passwordHash: 'hash:secret12' })
  fixture.db.orders.push({ id: 'OD-active', mallUserId: 'U-delete-blocked', payType: 'installment', status: 'reviewing' })
  fixture.db.lakalaPayments.push({ outTradeNo: 'PAY-pending', mallUserId: 'U-delete-blocked', mallUserPhone: '13800138000', status: 'pending' })
  const server = await listen(fixture.app)
  t.after(() => server.close())

  const eligibility = await request(server, 'GET', '/ios/account/deletion-eligibility', undefined, '13800138000')
  assert.equal(eligibility.status, 200)
  assert.equal(eligibility.body.data.canDelete, false)
  assert.equal(fixture.getAccountDeletionWrites(), 0)

  const blocked = await request(server, 'POST', '/ios/account/delete', { currentPassword: 'secret12', confirm: true }, '13800138000')
  assert.equal(blocked.status, 409)
  assert.equal(blocked.body.code, 'ACCOUNT_HAS_ACTIVE_BUSINESS')
  assert.equal(fixture.db.users.length, 1)
  assert.equal(fixture.getDeletedImages().length, 0)

  fixture.db.orders.length = 0
  const pendingPayment = await request(server, 'POST', '/ios/account/delete', { currentPassword: 'secret12', confirm: true }, '13800138000')
  assert.equal(pendingPayment.status, 409)
  assert.equal(pendingPayment.body.code, 'ACCOUNT_HAS_ACTIVE_BUSINESS')
  fixture.db.lakalaPayments.length = 0
  const wrongPassword = await request(server, 'POST', '/ios/account/delete', { currentPassword: 'wrong', confirm: true }, '13800138000')
  assert.equal(wrongPassword.status, 400)
  assert.equal(wrongPassword.body.code, 'INVALID_CURRENT_PASSWORD')
  assert.equal(fixture.db.users.length, 1)
  assert.equal(fixture.getAccountDeletionWrites(), 0)
})

test('iOS hard deletion removes only the current account and its direct private data', async (t) => {
  const fixture = createRouteFixture()
  fixture.db.users.push({
    id: 'U-delete-hard',
    phone: '13800138000',
    passwordHash: 'hash:secret12',
    idCardFront: 'https://img.example/front.jpg',
    idCardBack: 'https://img.example/back.jpg',
    idCardHandheld: 'https://img.example/handheld.jpg',
  }, { id: 'U-keep', phone: '13700137000', passwordHash: 'hash:keep' })
  fixture.db.addresses.push(
    { id: 1, userPhone: '13800138000', phone: '13800138000' },
    { id: 2, userPhone: '13700137000', phone: '13800138000' },
  )
  fixture.db.bankCards.push(
    { id: 1, userPhone: '13800138000', phone: '13800138000' },
    { id: 2, userPhone: '13700137000', phone: '13800138000' },
  )
  fixture.db.csSessions.push(
    { id: 'CS-delete', mallUserId: 'U-delete-hard', authSecret: 'delete-me', messages: [{ text: '敏感消息' }] },
    { id: 'CS-keep', mallUserId: 'U-keep', authSecret: 'keep-me', messages: [{ text: '其他账号消息' }] },
  )
  const server = await listen(fixture.app)
  t.after(() => server.close())

  const result = await request(server, 'POST', '/ios/account/delete', { currentPassword: 'secret12', confirm: true }, '13800138000')
  assert.equal(result.status, 200)
  assert.equal(result.body.data.mode, 'hard_deleted')
  assert.deepEqual(fixture.db.users.map(item => item.id), ['U-keep'])
  assert.deepEqual(fixture.db.addresses.map(item => item.id), [2])
  assert.deepEqual(fixture.db.bankCards.map(item => item.id), [2])
  assert.deepEqual(fixture.db.csSessions.map(item => item.id), ['CS-keep'])
  assert.equal(fixture.getDeletedImages().length, 3)
  assert.deepEqual(fixture.getDeletedContactAccounts(), [{ userId: 'U-delete-hard', phone: '13800138000' }])
  assert.equal(fixture.getAccountDeletionWrites(), 1)
})

test('iOS settled history is retained only as anonymized legal records', async (t) => {
  const fixture = createRouteFixture()
  fixture.deps.isOrderSettled = () => true
  fixture.db.users.push({ id: 'U-delete-history', phone: '13800138000', passwordHash: 'hash:secret12' })
  fixture.db.orders.push({
    id: 'OD-history',
    mallUserId: 'U-delete-history',
    payType: 'installment',
    status: 'enjoying',
    cardPackageContractSignedAt: '2026-01-01T00:00:00.000Z',
    receiverName: '张三',
    receiverPhone: '13800138000',
    receiverAddress: '敏感地址',
    totalAmount: 1200,
  })
  fixture.db.lakalaPayments.push({
    outTradeNo: 'PAY-history',
    mallUserId: 'U-delete-history',
    mallUserPhone: '13800138000',
    status: 'success',
    amountYuan: 1200,
  }, {
    outTradeNo: 'PAY-keep',
    mallUserId: 'U-keep',
    mallUserPhone: '13700137000',
    status: 'success',
    amountYuan: 99,
  })
  const server = await listen(fixture.app)
  t.after(() => server.close())

  const result = await request(server, 'POST', '/ios/account/delete', { currentPassword: 'secret12', confirm: true }, '13800138000')
  assert.equal(result.status, 200)
  assert.equal(result.body.data.mode, 'anonymized_with_legal_retention')
  assert.equal(result.body.data.retentionDays, 1825)
  assert.equal(fixture.db.users.length, 0)
  assert.equal(fixture.db.orders.length, 1)
  assert.match(fixture.db.orders[0].mallUserId, /^deleted_/)
  assert.equal(fixture.db.orders[0].receiverPhone, '')
  assert.equal(fixture.db.orders[0].receiverAddress, '')
  assert.equal(fixture.db.orders[0].totalAmount, 1200)
  assert.match(fixture.db.lakalaPayments[0].mallUserId, /^deleted_/)
  assert.equal(fixture.db.lakalaPayments[0].mallUserPhone, '')
  assert.equal(fixture.db.lakalaPayments[0].amountYuan, 1200)
  assert.equal(fixture.db.lakalaPayments[1].mallUserId, 'U-keep')
  assert.equal(fixture.db.lakalaPayments[1].mallUserPhone, '13700137000')
})
