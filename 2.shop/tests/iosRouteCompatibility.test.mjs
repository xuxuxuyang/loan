import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const routerSource = fs.readFileSync(
  new URL('../src/router/index.ts', import.meta.url),
  'utf8',
)

test('loads the iOS checkout path without WebKit dynamic-module interop', () => {
  assert.match(routerSource, /import MallProductDetailView from '\.\.\/views\/MallProductDetailView\.vue'/)
  assert.match(routerSource, /import MallOrderCreateView from '\.\.\/views\/MallOrderCreateView\.vue'/)
  assert.doesNotMatch(routerSource, /const MallProductDetailView =/)
  assert.doesNotMatch(routerSource, /const MallOrderCreateView =/)
})
