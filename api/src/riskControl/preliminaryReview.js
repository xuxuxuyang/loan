/**
 * 下单场景「信誉初审」：按业务编排调用上游风控能力（与 router 中单接口转发共用 upstreamClient）。
 * 十四槽位输入依赖、注册字段对照与单槽测试顺序见同目录 RISK_FOURTEEN_SLOTS.md。
 * 环境变量：
 * - RISK_PRELIMINARY_PLACEHOLDER_ID：未传 idNumber 时用于联调占位身份证号（勿在生产滥用）。
 * - RISK_PRELIMINARY_ENABLE_SMS=1：是否真实调用验证码/通知短信（默认关闭避免骚扰）。
 * - RISK_PRELIMINARY_CONTRACT_TRY=1：是否尝试创建电子合同（需上游支持）。
 */

const {
  isRiskUpstreamConfigured,
  postCourtDetailPro,
  postExecutionPro,
  postPersonal3,
  postOcrIdentify,
  postMobile2,
  postDsPhoneTime,
  postDsPhoneState,
  postProbeCEnc,
  postRadarV4Enc,
  postClSmsSend,
  postClSmsNotify,
  postCreateContract,
  postAuthPersonFace,
} = require('./upstreamClient')

function httpStepOk(res) {
  if (!res || res.ok === false) {
    return false
  }
  const j = res.json
  if (j && typeof j === 'object' && Object.prototype.hasOwnProperty.call(j, 'success') && j.success === false) {
    return false
  }
  return true
}

/** 华东云沙箱等常在文案前加此前缀；写入用户档案前去掉，避免与「本系统模拟」混淆 */
const RISK_TEXT_MOCK_PREFIX_RE = /^模拟[:：]\s*/

function stripUpstreamSandboxTextPrefix(str) {
  if (typeof str !== 'string') return str
  return str.replace(RISK_TEXT_MOCK_PREFIX_RE, '').trim()
}

/**
 * 浅处理开放平台 JSON：仅清理常见结论类字符串字段的前缀（不改变结构与计费事实）。
 * @param {unknown} json
 */
function sanitizeUpstreamRiskPayload(json) {
  if (json === null || json === undefined || typeof json !== 'object' || Array.isArray(json)) {
    return json
  }
  let out
  try {
    out = JSON.parse(JSON.stringify(json))
  }
  catch {
    return json
  }
  if (typeof out.message === 'string') {
    out.message = stripUpstreamSandboxTextPrefix(out.message)
  }
  const data = out.data
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const keys = ['summary', 'message', 'detail', 'info', 'remark', 'reason', 'note', 'description', 'msg']
    for (const k of keys) {
      if (typeof data[k] === 'string') {
        data[k] = stripUpstreamSandboxTextPrefix(data[k])
      }
    }
  }
  return out
}

function isHttpImageUrl(u) {
  return /^https?:\/\//i.test(String(u || '').trim())
}

/**
 * @param {() => Promise<{ ok?: boolean, status?: number, json?: unknown }>} fn
 */
async function execStep(label, key, fn) {
  try {
    const res = await fn()
    return {
      key,
      label,
      ok: httpStepOk(res),
      httpStatus: res.status,
      response: sanitizeUpstreamRiskPayload(res.json),
    }
  }
  catch (err) {
    return {
      key,
      label,
      ok: false,
      error: String(err && err.message ? err.message : err),
    }
  }
}

/**
 * @typedef {Object} CreditPreliminaryParams
 * @property {string} [userName]
 * @property {string} [phoneNumber]
 * @property {string} [idNumber] 身份证号；可与环境变量占位配合
 * @property {string} [idCardFront] 人像面图 URL（需 http(s) 可达）
 * @property {string} [idCardBack] 国徽面图 URL
 * @property {number} [totalAmount]
 * @property {number} [installmentPeriods]
 */

/**
 * @typedef {Object} PreliminaryReviewOptions
 * @property {boolean} [enableSms] 为 true 时强制走短信接口（覆盖环境变量关闭）
 * @property {boolean} [tryContract] 为 true 时强制尝试创建电子合同
 * @property {boolean} [adminManagedBatch] 管理端全量：仅真实请求 8 项（A3+B5），人脸/OCR/短信/合同等 6 项固定跳过不调用
 */

