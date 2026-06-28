const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const source = fs.readFileSync(path.resolve(__dirname, '../src/index.js'), 'utf8')

function routeBody(routeStart) {
  const start = source.indexOf(routeStart)
  assert.notEqual(start, -1, `${routeStart} route must exist`)
  const nextRoute = source.indexOf('\nrouter.', start + routeStart.length)
  assert.notEqual(nextRoute, -1, `${routeStart} must be followed by another route`)
  return source.slice(start, nextRoute)
}

test('register route rejects explicit invalid channels before consuming SMS code', () => {
  const body = routeBody("router.post('/auth/register'")
  const validatePos = body.indexOf('resolveRegisterChannelForRegistration(db, payload)')
  const smsPos = body.indexOf('verifyAndConsumeRegisterSms(phone, payload.smsCode)')

  assert.notEqual(validatePos, -1, 'register route must validate explicit register channel')
  assert.notEqual(smsPos, -1, 'register route must still verify SMS code')
  assert.ok(validatePos < smsPos, 'channel validation must happen before SMS consumption')
  assert.match(body, /channelCheck\.error/)
  assert.match(body, /推广链接失效/)
})
