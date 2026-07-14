import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

test('keeps the home controls below the iPhone status bar', () => {
  const source = fs.readFileSync(
    new URL('../src/components/index/HomeBannerMobile.vue', import.meta.url),
    'utf8',
  )

  assert.match(source, /padding-top:\s*max\(0\.75rem,\s*env\(safe-area-inset-top\)\)/)
})
