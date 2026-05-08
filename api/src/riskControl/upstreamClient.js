const crypto = require('node:crypto')
const { stableStringify, computeSign } = require('./signing')

function randomNostr() {
  return crypto.randomBytes(16).toString('hex')
}

function getUpstreamCredentials() {
  const baseUrl = String(process.env.RISK_UPSTREAM_BASE_URL || '').trim()
  const appid = String(process.env.RISK_UPSTREAM_APP_ID || '').trim()
  const appkey = String(process.env.RISK_UPSTREAM_APP_KEY || '').trim()
  return { baseUrl, appid, appkey }
}

/** 上游 BASE_URL + APP_ID + APP_KEY 已配置时可调用任一转发接口 */
function isRiskUpstreamConfigured() {
  const c = getUpstreamCredentials()
  return !!(c.baseUrl && c.appid && c.appkey)
}

const isUpstreamCourtDetailConfigured = isRiskUpstreamConfigured

function normalizeApiPath(envKey, defaultPath) {
  const p = String(process.env[envKey] || defaultPath).trim()
  return p.startsWith('/') ? p : `/${p}`
}

function courtDetailProPath() {
  return normalizeApiPath('RISK_UPSTREAM_COURT_DETAIL_PATH', '/api/risk.v4/courtDetailPro')
}

function executionProPath() {
  return normalizeApiPath('RISK_UPSTREAM_EXECUTION_PRO_PATH', '/api/risk.v4/executionPro')
}

function probeCEncPath() {
  return normalizeApiPath('RISK_UPSTREAM_PROBE_C_ENC_PATH', '/api/risk.V5/probeCEnc')
}

function radarV4EncPath() {
  return normalizeApiPath('RISK_UPSTREAM_RADAR_V4_ENC_PATH', '/api/risk.V5/radarV4Enc')
}

function ocrIdentifyPath() {
  return normalizeApiPath('RISK_UPSTREAM_OCR_IDENTIFY_PATH', '/api/sign/ocrIdentify')
}

function personal3Path() {
  return normalizeApiPath('RISK_UPSTREAM_PERSONAL3_PATH', '/api/datapay/personal3')
}

function dsPhoneTimePath() {
  return normalizeApiPath('RISK_UPSTREAM_DS_PHONE_TIME_PATH', '/api/risk/dsPhoneTime')
}

function dsPhoneStatePath() {
  return normalizeApiPath('RISK_UPSTREAM_DS_PHONE_STATE_PATH', '/api/risk/dsPhoneState')
}

function mobile2Path() {
  return normalizeApiPath('RISK_UPSTREAM_MOBILE2_PATH', '/api/datapay/mobile2')
}

function authPersonMobile3Path() {
  return normalizeApiPath('RISK_UPSTREAM_AUTH_PERSON_MOBILE3_PATH', '/api/sign/authPersonMobile3')
}

function authCompanyMobile3Path() {
  return normalizeApiPath('RISK_UPSTREAM_AUTH_COMPANY_MOBILE3_PATH', '/api/sign/authCompanyMobile3')
}

function captchaVerifyPath() {
  return normalizeApiPath('RISK_UPSTREAM_CAPTCHA_VERIFY_PATH', '/api/sign/captchaVerify')
}

function captchaResendPath() {
  return normalizeApiPath('RISK_UPSTREAM_CAPTCHA_RESEND_PATH', '/api/sign/captchaResend')
}

function getAuthRecordInfoPath() {
  return normalizeApiPath('RISK_UPSTREAM_GET_AUTH_RECORD_INFO_PATH', '/api/sign/getAuthRecordInfo')
}

function authPersonFacePath() {
  return normalizeApiPath('RISK_UPSTREAM_AUTH_PERSON_FACE_PATH', '/api/sign/authPersonFace')
}

function userFaceResultPath() {
  return normalizeApiPath('RISK_UPSTREAM_USER_FACE_RESULT_PATH', '/api/sign/userFaceResult')
}

function addPersonalUserPath() {
  return normalizeApiPath('RISK_UPSTREAM_ADD_PERSONAL_USER_PATH', '/api/sign/addPersonalUser')
}

function addEnterpriseUserPath() {
  return normalizeApiPath('RISK_UPSTREAM_ADD_ENTERPRISE_USER_PATH', '/api/sign/addEnterpriseUser')
}

function createContractPath() {
  return normalizeApiPath('RISK_UPSTREAM_CREATE_CONTRACT_PATH', '/api/sign/createContract')
}

function addSignerPath() {
  return normalizeApiPath('RISK_UPSTREAM_ADD_SIGNER_PATH', '/api/sign/addSigner')
}

function getContractPath() {
  return normalizeApiPath('RISK_UPSTREAM_GET_CONTRACT_PATH', '/api/sign/getContract')
}

function downloadContractPath() {
  return normalizeApiPath('RISK_UPSTREAM_DOWNLOAD_CONTRACT_PATH', '/api/sign/downloadContract')
}

function clSmsSendPath() {
  return normalizeApiPath('RISK_UPSTREAM_CL_SMS_SEND_PATH', '/api/clSms/send')
}

function clSmsNotifyPath() {
  return normalizeApiPath('RISK_UPSTREAM_CL_SMS_NOTIFY_PATH', '/api/clSms/notify')
}

