# 风控 API 说明（按接口分条）

服务前缀：`/risk-api`，完整示例：`http://localhost:3110/risk-api/...`。与商城等业务接口（见 `API.md`，前缀 `/api`）分离；实现见 `api/src/riskControl/`。

---

## 签名（所有需验签接口共用）

- **Content-Type：** `application/json`。
- **Body 顶层：** `appid`、`time`、`sign`；随机串为 **`rand` 或 `nostr`（二选一）**，签名算法相同。
- **业务字段：** 放在 `data`；签名字段 **`jsonData`** = 对 `data` 做递归按键名升序后的紧凑 JSON（实现：`signing.js` 的 `stableStringify`）。签名时不含 `appid`、`time`、`rand`/`nostr`、`sign`。
- **公式：** `sign = md5(appid + "#" + jsonData + "#" + time + "#" + appkey + "#" + randOrNostr)`，MD5 小写 32 位；拼接用的 **`time` 字符串**须与 Body 里 `time` 的文本形式一致。
- **时间：** `time` 可为毫秒或秒；默认允许与服务器偏差 ±300 秒（`RISK_CONTROL_TIMESTAMP_SKEW_SECONDS`）。
- **凭证：** 我方对接方用 `RISK_CONTROL_APP_ID` / `RISK_CONTROL_APP_KEY` 或 `RISK_CONTROL_CREDENTIALS_JSON`（详见 `api/.env.example`）；转发上游另配 `RISK_UPSTREAM_*`。

---

## `GET /health`

- **用在哪：** 探活；无需签名。
- **传参：** 无。
- **返回备注：** `data.credentialsConfigured` 表示是否已配置我方验签凭证（不返回密钥）。

---

## `POST /v1/ping`

- **用在哪：** 联调验签；仓库内业务未接。
- **鉴权：** 需签名（见上文）。
- **传参（Body）：**
  - `appid`、`time`、`sign`、`rand` 或 `nostr`：必填。
  - `data`：任意 JSON 对象（用于计算 `jsonData`）。
- **返回备注：** `data.echo` 为请求的 `data`。

---

## `POST /v1/court-detail-pro`

- **用在哪：** 法院信息（个人高级版）；服务端转发上游 `POST /api/risk.v4/courtDetailPro`。
- **鉴权：** 需签名；通过后服务端用 `RISK_UPSTREAM_*` 重新签名请求上游（路径可由 `RISK_UPSTREAM_COURT_DETAIL_PATH` 覆盖，超时见 `RISK_UPSTREAM_TIMEOUT_MS`）。
- **传参（Body）：**
  - 顶层签名字段：同 `/v1/ping`。
  - **`data`（必填）：** `idNumber`、`userName`、`phoneNumber`；仅这三项会发给上游。
- **返回备注：** 透传上游 JSON（如含 `data.CourtDetail` 等）；字段释义以开放平台为准。
- **常见错误：** 同下游网关：`50302`、`50201`、`50202`、`50401`、`40010`。

---

## `POST /v1/execution-pro`

- **用在哪：** 法院被执行（高级版）；服务端转发上游 `POST /api/risk.v4/executionPro`。
- **鉴权 / 传参：** 与 `/v1/court-detail-pro` 相同；路径可由 `RISK_UPSTREAM_EXECUTION_PRO_PATH` 覆盖。
- **返回备注：** 透传上游 JSON（如含 `data.ExecutionPro`、`data.Rule`（含 `hit_rules`、`result`）、`swift_number` 等）；开放平台输出的 `exp_*` 平铺字段含义见其文档，此处不展开。
- **常见错误：** 同上。

---

## `POST /v1/probe-c-enc`

- **用在哪：** 探针 C-md5；服务端转发上游 `POST /api/risk.V5/probeCEnc`（路径大小写与上游一致，可由 `RISK_UPSTREAM_PROBE_C_ENC_PATH` 覆盖）。
- **鉴权 / 传参：** 与 `/v1/court-detail-pro` 相同；**`data`：** `idNumber`、`userName`、`phoneNumber` 必填。开放平台 **`probeCEnc`** 约定三项须为 **32 位小写 MD5**；本服务在转发上游前会对 **明文三要素自动做 MD5**（若某字段已是 32 位 hex 则不再二次哈希）。直连华东云自行对接时需按其文档自行哈希。
- **返回备注：** 透传上游 JSON（如顶层含 `request_id`，`data` 内含 `result_code`、`acc_exc`、`currently_overdue` 等）；字段含义以开放平台为准。
- **常见错误：** 同上。

