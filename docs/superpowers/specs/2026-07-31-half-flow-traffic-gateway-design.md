# Half-Flow 新流量商独立接入设计

## 1. 目标

接入语雀《API半流程对接》定义的新流量商。业务时序对齐现有上海企浩渠道：用户准入、完整进件、基础校验后直接授信、授信结果回调、获取商城 H5、一次性免登录，进入商城后继续使用现有下单和订单风控流程。

新渠道只增加自己的代码和运行数据，不修改点多多、上海企浩或现有订单业务逻辑，不迁移、不批量处理、不更新或删除任何历史数据。

## 2. 已确认约束

- 使用方案 A：业务语义与上海企浩一致，通信协议严格按新渠道文档实现。
- 新渠道内部固定标识为 `halfFlow`。
- 新渠道目录、路由、环境变量、Mongo 集合、日志、回调记录和免登票据全部独立。
- 不导入 `zheyinTrafficGateway` 或 `duodiandianGateway` 的文件和函数。
- 不读写 `zheyinTrafficApplications` 或 `partnerGatewayApplications`。
- 不修改公共下单、订单审核、卡包发放、还款、管理后台或商城前端逻辑。
- 不在 API 启动时创建或更新渠道、流量商账号及其他业务数据。
- 不执行数据库迁移、集合重构、历史数据脚本或索引变更。
- 运行时只允许新增新渠道申请记录，以及准入通过后首次获取 H5 时新增的新商城用户。
- 手机号或身份证命中已有用户时直接拒绝，不绑定、不补字段、不修改已有用户。
- 新渠道默认关闭；只有配置完整并显式启用后才注册路由。

## 3. 接口范围

### 3.1 对流量商开放的入站接口

路由前缀由 `HALF_FLOW_TRAFFIC_ROUTE_PREFIX` 配置，推荐生产值为 `/open/partners/half-flow`。完整外部地址带现有 `/api` 前缀。

| 接口 | 方法 | 作用 |
| --- | --- | --- |
| `/admission` | POST | 用户准入/撞库 |
| `/apply` | POST | 用户完整进件 |
| `/app/link` | POST | 获取商城 H5 免登地址 |

### 3.2 新渠道出站接口

- 授信结果回调：发送到 `HALF_FLOW_TRAFFIC_CREDIT_NOTIFY_URL`。
- 不实现放款回调、订单审核回调、还款回调或结清回调。

### 3.3 商城内部接口

| 接口 | 方法 | 作用 |
| --- | --- | --- |
| `/login/consume` | POST | 消费一次性免登票据 |

该接口由新渠道生成的 H5 地址携带在 `consumePath` 中，不作为流量商业务接口发布。商城稳定免登契约使用查询参数和请求体字段 `applyNo`；本模块在独立路由内将其映射为流量商业务 `orderId`。

### 3.4 明确不实现

- 上海企浩的协议查询接口。
- 上海企浩的授信结果主动查询接口。
- 点多多的前置风控、风控结果复用和订单全生命周期回调。
- 任何流量商共用网关、共用申请表或共用业务服务。

## 4. 文件边界

新建目录：

```text
1.api/src/halfFlowTrafficGateway/
├── index.js
├── config.js
├── crypto.js
├── schema.js
├── repository.js
├── service.js
├── notify.js
└── routes.js
```

职责如下：

- `index.js`：只导出 halfFlow 网关的公开能力。
- `config.js`：读取和校验 `HALF_FLOW_TRAFFIC_*` 配置。
- `crypto.js`：实现新协议 AES-CTR + NoPadding、随机 nonce、Base64 封装和协议错误类型。
- `schema.js`：校验准入、进件、H5 请求字段，隔离文档字段拼写和枚举。
- `repository.js`：只访问 `halfFlowTrafficApplications` 集合；测试使用独立内存仓库。
- `service.js`：处理准入、进件、用户新增、H5 和票据业务。
- `notify.js`：构造并发送新渠道授信结果回调，记录最近通知结果。
- `routes.js`：注册新渠道路由、解析协议包、输出协议响应并声明 Mongo 刷新计划。

新建测试：

