const crypto = require('node:crypto')
const { stableStringify, computeSign } = require('./signing')

function randomNostr() {
  return crypto.randomBytes(16).toString('hex')
}

/** 华东云 probeCEnc / radarV4Enc（MD5 版）要求三项为 32 位小写 MD5；已为 MD5 的入参不再二次哈希 */
const MD5_32_HEX_RE = /^[a-fA-F0-9]{32}$/

function md5Lower32(str) {
  return crypto.createHash('md5').update(String(str ?? '').trim(), 'utf8').digest('hex')
}

function normalizeTripleForMd5RiskApi(data) {
  if (!data || typeof data !== 'object') return data
  const idNumber = String(data.idNumber ?? '').trim()
  const userName = String(data.userName ?? '').trim()
  const phoneNumber = String(data.phoneNumber ?? '').trim()
  const pick = s => (MD5_32_HEX_RE.test(s) ? s.toLowerCase() : md5Lower32(s))
  return {
    idNumber: pick(idNumber),
    userName: pick(userName),
    phoneNumber: pick(phoneNumber),
  }
}

function getUpstreamCredentials() {
  let baseUrl = String(process.env.RISK_UPSTREAM_BASE_URL || '').trim()
  let appid = String(process.env.RISK_UPSTREAM_APP_ID || '').trim()
  let appkey = String(process.env.RISK_UPSTREAM_APP_KEY || '').trim()
  // 与华东云文档一致：仅配 HD_CLOUD_* 时也视为已配置上游（避免重复填写两套变量）
  if (!baseUrl || !appid || !appkey) {
    const altBase = String(
      process.env.HD_CLOUD_BASE_URL || process.env.CLOUD_API_BASE_URL || process.env.HD_CLOUD_HOST || '',
    ).trim().replace(/\/+$/, '')
    const altId = String(process.env.HD_CLOUD_APP_ID || process.env.CLOUD_APP_ID || '').trim()
    const altKey = String(process.env.HD_CLOUD_APP_KEY || process.env.CLOUD_APP_KEY || '').trim()
    baseUrl = baseUrl || altBase
    appid = appid || altId
    appkey = appkey || altKey
  }
  return { baseUrl, appid, appkey }
}

/** 上游 BASE_URL + APP_ID + APP_KEY 已配置时可调用任一转发接口 */
function isRiskUpstreamConfigured() {
  const c = getUpstreamCredentials()
  return !!(c.baseUrl && c.appid && c.appkey)
}

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
  return postSignedUpstream(probeCEncPath(), normalizeTripleForMd5RiskApi(data))
}

