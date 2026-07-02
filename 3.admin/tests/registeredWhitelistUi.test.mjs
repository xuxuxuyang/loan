import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const app = fs.readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const router = fs.readFileSync(new URL('../src/router/index.ts', import.meta.url), 'utf8')
const permissions = fs.readFileSync(new URL('../src/composables/useAdminPermissions.ts', import.meta.url), 'utf8')
const usersPage = fs.readFileSync(new URL('../src/views/UsersPage.vue', import.meta.url), 'utf8')

test('registered whitelist is a sibling readonly menu route', () => {
  assert.match(app, /label: '注册白名单', path: '\/users\/registered-whitelist'/)
  assert.match(router, /path: '\/users\/registered-whitelist'[\s\S]*name: 'users-registered-whitelist'[\s\S]*permissionKey: 'users\.registeredWhitelist'/)
  assert.match(permissions, /'\/users\/registered-whitelist': 'users\.registeredWhitelist'/)
  assert.match(permissions, /'users\.registeredWhitelist': \{ name: 'users-registered-whitelist', path: '\/users\/registered-whitelist' \}/)
})

test('registered whitelist page requests dedicated view and hides write actions', () => {
  assert.match(usersPage, /isRegisteredWhitelistUsersView = computed\(\(\) => route\.path === '\/users\/registered-whitelist'\)/)
  assert.match(usersPage, /params\.set\('view', 'registered-whitelist'\)/)
  assert.match(usersPage, /canEditUsers = computed\(\(\) => !isRegisteredWhitelistUsersView\.value/)
  assert.match(usersPage, /canSetQuotaInCurrentView = computed\(\(\) => canSetQuota\.value && !readOnlyListView\.value\)/)
  assert.match(usersPage, /canRemarkInCurrentView = computed\(\(\) => canRemark\.value && !readOnlyListView\.value\)/)
  assert.match(usersPage, /canBlacklistInCurrentView = computed\(\(\) => canBlacklist\.value && !readOnlyListView\.value\)/)
  assert.match(usersPage, /canDeleteUserInCurrentView = computed\(\(\) => canDeleteUser\.value && !readOnlyListView\.value\)/)
})