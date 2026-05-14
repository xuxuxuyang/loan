const Router = require('@koa/router')
const { stableStringify, computeSign, timingSafeEqualHex } = require('./signing')
const {
  getAppKey,
  hasAnyCredential,
  REQUIRE_CONFIGURED,
} = require('./credentials')
const {
  isRiskUpstreamConfigured,
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
} = require('./upstreamClient')

const PREFIX = '/risk-api'

function parseTimestampMs(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return NaN
  // 兼容秒级时间戳（10 位）
  if (n > 0 && n < 1e12) {
    return Math.round(n * 1000)
  }
  return Math.round(n)
}

function defaultMaxSkewMs() {
  const sec = Number(process.env.RISK_CONTROL_TIMESTAMP_SKEW_SECONDS)
  const s = Number.isFinite(sec) && sec > 0 ? sec : 300
  return Math.round(s * 1000)
}

/** 校验签名；ctx.state.riskControl = { appid, time, rand, data }（rand 与 nostr 二选一） */
async function verifyRiskSignature(ctx, next) {
  if (REQUIRE_CONFIGURED && !hasAnyCredential()) {
    ctx.status = 503
    ctx.body = {
      success: false,
      code: 50301,
      msg: '风控开放接口未配置凭证（RISK_CONTROL_APP_ID / RISK_CONTROL_APP_KEY 或 RISK_CONTROL_CREDENTIALS_JSON）',
    }
    return
  }

  const body = ctx.request.body && typeof ctx.request.body === 'object'
    ? ctx.request.body
    : {}

  const appid = String(body.appid ?? '').trim()
  const timeRaw = body.time
  const rand = String(body.rand ?? body.nostr ?? '').trim()
  const sign = String(body.sign ?? '').trim()
  const data = body.data

  if (!appid || rand === '' || sign === '') {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40001,
      msg: '缺少 appid、rand/nostr 或 sign',
    }
    return
  }

  if (timeRaw === undefined || timeRaw === null || timeRaw === '') {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40002,
      msg: '缺少 time',
    }
    return
  }

  const timeMs = parseTimestampMs(timeRaw)
  if (!Number.isFinite(timeMs)) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40003,
      msg: 'time 格式无效',
    }
    return
  }

  const skew = defaultMaxSkewMs()
  const now = Date.now()
  if (Math.abs(now - timeMs) > skew) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40004,
      msg: `请求时间超出允许偏差（±${Math.round(skew / 1000)} 秒）`,
    }
    return
  }

  const appkey = getAppKey(appid)
  if (!appkey) {
    ctx.status = 403
    ctx.body = {
      success: false,
      code: 40301,
      msg: '无效的 appid',
    }
    return
  }

  let jsonData
  try {
    jsonData = stableStringify(data === undefined ? {} : data)
  }
  catch {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40005,
      msg: 'data 无法序列化为 jsonData',
    }
    return
  }

  const timeStr = String(timeRaw).trim()
  const expected = computeSign(appid, jsonData, timeStr, appkey, rand)
  if (!timingSafeEqualHex(sign, expected)) {
    ctx.status = 403
    ctx.body = {
      success: false,
      code: 40302,
      msg: '签名校验失败',
    }
    return
  }

  ctx.state.riskControl = {
    appid,
    time: timeStr,
    rand,
    data: data === undefined ? {} : data,
  }
  await next()
}

const router = new Router({ prefix: PREFIX })

