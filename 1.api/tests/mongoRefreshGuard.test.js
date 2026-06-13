const assert = require('node:assert/strict')
const test = require('node:test')

const { shouldBlockRequestOnMongoRefreshError } = require('../src/mongoRefreshGuard')

test('blocks write requests when Mongo refresh fails', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(shouldBlockRequestOnMongoRefreshError(method), true)
  }
})

test('does not block read requests when Mongo refresh fails', () => {
  assert.equal(shouldBlockRequestOnMongoRefreshError('GET'), false)
  assert.equal(shouldBlockRequestOnMongoRefreshError('HEAD'), false)
})