---

## `POST /v1/radar-v4-enc`

- **用在哪：** 全景雷达 v4-MD5；服务端转发上游 `POST /api/risk.V5/radarV4Enc`（可由 `RISK_UPSTREAM_RADAR_V4_ENC_PATH` 覆盖）。
- **鉴权 / 传参：** 与 `/v1/probe-c-enc` 相同（三项明文传入即可，**服务端转发上游前自动转为 MD5**，规则同探针）。
- **返回备注：** 透传上游 JSON（如顶层 `request_id`，`data` 下 `apply_report_detail`、`behavior_report_detail`、`current_report_detail` 及 `A2216*`、`B2217*`、`C2218*` 等编码字段）；逐项含义以开放平台「全景雷达」说明为准，此处不抄表。
- **常见错误：** 同上。
- **管理端摘要（本仓库）：** 管理后台按开放平台文档将 `apply_report_detail`、`behavior_report_detail`、`current_report_detail` 中的编码转为**中文指标名**分段展示（申请与查询、借贷与还款、授信与机构），便于非技术角色审阅；字段表见 `admin/src/utils/radarV4ReputationFacts.ts` 内 `RADAR_V4_MANAGER_LABELS`。

---

## `POST /v1/ocr-identify`

- **用在哪：** 身份证 OCR；服务端转发上游 `POST /api/sign/ocrIdentify`（可由 `RISK_UPSTREAM_OCR_IDENTIFY_PATH` 覆盖）。
- **鉴权：** 与其它接口相同（顶层 `appid`、`time`、`sign`、`rand`/`nostr`）。
- **传参（Body）：**
  - **`data.image`：** 必填；身份证图片 **可访问 URL**（与开放平台示例一致）。
  - **`data.side`：** 必填；`front`（人像面）或 `back`（国徽面），大小写不敏感；转发上游时使用小写。
  - 网关仅向上游发送 **`image`、`side`** 两项（勿将多余字段混入签名后的上游请求）。
- **返回备注：** 透传上游 JSON（`data` 中可能含 `idcard`、`realname`、`department`、`begin`、`end`、`photoBase64` 等，视 `side` 与识别结果而定）；详情以开放平台为准。
- **常见错误：** `40010`（缺字段或 `side` 非法）；其余同上游代理。

---

## `POST /v1/personal3`

- **用在哪：** 个人三要素对比 v2；服务端转发上游 `POST /api/datapay/personal3`（可由 `RISK_UPSTREAM_PERSONAL3_PATH` 覆盖）。
- **鉴权：** 与其它接口相同。
- **传参（Body）：**
  - **`data.name`：** 必填（开放平台示例字段名）；亦可填 **`data.userName`**，与 `/v1/court-detail-pro` 等保持一致。
  - **`data.id_card`：** 必填；亦可 **`data.idNumber`**。
  - **`data.mobile`：** 必填；亦可 **`data.phoneNumber`**。
  - 网关仅向上游发送 **`name`、`id_card`、`mobile`** 三项（开放平台约定的 snake_case）。
- **返回备注：** 透传上游 JSON；常见含义 **`data.result`**：`1` 三要素一致，`2` 不一致（以开放平台为准）。
- **常见错误：** `40010`（缺字段）；其余同上游代理。

---

## `POST /v1/ds-phone-time`

- **用在哪：** 在网时长；服务端转发上游 `POST /api/risk/dsPhoneTime`（可由 `RISK_UPSTREAM_DS_PHONE_TIME_PATH` 覆盖）。
- **鉴权：** 与其它接口相同。
- **传参（Body）：**
  - **`data.phoneNumber`：** 必填（与开放平台示例一致）；亦可填 **`data.mobile`**。
  - 网关仅向上游发送 **`phoneNumber`** 一项。
- **返回备注：** 透传上游 JSON；常见 **`data.corporation`**：`1` 移动、`2` 联通、`3` 电信；**`data.time`** 为区间字符串（如 `0-3`、`3-6`、`6-12`、`12-24`、`>24`），含义以开放平台为准。
- **常见错误：** `40010`（缺手机号）；其余同上游代理。

---

## `POST /v1/ds-phone-state`

