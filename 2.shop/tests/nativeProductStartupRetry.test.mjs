import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const helperUrl = new URL('../src/utils/nativeStartupRetry.ts', import.meta.url)
const productsSource = fs.readFileSync(
  new URL('../src/composables/useTeaProducts.ts', import.meta.url),
  'utf8',
)

test('retries a transient native startup request without affecting web requests', async () => {
  assert.equal(fs.existsSync(helperUrl), true, 'native startup retry helper must exist')
  if (!fs.existsSync(helperUrl)) {
    return
  }

  const { withNativeStartupRetry } = await import(helperUrl.href)
  let nativeAttempts = 0
  const result = await withNativeStartupRetry(async () => {
    nativeAttempts += 1
    if (nativeAttempts === 1) {
      throw new Error('network not ready')
    }
    return 'loaded'
  }, { native: true, retryDelaysMs: [0] })

  assert.equal(result, 'loaded')
  assert.equal(nativeAttempts, 2)

  let webAttempts = 0
  await assert.rejects(
    withNativeStartupRetry(async () => {
      webAttempts += 1
      throw new Error('web failure')
    }, { native: false, retryDelaysMs: [0] }),
    /web failure/,
  )
  assert.equal(webAttempts, 1)
})

test('uses native startup retry for product GET requests', () => {
  assert.match(productsSource, /withNativeStartupRetry/)
  assert.match(productsSource, /Capacitor\.isNativePlatform\(\)/)
})

test('keeps retrying long enough for the first iOS network permission decision', async () => {
  const { NATIVE_STARTUP_RETRY_DELAYS_MS } = await import(helperUrl.href)
  const retryWindowMs = NATIVE_STARTUP_RETRY_DELAYS_MS.reduce((total, delay) => total + delay, 0)

  assert.ok(NATIVE_STARTUP_RETRY_DELAYS_MS.length >= 4)
  assert.ok(retryWindowMs >= 45_000)
  assert.match(productsSource, /NATIVE_STARTUP_RETRY_DELAYS_MS/)
})
