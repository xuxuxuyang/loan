const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const apiSource = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8')

test('manual reject reason is persisted to the bound user with single-entity writes', () => {
  assert.match(apiSource, /target\.riskReason = customReason \|\| '人工审核不通过'/)
  assert.match(apiSource, /const buyer = resolveMallBuyerFromOrder\(db, target\)/)
  assert.match(apiSource, /buyer\.manualRejectReason = target\.riskReason/)
  assert.match(apiSource, /writeOrderDb\(db, target\)/)
  assert.match(apiSource, /writeUserDb\(db, buyer\)/)
})

test('manual reject reason is returned in order rows and exported by selected field', () => {
  assert.match(apiSource, /manualRejectReason: rawManualRejectReason/)
  assert.match(apiSource, /case 'manualRejectReason':/)
  assert.match(apiSource, /values\.manualRejectReason = String\(user\.manualRejectReason \|\| ''\)\.trim\(\)/)
  assert.match(apiSource, /manualRejectReason: '不通过原因'/)
})
