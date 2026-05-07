const path = require('path')

function trimTrailingSlash(url) {
  return String(url || '').trim().replace(/\/+$/, '')
}

function readEnv(primary, aliases = []) {
  const keys = [primary, ...aliases]
  for (const key of keys) {
    const raw = process.env[key]
    if (raw !== undefined && String(raw).trim() !== '') {
      return String(raw).trim()
    }
  }
  return ''
}

/**
 * 华东云开放接口基础配置（环境变量）。
 * 详见 api/.env.example
 */
function getCloudConfig() {
  const baseUrl = trimTrailingSlash(
    readEnv('HD_CLOUD_BASE_URL', ['CLOUD_API_BASE_URL', 'HD_CLOUD_HOST']),
  )
  const appId = readEnv('HD_CLOUD_APP_ID', ['CLOUD_APP_ID'])
  const appKey = readEnv('HD_CLOUD_APP_KEY', ['CLOUD_APP_KEY'])
  return { baseUrl, appId, appKey }
}

function isCloudConfigured() {
  const { baseUrl, appId, appKey } = getCloudConfig()
  return Boolean(baseUrl && appId && appKey)
}

/** 供健康检查等场景展示，不包含 appKey */
function getCloudConfigSummary() {
  const { baseUrl, appId } = getCloudConfig()
  const configured = isCloudConfigured()
  const appIdPreview = appId && appId.length > 6 ? `${appId.slice(0, 6)}…` : appId ? '(已配置)' : ''
  return {
    configured,
    baseUrl: baseUrl || null,
    appIdPreview: configured ? appIdPreview : null,
  }
}

function resolveEnvPath() {
  return path.join(__dirname, '..', '.env')
}

module.exports = {
  getCloudConfig,
  isCloudConfigured,
  getCloudConfigSummary,
  resolveEnvPath,
}