- **用在哪：** 运营商状态；服务端转发上游 `POST /api/risk/dsPhoneState`（可由 `RISK_UPSTREAM_DS_PHONE_STATE_PATH` 覆盖）。
- **鉴权 / 传参：** 与 `/v1/ds-phone-time` 相同（**`data.phoneNumber`** 或 **`data.mobile`**）；网关仅向上游发送 **`phoneNumber`**。
- **返回备注：** 透传上游 JSON；常见 **`data.corporation`**：`1` 移动、`2` 联通、`3` 电信；**`data.state`**：`0` 在网、`1` 停机、`2` 在网不可用（以开放平台为准）。
- **常见错误：** `40010`（缺手机号）；其余同上游代理。

---

## `POST /v1/mobile2`

- **用在哪：** 运营商二要素验证（姓名 + 手机号）；服务端转发上游 `POST /api/datapay/mobile2`（可由 `RISK_UPSTREAM_MOBILE2_PATH` 覆盖）。
- **鉴权：** 与其它接口相同。
- **传参（Body）：**
  - **`data.name`：** 必填；亦可 **`data.userName`**。
  - **`data.mobile`：** 必填；亦可 **`data.phoneNumber`**。
  - 网关仅向上游发送 **`name`、`mobile`** 两项。
- **返回备注：** 透传上游 JSON；常见 **`data.result`**：`1` 验证一致，`2` 不一致，`3` 异常（以开放平台为准）。
- **常见错误：** `40010`（缺字段）；其余同上游代理。

---

## `POST /v1/auth-person-mobile3`

- **用在哪：** 个人运营商三要素认证；服务端转发上游 `POST /api/sign/authPersonMobile3`（可由 `RISK_UPSTREAM_AUTH_PERSON_MOBILE3_PATH` 覆盖）。
- **鉴权 / 传参：** 与 **`/v1/personal3`** 相同：**`data.name`**（或 **`userName`**）、**`data.id_card`**（或 **`idNumber`**）、**`data.mobile`**（或 **`phoneNumber`**）；网关仅向上游发送 **`name`、`id_card`、`mobile`**。
- **返回备注：** 透传上游 JSON；常见 **`data.result`**：`0` 暂无结果/认证中，`1` 成功，`2` 失败（以开放平台为准）；另含 **`serialNo`**、**`type`** 等。
- **常见错误：** `40010`（缺字段）；其余同上游代理。

---

## `POST /v1/auth-company-mobile3`

- **用在哪：** 企业运营商三要素认证（法人姓名、手机、证件号 + 企业名称、统一社会信用代码）；服务端转发上游 `POST /api/sign/authCompanyMobile3`（可由 `RISK_UPSTREAM_AUTH_COMPANY_MOBILE3_PATH` 覆盖）。
- **鉴权：** 与其它接口相同。
- **传参（Body）：**
  - **`data.name`：** 必填（法人姓名）；亦可 **`data.userName`**。
  - **`data.mobile`：** 必填；亦可 **`data.phoneNumber`**。
  - **`data.id_card`：** 必填（法人证件号）；亦可 **`data.idNumber`**。
  - **`data.company_name`：** 必填；亦可 **`data.companyName`**。
  - **`data.credit_code`：** 必填（统一社会信用代码）；亦可 **`data.creditCode`**。
  - 网关仅向上游发送 **`name`、`mobile`、`id_card`、`company_name`、`credit_code`** 五项（snake_case）。
- **返回备注：** 透传上游 JSON；常见 **`data.result`**：`0` 暂无结果/认证中，`1` 成功，`2` 失败（以开放平台为准）；另含 **`serialNo`**、**`type`** 等。
- **常见错误：** `40010`（缺字段）；其余同上游代理。

---

## `POST /v1/captcha-verify`

- **用在哪：** 认证校验码校验（短信验证码）；服务端转发上游 `POST /api/sign/captchaVerify`（可由 `RISK_UPSTREAM_CAPTCHA_VERIFY_PATH` 覆盖）。
- **鉴权：** 与其它接口相同。
- **传参（Body）：**
  - **`data.serialNo`：** 必填（认证流水号，与发起认证接口返回一致）；亦可 **`data.serial_no`**。
  - **`data.captcha`：** 必填（短信验证码）。
  - 网关仅向上游发送 **`serialNo`、`captcha`** 两项（camelCase，与开放平台示例一致）。
- **返回备注：** 透传上游 JSON；常见 **`data.result`**：`0` 暂无结果/认证中，`1` 成功，`2` 失败（以开放平台为准）；另含 **`serialNo`**、**`type`** 等。
- **常见错误：** `40010`（缺字段）；其余同上游代理。

---

## `POST /v1/captcha-resend`

