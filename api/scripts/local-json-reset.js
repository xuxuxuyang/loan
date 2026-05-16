/**
 * 删除 api/data/db.json 与按子系统命名的 db.{tenant}.json（ALLOW_JSON_FALLBACK 本地存储）。
 * npm run json:fresh
 */
const fs = require('node:fs')
const path = require('node:path')

const DB_DIR = path.join(__dirname, '..', 'data')

function main() {
  if (!fs.existsSync(DB_DIR)) {
    console.log('[json-fresh] 无 api/data 目录，跳过')
    return
  }
  let removed = 0
  for (const name of fs.readdirSync(DB_DIR)) {
    const isPrimary = name === 'db.json'
    const isTenant = /^db\.[a-z0-9_-]+\.json$/i.test(name)
    if (!isPrimary && !isTenant) {
      continue
    }
    try {
      fs.unlinkSync(path.join(DB_DIR, name))
      removed += 1
      console.log('[json-fresh] 已删除', name)
    }
    catch (err) {
      console.warn('[json-fresh] 删除失败', name + ':', err?.message || err)
    }
  }
  console.log('[json-fresh] 完成，共移除', removed, '个文件。若 mall-api 正在运行且使用 JSON 回退，请重启')
}

main()