```text
1.api/tests/halfFlowTrafficGateway.test.js
```

只允许对现有文件做以下接线和配置修改：

- `1.api/src/index.js`：可选加载模块、注册路由、接入模块自己的 Mongo 刷新计划。
- `1.api/.env.development`：增加开发环境的新渠道完整配置和逐项中文备注。
- `1.api/.env.production`：增加生产环境的新渠道完整配置和逐项中文备注，初始保持关闭。

无需修改 `2.shop`、`3.admin`、`4.admin-liuliang`、`nginx.conf`、`store.js` 或共享 Mongo 集合映射。

## 5. 配置边界

所有可变运行参数都使用新渠道独立环境变量，并在 `1.api/.env.development` 和 `1.api/.env.production` 中分别维护完整配置：

```text
HALF_FLOW_TRAFFIC_ENABLED=false
HALF_FLOW_TRAFFIC_ROUTE_PREFIX=/open/partners/half-flow
HALF_FLOW_TRAFFIC_CHANNEL_CODE=
HALF_FLOW_TRAFFIC_REGISTER_CHANNEL_CODE=
HALF_FLOW_TRAFFIC_REGISTER_CHANNEL_NAME=
HALF_FLOW_TRAFFIC_AES_KEY=
HALF_FLOW_TRAFFIC_CREDIT_NOTIFY_URL=
HALF_FLOW_TRAFFIC_CUSTOMER_SERVICE_PHONE=
HALF_FLOW_TRAFFIC_DEFAULT_AMOUNT=2750
HALF_FLOW_TRAFFIC_DEFAULT_USER_QUOTA=2750
HALF_FLOW_TRAFFIC_CREDIT_EXPIRE_DAYS=365
HALF_FLOW_TRAFFIC_LOGIN_TOKEN_TTL_MS=600000
HALF_FLOW_TRAFFIC_NOTIFY_TIMEOUT_MS=8000
HALF_FLOW_TRAFFIC_LOAN_URL_TEMPLATE=
```

要求：

- 两份环境文件都必须包含上述全部变量，并在每组变量前写清用途、单位、格式、是否敏感、启用条件和生产上线注意事项。
- `config.js` 只读取和校验环境变量，不在代码中为路由、渠道信息、金额、有效期、超时、客服电话、回调地址或 H5 模板设置业务默认值。
- 模块启用时，任何必需变量缺失、格式非法或超出安全范围都不得注册路由；模块关闭时不得因尚未填写联调密钥而影响 API 启动。
- 开发与生产配置独立维护；生产配置初始固定为 `HALF_FLOW_TRAFFIC_ENABLED=false`，真实渠道码、密钥、回调地址和客服电话由上线人员在服务器环境文件中填写。
- `.env.development` 和 `.env.production` 已被 Git 忽略，不把其中的真实敏感值提交到版本库；本次只写安全占位值和详细备注。
- `AES_KEY` 是 Base64 编码值，解码后必须为 16、24 或 32 字节。
- `CHANNEL_CODE` 必须与对方请求头 `ChannelCode` 完全一致。
- `REGISTER_CHANNEL_CODE` 必须与我方流量管理中的“流量商标识”完全一致，用于用户归因和 H5 `channel` 参数，不发送到对方接口头。
- `REGISTER_CHANNEL_NAME` 只写入新创建用户的渠道归因快照。
- `DEFAULT_AMOUNT` 使用商城金额单位“元”；回调时转换为“分”。
- `LOAN_URL_TEMPLATE` 支持 `orderId`、`channel`、`token`、`consumePath` 和 `domainUrl`。
- 生产启用前，渠道必须通过现有管理流程作为一条新渠道记录配置完成；代码不自动写入渠道表。

协议字段名、接口后缀、`orderStatus=3`、成功码 `0` 以及独立集合名 `halfFlowTrafficApplications` 是双方协议或隔离边界，不是可变运行参数，保留为模块内常量且不得指向旧渠道资源。

## 6. 协议设计

### 6.1 请求

流量商请求使用：

```json
{
  "data": "Base64(nonce + ciphertext)"
}
```

请求头：

```text
Content-Type: application/json; charset=UTF-8
ChannelCode: 配置的渠道编码
```

