const assert = require('node:assert/strict')
const test = require('node:test')

const { applyUserRegisterChannel } = require('../src/userRegisterChannel')

test('updates user registration channel from an enabled traffic channel', () => {
  const db = {
    trafficChannels: [
      { code: 'lijin1', name: '丽金1' },
    ],
  }
  const user = { id: 'U1', registerChannelCode: '', registerChannelName: '' }

  applyUserRegisterChannel(db, user, ' lijin1 ')

  assert.equal(user.registerChannelCode, 'lijin1')
  assert.equal(user.registerChannelName, '丽金1')
})

test('clears user registration channel back to mall registration', () => {
  const db = { trafficChannels: [] }
  const user = { id: 'U1', registerChannelCode: 'lijin1', registerChannelName: '丽金1' }

  applyUserRegisterChannel(db, user, '')

  assert.equal(Object.hasOwn(user, 'registerChannelCode'), false)
  assert.equal(Object.hasOwn(user, 'registerChannelName'), false)
})

test('rejects missing or disabled traffic channel codes', () => {
  assert.throws(
    () => applyUserRegisterChannel({ trafficChannels: [] }, { id: 'U1' }, 'missing'),
    /register_channel_not_found/,
  )

  assert.throws(
    () => applyUserRegisterChannel(
      { trafficChannels: [{ code: 'disabled', name: '禁用', disabled: true }] },
      { id: 'U1' },
      'disabled',
    ),
    /register_channel_disabled/,
  )
})
