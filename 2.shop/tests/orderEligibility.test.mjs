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

const eligibility = loadTsModule('src/utils/orderEligibility.ts')

const baseInput = {
  idNumber: '110101199001010011',
  phone: '13800138000',
  addressParts: ['浙江省', '杭州市', '西湖区', '文三路'],
  today: new Date('2026-06-09T00:00:00+08:00'),
}

test('allows ages 22 and 49 inclusively', () => {
  assert.equal(eligibility.validateMallOrderBeforeRisk({ ...baseInput, idNumber: '110101200406090011' }).ok, true)
  assert.equal(eligibility.validateMallOrderBeforeRisk({ ...baseInput, idNumber: '110101197706090011' }).ok, true)
})

test('rejects ages below 22 and above 49', () => {
  const tooYoung = eligibility.validateMallOrderBeforeRisk({ ...baseInput, idNumber: '110101200406100011' })
  const tooOld = eligibility.validateMallOrderBeforeRisk({ ...baseInput, idNumber: '110101197606090011' })
  assert.equal(tooYoung.ok, false)
  assert.match(tooYoung.message, /22周岁到49周岁/)
  assert.equal(tooOld.ok, false)
  assert.match(tooOld.message, /22周岁到49周岁/)
})

test('rejects restricted id card regions', () => {
  const result = eligibility.validateMallOrderBeforeRisk({ ...baseInput, idNumber: '650101199001010011' })
  assert.equal(result.ok, false)
  assert.match(result.message, /暂不支持/)
})

test('rejects restricted address or phone location text without leaking extra data', () => {
  assert.equal(eligibility.validateMallOrderBeforeRisk({ ...baseInput, addressParts: ['浙江省', '宁波市', '海曙区'] }).ok, false)
  assert.equal(eligibility.validateMallOrderBeforeRisk({ ...baseInput, phoneLocationText: '内蒙古呼和浩特' }).ok, false)
})
