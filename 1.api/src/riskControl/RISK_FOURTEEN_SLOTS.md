# 十四项风控槽位：数据来源与测试分类说明

本文档对应实现文件：`preliminaryReview.js`。其中：

- **`runCreditPreliminaryReview`**：下单场景把 14 个展示位对应的接口按固定顺序编排、一次性跑完（批量封装）。
- **`runSingleRiskSlot`**：只调用其中一个槽位（适合测试阶段逐项验收）。

全局前提：**必须配置上游**（`RISK_UPSTREAM_*` 或 `HD_CLOUD_*` 等），否则所有真实调用均为跳过，不会命中开放平台。

---

## 1. 与「用户注册信息」的关系（怎么理解「直接调取」）

下面说的「注册信息」指你们用户在库里常见字段，例如：`name`（真实姓名）、`phone`、`idNumber`、`idCardFront` / `idCardBack`（身份证正反面 **http(s) 图片 URL**）等。实际字段名以你们 `users` 模型为准。

| 注册阶段通常是否齐全 | 能直接支撑哪些槽位 |
|---------------------|-------------------|
| 仅有手机号 | `ds_phone_time`、`ds_phone_state` |
| 姓名 + 手机号（无常驻身份证号） | 再加上 `mobile2` |
| 姓名 + 手机号 + 身份证号（实名三要素） | 再加上法院/雷达/三要素/人脸等「身份包」内接口（见下文列表） |
| 另有身份证照片 **公网 URL** | 再加上 `id_card_ocr`（正反面各一次 OCR） |

**结论**：十四项里**没有哪一项**在「完全匿名、只有昵称」的前提下还能跑通；最少也要手机号才能做运营商类查询。

---

## 2. 按「依赖输入」分的三大类（推荐测试心智模型）

### A 类 — 不依赖身份证号，仅凭「姓名 + 手机」或「仅手机」

适合最先测通道与签名是否正常。

| 槽位 `slotKey` | 批量封装所需 | 单槽 `runSingleRiskSlot` 所需 |
|----------------|-------------|------------------------------|
| `mobile2` | `userName` + `phoneNumber` | 同上 |
| `ds_phone_time` | `phoneNumber` | 同上 |
| `ds_phone_state` | `phoneNumber` | 同上 |

说明：这类接口**可以把注册里的姓名、手机号拿来就直接调**（若注册未采集真实姓名，则 `mobile2` 不具备条件）。

---

### B 类 — 依赖「实名三要素」：身份证号 + 姓名 + 手机号

批量封装里若缺少任一要素，会走 `identity_bundle` 跳过逻辑，十四格里对应 6 个槽位会显示为 skipped；单槽则会返回缺少三要素的跳过原因。

| 槽位 `slotKey` | 说明 |
|----------------|------|
| `court_detail_pro` | 法院信息（个人高级版） |
| `execution_pro` | 被执行人（高级版） |
| `personal3` | 个人三要素比对 |
| `probe_c_enc` | 探针 C（MD5） |
| `radar_v4_enc` | 全景雷达 V4（MD5） |
| `auth_person_face` | 个人人脸活体认证（当前客户端仅传 `name` + `id_card`，上游若还需活体流水/回调以开放平台文档为准） |

**与注册的关系**：用户必须在档案里**补全身份证 + 真实姓名 + 手机**，才能把这 6 项当作「用注册信息直接调取」；否则属于前置条件未满。

---

### C 类 — 依赖「批量封装开关 / 业务单据 / 额外参数」，不能单靠「填齐注册三项」