/** 管理端「全量风控核查」不请求的槽位对应步骤文案（仍写入 14 行快照供列表展示） */
const ADMIN_BATCH_SKIP_REASON = {
  face: '管理端全量核查不调用人脸活体认证（请在业务端或开放平台联调验证）',
  ocr: '管理端全量核查不调用身份证 OCR（需公网图片 URL 时在业务端验证）',
  sms: '管理端全量核查不调用短信接口（避免骚扰与额外计费）',
  contract: '管理端全量核查不调用电子合同',
}

/**
 * 未配置上游时不调用开放平台，返回与真实编排同结构的「跳过」步骤（不产生模拟 JSON）。
 */
function buildNoUpstreamSkippedSteps(params, options = {}) {
  const userName = String(params.userName || '').trim()
  const phoneNumber = String(params.phoneNumber || '').trim()
  let idNumber = String(params.idNumber || '').trim()
  const placeholder = String(process.env.RISK_PRELIMINARY_PLACEHOLDER_ID || '').trim()
  if (!idNumber && placeholder) {
    idNumber = placeholder
  }

  const idCardFront = String(params.idCardFront || '').trim()
  const idCardBack = String(params.idCardBack || '').trim()
  const enableSms = options.enableSms === true
    || String(process.env.RISK_PRELIMINARY_ENABLE_SMS || '').trim() === '1'
  const tryContract = options.tryContract === true
    || String(process.env.RISK_PRELIMINARY_CONTRACT_TRY || '').trim() === '1'

  const UP = '未配置风控上游（请配置 RISK_UPSTREAM_* 或 HD_CLOUD_*），无法调用真实接口'

  /** @type {Array<Record<string, unknown>>} */
  const steps = []

  const hasTriple = !!(idNumber && userName && phoneNumber)

  if (hasTriple) {
    steps.push({ key: 'court_detail_pro', label: '法院信息-个人高级版', skipped: true, reason: UP })
    steps.push({ key: 'execution_pro', label: '法院被执行人-高级版', skipped: true, reason: UP })
    steps.push({ key: 'probe_c_enc', label: '探针C-MD5', skipped: true, reason: UP })
    steps.push({ key: 'radar_v4_enc', label: '全景雷达-MD5', skipped: true, reason: UP })
    steps.push({ key: 'personal3', label: '个人三要素对比', skipped: true, reason: UP })
    steps.push({ key: 'auth_person_face', label: '个人人脸活体认证', skipped: true, reason: UP })
  }
  else {
    steps.push({
      key: 'identity_bundle',
      label: '身份三要素类接口',
      skipped: true,
      reason: '缺少 idNumber / userName / phoneNumber（可在下单 body 传 idNumber，或配置 RISK_PRELIMINARY_PLACEHOLDER_ID）',
    })
  }

  if (isHttpImageUrl(idCardFront)) {
    steps.push({ key: 'ocr_front', label: '身份证OCR（人像面）', skipped: true, reason: UP })
  }
  else {
    steps.push({
      key: 'ocr_front',
      label: '身份证OCR（人像面）',
      skipped: true,
      reason: '无人像面 http(s) 图片地址',
    })
  }

  if (isHttpImageUrl(idCardBack)) {
    steps.push({ key: 'ocr_back', label: '身份证OCR（国徽面）', skipped: true, reason: UP })
  }
  else {
    steps.push({
      key: 'ocr_back',
      label: '身份证OCR（国徽面）',
      skipped: true,
      reason: '无国徽面 http(s) 图片地址',
    })
  }

  if (userName && phoneNumber) {
    steps.push({ key: 'mobile2', label: '运营商二要素验证', skipped: true, reason: UP })
  }
  else {
    steps.push({
      key: 'mobile2',
      label: '运营商二要素验证',
      skipped: true,
      reason: '缺少姓名或手机号',
    })
  }

  if (phoneNumber) {
    steps.push({ key: 'ds_phone_time', label: '手机号在网时长', skipped: true, reason: UP })
    steps.push({ key: 'ds_phone_state', label: '运营商状态', skipped: true, reason: UP })
  }
  else {
    steps.push({
      key: 'ds_phone',
      label: '在网时长/运营商状态',
      skipped: true,
      reason: '无手机号',
    })
  }

  if (enableSms && phoneNumber) {
    steps.push({ key: 'cl_sms_send', label: '验证码短信发送', skipped: true, reason: UP })
    steps.push({ key: 'cl_sms_notify', label: '通知类短信发送', skipped: true, reason: UP })
  }
  else {
    const rs = enableSms ? '无手机号' : '未设置 RISK_PRELIMINARY_ENABLE_SMS=1（默认不发短信）'
    steps.push({
      key: 'cl_sms_send',
      label: '验证码短信发送',
      skipped: true,
      reason: rs,
    })
    steps.push({
      key: 'cl_sms_notify',
      label: '通知类短信发送',
      skipped: true,
      reason: rs,
    })
  }

  steps.push({
    key: 'logistics',
    label: '物流查询',
    skipped: true,
    reason: '下单阶段尚无快递单号，发货后再查物流',
  })

  if (tryContract && phoneNumber) {
    steps.push({ key: 'create_contract', label: '电子合同（创建）', skipped: true, reason: UP })
  }
  else {
    steps.push({
      key: 'create_contract',
      label: '电子合同',
      skipped: true,
      reason: '默认跳过（需要试创合同时设置 RISK_PRELIMINARY_CONTRACT_TRY=1）',
    })
  }

  return steps
}