- **用在哪：** 重新发送认证短信验证码；服务端转发上游 `POST /api/sign/captchaResend`（可由 `RISK_UPSTREAM_CAPTCHA_RESEND_PATH` 覆盖）。
- **鉴权：** 与其它接口相同。
- **传参（Body）：**
  - **`data.serialNo`：** 必填（认证流水号）；亦可 **`data.serial_no`**。
  - 网关仅向上游发送 **`serialNo`** 一项。
- **返回备注：** 透传上游 JSON（开放平台示例中 **`data`** 可能为空数组 `[]`）；具体结构以开放平台为准。
- **常见错误：** `40010`（缺流水号）；其余同上游代理。

---

## `POST /v1/get-auth-record-info`

- **用在哪：** 实名认证信息查询；服务端转发上游 `POST /api/sign/getAuthRecordInfo`（可由 `RISK_UPSTREAM_GET_AUTH_RECORD_INFO_PATH` 覆盖）。
- **鉴权 / 传参：** 与 **`/v1/captcha-resend`** 相同：**`data.serialNo`**（或 **`serial_no`**）；网关仅向上游发送 **`serialNo`**。
- **返回备注：** 透传上游 JSON；**`data`** 中常见 **`result`**（`0` 认证中、`1` 成功、`2` 失败）、**`authTypeCode`** / **`authTypeName`**、**`userType`**（`1` 企业、`2` 个人）、**`realName`**、**`mobile`**、**`idCardNo`**、企业 **`companyName`** / **`creditCode`**、办理人相关 **`agent*`** 等；字段释义以开放平台为准。
- **常见错误：** `40010`（缺流水号）；其余同上游代理。

---

## `POST /v1/auth-person-face`

- **用在哪：** 个人人脸活体认证；服务端转发上游 `POST /api/sign/authPersonFace`（可由 `RISK_UPSTREAM_AUTH_PERSON_FACE_PATH` 覆盖）。
- **鉴权：** 与其它接口相同。
- **传参（Body）：**
  - **`data.name`：** 必填；亦可 **`data.userName`**。
  - **`data.id_card`：** 必填；亦可 **`data.idNumber`**。
  - **可选（有值才转发）：** **`bizId`**（或 **`biz_id`**，最长 32 位业务 ID）、**`faceAuthMode`**（或 **`face_auth_mode`**，认证渠道：`1` 支付宝 / `2` H5 默认 / `4` 微信小程序 / `5` 支付宝小程序 / `9` 支付宝 H5 等，以开放平台为准）、**`redirectUrl`**（或 **`redirect_url`**，同步跳转）、**`metaInfo`**（或 **`meta_info`**，支付宝 H5 版等场景必填项见其文档）、**`notifyUrl`**（或 **`notify_url`**，异步通知）。
  - 网关转发 **`data`** 对象键名为开放平台 camelCase（**`name`、`id_card`、`bizId`、`faceAuthMode`、`redirectUrl`、`metaInfo`、`notifyUrl`**）；未传的可选字段不会出现在上游请求里。
- **返回备注：** 透传上游 JSON；常见 **`data.faceUrl`**（人脸识别链接）、**`result`**、`serialNo`、`type` 等（以开放平台为准）。
- **常见错误：** `40010`（缺姓名或证件号）；其余同上游代理。

---

## `POST /v1/user-face-result`

- **用在哪：** 查询人脸核身结果；服务端转发上游 `POST /api/sign/userFaceResult`（可由 `RISK_UPSTREAM_USER_FACE_RESULT_PATH` 覆盖）。
- **鉴权：** 与其它接口相同。
- **传参（Body）：**
  - **`data.bizId`：** 必填（接入商自定义业务 ID，最长 32 位）；亦可 **`data.biz_id`**。
  - 网关仅向上游发送 **`bizId`** 一项。
- **返回备注：** 透传上游 JSON；开放平台示例中含 **`data.msg`**、**`data.status`**（`1` 等待认证、`2` 认证成功、`3` 认证失败）；以开放平台为准。
- **常见错误：** `40010`（缺 bizId）；其余同上游代理。

---

## `POST /v1/add-personal-user`

- **用在哪：** 添加个人用户信息；服务端转发上游 `POST /api/sign/addPersonalUser`（可由 `RISK_UPSTREAM_ADD_PERSONAL_USER_PATH` 覆盖）。
- **鉴权：** 与其它接口相同。
- **传参（Body）：**
  - **`data.account`：** 必填（用户唯一识别码）。
  - **`data.serialNo`：** 必填（实名认证流水号）；亦可 **`data.serial_no`**。
  - 网关向上游发送 **`account`、`serialNo`**（camelCase，与开放平台一致）。