async function runUpstreamProxy(ctx, upstreamFetch, payload) {
  if (!isRiskUpstreamConfigured()) {
    ctx.status = 503
    ctx.body = {
      success: false,
      code: 50302,
      msg: '未配置风控上游（RISK_UPSTREAM_BASE_URL、RISK_UPSTREAM_APP_ID、RISK_UPSTREAM_APP_KEY）',
    }
    return
  }

  try {
    const upstream = await upstreamFetch(payload)
    ctx.status = upstream.status || 502
    if (upstream.json !== null && upstream.json !== undefined) {
      ctx.body = upstream.json
      return
    }
    ctx.body = {
      success: false,
      code: 50201,
      msg: '上游返回非 JSON',
      raw: upstream.text && upstream.text.length > 2000
        ? `${upstream.text.slice(0, 2000)}…`
        : upstream.text,
    }
  }
  catch (err) {
    if (err && err.code === 'upstream_not_configured') {
      ctx.status = 503
      ctx.body = {
        success: false,
        code: 50302,
        msg: '未配置风控上游凭证',
      }
      return
    }
    const aborted = err && err.name === 'AbortError'
    ctx.status = aborted ? 504 : 502
    ctx.body = {
      success: false,
      code: aborted ? 50401 : 50202,
      msg: aborted ? '上游请求超时' : '调用风控上游失败',
      detail: String(err && err.message ? err.message : err),
    }
  }
}

/** idNumber / userName / phoneNumber 验签转发上游 */
async function forwardIdentityUpstream(ctx, upstreamFetch) {
  const data = ctx.state.riskControl.data || {}
  const idNumber = String(data.idNumber ?? '').trim()
  const userName = String(data.userName ?? '').trim()
  const phoneNumber = String(data.phoneNumber ?? '').trim()

  const missing = []
  if (!idNumber) missing.push('data.idNumber')
  if (!userName) missing.push('data.userName')
  if (!phoneNumber) missing.push('data.phoneNumber')
  if (missing.length) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: `缺少必填字段：${missing.join('、')}`,
    }
    return
  }

  const payload = { idNumber, userName, phoneNumber }
  await runUpstreamProxy(ctx, upstreamFetch, payload)
}

/** 身份证 OCR：data.image（图片 URL）、data.side（front | back） */
async function forwardOcrIdentify(ctx) {
  const data = ctx.state.riskControl.data || {}
  const image = String(data.image ?? '').trim()
  const sideNorm = String(data.side ?? '').trim().toLowerCase()

  const missing = []
  if (!image) missing.push('data.image')
  if (!sideNorm) missing.push('data.side')
  if (missing.length) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: `缺少必填字段：${missing.join('、')}`,
    }
    return
  }

  if (sideNorm !== 'front' && sideNorm !== 'back') {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: 'data.side 须为 front（人像面）或 back（国徽面）',
    }
    return
  }

  await runUpstreamProxy(ctx, postOcrIdentify, { image, side: sideNorm })
}

/** name、id_card、mobile（可与 userName / idNumber / phoneNumber 别名兼容）；用于 datapay personal3、sign authPersonMobile3 */
async function forwardNameIdCardMobileUpstream(ctx, upstreamFetch) {
  const data = ctx.state.riskControl.data || {}
  const name = String(data.name ?? data.userName ?? '').trim()
  const id_card = String(data.id_card ?? data.idNumber ?? '').trim()
  const mobile = String(data.mobile ?? data.phoneNumber ?? '').trim()

  const missing = []
  if (!name) missing.push('data.name（或 userName）')
  if (!id_card) missing.push('data.id_card（或 idNumber）')
  if (!mobile) missing.push('data.mobile（或 phoneNumber）')
  if (missing.length) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: `缺少必填字段：${missing.join('、')}`,
    }
    return
  }

  await runUpstreamProxy(ctx, upstreamFetch, { name, id_card, mobile })
}

/** 个人三要素对比 v2：上游 POST /api/datapay/personal3 */
async function forwardPersonal3(ctx) {
  await forwardNameIdCardMobileUpstream(ctx, postPersonal3)
}

