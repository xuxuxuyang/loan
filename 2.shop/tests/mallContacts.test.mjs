import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)

function loadTsModule(relativePath, modules = {}) {
  const filename = path.resolve(relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText
  const module = { exports: {} }
  const moduleRequire = id => Object.hasOwn(modules, id) ? modules[id] : require(id)
  const context = vm.createContext({ module, exports: module.exports, require: moduleRequire, console, URLSearchParams })
  vm.runInContext(output, context, { filename })
  return module.exports
}

const contacts = loadTsModule('src/utils/mallContacts.ts')
const cardPackageSource = fs.readFileSync('src/components/my/CardPackageSection.vue', 'utf8')
const orderMobileSource = fs.readFileSync('src/components/my/order/MyOrderMobile.vue', 'utf8')
const iosContactsPluginPath = 'ios/App/App/MallContactsPlugin.swift'
const iosBridgeControllerPath = 'ios/App/App/MallBridgeViewController.swift'
const iosInfoPlistPath = 'ios/App/App/Info.plist'
const iosStoryboardPath = 'ios/App/App/Base.lproj/Main.storyboard'
const iosProjectPath = 'ios/App/App.xcodeproj/project.pbxproj'

test('reads contacts through the native plugin on iOS', async () => {
  const rows = [{ contactId: 'ios-1', displayName: 'iPhone Contact', phones: ['13800138001'] }]
  const nativeContacts = loadTsModule('src/composables/useAndroidContacts.ts', {
    '@capacitor/core': {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
      },
      registerPlugin: () => ({
        getContacts: async () => ({ contacts: rows, count: rows.length }),
        openAppSettings: async () => undefined,
      }),
    },
    '~/utils/mallContacts': contacts,
  })

  assert.equal(nativeContacts.isNativeContactsAvailable(), true)
  assert.equal(nativeContacts.isIosNativeContactsAvailable(), true)
  assert.deepEqual(await nativeContacts.readNativeDeviceContacts(), rows)
  let uploadedRows = null
  await nativeContacts.readAndUploadNativeContacts(async (contacts) => {
    uploadedRows = contacts
  })
  assert.deepEqual(uploadedRows, rows)
})

test('does not upload contacts when native permission is denied', async () => {
  let uploadCalls = 0
  const nativeContacts = loadTsModule('src/composables/useAndroidContacts.ts', {
    '@capacitor/core': {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
      },
      registerPlugin: () => ({
        getContacts: async () => { throw new Error('contacts_permission_denied') },
        openAppSettings: async () => undefined,
      }),
    },
    '~/utils/mallContacts': contacts,
  })

  await assert.rejects(
    nativeContacts.readAndUploadNativeContacts(async () => { uploadCalls += 1 }),
    /contacts_permission_denied/,
  )
  assert.equal(uploadCalls, 0)
})

test('accepts user-authorized partial or full contacts access on iOS', () => {
  const source = fs.readFileSync(iosContactsPluginPath, 'utf8')
  const infoPlist = fs.readFileSync(iosInfoPlistPath, 'utf8')

  assert.match(source, /if #available\(iOS 18\.0, \*\), status == \.limited\s*\{\s*return true\s*\}/)
  assert.doesNotMatch(source, /contacts_permission_limited/)
  assert.doesNotMatch(cardPackageSource, /isContactsPermissionLimitedError/)
  assert.doesNotMatch(cardPackageSource, /promptOpenFullContactsSettings/)
  assert.doesNotMatch(cardPackageSource, /仅授权部分联系人将无法/)
  assert.doesNotMatch(cardPackageSource, /我会选择完全访问/)
  assert.match(cardPackageSource, /iOS 18 及以上可以选择部分联系人，也可以自愿选择完全访问/)
  assert.match(cardPackageSource, /只会上传您授权的联系人/)
  assert.match(cardPackageSource, /contacts-full-access-dialog/)
  assert.match(cardPackageSource, /继续选择授权方式/)
  assert.match(cardPackageSource, /已上传您授权的联系人/)
  assert.match(cardPackageSource, /已取消授权，未上传任何联系人/)
  assert.match(cardPackageSource, /系统不会上传任何联系人/)
  assert.match(cardPackageSource, /未获取到含手机号的已授权联系人/)
  assert.match(cardPackageSource, /通过网页签署或联系客服处理/)
  assert.match(infoPlist, /读取并上传/)
  assert.match(infoPlist, /姓名、手机号及去重标识/)
  assert.match(infoPlist, /iOS 18及以上可选择部分联系人或完全访问/)
  assert.match(infoPlist, /订单安全审核/)
})

test('uses generic App guidance outside a native contacts runtime', async () => {
  const nativeContacts = loadTsModule('src/composables/useAndroidContacts.ts', {
    '@capacitor/core': {
      Capacitor: {
        isNativePlatform: () => false,
        getPlatform: () => 'web',
      },
      registerPlugin: () => ({}),
    },
    '~/utils/mallContacts': contacts,
  })

  await assert.rejects(nativeContacts.readNativeDeviceContacts(), /手机 App/)
})

test('uses native contacts functions for contract authorization', () => {
  assert.match(cardPackageSource, /isNativeContactsAvailable, openNativeAppSettings, readAndUploadNativeContacts/)
  assert.match(cardPackageSource, /if \(!isNativeContactsAvailable\(\)\)/)
  assert.match(cardPackageSource, /await openNativeAppSettings\(\)/)
  assert.match(cardPackageSource, /await readAndUploadNativeContacts\(async \(contacts\) =>/)
})

test('keeps replacement-character detection out of generated assets', () => {
  assert.match(orderMobileSource, /Number\.parseInt\('fffd', 16\)/)
})

test('declares an iOS MallContacts bridge with the Android-compatible methods', () => {
  assert.equal(fs.existsSync(iosContactsPluginPath), true)
  if (!fs.existsSync(iosContactsPluginPath)) {
    return
  }
  const source = fs.readFileSync(iosContactsPluginPath, 'utf8')
  assert.match(source, /import Contacts/)
  assert.match(source, /public let jsName = "MallContacts"/)
  assert.match(source, /CAPPluginMethod\(name: "getContacts", returnType: CAPPluginReturnPromise\)/)
  assert.match(source, /CAPPluginMethod\(name: "openAppSettings", returnType: CAPPluginReturnPromise\)/)
  assert.match(source, /CNContactFormatter\.descriptorForRequiredKeys\(for:\s*\.fullName\)/)
  assert.equal(fs.existsSync(iosBridgeControllerPath), true)
  if (!fs.existsSync(iosBridgeControllerPath)) {
    return
  }
  assert.match(fs.readFileSync(iosBridgeControllerPath, 'utf8'), /registerPluginInstance\(MallContactsPlugin\(\)\)/)
  assert.match(fs.readFileSync(iosInfoPlistPath, 'utf8'), /<key>NSContactsUsageDescription<\/key>/)
  assert.match(fs.readFileSync(iosInfoPlistPath, 'utf8'), /<string>wenshuomall<\/string>/)
  assert.match(fs.readFileSync(iosStoryboardPath, 'utf8'), /customClass="MallBridgeViewController"/)
  const projectSource = fs.readFileSync(iosProjectPath, 'utf8')
  assert.match(projectSource, /MallContactsPlugin\.swift in Sources/)
  assert.match(projectSource, /MallBridgeViewController\.swift in Sources/)
})

test('chunks contacts by positive server batch size', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ displayName: `c${i}`, phones: [`1380013800${i}`] }))
  assert.equal(JSON.stringify(contacts.chunkMallContacts(rows, 2).map(item => item.length)), JSON.stringify([2, 2, 1]))
  assert.equal(JSON.stringify(contacts.chunkMallContacts(rows, 0).map(item => item.length)), JSON.stringify([5]))
})

