/**
 * 主配置写在 api/.env.development 与 api/.env.production（由 NODE_ENV 决定读哪一个）。
 * 加载顺序（后者仅在「允许覆盖」时改写已有键）：
 * 1. api/.env.${NODE_ENV} — 主配置；NODE_ENV 未设置时视为 development
 * 2. api/.env — 可选：仅补充上一步未出现的键（兼容旧仓库单文件 .env）
 * 3. api/.env.local — 可选：本机敏感覆盖（勿提交）
 * 4. 仓库根目录 .env — 仅补充尚未出现的键（与 monorepo 其它包共用）
 */
const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')

const PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
]
const REQUIRED_NO_PROXY = ['127.0.0.1', 'localhost', '.aliyuncs.com']

function fileExists(p) {
  try {
    fs.accessSync(p, fs.constants.R_OK)
    return true
  }
  catch {
    return false
  }
}

function hardenProxyEnv() {
  for (const key of PROXY_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(process.env, key)) {
      delete process.env[key]
    }
  }
  const existed = String(process.env.NO_PROXY || process.env.no_proxy || '').trim()
  const merged = [...new Set([...existed.split(',').map(s => s.trim()).filter(Boolean), ...REQUIRED_NO_PROXY])]
  const noProxy = merged.join(',')
  process.env.NO_PROXY = noProxy
  process.env.no_proxy = noProxy
}

/** 调用方一般为 api/src 下的模块，传入 __dirname */
function loadDotenvExports(entryDirname) {
  const apiRoot = path.join(entryDirname, '..')
  const mode = String(process.env.NODE_ENV || 'development').trim() || 'development'
  const modePath = path.join(apiRoot, `.env.${mode}`)
  const basePath = path.join(apiRoot, '.env')
  const localPath = path.join(apiRoot, '.env.local')
  const rootEnv = path.join(entryDirname, '..', '..', '.env')

  if (fileExists(modePath)) {
    dotenv.config({ path: modePath, override: false })
  }
  if (fileExists(basePath)) {
    dotenv.config({ path: basePath, override: false })
  }
  if (fileExists(localPath)) {
    dotenv.config({ path: localPath, override: true })
  }
  if (fileExists(rootEnv)) {
    dotenv.config({ path: rootEnv, override: false })
  }
  hardenProxyEnv()
}

module.exports = { loadDotenvExports }