/** 企业运营商三要素：上游 name、mobile、id_card、company_name、credit_code */
async function forwardAuthCompanyMobile3(ctx) {
  const data = ctx.state.riskControl.data || {}
  const name = String(data.name ?? data.userName ?? '').trim()
  const mobile = String(data.mobile ?? data.phoneNumber ?? '').trim()
  const id_card = String(data.id_card ?? data.idNumber ?? '').trim()
  const company_name = String(data.company_name ?? data.companyName ?? '').trim()
  const credit_code = String(data.credit_code ?? data.creditCode ?? '').trim()

  const missing = []
  if (!name) missing.push('data.name（或 userName）')
  if (!mobile) missing.push('data.mobile（或 phoneNumber）')
  if (!id_card) missing.push('data.id_card（或 idNumber）')
  if (!company_name) missing.push('data.company_name（或 companyName）')
  if (!credit_code) missing.push('data.credit_code（或 creditCode）')
  if (missing.length) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: `缺少必填字段：${missing.join('、')}`,
    }
    return
  }

  await runUpstreamProxy(ctx, postAuthCompanyMobile3, {
    name,
    mobile,
    id_card,
    company_name,
    credit_code,
  })
}

/** 认证校验码校验：上游 serialNo、captcha（短信验证码） */
async function forwardCaptchaVerify(ctx) {
  const data = ctx.state.riskControl.data || {}
  const serialNo = String(data.serialNo ?? data.serial_no ?? '').trim()
  const captcha = String(data.captcha ?? '').trim()

  const missing = []
  if (!serialNo) missing.push('data.serialNo（或 serial_no）')
  if (!captcha) missing.push('data.captcha')
  if (missing.length) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: `缺少必填字段：${missing.join('、')}`,
    }
    return
  }

  await runUpstreamProxy(ctx, postCaptchaVerify, { serialNo, captcha })
}

/** captchaResend / getAuthRecordInfo：上游仅需 serialNo */
async function forwardSerialNoOnlyUpstream(ctx, upstreamFetch) {
  const data = ctx.state.riskControl.data || {}
  const serialNo = String(data.serialNo ?? data.serial_no ?? '').trim()

  if (!serialNo) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: '缺少必填字段：data.serialNo（或 serial_no）',
    }
    return
  }

  await runUpstreamProxy(ctx, upstreamFetch, { serialNo })
}

/** 重新发送认证验证码：上游 POST /api/sign/captchaResend */
async function forwardCaptchaResend(ctx) {
  await forwardSerialNoOnlyUpstream(ctx, postCaptchaResend)
}

/** 个人人脸活体认证：上游 name、id_card 必填；可选 bizId、faceAuthMode、redirectUrl、metaInfo、notifyUrl（camelCase，与开放平台一致） */
async function forwardAuthPersonFace(ctx) {
  const data = ctx.state.riskControl.data || {}
  const name = String(data.name ?? data.userName ?? '').trim()
  const id_card = String(data.id_card ?? data.idNumber ?? '').trim()

  const missing = []
  if (!name) missing.push('data.name（或 userName）')
  if (!id_card) missing.push('data.id_card（或 idNumber）')
  if (missing.length) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: `缺少必填字段：${missing.join('、')}`,
    }
    return
  }

  const payload = { name, id_card }

  const bizId = String(data.bizId ?? data.biz_id ?? '').trim()
  if (bizId) payload.bizId = bizId

  const faceRaw = data.faceAuthMode ?? data.face_auth_mode
  if (faceRaw !== undefined && faceRaw !== null && faceRaw !== '') {
    const m = Number(faceRaw)
    if (Number.isFinite(m)) payload.faceAuthMode = m
  }

  const redirectUrl = String(data.redirectUrl ?? data.redirect_url ?? '').trim()
  if (redirectUrl) payload.redirectUrl = redirectUrl

  const metaInfo = String(data.metaInfo ?? data.meta_info ?? '').trim()
  if (metaInfo) payload.metaInfo = metaInfo

  const notifyUrl = String(data.notifyUrl ?? data.notify_url ?? '').trim()
  if (notifyUrl) payload.notifyUrl = notifyUrl

  await runUpstreamProxy(ctx, postAuthPersonFace, payload)
}

/** 查询人脸核身结果：上游仅需 data.bizId */
async function forwardUserFaceResult(ctx) {
  const data = ctx.state.riskControl.data || {}
  const bizId = String(data.bizId ?? data.biz_id ?? '').trim()

  if (!bizId) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: '缺少必填字段：data.bizId（或 biz_id）',
    }
    return
  }

  await runUpstreamProxy(ctx, postUserFaceResult, { bizId })
}

