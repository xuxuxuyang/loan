import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')

test('mall auth exposes duodiandian auto login and calls the scoped endpoint only with ticket query', () => {
  const auth = fs.readFileSync(path.join(root, 'src/composables/useMallAuth.ts'), 'utf8')
  assert.match(auth, /autoLoginFromDuodiandianTicket/)
  assert.match(auth, /\/open\/partners\/duodiandian\/autoLogin/)
  assert.match(auth, /autoLoginPath/)
  assert.match(auth, /partner.*duodiandian/s)
  assert.match(auth, /loginTicket/)
})

test('app bootstrap attempts duodiandian auto login once before mounting', () => {
  const main = fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8')
  assert.match(main, /autoLoginFromDuodiandianTicket/)
  assert.match(main, /await\s+autoLoginFromDuodiandianTicket\(\)/)
})