function postRadarV4Enc(data) {
  return postSignedUpstream(radarV4EncPath(), normalizeTripleForMd5RiskApi(data))
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

/** 验证码类短信：data 为 { phone, msg }（msg 为完整正文，含签名；商城注册见 mallRegisterSms） */
function postClSmsSend(data) {
  return postSignedUpstream(clSmsSendPath(), data)
}

function postClSmsNotify(data) {
  return postSignedUpstream(clSmsNotifyPath(), data)
}

/**
 * 通道层：HTTP 可达且信封层未明确声明失败（不等同于「信誉通过」，结论仅看各 judge）。
 * 供内部直接调用 postSignedUpstream / postClSmsSend 等结果解析复用。
 */
function orderRiskChannelAndEnvelopeOk(res) {
  if (!res || res.ok === false) {
    return { ok: false, reason: `请求失败（HTTP ${res && res.status != null ? res.status : '--'}）` }
  }
  const j = res.json
  if (j == null || typeof j !== 'object') {
    return { ok: false, reason: '响应非 JSON，无法读取信誉结论' }
  }
  if (Object.prototype.hasOwnProperty.call(j, 'success') && j.success === true) {
    return { ok: true, reason: '' }
  }
  if (Object.prototype.hasOwnProperty.call(j, 'success') && j.success === false) {
    return { ok: false, reason: String(j.msg || j.message || j.Message || j.info || j.Info || '上游 success:false') }
  }
  const c = j.code ?? j.Code ?? j.errCode
  if (c !== undefined && c !== null && String(c).trim() !== '') {
    const cn = Number(c)
    const msgcodeSuffix = (() => {
      const mc = j.msgcode ?? j.msgCode
      if (mc === undefined || mc === null || String(mc).trim() === '') {
        return ''
      }
      return ` msgcode=${String(mc).trim()}`
    })()
    if (!Number.isNaN(cn) && cn >= 400) {
      const base = String(j.msg || j.message || j.Message || j.info || j.Info || '').trim()
      return { ok: false, reason: base ? `${base}${msgcodeSuffix}` : `上游业务码 ${c}${msgcodeSuffix}` }
    }
    const cs = String(c).trim().toLowerCase()
    const badStr = new Set(['fail', 'false', 'error', '-1'])
    if (badStr.has(cs)) {
      const base = String(j.msg || j.message || j.Message || j.info || j.Info || '').trim()
      return { ok: false, reason: base ? `${base}${msgcodeSuffix}` : `上游业务码 ${c}${msgcodeSuffix}` }
    }
  }
  return { ok: true, reason: '' }
}

function dataLayerExplicitError(data) {
  if (!data || typeof data !== 'object') {
    return ''
  }
  const e = data.error ?? data.errMsg ?? data.err_msg ?? data.errMessage ?? data.err_message
  if (typeof e === 'string' && e.trim()) {
    return e.trim().slice(0, 200)
  }
  return ''
}

function judgeMobile2Pass(json) {
  const d = json && json.data
  if (!d || typeof d !== 'object') {
    return { ok: false, reason: '二要素：无业务数据，无法确认机主与姓名一致' }
  }
  const layerErr = dataLayerExplicitError(d)
  if (layerErr) {
    return { ok: false, reason: `运营商二要素：${layerErr}` }
  }
  const r = d.result !== undefined && d.result !== null ? String(d.result).trim() : ''
  if (r === '1') {
    return { ok: true }
  }
  const match = d.match ?? d.isMatch ?? d.consistent
  if (match === true || match === 1 || match === '1' || String(match).toLowerCase() === 'true') {
    return { ok: true }
  }
  if (r === '2') {
    return { ok: false, reason: '运营商二要素：姓名与手机号不一致（信誉不一致）' }
  }
  if (r === '3') {
    return { ok: false, reason: '运营商二要素：核验异常或无结果' }
  }
  return { ok: false, reason: '运营商二要素：无有效核验结论' }
}

function judgeDsPhoneTimePass(json) {
  const d = json && json.data
  if (!d || typeof d !== 'object') {
    return { ok: false, reason: '在网时长：无业务数据，无法确认号码信誉' }
  }
  const layerErr = dataLayerExplicitError(d)
  if (layerErr) {
    return { ok: false, reason: `在网时长：${layerErr}` }
  }
  const riskHit = d.risk_hit ?? d.riskHit ?? d.hit_risk ?? d.riskFlag
  if (riskHit === true || riskHit === 1 || riskHit === '1') {
    return { ok: false, reason: '在网时长：命中风险标识' }
  }
  const t = d.time ?? d.bucket ?? d.monthsInNetwork
  if (t !== undefined && t !== null && String(t).trim() !== '') {
    return { ok: true }
  }
  return { ok: false, reason: '在网时长：无有效区间，无法确认在网信誉' }
}

function judgeDsPhoneStatePass(json) {
  const d = json && json.data
  if (!d || typeof d !== 'object') {
    return { ok: false, reason: '运营商状态：无业务数据' }
  }
  const layerErr = dataLayerExplicitError(d)
  if (layerErr) {
    return { ok: false, reason: `运营商状态：${layerErr}` }
  }
  const s = d.state !== undefined && d.state !== null ? String(d.state).trim() : ''
  if (s === '0') {
    return { ok: true }
  }
  if (s === '1') {
    return { ok: false, reason: '运营商状态：停机（影响履约信誉）' }
  }
  if (s === '2') {
    return { ok: false, reason: '运营商状态：在网不可用' }
  }
  return { ok: false, reason: '运营商状态：无法确认为正常在网' }
}

function judgeCourtDetailProPass(json) {
  const data = json && json.data
  if (!data || typeof data !== 'object') {
    return { ok: false, reason: '法院信息：无业务数据' }
  }
  const layerErr = dataLayerExplicitError(data)
  if (layerErr) {
    return { ok: false, reason: `法院信息：${layerErr}` }
  }
  if (data.hit === true || data.hit === 1 || data.hit === '1') {
    return { ok: false, reason: '法院信息：命中公开涉诉' }
  }
  const cd = data.CourtDetail || data.courtDetail || data.court_detail
  const countRaw = cd && typeof cd === 'object' ? cd.count : data.caseCount
  const countNum = Number(countRaw)
  const entryRaw = cd && typeof cd === 'object' ? cd.entryList || cd.entry_list : data.entryList
  const listLen = Array.isArray(entryRaw) ? entryRaw.length : 0
  if (Number.isFinite(countNum) && countNum > 0) {
    return { ok: false, reason: `法院信息：涉诉案件数 ${countNum}` }
  }
  if (listLen > 0) {
    return { ok: false, reason: '法院信息：存在涉诉记录' }
  }
  return { ok: true }
}

function judgeExecutionProPass(json) {
  const data = json && json.data
  if (!data || typeof data !== 'object') {
    return { ok: false, reason: '被执行人：无业务数据' }
  }
  const layerErr = dataLayerExplicitError(data)
  if (layerErr) {
    return { ok: false, reason: `被执行人：${layerErr}` }
  }
  if (data.executedHit === true || data.executedHit === 1 || data.executedHit === '1') {
    return { ok: false, reason: '被执行人：命中记录' }
  }
  const rule = data.Rule || data.rule
  if (rule && typeof rule === 'object' && rule.result !== undefined && rule.result !== null) {
    const rr = String(rule.result).toLowerCase()
    if (rr === '1' || rr === 'true' || rr === 'hit') {
      return { ok: false, reason: '被执行人：规则命中' }
    }
  }
  const ex = data.ExecutionPro || data.executionPro || data.execution_pro || data.Execution
  const countRaw = ex && typeof ex === 'object' ? ex.count : data.caseCount
  const countNum = Number(countRaw)
  const entryRaw = ex && typeof ex === 'object' ? ex.entryList || ex.entry_list : data.entryList
  const listLen = Array.isArray(entryRaw) ? entryRaw.length : 0
  if (Number.isFinite(countNum) && countNum > 0) {
    return { ok: false, reason: `被执行人：记录数 ${countNum}` }
  }
  if (listLen > 0) {
    return { ok: false, reason: '被执行人：存在记录' }
  }
  return { ok: true }
}

function judgePersonal3Pass(json) {
  const d = json && json.data
  if (!d || typeof d !== 'object') {
    return { ok: false, reason: '个人三要素：无业务数据' }
  }
  const layerErr = dataLayerExplicitError(d)
  if (layerErr) {
    return { ok: false, reason: `个人三要素：${layerErr}` }
  }
  const r = d.result !== undefined && d.result !== null ? String(d.result).trim() : ''
  if (r === '1') {
    return { ok: true }
  }
  if (r === '2') {
    return { ok: false, reason: '个人三要素：不一致（实名信誉不通过）' }
  }
  if (r === '0') {
    return { ok: false, reason: '个人三要素：无法核验或异常' }
  }
  return { ok: false, reason: '个人三要素：无有效结论' }
}

function normalizeAccExcForProbe(ae) {
  if (ae === undefined || ae === null || ae === false) {
    return null
  }
  if (ae === 0 || ae === '0' || ae === '') {
    return null
  }
  if (typeof ae === 'object' && !Array.isArray(ae) && Object.keys(ae).length === 0) {
    return null
  }
  return ae
}

function judgeProbeCEncPass(json) {
  const d = json && json.data
  if (!d || typeof d !== 'object') {
    return { ok: false, reason: '探针C：无业务数据，无法确认资信' }
  }
  const layerErr = dataLayerExplicitError(d)
  if (layerErr) {
    return { ok: false, reason: `探针C：${layerErr}` }
  }
  const od = d.currently_overdue ?? d.currentlyOverdue
  if (od === true || od === 1 || od === '1' || String(od).toLowerCase() === 'true') {
    return { ok: false, reason: '探针C：当前逾期（信誉不通过）' }
  }
  const ae = normalizeAccExcForProbe(d.acc_exc ?? d.accExc)
  if (ae != null) {
    return { ok: false, reason: '探针C：存在资信异常标识(acc_exc)' }
  }
  return { ok: true }
}

/** 先享后付下单七步校验顺序（与 runOrderSubmitUpstreamRiskPack 一致） */
const ORDER_INSTALLMENT_RISK_STEP_KEYS = Object.freeze([
  'mobile2',
  'ds_phone_time',
  'ds_phone_state',
  'court_detail_pro',
  'execution_pro',
  'personal3',
  'probe_c_enc',
])

const ORDER_INSTALLMENT_RISK_STEP_LABELS = {
  mobile2: '运营商二要素验证',
  ds_phone_time: '手机号在网时长',
  ds_phone_state: '运营商状态',
  court_detail_pro: '法院信息-个人高级版',
  execution_pro: '法院被执行人-高级版',
  personal3: '个人三要素对比',
  probe_c_enc: '探针C-MD5',
}

/**
 * 执行单步先享后付下单风控（供商城分步请求与 pack 共用）。
 * @param {string} stepKey
 * @param {{ userName: string, phoneNumber: string, idNumber: string }} params
 * @returns {Promise<{ ok: boolean, step: Record<string, unknown> }>}
 */
async function runOrderSubmitSingleRiskStep(stepKey, params) {
  const label = ORDER_INSTALLMENT_RISK_STEP_LABELS[stepKey] || stepKey
  const userName = String(params.userName || '').trim()
  const phoneNumber = String(params.phoneNumber || '').trim()
  let idNumber = String(params.idNumber || '').trim()
  const placeholder = String(process.env.RISK_PRELIMINARY_PLACEHOLDER_ID || '').trim()
  if (!idNumber && placeholder) {
    idNumber = placeholder
  }
  if (!userName || !phoneNumber || !idNumber) {
    return {
      ok: false,
      step: {
        key: stepKey,
        label,
        ok: false,
        error: '缺少姓名、手机号或身份证号',
      },
    }
  }
  if (!ORDER_INSTALLMENT_RISK_STEP_KEYS.includes(stepKey)) {
    return {
      ok: false,
      step: { key: stepKey, label, ok: false, error: '未知风控步骤' },
    }
  }

  if (!isRiskUpstreamConfigured()) {
    const skip = String(process.env.RISK_ORDER_SUBMIT_SKIP_UPSTREAM || '').trim() === '1'
    if (skip) {
      return {
        ok: true,
        step: {
          key: stepKey,
          label,
          ok: true,
          skipped: true,
          reason: 'RISK_ORDER_SUBMIT_SKIP_UPSTREAM=1 跳过上游（仅本地调试）',
        },
      }
    }
    return {
      ok: false,
      step: {
        key: stepKey,
        label,
        ok: false,
        error: '未配置风控上游（RISK_UPSTREAM_* 或 HD_CLOUD_*）',
      },
    }
  }

  const triple = { userName, phoneNumber, idNumber }
  const personalPayload = { name: userName, id_card: idNumber, mobile: phoneNumber }

  /** @type {() => Promise<{ ok?: boolean, status?: number, json?: unknown }>} */
  let fn
  /** @type {(json: unknown) => { ok: boolean, reason?: string }} */
  let judge
  switch (stepKey) {
    case 'mobile2':
      fn = () => postMobile2({ name: userName, mobile: phoneNumber })
      judge = judgeMobile2Pass
      break
    case 'ds_phone_time':
      fn = () => postDsPhoneTime({ phoneNumber })
      judge = judgeDsPhoneTimePass
      break
    case 'ds_phone_state':
      fn = () => postDsPhoneState({ phoneNumber })
      judge = judgeDsPhoneStatePass
      break
    case 'court_detail_pro':
      fn = () => postCourtDetailPro(triple)
      judge = judgeCourtDetailProPass
      break
    case 'execution_pro':
      fn = () => postExecutionPro(triple)
      judge = judgeExecutionProPass
      break
    case 'personal3':
      fn = () => postPersonal3(personalPayload)
      judge = judgePersonal3Pass
      break
    case 'probe_c_enc':
      fn = () => postProbeCEnc(triple)
      judge = judgeProbeCEncPass
      break
    default:
      return {
        ok: false,
        step: { key: stepKey, label, ok: false, error: '未知风控步骤' },
      }
  }

  let res
  try {
    res = await fn()
  }
  catch (err) {
    return {
      ok: false,
      step: {
        key: stepKey,
        label,
        ok: false,
        error: String(err && err.message ? err.message : err),
      },
    }
  }
  const ch = orderRiskChannelAndEnvelopeOk(res)
  if (!ch.ok) {
    return {
      ok: false,
      step: {
        key: stepKey,
        label,
        ok: false,
        httpStatus: res.status,
        response: res.json,
        error: ch.reason || '通道或信封层失败',
      },
    }
  }
  const verdict = judge(res.json)
  return {
    ok: verdict.ok,
    step: {
      key: stepKey,
      label,
      ok: verdict.ok,
      httpStatus: res.status,
      response: res.json,
      error: verdict.ok ? undefined : verdict.reason,
    },
  }
}

/**
 * 订单提交专用：顺序调用 7 项上游风控；**通过=返回体信誉结论无问题**（非仅 HTTP 成功）。
 * 1 运营商二要素 2 在网时长 3 运营商状态 4 法院信息个人高级版 5 法院被执行人高级版 6 个人三要素 7 探针C-MD5
 * @param {{ userName?: string, phoneNumber?: string, idNumber?: string }} params
 * @returns {Promise<{ allPassed: boolean, message: string, steps: Array<Record<string, unknown>>, skipped?: boolean }>}
 */
async function runOrderSubmitUpstreamRiskPack(params) {
  const userName = String(params.userName || '').trim()
  const phoneNumber = String(params.phoneNumber || '').trim()
  let idNumber = String(params.idNumber || '').trim()
  const placeholder = String(process.env.RISK_PRELIMINARY_PLACEHOLDER_ID || '').trim()
  if (!idNumber && placeholder) {
    idNumber = placeholder
  }

  /** @type {Array<Record<string, unknown>>} */
  const steps = []

  if (!userName || !phoneNumber || !idNumber) {
    const msg = '缺少姓名、手机号或身份证号，无法完成系统审核'
    steps.push({
      key: 'order_risk_input',
      label: '下单风控入参',
      ok: false,
      error: msg,
    })
    return { allPassed: false, message: msg, steps }
  }

  if (!isRiskUpstreamConfigured()) {
    const skip = String(process.env.RISK_ORDER_SUBMIT_SKIP_UPSTREAM || '').trim() === '1'
    if (skip) {
      for (const key of ORDER_INSTALLMENT_RISK_STEP_KEYS) {
        steps.push({
          key,
          label: ORDER_INSTALLMENT_RISK_STEP_LABELS[key],
          ok: true,
          skipped: true,
          reason: 'RISK_ORDER_SUBMIT_SKIP_UPSTREAM=1 跳过上游（仅本地调试）',
        })
      }
      return {
        allPassed: true,
        message: '',
        steps,
        skipped: true,
      }
    }
    const msg = '未配置风控上游（RISK_UPSTREAM_* 或 HD_CLOUD_*），无法完成系统审核'
    steps.push({ key: 'upstream', label: '风控上游', ok: false, error: msg })
    return { allPassed: false, message: msg, steps }
  }

  const tripleParams = { userName, phoneNumber, idNumber }
  for (const key of ORDER_INSTALLMENT_RISK_STEP_KEYS) {
    const r = await runOrderSubmitSingleRiskStep(key, tripleParams)
    steps.push(r.step)
    if (!r.ok) {
      return { allPassed: false, message: String(r.step.error || '审核不通过'), steps }
    }
  }

  return { allPassed: true, message: '', steps }
}

module.exports = {
  isRiskUpstreamConfigured,
  orderRiskChannelAndEnvelopeOk,
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
  postClSmsSend,
  postClSmsNotify,
  runOrderSubmitUpstreamRiskPack,
  runOrderSubmitSingleRiskStep,
  ORDER_INSTALLMENT_RISK_STEP_KEYS,
  ORDER_INSTALLMENT_RISK_STEP_LABELS,
}