解密流程：

1. 校验 `ChannelCode`。
2. Base64 解码 `HALF_FLOW_TRAFFIC_AES_KEY`。
3. Base64 解码 `body.data`。
4. 前 16 字节作为 AES-CTR nonce。
5. 剩余字节作为密文。
6. 使用 AES-CTR + NoPadding 解密，不添加或移除任何块填充。
7. 将解密结果按 UTF-8 JSON 解析，并要求结果为普通对象。

流量商在实际联调中明确协议为 NoPadding：直接加密 UTF-8 JSON 原始字节，解密后直接解析 JSON。该规则只属于新渠道独立模块，不影响其他渠道；固定明文、密钥、nonce 和密文测试向量用于持续验证双方行为。

### 6.2 业务响应

对流量商的成功响应统一为：

```json
{
  "code": 0,
  "message": "success",
  "data": "加密后的业务 JSON"
}
```

协议或参数错误保持 HTTP 200，返回非零 `code`、可读 `message` 和空 `data`，避免 Koa 默认错误页暴露内部信息。商城内部 `/login/consume` 继续使用商城现有 `{ success, data, msg }` 风格。

### 6.3 回调

授信回调使用同一套 `ChannelCode` 请求头和 AES-CTR 加密包。业务明文为：

```json
{
  "orderId": "流量商订单号",
  "orderStatus": 3,
  "money": 275000,
  "expireTime": 1817059200000
}
```

- `orderStatus=3` 表示基础授信通过。
- 当前方案没有异步人工审核，不主动发送 `orderStatus=1`。
- 基础资料校验失败时进件接口直接返回协议错误，不创建申请、不发送拒绝回调。
- 已经持久化但后续业务决定拒绝时才使用 `orderStatus=2` 和 `failReason`；当前方案不新增这种决策节点。
- 回调接收成功的判断为 HTTP 2xx 且响应 JSON `code` 等于数字或字符串 `0`。

## 7. 数据模型

独立集合：

```text
halfFlowTrafficApplications
```

每个身份只保留一个渠道申请主记录，字段分组如下：

- 标识：`id`、`channelCode`、`orderId`。
- 准入摘要：`mobileMd5`、`idCardMd5`、`admissionStatus`、`admissionAt`。
- 进件快照：`rawApplyPayload`、`userPhoneMasked`、`idCardMasked`。
- 授信：`creditStatus`、`creditAmountYuan`、`creditExpireAt`、`creditDecisionSource`。
- 用户关联：`mallUserId`、`mallUserCreatedAt`。
- 票据：`loginTokenHash`、`loginTokenIssuedAt`、`loginTokenConsumedAt`。
- 回调：`notifyLogs`、`lastNotifyStatus`、`lastNotifyAt`。
- 审计：`createdAt`、`updatedAt`。

集合不加入共享 `store.js` 数据结构，直接通过 Mongo repository 访问，从而不参与已有集合的全量读写和 JSON 回退序列化。

申请集合可以保存新渠道自己的完整进件快照，但日志和响应不得打印姓名、手机号、身份证、照片 URL、联系人或密钥。

## 8. 业务数据流

### 8.1 准入/撞库

输入明文：

```json
{
  "idCardMd5": "身份证MD5",
  "mobileMd5": "手机号MD5"
}
```

处理顺序：

1. 校验两个字段为 32 位十六进制 MD5，并统一转小写。
2. 查询 `halfFlowTrafficApplications` 是否已有相同摘要。
3. 已有相同新渠道申请时幂等返回通过，不创建重复记录。
4. 只读扫描现有商城用户；手机号或身份证任一 MD5 命中即拒绝。
5. 未命中时在独立集合新增准入记录。

通过业务响应：

```json
{
  "result": 1,
  "reason": "",
  "customerServicePhone": "配置的客服电话"
}
```

拒绝属于正常业务响应，外层 `code` 仍为 0：

```json
{
  "result": 0,
  "reason": "用户已存在",
  "customerServicePhone": "配置的客服电话"
}
```

### 8.2 用户进件

处理顺序：