| 槽位 `slotKey` | 前置条件 | 批量 `runCreditPreliminaryReview` | 单槽 `runSingleRiskSlot`（管理端 `manualInvoke: true`） |
|----------------|----------|-------------------------------------|----------------------------------------------------------|
| `id_card_ocr` | 人像面、国徽面各需 **合法 `http(s)` 图片 URL**（非 blob、非相对路径） | 无 URL 则 OCR 步骤 skipped | 缺哪面跳过哪面；两面都缺则整槽 skipped |
| `cl_sms_send` | 手机号；**真发短信会计费** | 需 `RISK_PRELIMINARY_ENABLE_SMS=1` 或请求选项 `enableSms` | 管理端单槽接口固定传 `manualInvoke: true`，**不会因未传 `allowSms` 而跳过**（仍会请求上游发短信，前提是手机号齐全）；`allowSms` 仅写入 `enableSms`，主要用于与其它调用方式对齐 |
| `cl_sms_notify` | 同上 | 同上 | 同上 |
| `create_contract` | 手机号；依赖上游合同能力 | 需 `RISK_PRELIMINARY_CONTRACT_TRY=1` 或 `tryContract`，否则 skipped | **与批量不同**：单槽在实现里**只要有手机号即尝试** `postCreateContract`（无需 `tryContract`） |
| `logistics` | **快递运单号等业务数据** | **永远不发起请求**，固定 skipped（文案：下单阶段无单号） | 单槽固定 skipped：注册用户场景无运单号 |

---

## 3. 十四槽位清单（逐项：能否「只靠注册字段」与注意事项）

| # | `slotKey` | 能否在「姓名+手机+身份证已入库」下直接调 | 额外前置 |
|---|-----------|------------------------------------------|----------|
| 1 | `court_detail_pro` | 是（三要素） | 上游计费 |
| 2 | `execution_pro` | 是（三要素） | 同上 |
| 3 | `personal3` | 是（三要素） | 同上 |
| 4 | `id_card_ocr` | **否** | 必须 `idCardFront` / `idCardBack` 公网图 URL |
| 5 | `mobile2` | 仅需姓名+手机（不需身份证） | — |
| 6 | `cl_sms_send` | **否**（批量默认不发） | 批量要开短信开关；测试注意骚扰与费用 |
| 7 | `cl_sms_notify` | **否** | 同上 |
| 8 | `ds_phone_time` | 仅需手机 | — |
| 9 | `ds_phone_state` | 仅需手机 | — |
| 10 | `probe_c_enc` | 是（三要素） | — |
| 11 | `radar_v4_enc` | 是（三要素） | — |
| 12 | `logistics` | **否** | 要有运单号并在独立流程中接入；当前初审封装不测 |
| 13 | `create_contract` | 批量下 **否**（默认跳过） | 批量开 `RISK_PRELIMINARY_CONTRACT_TRY=1`；单槽有手机即可试 |
| 14 | `auth_person_face` | 是（三要素，代码层） | 上游实际活体流程以文档为准 |

---

## 4. 测试阶段建议顺序（先单槽，再封装）

1. **环境**：确认上游 BASE_URL / APP_ID / APP_KEY，以及各路径环境变量与开放平台一致。  
2. **A 类**：`ds_phone_time` → `ds_phone_state` → `mobile2`（验证最小数据集）。  
3. **B 类**：在三要素齐全的测试用户上，逐个调用 `court_detail_pro`、`execution_pro`、`personal3`、`probe_c_enc`、`radar_v4_enc`、`auth_person_face`。  
4. **C 类**：  
   - 上传身份证图到可访问 URL 后测 `id_card_ocr`；  
   - 短信最后测并控制频率；  
   - 合同单槽与批量开关行为不同，需分别验收；  
   - `logistics` 在发货/物流子系统中单独设计请求，不要指望初审封装带出数据。  
5. **回归**：全部单槽通过后，再用 **`runCreditPreliminaryReview`** 跑完整编排，对照 `normalizeFourteenProductRows` 十四行是否与预期一致。

---

## 5. 参考：批量封装里的环境变量（摘自源码注释）

| 变量 | 作用 |
|------|------|
| `RISK_PRELIMINARY_PLACEHOLDER_ID` | 未传 `idNumber` 时的占位身份证号（联调用，生产慎用） |
| `RISK_PRELIMINARY_ENABLE_SMS=1` | 批量初审是否真实调用两条短信接口 |
| `RISK_PRELIMINARY_CONTRACT_TRY=1` | 批量初审是否尝试创建电子合同 |

---

## 6. 管理端单槽接口（便于联调）

`POST /users/:id/risk-slot/:slotKey`（需管理员权限）内部使用 `runSingleRiskSlot`，并把返回合并写入用户的 `riskControlSnapshot.fourteenRows` 对应行。具体权限与 body（如 `idNumber` 覆盖、`allowSms`）见 `api/src/index.js` 路由实现。
