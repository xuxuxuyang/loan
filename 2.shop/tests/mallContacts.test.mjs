import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)

function loadTsModule(relativePath) {
  const filename = path.resolve(relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText
  const module = { exports: {} }
  const context = vm.createContext({ module, exports: module.exports, require, console, URLSearchParams })
  vm.runInContext(output, context, { filename })
  return module.exports
}

const contacts = loadTsModule('src/utils/mallContacts.ts')

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

test('detects contract client platform from H5 user agent', () => {
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
    'ios',
  )
  assert.equal(
    contacts.resolveMallContractClientPlatform({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    }),
    'ios',
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

test('builds a stable Android app contract deep link without exposing phone', () => {
  assert.equal(
    contacts.buildMallAndroidContractUrl('O 1001'),
    'wenshuomall://contract?orderId=O+1001',
  )
})
