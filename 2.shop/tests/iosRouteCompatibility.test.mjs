import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const routerSource = fs.readFileSync(
  new URL('../src/router/index.ts', import.meta.url),
  'utf8',
)

test('unwraps lazy view modules before Vue Router handles them on iOS WebKit', () => {
  assert.match(routerSource, /function loadRouteView/)

  const wrappedViews = routerSource.match(/const Mall\w+View = loadRouteView\(\(\) => import\(/g) ?? []
  const rawViews = routerSource.match(/const Mall\w+View = \(\) => import\(/g) ?? []

  assert.ok(wrappedViews.length >= 19, 'all routed mall views should unwrap their default export')
  assert.equal(rawViews.length, 0, 'raw module namespace loaders trigger a WebKit router error')
})
