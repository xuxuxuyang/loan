const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

test('admin username login checks core platform account before default tenant legacy copy', () => {
  const source = read('1.api/src/index.js')
  const start = source.indexOf('async function findAdminAccountByUsernameAcrossTenantsFromMongo')
  const end = source.indexOf('async function getAdminAccountByPhoneAcrossTenants', start)
  assert.ok(start >= 0, 'Mongo username login lookup function must exist')
  assert.ok(end > start, 'Mongo username login lookup function must have a bounded body')
  const body = source.slice(start, end)

  const coreLookup = body.indexOf("findAdminAccountByUsernameInMongoScoped('core', DEFAULT_TENANT_ID, key)")
  const tenantLookup = body.indexOf("findAdminAccountByUsernameInMongoScoped('tenant', preferred, key)")
  assert.ok(coreLookup >= 0, 'login must check core platform accounts')
  assert.ok(tenantLookup >= 0, 'login may still check preferred tenant accounts')
  assert.ok(coreLookup < tenantLookup, 'core platform account must win over stale default-tenant copies')
})

test('admin username login fallback checks core before default tenant in JSON mode too', () => {
  const source = read('1.api/src/index.js')
  const start = source.indexOf('async function getAdminAccountByUsernameAcrossTenants')
  const end = source.indexOf('async function isPlatformAdminBearerForWorkspace', start)
  assert.ok(start >= 0, 'JSON username login lookup function must exist')
  assert.ok(end > start, 'JSON username login lookup function must have a bounded body')
  const body = source.slice(start, end)

  const coreRead = body.indexOf('const dbCore = await readCoreDb({ forAdminAuth: true })')
  const tenantRead = body.indexOf('const dbPreferred = await readDbByTenantId(preferred, { forAdminAuth: true })')
  assert.ok(coreRead >= 0, 'login must read core platform accounts')
  assert.ok(tenantRead >= 0, 'login may still read preferred tenant accounts')
  assert.ok(coreRead < tenantRead, 'core platform account must win over stale default-tenant copies')
})