const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const apiRoot = path.resolve(__dirname, '..')

test('package scripts do not expose database reset or local snapshot import commands', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(apiRoot, 'package.json'), 'utf8'))
  const scripts = pkg.scripts || {}
  const forbidden = [
    'fresh',
    'reset:project',
    'mongo:fresh',
    'json:fresh',
    'import:mongo-local',
    'import:mall-seed',
  ]

  for (const name of forbidden) {
    assert.equal(Object.prototype.hasOwnProperty.call(scripts, name), false, `${name} must not exist`)
  }
})

test('dangerous reset/import scripts are not present in the repository', () => {
  const forbiddenFiles = [
    'scripts/import-local-to-mongo.js',
    'scripts/mongo-bootstrap-only.js',
    'scripts/project-full-reset.js',
    'scripts/local-json-reset.js',
    'scripts/import-mall-zone-seed.js',
    'scripts/seed-mall-showcase-catalog.js',
    'scripts/write-mall-zone-seed.js',
  ]

  for (const relativePath of forbiddenFiles) {
    assert.equal(fs.existsSync(path.join(apiRoot, relativePath)), false, `${relativePath} must not exist`)
  }
})

test('source code does not contain database reset or drop entrypoints', () => {
  const roots = ['src', 'scripts']
  const forbiddenPatterns = [
    /resetDb\b/,
    /dropAllMongoProjectDatabases\b/,
    /wipeAllMongoPersistence\b/,
    /importLocalSnapshotToMongo\b/,
    /removeTenantJsonStoreFile\b/,
    /\/admin\/reset-data/,
    /dropDatabase\s*\(/,
    /import:mongo-local/,
    /mongo:fresh/,
    /reset:project/,
    /json:fresh/,
  ]

  const files = []
  for (const root of roots) {
    const dir = path.join(apiRoot, root)
    if (!fs.existsSync(dir)) continue
    walk(dir, files)
  }

  for (const file of files) {
    const rel = path.relative(apiRoot, file)
    const text = fs.readFileSync(file, 'utf8')
    for (const pattern of forbiddenPatterns) {
      assert.equal(pattern.test(text), false, `${rel} contains forbidden pattern ${pattern}`)
    }
  }
})

function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, files)
    }
    else if (entry.isFile() && /\.(js|cjs|mjs|ts|json|md)$/.test(entry.name)) {
      files.push(full)
    }
  }
}