/** getContract：上游仅需 data.contractNo */
async function forwardContractNoOnlyUpstream(ctx, upstreamFetch) {
  const data = ctx.state.riskControl.data || {}
  const contractNo = String(data.contractNo ?? data.contract_no ?? '').trim()

  if (!contractNo) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: '缺少必填字段：data.contractNo（或 contract_no）',
    }
    return
  }

  if (contractNo.length > 40) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: 'data.contractNo 长度须在 40 位以内',
    }
    return
  }

  await runUpstreamProxy(ctx, upstreamFetch, { contractNo })
}

/** 查询合同信息：上游仅需 data.contractNo */
async function forwardGetContract(ctx) {
  await forwardContractNoOnlyUpstream(ctx, postGetContract)
}

/** clSms/send、clSms/notify：上游 data.phone、data.msg */
async function forwardPhoneMsgUpstream(ctx, upstreamFetch) {
  const data = ctx.state.riskControl.data || {}
  const phone = String(data.phone ?? data.mobile ?? data.phoneNumber ?? '').trim()
  const msg = String(data.msg ?? '').trim()

  const missing = []
  if (!phone) missing.push('data.phone（或 mobile、phoneNumber）')
  if (!msg) missing.push('data.msg')
  if (missing.length) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: `缺少必填字段：${missing.join('、')}`,
    }
    return
  }

  await runUpstreamProxy(ctx, upstreamFetch, { phone, msg })
}

/** 验证码短信发送：上游 POST /api/clSms/send */
async function forwardClSmsSend(ctx) {
  await forwardPhoneMsgUpstream(ctx, postClSmsSend)
}

/** 通知短信发送：上游 POST /api/clSms/notify */
async function forwardClSmsNotify(ctx) {
  await forwardPhoneMsgUpstream(ctx, postClSmsNotify)
}

/** 添加个人用户信息：上游 account（用户唯一识别码）、serialNo（实名认证流水号） */
async function forwardAddPersonalUser(ctx) {
  const data = ctx.state.riskControl.data || {}
  const account = String(data.account ?? '').trim()
  const serialNo = String(data.serialNo ?? data.serial_no ?? '').trim()

  const missing = []
  if (!account) missing.push('data.account')
  if (!serialNo) missing.push('data.serialNo（或 serial_no）')
  if (missing.length) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: `缺少必填字段：${missing.join('、')}`,
    }
    return
  }

  await runUpstreamProxy(ctx, postAddPersonalUser, { account, serialNo })
}

/** 添加企业用户信息：上游 account（用户唯一识别码）、serialNo（实名认证流水号） */
async function forwardAddEnterpriseUser(ctx) {
  const data = ctx.state.riskControl.data || {}
  const account = String(data.account ?? '').trim()
  const serialNo = String(data.serialNo ?? data.serial_no ?? '').trim()

  const missing = []
  if (!account) missing.push('data.account')
  if (!serialNo) missing.push('data.serialNo（或 serial_no）')
  if (missing.length) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: `缺少必填字段：${missing.join('、')}`,
    }
    return
  }

  await runUpstreamProxy(ctx, postAddEnterpriseUser, { account, serialNo })
}