- **返回备注：** 透传上游 JSON。
- **常见错误：** `40010`（缺 account 或流水号）；其余同上游代理。

---

## `POST /v1/add-enterprise-user`

- **用在哪：** 添加企业用户信息；服务端转发上游 `POST /api/sign/addEnterpriseUser`（可由 `RISK_UPSTREAM_ADD_ENTERPRISE_USER_PATH` 覆盖）。
- **鉴权：** 与其它接口相同。
- **传参（Body）：**
  - **`data.account`：** 必填（用户唯一识别码，一般为企业在接入方的标识）。
  - **`data.serialNo`：** 必填（实名认证流水号）；亦可 **`data.serial_no`**。
  - 网关向上游发送 **`account`、`serialNo`**（camelCase，与开放平台一致）。
- **返回备注：** 透传上游 JSON（开放平台示例中含 **`data.sealNo`** 等印章相关字段，其余可能为 `null`）；以开放平台为准。
- **常见错误：** `40010`（缺 account 或流水号）；其余同上游代理。

---

## `POST /v1/create-contract`

- **用在哪：** 上传待签署文件（创建合同）；服务端转发上游 `POST /api/sign/createContract`（可由 `RISK_UPSTREAM_CREATE_CONTRACT_PATH` 覆盖）。下游仍为 JSON 验签；多文件上传若开放平台要求 multipart，需按其文档另行对接，此处 **`contractFiles`** 按开放平台 JSON 示例传 **URL 字符串数组**。
- **鉴权：** 与其它接口相同。
- **传参（Body `data`，网关转发键名为 camelCase，并支持常见 snake_case 别名）：**
  - **必填：** **`contractNo`**（或 **`contract_no`**，≤40 位）、**`contractName`**（或 **`contract_name`**，≤120 位，不可含 `* " : / \ < > |`）、**`signOrder`**（或 **`sign_order`**，`1` 无序、`2` 顺序）。
  - **有效期（二选一必填）：** **`validityTime`**（或 **`validity_time`**，剩余天数，整数）或 **`validityDate`**（或 **`validity_date`**，`yyyyMMddHHmmss` 字符串）。
  - **可选：** **`contractFiles`** / **`contract_files`**（字符串 URL 数组）、**`readSeconds`** / **`read_seconds`**、**`readType`** / **`read_type`**、**`needAgree`** / **`need_agree`**、**`autoExpand`** / **`auto_expand`**、**`notifyUrl`** / **`notify_url`**、**`callbackUrl`** / **`callback_url`**、**`userNotifyUrl`** / **`user_notify_url`**、**`redirectUrl`** / **`redirect_url`**、**`refuseOn`** / **`refuse_on`**、**`autoContinue`** / **`auto_continue`**、**`viewFlg`** / **`view_flg`**、**`redirectReturnUrl`** / **`redirect_return_url`**、**`redirectCompletedUrl`** / **`redirect_completed_url`**、**`storeCloudSign`** / **`store_cloud_sign`**、**`enableDownloadButton`** / **`enable_download_button`**。未传或空字符串的可选项不会出现在上游请求体中；数值项非法时静默跳过（与「未传」同类）。
  - 回调、强制阅读等语义以开放平台说明为准。
- **返回备注：** 透传上游 JSON（示例中含 **`data.previewUrl`**、**`data.contractFiles`** 附件信息等）。
- **常见错误：** `40010`（缺必填、signOrder 非法、合同名长度/非法字符、未提供有效期二者之一、`contractFiles` 非数组等）；其余同上游代理。

---

## `POST /v1/add-signer`