function upstreamTimeoutMs() {
  const n = Number(process.env.RISK_UPSTREAM_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 60000
}

function joinUrl(baseUrl, path) {
  const base = String(baseUrl || '').replace(/\/+$/, '')
  const p = String(path || '').startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}

/**
 * 按上游约定构造 POST body：time（秒级字符串）、nostr、appid、sign、data。
 * sign = md5(appid#jsonData#time#appkey#nostr)，jsonData = stableStringify(data)。
 */
async function postSignedUpstream(relPath, data) {
  const { baseUrl, appid, appkey } = getUpstreamCredentials()
  if (!baseUrl || !appid || !appkey) {
    const err = new Error('upstream_not_configured')
    err.code = 'upstream_not_configured'
    throw err
  }

  const url = joinUrl(baseUrl, relPath)
  const time = String(Math.floor(Date.now() / 1000))
  const nostr = randomNostr()
  let jsonData
  try {
    jsonData = stableStringify(data === undefined ? {} : data)
  }
  catch (e) {
    const err = new Error('stable_stringify_failed')
    err.code = 'stable_stringify_failed'
    err.cause = e
    throw err
  }

  const sign = computeSign(appid, jsonData, time, appkey, nostr)
  const payload = {
    time,
    nostr,
    appid,
    sign,
    data,
  }

  const ms = upstreamTimeoutMs()
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: ac.signal,
    })
    const text = await res.text()
    let json = null
    if (text) {
      try {
        json = JSON.parse(text)
      }
      catch {
        json = null
      }
    }
    return { ok: res.ok, status: res.status, json, text }
  }
  finally {
    clearTimeout(timer)
  }
}

function postCourtDetailPro(data) {
  return postSignedUpstream(courtDetailProPath(), data)
}

function postExecutionPro(data) {
  return postSignedUpstream(executionProPath(), data)
}

function postProbeCEnc(data) {
  return postSignedUpstream(probeCEncPath(), data)
}

function postRadarV4Enc(data) {
  return postSignedUpstream(radarV4EncPath(), data)
}

function postOcrIdentify(data) {
  return postSignedUpstream(ocrIdentifyPath(), data)
}

function postPersonal3(data) {
  return postSignedUpstream(personal3Path(), data)
}

function postDsPhoneTime(data) {
  return postSignedUpstream(dsPhoneTimePath(), data)
}

function postDsPhoneState(data) {
  return postSignedUpstream(dsPhoneStatePath(), data)
}

function postMobile2(data) {
  return postSignedUpstream(mobile2Path(), data)
}

function postAuthPersonMobile3(data) {
  return postSignedUpstream(authPersonMobile3Path(), data)
}

function postAuthCompanyMobile3(data) {
  return postSignedUpstream(authCompanyMobile3Path(), data)
}

function postCaptchaVerify(data) {
  return postSignedUpstream(captchaVerifyPath(), data)
}

function postCaptchaResend(data) {
  return postSignedUpstream(captchaResendPath(), data)
}

function postGetAuthRecordInfo(data) {
  return postSignedUpstream(getAuthRecordInfoPath(), data)
}

function postAuthPersonFace(data) {
  return postSignedUpstream(authPersonFacePath(), data)
}

function postUserFaceResult(data) {
  return postSignedUpstream(userFaceResultPath(), data)
}

function postAddPersonalUser(data) {
  return postSignedUpstream(addPersonalUserPath(), data)
}

function postAddEnterpriseUser(data) {
  return postSignedUpstream(addEnterpriseUserPath(), data)
}

function postCreateContract(data) {
  return postSignedUpstream(createContractPath(), data)
}

function postAddSigner(data) {
  return postSignedUpstream(addSignerPath(), data)
}

function postGetContract(data) {
  return postSignedUpstream(getContractPath(), data)
}

function postDownloadContract(data) {
  return postSignedUpstream(downloadContractPath(), data)
}

function postClSmsSend(data) {
  return postSignedUpstream(clSmsSendPath(), data)
}

function postClSmsNotify(data) {
  return postSignedUpstream(clSmsNotifyPath(), data)
}

module.exports = {
  isRiskUpstreamConfigured,
  isUpstreamCourtDetailConfigured,
  postSignedUpstream,
  postCourtDetailPro,
  postExecutionPro,
  postProbeCEnc,
  postRadarV4Enc,
  postOcrIdentify,
  postPersonal3,
  postDsPhoneTime,
  postDsPhoneState,
  postMobile2,
  postAuthPersonMobile3,
  postAuthCompanyMobile3,
  postCaptchaVerify,
  postCaptchaResend,
  postGetAuthRecordInfo,
  postAuthPersonFace,
  postUserFaceResult,
  postAddPersonalUser,
  postAddEnterpriseUser,
  postCreateContract,
  postAddSigner,
  postGetContract,
  postDownloadContract,
  postClSmsSend,
  postClSmsNotify,
  courtDetailProPath,
  executionProPath,
  probeCEncPath,
  radarV4EncPath,
  ocrIdentifyPath,
  personal3Path,
  dsPhoneTimePath,
  dsPhoneStatePath,
  mobile2Path,
  authPersonMobile3Path,
  authCompanyMobile3Path,
  captchaVerifyPath,
  captchaResendPath,
  getAuthRecordInfoPath,
  authPersonFacePath,
  userFaceResultPath,
  addPersonalUserPath,
  addEnterpriseUserPath,
  createContractPath,
  addSignerPath,
  getContractPath,
  downloadContractPath,
  clSmsSendPath,
  clSmsNotifyPath,
}