/** 上传待签署文件（创建合同）：上游 POST /api/sign/createContract */
async function forwardCreateContract(ctx) {
  const data = ctx.state.riskControl.data || {}

  const contractNo = String(data.contractNo ?? data.contract_no ?? '').trim()
  const contractName = String(data.contractName ?? data.contract_name ?? '').trim()
  const signOrderRaw = data.signOrder ?? data.sign_order

  const missing = []
  if (!contractNo) missing.push('data.contractNo（或 contract_no）')
  if (!contractName) missing.push('data.contractName（或 contract_name）')
  if (signOrderRaw === undefined || signOrderRaw === null || signOrderRaw === '') {
    missing.push('data.signOrder（或 sign_order）')
  }
  if (missing.length) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: `缺少必填字段：${missing.join('、')}`,
    }
    return
  }

  if (contractNo.length > 40) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: 'data.contractNo 长度须在 40 位以内',
    }
    return
  }

  if (contractName.length > 120) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: 'data.contractName 长度须在 120 位以内',
    }
    return
  }

  if (/[*":\\/<>|]/.test(contractName)) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: 'data.contractName 不可包含 * " : / \\ < > | 等字符',
    }
    return
  }

  const signOrder = Number(signOrderRaw)
  if (!Number.isFinite(signOrder) || (signOrder !== 1 && signOrder !== 2)) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: 'data.signOrder 须为 1（无序签约）或 2（顺序签约）',
    }
    return
  }

  const validityTimeRaw = data.validityTime ?? data.validity_time
  const validityDate = String(data.validityDate ?? data.validity_date ?? '').trim()
  const hasValidityTime = validityTimeRaw !== undefined && validityTimeRaw !== null && validityTimeRaw !== ''
  const hasValidityDate = !!validityDate
  if (!hasValidityTime && !hasValidityDate) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: '须提供 data.validityTime（或 validity_time）与 data.validityDate（或 validity_date）二者之一',
    }
    return
  }

  if (hasValidityTime) {
    const vt = Number(validityTimeRaw)
    if (!Number.isFinite(vt)) {
      ctx.status = 400
      ctx.body = {
        success: false,
        code: 40010,
        msg: 'data.validityTime 须为有效数字（剩余天数）',
      }
      return
    }
  }

  const payload = { contractNo, contractName, signOrder }

  if (hasValidityTime) {
    payload.validityTime = Math.round(Number(validityTimeRaw))
  }
  if (hasValidityDate) {
    payload.validityDate = validityDate
  }

  const filesRaw = data.contractFiles ?? data.contract_files
  if (filesRaw !== undefined && filesRaw !== null) {
    if (!Array.isArray(filesRaw)) {
      ctx.status = 400
      ctx.body = {
        success: false,
        code: 40010,
        msg: 'data.contractFiles（或 contract_files）须为 URL 字符串数组',
      }
      return
    }
    payload.contractFiles = filesRaw.map((u) => String(u).trim()).filter(Boolean)
  }

  const optNum = (camel, snake) => {
    const raw = data[camel] ?? data[snake]
    if (raw === undefined || raw === null || raw === '') return
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    payload[camel] = Math.round(n)
  }

  const optStr = (camel, snake) => {
    const s = String(data[camel] ?? data[snake] ?? '').trim()
    if (s) payload[camel] = s
  }

  optNum('readSeconds', 'read_seconds')
  optNum('readType', 'read_type')
  optNum('needAgree', 'need_agree')
  optNum('autoExpand', 'auto_expand')
  optNum('refuseOn', 'refuse_on')
  optNum('autoContinue', 'auto_continue')
  optNum('viewFlg', 'view_flg')
  optNum('enableDownloadButton', 'enable_download_button')

  optStr('notifyUrl', 'notify_url')
  optStr('callbackUrl', 'callback_url')
  optStr('userNotifyUrl', 'user_notify_url')
  optStr('redirectUrl', 'redirect_url')
  optStr('redirectReturnUrl', 'redirect_return_url')
  optStr('redirectCompletedUrl', 'redirect_completed_url')
  optStr('storeCloudSign', 'store_cloud_sign')

  await runUpstreamProxy(ctx, postCreateContract, payload)
}

/**
 * 添加签署方：上游 POST /api/sign/addSigner；开放平台 Body.data 为签署方对象数组。
 * 验签时 jsonData 须对该数组做 stableStringify（单方也需 [{ ... }]）。
 */
