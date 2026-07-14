import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

test('keeps primary shopping controls below the iPhone status bar', () => {
  const paths = [
    '../src/components/index/HomeBannerMobile.vue',
    '../src/components/list/MallListMobile.vue',
    '../src/components/my/MyCenterMobile.vue',
    '../src/views/MallProductDetailView.vue',
  ]

  for (const relativePath of paths) {
    const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    assert.match(source, /env\(safe-area-inset-top\)/, `${relativePath} must respect the iPhone status bar`)
  }
})