async function runCreditPreliminaryReview(params, options = {}) {
  if (!isRiskUpstreamConfigured()) {
    const steps = buildNoUpstreamSkippedSteps(params, options)
    const executed = steps.filter(s => !s.skipped)
    const failed = executed.filter(s => s.ok === false)
    const passed = failed.length === 0
    const stepsSummary = steps.map((s) => {
      if (s.skipped) {
        return { key: s.key, state: 'skipped' }
      }
      return { key: s.key, state: s.ok ? 'ok' : 'fail' }
    })
    return {
      configured: false,
      simulated: false,
      passed,
      steps,
      stepsSummary,
      summaryMessage: '未配置风控上游，未调用开放平台（已关闭本地模拟数据）。',
    }
  }

  const userName = String(params.userName || '').trim()
  const phoneNumber = String(params.phoneNumber || '').trim()
  let idNumber = String(params.idNumber || '').trim()
  const placeholder = String(process.env.RISK_PRELIMINARY_PLACEHOLDER_ID || '').trim()
  if (!idNumber && placeholder) {
    idNumber = placeholder
  }

  const idCardFront = String(params.idCardFront || '').trim()
  const idCardBack = String(params.idCardBack || '').trim()
  const enableSms = options.enableSms === true
    || String(process.env.RISK_PRELIMINARY_ENABLE_SMS || '').trim() === '1'
  const tryContract = options.tryContract === true
    || String(process.env.RISK_PRELIMINARY_CONTRACT_TRY || '').trim() === '1'
  const adminManagedBatch = options.adminManagedBatch === true

  /** @type {Array<Record<string, unknown>>} */
  const steps = []

  const hasTriple = !!(idNumber && userName && phoneNumber)

  if (hasTriple) {
    const triple = { idNumber, userName, phoneNumber }
    steps.push(await execStep('法院信息-个人高级版', 'court_detail_pro', () => postCourtDetailPro(triple)))
    steps.push(await execStep('法院被执行人-高级版', 'execution_pro', () => postExecutionPro(triple)))
    steps.push(await execStep('探针C-MD5', 'probe_c_enc', () => postProbeCEnc(triple)))
    steps.push(await execStep('全景雷达-MD5', 'radar_v4_enc', () => postRadarV4Enc(triple)))
    steps.push(await execStep('个人三要素对比', 'personal3', () => postPersonal3({
      name: userName,
      id_card: idNumber,
      mobile: phoneNumber,
    })))
    if (adminManagedBatch) {
      steps.push({
        key: 'auth_person_face',
        label: '个人人脸活体认证',
        skipped: true,
        reason: ADMIN_BATCH_SKIP_REASON.face,
      })
    }
    else {
      steps.push(await execStep('个人人脸活体认证', 'auth_person_face', () => postAuthPersonFace({
        name: userName,
        id_card: idNumber,
      })))
    }
  }
  else {
    steps.push({
      key: 'identity_bundle',
      label: '身份三要素类接口',
      skipped: true,
      reason: '缺少 idNumber / userName / phoneNumber（可在下单 body 传 idNumber，或配置 RISK_PRELIMINARY_PLACEHOLDER_ID）',
    })
  }

  if (adminManagedBatch) {
    steps.push({
      key: 'ocr_front',
      label: '身份证OCR（人像面）',
      skipped: true,
      reason: ADMIN_BATCH_SKIP_REASON.ocr,
    })
    steps.push({
      key: 'ocr_back',
      label: '身份证OCR（国徽面）',
      skipped: true,
      reason: ADMIN_BATCH_SKIP_REASON.ocr,
    })
  }
  else if (isHttpImageUrl(idCardFront)) {
    steps.push(await execStep('身份证OCR（人像面）', 'ocr_front', () => postOcrIdentify({
      image: idCardFront,
      side: 'front',
    })))
  }
  else {
    steps.push({
      key: 'ocr_front',
      label: '身份证OCR（人像面）',
      skipped: true,
      reason: '无人像面 http(s) 图片地址',
    })
  }

  if (!adminManagedBatch) {
    if (isHttpImageUrl(idCardBack)) {
      steps.push(await execStep('身份证OCR（国徽面）', 'ocr_back', () => postOcrIdentify({
        image: idCardBack,
        side: 'back',
      })))
    }
    else {
      steps.push({
        key: 'ocr_back',
        label: '身份证OCR（国徽面）',
        skipped: true,
        reason: '无国徽面 http(s) 图片地址',
      })
    }
  }

  if (userName && phoneNumber) {
    steps.push(await execStep('运营商二要素验证', 'mobile2', () => postMobile2({
      name: userName,
      mobile: phoneNumber,
    })))
  }
  else {
    steps.push({
      key: 'mobile2',
      label: '运营商二要素验证',
      skipped: true,
      reason: '缺少姓名或手机号',
    })
  }

  if (phoneNumber) {
    steps.push(await execStep('手机号在网时长', 'ds_phone_time', () => postDsPhoneTime({ phoneNumber })))
    steps.push(await execStep('运营商状态', 'ds_phone_state', () => postDsPhoneState({ phoneNumber })))
  }
  else {
    steps.push({
      key: 'ds_phone',
      label: '在网时长/运营商状态',
      skipped: true,
      reason: '无手机号',
    })
  }

  if (adminManagedBatch) {
    steps.push({
      key: 'cl_sms_send',
      label: '验证码短信发送',
      skipped: true,
      reason: ADMIN_BATCH_SKIP_REASON.sms,
    })
    steps.push({
      key: 'cl_sms_notify',
      label: '通知类短信发送',
      skipped: true,
      reason: ADMIN_BATCH_SKIP_REASON.sms,
    })
  }
  else if (enableSms && phoneNumber) {
    const amt = Number(params.totalAmount || 0)
    const capMsg = `【信誉初审】验证码类短信通道联调，订单金额${amt}`.slice(0, 180)
    steps.push(await execStep('验证码短信发送', 'cl_sms_send', () => postClSmsSend({
      phone: phoneNumber,
      msg: capMsg,
    })))
    steps.push(await execStep('通知类短信发送', 'cl_sms_notify', () => postClSmsNotify({
      phone: phoneNumber,
      msg: `【商城】您的分期订单已提交信誉初审，应付¥${amt.toFixed(2)}`.slice(0, 200),
    })))
  }
  else {
    const rs = enableSms ? '无手机号' : '未设置 RISK_PRELIMINARY_ENABLE_SMS=1（默认不发短信）'
    steps.push({
      key: 'cl_sms_send',
      label: '验证码短信发送',
      skipped: true,
      reason: rs,
    })
    steps.push({
      key: 'cl_sms_notify',
      label: '通知类短信发送',
      skipped: true,
      reason: rs,
    })
  }

  steps.push({
    key: 'logistics',
    label: '物流查询',
    skipped: true,
    reason: '下单阶段尚无快递单号，发货后再查物流',
  })

  if (adminManagedBatch) {
    steps.push({
      key: 'create_contract',
      label: '电子合同',
      skipped: true,
      reason: ADMIN_BATCH_SKIP_REASON.contract,
    })
  }
  else if (tryContract && phoneNumber) {
    const contractNo = `PRE${Date.now()}`.slice(0, 40)
    steps.push(await execStep('电子合同（创建）', 'create_contract', () => postCreateContract({
      contractNo,
      contractName: `分期信誉初审-${phoneNumber}`.slice(0, 120),
      signOrder: 1,
      validityTime: 30,
    })))
  }
  else {
    steps.push({
      key: 'create_contract',
      label: '电子合同',
      skipped: true,
      reason: '默认跳过（需要试创合同时设置 RISK_PRELIMINARY_CONTRACT_TRY=1）',
    })
  }

  const executed = steps.filter(s => !s.skipped)
  const failed = executed.filter(s => s.ok === false)
  const passed = failed.length === 0

  const stepsSummary = steps.map((s) => {
    if (s.skipped) {
      return { key: s.key, state: 'skipped' }
    }
    return { key: s.key, state: s.ok ? 'ok' : 'fail' }
  })

  return {
    configured: true,
    simulated: false,
    passed,
    steps,
    stepsSummary,
    summaryMessage: passed
      ? ''
      : `信誉初审有 ${failed.length} 项未通过，请核对实名与运营商信息`,
  }
}