async function forwardAddSigner(ctx) {
  const rawRows = ctx.state.riskControl.data

  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: 'data 须为非空数组（每项为一名签署方；单方时请传单元素数组）',
    }
    return
  }

  const appendSignerOptInt = (row, raw, camel, snake) => {
    const v = raw[camel] ?? raw[snake]
    if (v === undefined || v === null || v === '') return
    const n = Number(v)
    if (!Number.isFinite(n)) return
    row[camel] = Math.round(n)
  }

  const rows = []
  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      ctx.status = 400
      ctx.body = {
        success: false,
        code: 40010,
        msg: `data[${i}] 须为对象`,
      }
      return
    }

    const contractNo = String(raw.contractNo ?? raw.contract_no ?? '').trim()
    const account = String(raw.account ?? '').trim()
    const signTypeRaw = raw.signType ?? raw.sign_type

    const missing = []
    if (!contractNo) missing.push('contractNo（或 contract_no）')
    if (!account) missing.push('account')
    if (signTypeRaw === undefined || signTypeRaw === null || signTypeRaw === '') {
      missing.push('signType（或 sign_type）')
    }
    if (missing.length) {
      ctx.status = 400
      ctx.body = {
        success: false,
        code: 40010,
        msg: `data[${i}] 缺少必填字段：${missing.join('、')}`,
      }
      return
    }

    if (contractNo.length > 40) {
      ctx.status = 400
      ctx.body = {
        success: false,
        code: 40010,
        msg: `data[${i}] contractNo 长度须在 40 位以内`,
      }
      return
    }

    const signType = Number(signTypeRaw)
    if (!Number.isFinite(signType) || (signType !== 2 && signType !== 3)) {
      ctx.status = 400
      ctx.body = {
        success: false,
        code: 40010,
        msg: `data[${i}] signType 须为 2（无感知签约）或 3（有感知签约）`,
      }
      return
    }

    const row = { contractNo, account, signType }

    const nm = String(raw.noticeMobile ?? raw.notice_mobile ?? '').trim()
    if (nm) row.noticeMobile = nm

    const soRaw = raw.signOrder ?? raw.sign_order
    if (soRaw !== undefined && soRaw !== null && soRaw !== '') {
      const so = String(soRaw).trim()
      if (so) row.signOrder = so
    }

    appendSignerOptInt(row, raw, 'isNotice', 'is_notice')
    appendSignerOptInt(row, raw, 'validateType', 'validate_type')
    appendSignerOptInt(row, raw, 'faceAuthMode', 'face_auth_mode')
    appendSignerOptInt(row, raw, 'autoSwitch', 'auto_switch')
    appendSignerOptInt(row, raw, 'isNoticeComplete', 'is_notice_complete')
    appendSignerOptInt(row, raw, 'waterMark', 'water_mark')
    appendSignerOptInt(row, raw, 'autoSms', 'auto_sms')
    appendSignerOptInt(row, raw, 'customSignFlag', 'custom_sign_flag')
    appendSignerOptInt(row, raw, 'changeSeal', 'change_seal')

    const vtl = raw.validateTypeList ?? raw.validate_type_list
    if (vtl !== undefined && vtl !== null && vtl !== '') {
      const s = String(vtl).trim()
      if (s) row.validateTypeList = s
    }

    const ssl = raw.signStrategyList ?? raw.sign_strategy_list
    if (ssl !== undefined) {
      if (!Array.isArray(ssl)) {
        ctx.status = 400
        ctx.body = {
          success: false,
          code: 40010,
          msg: `data[${i}] signStrategyList（或 sign_strategy_list）须为数组`,
        }
        return
      }
      row.signStrategyList = ssl
    }

    const stk = raw.signStrikeList ?? raw.sign_strike_list
    if (stk !== undefined) {
      if (!Array.isArray(stk)) {
        ctx.status = 400
        ctx.body = {
          success: false,
          code: 40010,
          msg: `data[${i}] signStrikeList（或 sign_strike_list）须为数组`,
        }
        return
      }
      row.signStrikeList = stk
    }

    const ac = raw.authConfig ?? raw.auth_config
    if (ac !== undefined) {
      if (!ac || typeof ac !== 'object' || Array.isArray(ac)) {
        ctx.status = 400
        ctx.body = {
          success: false,
          code: 40010,
          msg: `data[${i}] authConfig（或 auth_config）须为对象`,
        }
        return
      }
      row.authConfig = ac
    }

    const sm = String(raw.signMark ?? raw.sign_mark ?? '').trim()
    if (sm) row.signMark = sm

    const fcu = String(raw.fillCallBackUrl ?? raw.fill_callback_url ?? '').trim()
    if (fcu) row.fillCallBackUrl = fcu

    const biz = String(raw.bizId ?? raw.biz_id ?? '').trim()
    if (biz) row.bizId = biz

    rows.push(row)
  }

  await runUpstreamProxy(ctx, postAddSigner, rows)
}