- **用在哪：** 添加签署方；服务端转发上游 `POST /api/sign/addSigner`（可由 `RISK_UPSTREAM_ADD_SIGNER_PATH` 覆盖）。
- **鉴权：** 与其它接口相同；**注意：** 开放平台示例中 **`data` 为数组**（每名签署方一个对象），联调时 **`jsonData`** 须对 **`data` 数组**做 `stableStringify`；单方签署也请传 **`[{ ... }]`**。
- **传参（Body `data` 数组元素，网关逐项组装为 camelCase 后发上游）：**
  - **每项必填：** **`contractNo`**（或 **`contract_no`**，≤40 位）、**`account`**、**`signType`**（或 **`sign_type`**，`2` 无感知、`3` 有感知）。
  - **可选（顶层，含 snake_case 别名）：** **`noticeMobile`** / **`notice_mobile`**，**`signOrder`** / **`sign_order`**（字符串），**`validateType`** / **`validate_type`**，**`validateTypeList`** / **`validate_type_list`**，**`faceAuthMode`** / **`face_auth_mode`**，**`autoSwitch`** / **`auto_switch`**，**`isNotice`** / **`is_notice`**，**`isNoticeComplete`** / **`is_notice_complete`**，**`waterMark`** / **`water_mark`**，**`autoSms`** / **`auto_sms`**，**`customSignFlag`** / **`custom_sign_flag`**，**`changeSeal`** / **`change_seal`**，**`signMark`** / **`sign_mark`**，**`fillCallBackUrl`** / **`fill_callback_url`**，**`bizId`** / **`biz_id`**；**`signStrategyList`** / **`sign_strategy_list`**、**`signStrikeList`** / **`sign_strike_list`**（须为数组，内部字段与开放平台示例一致，一般为 camelCase）；**`authConfig`** / **`auth_config`**（对象）。未列出的字段当前版本不会自动转发（新增需求再扩展）。
  - **`signStrategyList` / 骑缝章**等细则见开放平台表格。
- **返回备注：** 透传上游 JSON（示例中含 **`data.previewUrl`**、**`data.signUser`** 等）。
- **常见错误：** `40010`（`data` 须为非空数组、某项缺必填、`signType` 非法、`contractNo` 超长、列表/对象类型不符等）；其余同上游代理。

---

## `POST /v1/get-contract`

- **用在哪：** 查询合同信息；服务端转发上游 `POST /api/sign/getContract`（可由 `RISK_UPSTREAM_GET_CONTRACT_PATH` 覆盖）。
- **鉴权：** 与其它接口相同。
- **传参（Body）：**
  - **`data.contractNo`：** 必填（合同唯一编号）；亦可 **`data.contract_no`**（建议 ≤40 位，与创建合同一致）。
  - 网关仅向上游发送 **`contractNo`**。
- **返回备注：** 透传上游 JSON；常见 **`data.status`**（`0` 等待签约、`1` 签约中、`2` 已签约、`3` 过期、`4` 拒签、`6` 作废、`7` 撤销、`-2` 异常等）、**`contractName`**、**`validityTime`**、**`previewUrl`**、**`embeddedUrl`**、**`signUser`**（签署方列表及 **`signStatus`**、**`signUrl`** 等）、**`contractViewHis`**（访问日志）等；字段释义以开放平台为准。
- **常见错误：** `40010`（缺合同编号或超长）；其余同上游代理。

---

## `POST /v1/cl-sms-send`

- **用在哪：** 验证码短信发送；服务端转发上游 `POST /api/clSms/send`（可由 `RISK_UPSTREAM_CL_SMS_SEND_PATH` 覆盖）。与其它签名接口相同，使用我方 **`jsonData`** 验签后由 **`RISK_UPSTREAM_*`** 再签转发。
- **鉴权：** 与其它接口相同。
- **传参（Body）：**
  - **`data.phone`：** 必填（收件手机号）；亦可 **`data.mobile`** 或 **`data.phoneNumber`**。
  - **`data.msg`：** 必填（短信全文，须符合运营商/签名规范，如示例中的 **`【签名】…`**）。
  - 网关向上游发送 **`phone`、`msg`**（键名与开放平台一致）。
- **返回备注：** 透传上游 JSON（示例成功时 **`data`** 可能为空数组 `[]`）。
- **常见错误：** `40010`（缺手机号或短信内容）；其余同上游代理。

---

## `POST /v1/cl-sms-notify`

- **用在哪：** 通知短信发送；服务端转发上游 `POST /api/clSms/notify`（可由 `RISK_UPSTREAM_CL_SMS_NOTIFY_PATH` 覆盖）。
- **鉴权 / 传参：** 与 **`/v1/cl-sms-send`** 相同：**`data.phone`**（或 **`mobile`**、**`phoneNumber`**）、**`data.msg`**；网关向上游发送 **`phone`、`msg`**。
- **返回备注：** 透传上游 JSON（示例成功时 **`data`** 可能为空数组 `[]`）。
- **常见错误：** 同 **`/v1/cl-sms-send`**。

---

## 其它错误码（验签层）

- **`50301`：** 未配置我方风控凭证（且允许拦截时）。
- **`40001`～`40005`：** 缺参、`time` 无效/偏差、`data` 不可序列化等。
- **`40301` / `40302`：** 无效 `appid` / 签名不匹配。
