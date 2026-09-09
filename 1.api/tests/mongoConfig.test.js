const assert = require('node:assert/strict')
const test = require('node:test')
const { getMongoRefreshMode } = require('../src/mongoConfig')

test('Mongo refresh mode defaults to version for missing or invalid values', (t) => {
  const original = process.env.MONGO_REFRESH_MODE
  t.after(() => {
    if (original === undefined) delete process.env.MONGO_REFRESH_MODE
    else process.env.MONGO_REFRESH_MODE = original
  })
  delete process.env.MONGO_REFRESH_MODE
  assert.equal(getMongoRefreshMode(), 'version')
  for (const value of ['', ' ', 'invalid']) {
    process.env.MONGO_REFRESH_MODE = value
    assert.equal(getMongoRefreshMode(), 'version')
  }
})

test('Mongo refresh mode accepts the supported modes case-insensitively', (t) => {
  const original = process.env.MONGO_REFRESH_MODE
  t.after(() => {
    if (original === undefined) delete process.env.MONGO_REFRESH_MODE
    else process.env.MONGO_REFRESH_MODE = original
  })
  for (const mode of ['version', 'every_request', 'single_instance']) {
    process.env.MONGO_REFRESH_MODE = ` ${mode.toUpperCase()} `
    assert.equal(getMongoRefreshMode(), mode)
  }
})