/** 运营商二要素：上游字段 name、mobile（可与 userName / phoneNumber 别名兼容） */
async function forwardMobile2(ctx) {
  const data = ctx.state.riskControl.data || {}
  const name = String(data.name ?? data.userName ?? '').trim()
  const mobile = String(data.mobile ?? data.phoneNumber ?? '').trim()

  const missing = []
  if (!name) missing.push('data.name（或 userName）')
  if (!mobile) missing.push('data.mobile（或 phoneNumber）')
  if (missing.length) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: `缺少必填字段：${missing.join('、')}`,
    }
    return
  }

  await runUpstreamProxy(ctx, postMobile2, { name, mobile })
}

/** 在网时长 / 运营商状态：上游仅需 data.phoneNumber（可与 mobile 别名兼容） */
async function forwardDsPhoneNumberUpstream(ctx, upstreamFetch) {
  const data = ctx.state.riskControl.data || {}
  const phoneNumber = String(data.phoneNumber ?? data.mobile ?? '').trim()

  if (!phoneNumber) {
    ctx.status = 400
    ctx.body = {
      success: false,
      code: 40010,
      msg: '缺少必填字段：data.phoneNumber（或 mobile）',
    }
    return
  }

  await runUpstreamProxy(ctx, upstreamFetch, { phoneNumber })
}

router.get('/health', (ctx) => {
  ctx.body = {
    success: true,
    code: 0,
    msg: 'ok',
    data: {
      service: 'risk-control',
      credentialsConfigured: hasAnyCredential(),
    },
  }
})

/** 联调用：验签后原样返回 data，便于对接方验证加签逻辑 */
router.post('/v1/ping', verifyRiskSignature, (ctx) => {
  ctx.body = {
    success: true,
    code: 0,
    msg: 'ok',
    data: {
      echo: ctx.state.riskControl.data,
    },
  }
})

/** 法院信息-个人高级版：验签后转发上游 POST /api/risk.v4/courtDetailPro */
router.post('/v1/court-detail-pro', verifyRiskSignature, async (ctx) => {
  await forwardIdentityUpstream(ctx, postCourtDetailPro)
})

/** 法院被执行-高级版：验签后转发上游 POST /api/risk.v4/executionPro */
router.post('/v1/execution-pro', verifyRiskSignature, async (ctx) => {
  await forwardIdentityUpstream(ctx, postExecutionPro)
})

/** 探针 C-md5：验签后转发上游 POST /api/risk.V5/probeCEnc */
router.post('/v1/probe-c-enc', verifyRiskSignature, async (ctx) => {
  await forwardIdentityUpstream(ctx, postProbeCEnc)
})

/** 全景雷达 v4-MD5：验签后转发上游 POST /api/risk.V5/radarV4Enc */
router.post('/v1/radar-v4-enc', verifyRiskSignature, async (ctx) => {
  await forwardIdentityUpstream(ctx, postRadarV4Enc)
})

/** 身份证 OCR：验签后转发上游 POST /api/sign/ocrIdentify */
router.post('/v1/ocr-identify', verifyRiskSignature, async (ctx) => {
  await forwardOcrIdentify(ctx)
})

/** 个人三要素对比 v2：验签后转发上游 POST /api/datapay/personal3 */
router.post('/v1/personal3', verifyRiskSignature, async (ctx) => {
  await forwardPersonal3(ctx)
})

