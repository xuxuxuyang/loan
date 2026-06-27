import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(
  new URL('../src/components/UserRegistrationInfoScroll.vue', import.meta.url),
  'utf8',
)

test('contacts section does not reserve idle helper space before loading', () => {
  assert.equal(source.includes('点击右侧按钮读取通讯录明细'), false)
  assert.equal(source.includes('user-preview-contacts-empty'), false)
})