/** 与开放平台「14 个产品名称」顺序一致，用于管理端展示对齐 */
const IDENTITY_STEP_KEYS = new Set([
  'court_detail_pro',
  'execution_pro',
  'personal3',
  'probe_c_enc',
  'radar_v4_enc',
  'auth_person_face',
])

/**
 * 将原始 steps 整理为 14 行（含合并身份证 OCR 两项为一行）
 * @param {Array<Record<string, unknown>>} steps
 */
function normalizeFourteenProductRows(steps) {
  const list = Array.isArray(steps) ? steps : []
  /** @type {Record<string, Record<string, unknown>>} */
  const byKey = {}
  for (const s of list) {
    if (s && typeof s === 'object' && s.key && byKey[String(s.key)] === undefined) {
      byKey[String(s.key)] = s
    }
  }
  const ib = byKey.identity_bundle

  /**
   * @param {string} stepKey
   * @param {string} label
   */
  function stepRow(stepKey, label) {
    const s = byKey[stepKey]
    if (ib && IDENTITY_STEP_KEYS.has(stepKey)) {
      return {
        slotKey: stepKey,
        productLabel: label,
        state: 'skipped',
        skippedReason: String(ib.reason || ''),
        httpStatus: null,
        rawResponse: null,
      }
    }
    if (!s) {
      return {
        slotKey: stepKey,
        productLabel: label,
        state: 'skipped',
        skippedReason: '无执行记录',
        httpStatus: null,
        rawResponse: null,
      }
    }
    if (s.skipped) {
      return {
        slotKey: stepKey,
        productLabel: label,
        state: 'skipped',
        skippedReason: String(s.reason || ''),
        httpStatus: null,
        rawResponse: null,
      }
    }
    return {
      slotKey: stepKey,
      productLabel: label,
      state: s.ok ? 'ok' : 'fail',
      httpStatus: s.httpStatus,
      error: s.error,
      rawResponse: s.response ?? null,
    }
  }

  const ocrF = byKey.ocr_front
  const ocrB = byKey.ocr_back
  let ocrRow
  if ((ocrF && ocrF.skipped) && (ocrB && ocrB.skipped)) {
    ocrRow = {
      slotKey: 'id_card_ocr',
      productLabel: '身份证ocr',
      state: 'skipped',
      skippedReason: `人像面：${ocrF.reason || ''}；国徽面：${ocrB.reason || ''}`,
      rawResponse: null,
    }
  }
  else {
    const frontPart = ocrF && !ocrF.skipped
      ? { httpStatus: ocrF.httpStatus, ok: ocrF.ok, response: ocrF.response, error: ocrF.error }
      : { skipped: true, reason: ocrF?.reason || '未调人像面' }
    const backPart = ocrB && !ocrB.skipped
      ? { httpStatus: ocrB.httpStatus, ok: ocrB.ok, response: ocrB.response, error: ocrB.error }
      : { skipped: true, reason: ocrB?.reason || '未调国徽面' }
    const rawResponse = { 人像面: frontPart, 国徽面: backPart }
    const fBad = ocrF && !ocrF.skipped && ocrF.ok === false
    const bBad = ocrB && !ocrB.skipped && ocrB.ok === false
    const anyFail = fBad || bBad
    const bothSkippedExec = (!ocrF || ocrF.skipped) && (!ocrB || ocrB.skipped)
    ocrRow = {
      slotKey: 'id_card_ocr',
      productLabel: '身份证ocr',
      state: bothSkippedExec ? 'skipped' : (anyFail ? 'fail' : 'ok'),
      skippedReason: bothSkippedExec ? String(ocrF?.reason || ocrB?.reason || '') : '',
      rawResponse,
    }
  }

  function dsTimeRow() {
    const c = byKey.ds_phone
    if (c && c.skipped) {
      return {
        slotKey: 'ds_phone_time',
        productLabel: '手机号在网时长',
        state: 'skipped',
        skippedReason: String(c.reason || ''),
        rawResponse: null,
      }
    }
    return stepRow('ds_phone_time', '手机号在网时长')
  }

  function dsStateRow() {
    const c = byKey.ds_phone
    if (c && c.skipped) {
      return {
        slotKey: 'ds_phone_state',
        productLabel: '运营商状态',
        state: 'skipped',
        skippedReason: String(c.reason || ''),
        rawResponse: null,
      }
    }
    return stepRow('ds_phone_state', '运营商状态')
  }

  const logistics = byKey.logistics || {
    key: 'logistics',
    skipped: true,
    reason: '无物流步骤记录',
  }

  return [
    stepRow('court_detail_pro', '法院信息-个人高级版'),
    stepRow('execution_pro', '法院被执行人-高级版'),
    stepRow('personal3', '个人三要素对比'),
    ocrRow,
    stepRow('mobile2', '运营商二要素验证'),
    stepRow('cl_sms_send', '验证码短信发送'),
    stepRow('cl_sms_notify', '通知类短信发送'),
    dsTimeRow(),
    dsStateRow(),
    stepRow('probe_c_enc', '探针C-MD5'),
    stepRow('radar_v4_enc', '全景雷达-MD5'),
    logistics.skipped
      ? {
          slotKey: 'logistics',
          productLabel: '物流查询',
          state: 'skipped',
          skippedReason: String(logistics.reason || ''),
          rawResponse: null,
        }
      : {
          slotKey: 'logistics',
          productLabel: '物流查询',
          state: logistics.ok ? 'ok' : 'fail',
          httpStatus: logistics.httpStatus,
          error: logistics.error,
          rawResponse: logistics.response ?? null,
        },
    stepRow('create_contract', '电子合同'),
    stepRow('auth_person_face', '个人人脸活体认证'),
  ]
}

