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
  const context = vm.createContext({ module, exports: module.exports, require, console })
  vm.runInContext(output, context, { filename })
  return module.exports
}

const config = loadTsModule('src/config/mallRuntimeConfig.ts')

test('resolves production-facing values from env without changing configured values', () => {
  const result = config.resolveMallRuntimeConfigFromEnv({
    VITE_MALL_SITE_URL: ' https://shop.example.com/ ',
    VITE_MALL_ICP_TEXT: ' 示例ICP备案号 ',
    VITE_MALL_ICP_LINK: ' https://beian.miit.gov.cn/ ',
    VITE_MALL_TRACKING_LOOKUP_URL: ' https://tracking.example.com/ ',
    VITE_MALL_KEFU_QR_URL: ' https://cdn.example.com/kefu.png ',
    VITE_MALL_KEFU_DISPLAY_NAME: ' 示例客服 · 示例公司 ',
  }, { bundledKefuQrUrl: '/assets/kefu.png' })

  assert.equal(result.siteUrl, 'https://shop.example.com/')
  assert.equal(result.icpText, '示例ICP备案号')
  assert.equal(result.icpLink, 'https://beian.miit.gov.cn/')
  assert.equal(result.trackingLookupUrl, 'https://tracking.example.com/')
  assert.equal(result.kefuQrUrl, 'https://cdn.example.com/kefu.png')
  assert.equal(result.kefuDisplayName, '示例客服 · 示例公司')})

test('uses non-business fallbacks when optional env values are omitted', () => {
  const result = config.resolveMallRuntimeConfigFromEnv({}, { bundledKefuQrUrl: '/assets/kefu.png' })

  assert.equal(result.siteUrl, '')
  assert.equal(result.icpText, '')
  assert.equal(result.icpLink, 'https://beian.miit.gov.cn/')
  assert.equal(result.trackingLookupUrl, '')
  assert.equal(result.kefuQrUrl, '/assets/kefu.png')
  assert.equal(result.kefuDisplayName, '在线客服')
})