test('requires at least one contact before upload can complete', () => {
  assert.equal(contacts.hasUploadableMallContacts([]), false)
  assert.equal(contacts.hasUploadableMallContacts(null), false)
  assert.equal(contacts.hasUploadableMallContacts([{ displayName: 'No phone', phones: [] }]), false)
  assert.equal(contacts.hasUploadableMallContacts([{ displayName: '张三', phones: ['13800138001'] }]), true)
})

test('requires contacts only for native iOS while preserving existing Android detection', () => {
  assert.equal(
    contacts.resolveMallContractClientPlatform({
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    }),
    'android',
  )
  assert.equal(
    contacts.resolveMallContractClientPlatform({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
    }),
    'web',
  )
  assert.equal(
    contacts.resolveMallContractClientPlatform({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    }),
    'web',
  )
  assert.equal(
    contacts.resolveMallContractClientPlatform({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      platform: 'iPhone',
      maxTouchPoints: 5,
      nativePlatform: 'ios',
    }),
    'ios_app',
  )
  assert.equal(
    contacts.resolveMallContractClientPlatform({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      platform: 'Win32',
      maxTouchPoints: 0,
    }),
    'web',
  )
})

test('recognizes Android and iOS as native contacts platforms', () => {
  assert.equal(contacts.isNativeMallContactsPlatform('android'), true)
  assert.equal(contacts.isNativeMallContactsPlatform('ios'), true)
  assert.equal(contacts.isNativeMallContactsPlatform('web'), false)
})

test('detects CONTACTS_REQUIRED API errors from response data or message', () => {
  assert.equal(contacts.isContactsRequiredApiError({ data: { data: { errorCode: 'CONTACTS_REQUIRED' } } }), true)
  assert.equal(contacts.isContactsRequiredApiError({ data: { msg: '签署合同前需在安卓 App 内完成通讯录授权' } }), true)
  assert.equal(contacts.isContactsRequiredApiError({ data: { msg: '其它错误' } }), false)
})


test('detects Android contacts permission denial errors', () => {
  assert.equal(contacts.isContactsPermissionDeniedError(new Error('contacts_permission_denied')), true)
  assert.equal(contacts.isContactsPermissionDeniedError({ data: { msg: 'permission denied by user' } }), true)
  assert.equal(contacts.isContactsPermissionDeniedError(new Error('contacts_read_failed')), false)
})

test('detects limited iOS contacts permission separately', () => {
  assert.equal(contacts.isContactsPermissionLimitedError(new Error('contacts_permission_limited')), true)
  assert.equal(contacts.isContactsPermissionLimitedError(new Error('contacts_permission_denied')), false)
})

test('builds a stable Android app contract deep link without exposing phone', () => {
  assert.equal(
    contacts.buildMallAndroidContractUrl('O 1001'),
    'wenshuomall://contract?orderId=O+1001',
  )
})