/** 管理端「单接口手动查询」允许的槽位（与 normalizeFourteenProductRows 顺序一致） */
const FOURTEEN_SLOT_KEYS = new Set([
  'court_detail_pro',
  'execution_pro',
  'personal3',
  'id_card_ocr',
  'mobile2',
  'cl_sms_send',
  'cl_sms_notify',
  'ds_phone_time',
  'ds_phone_state',
  'probe_c_enc',
  'radar_v4_enc',
  'logistics',
  'create_contract',
  'auth_person_face',
])

const SLOT_PRODUCT_LABEL = {
  court_detail_pro: '法院信息-个人高级版',
  execution_pro: '法院被执行人-高级版',
  personal3: '个人三要素对比',
  id_card_ocr: '身份证ocr',
  mobile2: '运营商二要素验证',
  cl_sms_send: '验证码短信发送',
  cl_sms_notify: '通知类短信发送',
  ds_phone_time: '手机号在网时长',
  ds_phone_state: '运营商状态',
  probe_c_enc: '探针C-MD5',
  radar_v4_enc: '全景雷达-MD5',
  logistics: '物流查询',
  create_contract: '电子合同',
  auth_person_face: '个人人脸活体认证',
}

function skippedRiskRow(slotKey, reason, rawResponse = null) {
  return {
    slotKey,
    productLabel: SLOT_PRODUCT_LABEL[slotKey] || slotKey,
    state: 'skipped',
    skippedReason: reason,
    httpStatus: null,
    rawResponse,
    error: undefined,
  }
}

