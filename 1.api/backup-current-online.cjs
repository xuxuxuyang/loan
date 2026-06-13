const fs = require('fs')
const path = require('path')
const { MongoClient, EJSON } = require('mongodb')

function readEnvValue(file, key) {
  const text = fs.readFileSync(file, 'utf8')
  const m = text.match(new RegExp('^' + key + '=(.*)$', 'm'))
  return m ? m[1].trim() : ''
}

const uri = readEnvValue('.env.production', 'MONGODB_URI') || readEnvValue('.env.development', 'MONGODB_URI')
if (!uri) throw new Error('MONGODB_URI not found')

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '').replace('T', '-')
const outRoot = path.resolve('..', 'beifen', `tencent-live-emergency-${stamp}`)
fs.mkdirSync(outRoot, { recursive: true })

const dbNames = ['mall', 'mall__core', 'mall__self', 'mall__tenant_admin', 'mall__tenant_default_tenant', 'mall__tenant_www']
const manifest = { createdAt: new Date().toISOString(), source: 'current-online-tencent-via-local-tunnel', outRoot, dbs: {} }

;(async () => {
  const client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 8000 })
  try {
    for (const dbName of dbNames) {
      const db = client.db(dbName)
      const cols = await db.listCollections().toArray()
      const dbDir = path.join(outRoot, dbName)
      fs.mkdirSync(dbDir, { recursive: true })
      manifest.dbs[dbName] = {}
      for (const col of cols.map(c => c.name).sort()) {
        const docs = await db.collection(col).find({}).toArray()
        const file = path.join(dbDir, `${col}.ejson`)
        fs.writeFileSync(file, EJSON.stringify(docs, { relaxed: false }, 2), 'utf8')
        manifest.dbs[dbName][col] = { count: docs.length, file: path.relative(outRoot, file) }
        console.log(`dumped ${dbName}.${col}: ${docs.length}`)
      }
    }
    fs.writeFileSync(path.join(outRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
    console.log('BACKUP_OK=' + outRoot)
  } finally {
    await client.close()
  }
})().catch(e => { console.error('BACKUP_FAILED:', e.message); process.exit(1) })