/** 在网时长：验签后转发上游 POST /api/risk/dsPhoneTime */
router.post('/v1/ds-phone-time', verifyRiskSignature, async (ctx) => {
  await forwardDsPhoneNumberUpstream(ctx, postDsPhoneTime)
})

/** 运营商状态：验签后转发上游 POST /api/risk/dsPhoneState */
router.post('/v1/ds-phone-state', verifyRiskSignature, async (ctx) => {
  await forwardDsPhoneNumberUpstream(ctx, postDsPhoneState)
})

/** 运营商二要素验证：验签后转发上游 POST /api/datapay/mobile2 */
router.post('/v1/mobile2', verifyRiskSignature, async (ctx) => {
  await forwardMobile2(ctx)
})

/** 个人运营商三要素认证：验签后转发上游 POST /api/sign/authPersonMobile3 */
router.post('/v1/auth-person-mobile3', verifyRiskSignature, async (ctx) => {
  await forwardNameIdCardMobileUpstream(ctx, postAuthPersonMobile3)
})

/** 企业运营商三要素认证：验签后转发上游 POST /api/sign/authCompanyMobile3 */
router.post('/v1/auth-company-mobile3', verifyRiskSignature, async (ctx) => {
  await forwardAuthCompanyMobile3(ctx)
})

/** 认证校验码校验：验签后转发上游 POST /api/sign/captchaVerify */
router.post('/v1/captcha-verify', verifyRiskSignature, async (ctx) => {
  await forwardCaptchaVerify(ctx)
})

/** 重新发送认证验证码：验签后转发上游 POST /api/sign/captchaResend */
router.post('/v1/captcha-resend', verifyRiskSignature, async (ctx) => {
  await forwardCaptchaResend(ctx)
})

/** 实名认证信息查询：验签后转发上游 POST /api/sign/getAuthRecordInfo */
router.post('/v1/get-auth-record-info', verifyRiskSignature, async (ctx) => {
  await forwardSerialNoOnlyUpstream(ctx, postGetAuthRecordInfo)
})

/** 个人人脸活体认证：验签后转发上游 POST /api/sign/authPersonFace */
router.post('/v1/auth-person-face', verifyRiskSignature, async (ctx) => {
  await forwardAuthPersonFace(ctx)
})

/** 查询人脸核身结果：验签后转发上游 POST /api/sign/userFaceResult */
router.post('/v1/user-face-result', verifyRiskSignature, async (ctx) => {
  await forwardUserFaceResult(ctx)
})

/** 添加个人用户信息：验签后转发上游 POST /api/sign/addPersonalUser */
router.post('/v1/add-personal-user', verifyRiskSignature, async (ctx) => {
  await forwardAddPersonalUser(ctx)
})

/** 添加企业用户信息：验签后转发上游 POST /api/sign/addEnterpriseUser */
router.post('/v1/add-enterprise-user', verifyRiskSignature, async (ctx) => {
  await forwardAddEnterpriseUser(ctx)
})

/** 上传待签署文件（创建合同）：验签后转发上游 POST /api/sign/createContract */
router.post('/v1/create-contract', verifyRiskSignature, async (ctx) => {
  await forwardCreateContract(ctx)
})

/** 添加签署方：验签后转发上游 POST /api/sign/addSigner */
router.post('/v1/add-signer', verifyRiskSignature, async (ctx) => {
  await forwardAddSigner(ctx)
})

/** 查询合同信息：验签后转发上游 POST /api/sign/getContract */
router.post('/v1/get-contract', verifyRiskSignature, async (ctx) => {
  await forwardGetContract(ctx)
})

/** 验证码短信发送：验签后转发上游 POST /api/clSms/send */
router.post('/v1/cl-sms-send', verifyRiskSignature, async (ctx) => {
  await forwardClSmsSend(ctx)
})

/** 通知短信发送：验签后转发上游 POST /api/clSms/notify */
router.post('/v1/cl-sms-notify', verifyRiskSignature, async (ctx) => {
  await forwardClSmsNotify(ctx)
})

module.exports = {
  router,
  verifyRiskSignature,
  PREFIX,
}