/**
 * @param {string} slotKey
 * @param {{ ok?: boolean, httpStatus?: number, response?: unknown, error?: string }} s execStep 结果
 */
function execStepToRiskRow(slotKey, s) {
  const label = SLOT_PRODUCT_LABEL[slotKey] || slotKey
  return {
    slotKey,
    productLabel: label,
    state: s.ok ? 'ok' : 'fail',
    httpStatus: s.httpStatus,
    error: s.error,
    rawResponse: s.response ?? null,
  }
}

/**
 * 仅调用一项风控能力（真实上游计费按次）；用于管理端手动联调。
 * @param {string} slotKey
 * @param {{ params?: CreditPreliminaryParams, enableSms?: boolean, tryContract?: boolean, manualInvoke?: boolean }} opts
 */
async function runSingleRiskSlot(slotKey, opts = {}) {
  const key = String(slotKey || '').trim()
  if (!FOURTEEN_SLOT_KEYS.has(key)) {
    const err = new Error(`不支持的风控槽位：${slotKey}`)
    err.code = 'bad_slot'
    throw err
  }

  const params = opts.params || {}
  const options = {
    enableSms: opts.enableSms === true,
    tryContract: opts.tryContract === true,
    manualInvoke: opts.manualInvoke === true,
  }

  if (!isRiskUpstreamConfigured()) {
    return skippedRiskRow(key, '未配置风控上游（RISK_UPSTREAM_BASE_URL / APP_ID / APP_KEY），无法调用真实接口')
  }

  const userName = String(params.userName || '').trim()
  const phoneNumber = String(params.phoneNumber || '').trim()
  let idNumber = String(params.idNumber || '').trim()
  const placeholder = String(process.env.RISK_PRELIMINARY_PLACEHOLDER_ID || '').trim()
  if (!idNumber && placeholder) {
    idNumber = placeholder
  }
  const idCardFront = String(params.idCardFront || '').trim()
  const idCardBack = String(params.idCardBack || '').trim()
  const triple = { idNumber, userName, phoneNumber }
  const hasTriple = !!(idNumber && userName && phoneNumber)

  switch (key) {
    case 'court_detail_pro':
      if (!hasTriple) {
        return skippedRiskRow(key, '缺少 idNumber / userName / phoneNumber（请在用户档案补全身份证）')
      }
      return execStepToRiskRow(key, await execStep(SLOT_PRODUCT_LABEL[key], 'court_detail_pro', () => postCourtDetailPro(triple)))
    case 'execution_pro':
      if (!hasTriple) {
        return skippedRiskRow(key, '缺少 idNumber / userName / phoneNumber（请在用户档案补全身份证）')
      }
      return execStepToRiskRow(key, await execStep(SLOT_PRODUCT_LABEL[key], 'execution_pro', () => postExecutionPro(triple)))
    case 'personal3':
      if (!hasTriple) {
        return skippedRiskRow(key, '缺少 idNumber / userName / phoneNumber')
      }
      return execStepToRiskRow(key, await execStep(SLOT_PRODUCT_LABEL[key], 'personal3', () => postPersonal3({
        name: userName,
        id_card: idNumber,
        mobile: phoneNumber,
      })))
    case 'auth_person_face':
      if (!hasTriple) {
        return skippedRiskRow(key, '缺少 idNumber / userName / phoneNumber')
      }
      return execStepToRiskRow(key, await execStep(SLOT_PRODUCT_LABEL[key], 'auth_person_face', () => postAuthPersonFace({
        name: userName,
        id_card: idNumber,
      })))
    case 'probe_c_enc':
      if (!hasTriple) {
        return skippedRiskRow(key, '缺少 idNumber / userName / phoneNumber')
      }
      return execStepToRiskRow(key, await execStep(SLOT_PRODUCT_LABEL[key], 'probe_c_enc', () => postProbeCEnc(triple)))
    case 'radar_v4_enc':
      if (!hasTriple) {
        return skippedRiskRow(key, '缺少 idNumber / userName / phoneNumber')
      }
      return execStepToRiskRow(key, await execStep(SLOT_PRODUCT_LABEL[key], 'radar_v4_enc', () => postRadarV4Enc(triple)))
    case 'mobile2':
      if (!userName || !phoneNumber) {
        return skippedRiskRow(key, '缺少姓名或手机号')
      }
      return execStepToRiskRow(key, await execStep(SLOT_PRODUCT_LABEL[key], 'mobile2', () => postMobile2({
        name: userName,
        mobile: phoneNumber,
      })))
    case 'ds_phone_time':
      if (!phoneNumber) {
        return skippedRiskRow(key, '缺少手机号')
      }
      return execStepToRiskRow(key, await execStep(SLOT_PRODUCT_LABEL[key], 'ds_phone_time', () => postDsPhoneTime({ phoneNumber })))
    case 'ds_phone_state':
      if (!phoneNumber) {
        return skippedRiskRow(key, '缺少手机号')
      }
      return execStepToRiskRow(key, await execStep(SLOT_PRODUCT_LABEL[key], 'ds_phone_state', () => postDsPhoneState({ phoneNumber })))
    case 'id_card_ocr': {
      let frontPart
      if (isHttpImageUrl(idCardFront)) {
        const ocrF = await execStep('身份证OCR（人像面）', 'ocr_front', () => postOcrIdentify({
          image: idCardFront,
          side: 'front',
        }))
        frontPart = {
          httpStatus: ocrF.httpStatus,
          ok: ocrF.ok,
          response: ocrF.response,
          error: ocrF.error,
        }
      }
      else {
        frontPart = { skipped: true, reason: '无人像面 http(s) 图片地址' }
      }
      let backPart
      if (isHttpImageUrl(idCardBack)) {
        const ocrB = await execStep('身份证OCR（国徽面）', 'ocr_back', () => postOcrIdentify({
          image: idCardBack,
          side: 'back',
        }))
        backPart = {
          httpStatus: ocrB.httpStatus,
          ok: ocrB.ok,
          response: ocrB.response,
          error: ocrB.error,
        }
      }
      else {
        backPart = { skipped: true, reason: '无国徽面 http(s) 图片地址' }
      }
      const rawResponse = { 人像面: frontPart, 国徽面: backPart }
      const fBad = !frontPart.skipped && frontPart.ok === false
      const bBad = !backPart.skipped && backPart.ok === false
      const bothSkippedExec = Boolean(frontPart.skipped && backPart.skipped)
      const anyFail = fBad || bBad
      return {
        slotKey: key,
        productLabel: SLOT_PRODUCT_LABEL[key],
        state: bothSkippedExec ? 'skipped' : (anyFail ? 'fail' : 'ok'),
        skippedReason: bothSkippedExec ? `人像面：${frontPart.reason || ''}；国徽面：${backPart.reason || ''}` : '',
        httpStatus: null,
        rawResponse,
        error: fBad ? frontPart.error : (bBad ? backPart.error : undefined),
      }
    }
    case 'cl_sms_send':
      if (!phoneNumber) {
        return skippedRiskRow(key, '缺少手机号')
      }
      if (!options.manualInvoke && !options.enableSms) {
        return skippedRiskRow(key, '短信通道需在请求体传 allowSms=true，或使用管理端手动调用（已默认允许）')
      }
      {
        const amt = Number(params.totalAmount || 0)
        const capMsg = `【信誉初审】验证码类短信通道联调，订单金额${amt}`.slice(0, 180)
        return execStepToRiskRow(key, await execStep(SLOT_PRODUCT_LABEL[key], 'cl_sms_send', () => postClSmsSend({
          phone: phoneNumber,
          msg: capMsg,
        })))
      }
    case 'cl_sms_notify':
      if (!phoneNumber) {
        return skippedRiskRow(key, '缺少手机号')
      }
      if (!options.manualInvoke && !options.enableSms) {
        return skippedRiskRow(key, '短信通道需在请求体传 allowSms=true，或使用管理端手动调用（已默认允许）')
      }
      {
        const amt = Number(params.totalAmount || 0)
        return execStepToRiskRow(key, await execStep(SLOT_PRODUCT_LABEL[key], 'cl_sms_notify', () => postClSmsNotify({
          phone: phoneNumber,
          msg: `【商城】您的分期订单已提交信誉初审，应付¥${amt.toFixed(2)}`.slice(0, 200),
        })))
      }
    case 'logistics':
      return skippedRiskRow(key, '注册用户场景无快递单号，开放平台物流类产品需在订单发货后有运单号再调用')
    case 'create_contract':
      if (!phoneNumber) {
        return skippedRiskRow(key, '缺少手机号')
      }
      {
        const contractNo = `ADM${Date.now()}`.slice(0, 40)
        return execStepToRiskRow(key, await execStep(SLOT_PRODUCT_LABEL[key], 'create_contract', () => postCreateContract({
          contractNo,
          contractName: `管理员手动-分期-${phoneNumber}`.slice(0, 120),
          signOrder: 1,
          validityTime: 30,
        })))
      }
    default:
      return skippedRiskRow(key, '未实现')
  }
}

module.exports = {
  runCreditPreliminaryReview,
  isRiskUpstreamConfigured,
  normalizeFourteenProductRows,
  runSingleRiskSlot,
  FOURTEEN_SLOT_KEYS,
}
