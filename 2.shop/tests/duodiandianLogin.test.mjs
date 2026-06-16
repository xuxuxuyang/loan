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
  const context = vm.createContext({ module, exports: module.exports, require, console, URL })
  vm.runInContext(output, context, { filename })
  return module.exports
}

const loginUtils = loadTsModule('src/utils/duodiandianLogin.ts')

test('uses backend supplied consumePath when present', () => {
  assert.equal(
    loginUtils.resolveDuodiandianLoginConsumeUrl(
      'https://wenshuosc.com/api',
      'duodiandian',
      '/api/market/halfFlow/447285613150998528/open/login/consume',
    ),
    '/api/market/halfFlow/447285613150998528/open/login/consume',
  )
})

test('falls back to the production half-flow consume endpoint for old duodiandian links', () => {
  assert.equal(
    loginUtils.resolveDuodiandianLoginConsumeUrl('https://wenshuosc.com/api', 'duodiandian'),
    'https://wenshuosc.com/api/market/halfFlow/447285613150998528/open/login/consume',
  )
})

test('keeps generic partner paths for non-duodiandian channels', () => {
  assert.equal(
    loginUtils.resolveDuodiandianLoginConsumeUrl('/api/', 'other_channel'),
    '/api/open/partners/other_channel/login/consume',
  )
})

test('sanitizes technical request errors before showing them to shoppers', () => {
  assert.equal(
    loginUtils.sanitizeTrafficLoginErrorMessage('[POST] "https://wenshuosc.com/api/open/partners/duodiandian/login/consume": 404 Not Found'),
    '正在为您进入商城，请稍候重试',
  )
  assert.equal(
    loginUtils.sanitizeTrafficLoginErrorMessage('[POST] "/api/market/halfFlow/447285613150998528/open/login/consume": 400 Bad Request'),
    '正在为您进入商城，请稍候重试',
  )
})
