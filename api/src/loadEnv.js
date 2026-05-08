/**
 * 加载顺序：先 api/.env，再项目根目录 .env；后者不覆盖已存在的变量，
 * 便于把 MONGODB_URI 写在根 .env（与 Nuxt 同目录），同时 api/.env 仍可覆盖。
 */
const path = require('node:path')
const dotenv = require('dotenv')

/** 调用方一般为 api/src 下的模块，传入 __dirname */
function loadDotenvExports(entryDirname) {
  const apiEnv = path.join(entryDirname, '..', '.env')
  dotenv.config({ path: apiEnv })
  const rootEnv = path.join(entryDirname, '..', '..', '.env')
  dotenv.config({ path: rootEnv })
}

module.exports = { loadDotenvExports }
