import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)

function loadTsModule(path) {
  const filename = path instanceof URL ? fileURLToPath(path) : path
  const source = fs.readFileSync(filename, 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(js, { module, exports: module.exports, require }, { filename })
  return module.exports
}

test('patched order merge keeps current buyer display fields when patch response is not enriched', () => {
  const { mergePatchedOrder } = loadTsModule(new URL('../src/utils/orderPatchMerge.ts', import.meta.url))
  const previous = {
    id: 'OD1',
    user: 'Test Buyer',
    buyerPhone: '13267009143',
    mallUserId: 'U1',
    userRemark: 'keep remark',
    emergencyContactsComplete: true,
    registerChannelCode: 'traffic-a',
    registerChannelName: 'Traffic A',
    registerChannelLabel: 'Traffic A Label',
  }
  const mapped = {
    id: 'OD1',
    user: 'бк',
    buyerPhone: '',
    mallUserId: undefined,
    userRemark: '',
  }

  const merged = mergePatchedOrder(previous, mapped)

  assert.equal(merged.user, 'Test Buyer')
  assert.equal(merged.buyerPhone, '13267009143')
  assert.equal(merged.mallUserId, 'U1')
  assert.equal(merged.userRemark, 'keep remark')
  assert.equal(merged.emergencyContactsComplete, true)
  assert.equal(merged.registerChannelCode, 'traffic-a')
  assert.equal(merged.registerChannelName, 'Traffic A')
  assert.equal(merged.registerChannelLabel, 'Traffic A Label')
})