1. 校验 `orderId`、`mobile`、`name`、`idCard`。
2. 校验 `authInfo`、`baseInfo`、`deviceInfo`、`contactInfos` 的文档必填字段。
3. 对明文手机号和身份证计算 MD5，必须命中本渠道已通过的准入记录。
4. `orderId` 已绑定同一身份时幂等返回成功。
5. `orderId` 已绑定其他身份，或身份已绑定其他 `orderId` 时拒绝。
6. 保存完整进件快照及掩码摘要，不创建商城用户。
7. 按上海企浩现行逻辑直接设置基础授信通过，额度和有效期来自本渠道配置。
8. 先持久化申请，再异步发送 `orderStatus=3` 授信回调。
9. 进件接口立即返回本渠道文档定义的成功业务数据。

新渠道不调用现有风控包，也不复用点多多进件风控。

### 8.3 获取 H5

输入明文：

```json
{
  "orderId": "流量商订单号",
  "domainUrl": "可选渠道链接"
}
```

处理顺序：

1. 只查询本渠道独立集合中的 `orderId`。
2. 要求申请已经基础授信通过。
3. 如果申请已有 `mallUserId`，只允许复用该申请自己创建的用户。
4. 如果尚未创建用户，再次按手机号和身份证查询共享用户。
5. 命中任何已有用户时拒绝，绝不绑定或修改该用户。
6. 未命中时新增商城用户，并写入本渠道归因字段和默认额度。
7. 等待用户持久化成功。
8. 生成随机一次性 token，只在响应 URL 中返回明文；申请集合只保存 SHA-256 哈希。
9. 更新申请的 `mallUserId` 和票据状态。
10. 返回字段 `repaymentAddress`，值为带 `trafficLogin=1`、`channel`、`applyNo`、`token` 和 `consumePath` 的商城 H5 地址；其中 `applyNo` 的值来自本渠道 `orderId`。

### 8.4 消费免登票据

1. 接收商城请求体 `{ applyNo, token }`，在本渠道独立路由内将 `applyNo` 映射为内部 `orderId`，再查询本渠道申请。
2. 校验授信状态、token 哈希、签发时间、有效期和未消费状态。
3. 按申请保存的 `mallUserId` 查询商城用户。
4. 标记票据已消费并持久化。
5. 返回现有商城登录凭证格式和必要用户资料。
6. 同一票据再次使用时拒绝。

进入商城后，新用户完全使用现有下单、订单风控、审核、卡包和还款流程；halfFlow 模块不再参与。

## 9. 新商城用户映射

只映射商城已有字段，不修改共享用户结构：

| 商城字段 | 新渠道来源 |
| --- | --- |
| `name` | `name` |
| `phone` | `mobile` |
| `idNumber` | `idCard` |
| `idCardFront` | `authInfo.idCardFront` |
| `idCardBack` | `authInfo.idCardBack` |
| `idCardHandheld` | `authInfo.faceUrl` |
| `locationText` | `baseInfo.province + city + area + address` |
| `emergencyContacts` | `contactInfos` 两位联系人 |
| `quota` | `HALF_FLOW_TRAFFIC_DEFAULT_USER_QUOTA` |
| `registerChannelCode` | `HALF_FLOW_TRAFFIC_REGISTER_CHANNEL_CODE` |
| `registerChannelName` | `HALF_FLOW_TRAFFIC_REGISTER_CHANNEL_NAME` |

人脸分、置信度、设备、收入、行业和单位信息保留在独立申请集合，不扩展历史用户结构。

## 10. 幂等与错误处理

- 准入以 `mobileMd5 + idCardMd5` 幂等。
- 进件以 `channelCode + orderId` 幂等。
- 同一 `orderId` 不允许更换手机号或身份证。
- 同一身份不允许绑定两个 `orderId`。
- H5 重复获取可以轮换新票据；旧的未消费票据立即失效。
- 登录票据只能使用一次，默认 10 分钟有效。
- 回调成功去重键为 `orderId + orderStatus`，成功状态和通知日志写入独立申请记录。
- 回调失败只记录失败，不回滚已经完成的基础授信，不影响接口主流程。
- 配置缺失时不注册路由，记录不含密钥的警告。
- 解密、JSON、字段校验和渠道不匹配统一转换为协议失败响应，不抛出 Koa HTML 错误页。
- Mongo 写入失败时不得返回业务成功。
- 新商城用户写入失败时不得返回 H5 地址。

## 11. 上线保护

1. `1.api/.env.development` 和 `1.api/.env.production` 都写入完整的新渠道配置及详细备注，代码合入和生产部署时保持 `HALF_FLOW_TRAFFIC_ENABLED=false`。
2. 不把真实密钥、回调 URL、客服电话或渠道编码提交到 Git；真实值只在对应服务器的环境文件中维护。
3. 先运行单元测试和全量后端测试。
4. 在测试环境配置独立 `ChannelCode` 和 AES 密钥。
5. 与流量商确认 AES-CTR 固定测试向量、金额单位、时间戳和回调成功响应。
6. 使用测试身份完成准入、进件、回调、H5、免登全链路。
7. 确认点多多和上海企浩测试全部不变。
8. 确认未修改历史用户、订单、旧渠道和旧申请。
9. 生产只在 `1.api/.env.production` 新增本渠道环境变量，先保持关闭并重启验证旧业务。
10. 配置新渠道管理记录后再开启 `HALF_FLOW_TRAFFIC_ENABLED=true`。
11. 上线异常时只关闭该开关并重启，不回滚或处理任何业务数据。

## 12. 测试与验收

### 12.1 协议测试

- Base64 AES 密钥长度校验。
- 固定 nonce 的 AES-CTR + NoPadding 加密结果测试。
- 密文长度与 UTF-8 JSON 原始字节长度一致测试。
- `Base64(nonce + ciphertext)` 解密往返测试。
- 错误 `ChannelCode`、无 data、短 nonce、非法 Base64、非法 JSON 测试。
- 外层成功和失败响应字段测试。

### 12.2 准入测试

- 新身份准入通过并只写本渠道集合。
- 已有商城手机号拒绝且不修改用户。
- 已有商城身份证拒绝且不修改用户。
- 相同新渠道身份重复准入幂等。
- 点多多和上海企浩申请数据保持原样。

### 12.3 进件和回调测试

- 文档全部必填字段校验。
- 未准入身份禁止进件。
- 相同 `orderId` 同身份重复提交幂等。
- `orderId` 身份冲突拒绝。
- 基础授信额度、有效期和状态正确。
- 回调 `orderStatus=3`、金额分转换、13 位时间戳正确。
- 申请先持久化，再触发异步回调。
- 回调失败记录在本渠道申请中，不影响其他集合。

### 12.4 H5 和免登测试

- 未授信申请不能获取 H5。
- 首次获取 H5 只新增一个商城用户。
- 并发出现历史用户时拒绝且不修改历史用户。
- 重复获取 H5 不重复创建用户，只轮换本渠道票据。
- H5 使用 `repaymentAddress` 字段，携带本渠道 `consumePath`，并以 `applyNo=<orderId>` 对齐商城稳定免登契约。
- token 哈希保存、明文不落库、过期拒绝、重复消费拒绝。

### 12.5 隔离测试

- 模块源码不导入点多多或上海企浩模块。
- 禁用时不注册任何 halfFlow 路由。
- 新渠道请求只访问声明的集合。
- 运行完整测试后，点多多和上海企浩测试仍通过。
- 不修改 `orders`、历史 `users`、`trafficChannels`、`trafficPartners`、`partnerGatewayApplications` 和 `zheyinTrafficApplications`。
- 从项目根目录运行 `node scripts/check-mojibake.js .` 并通过。

## 13. 验收结论

满足以下条件才允许声明完成：

- 新渠道业务时序与上海企浩一致。
- 新渠道协议严格符合语雀半流程文档及双方确认的测试向量。
- 所有新渠道代码、配置、数据和测试独立。
- 未改动点多多、上海企浩和公共订单业务逻辑。
- 未执行数据库迁移或历史数据操作。
- 新渠道关闭时，现有线上行为与接入前一致。
- 乱码检查、定向测试和后端全量测试全部通过。
