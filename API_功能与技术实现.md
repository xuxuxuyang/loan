# API 项目功能与技术实现分析

> 分析对象：`1.api`  
> 分析日期：2026-08-24  
> 分析方式：静态阅读入口、路由、业务模块、存储层、第三方集成、脚本与测试；未启动服务，未连接 MongoDB，未调用任何外部接口。  
> 文档定位：记录当前源码真实实现。本文不是接口改造方案，也不代表所有现状都满足生产安全要求。

## 1. 分析范围与结论

本次覆盖 `1.api` 中的 116 个 Git 跟踪文件，重点逐项检查了：

- `src/` 下 66 个文件，其中 65 个 JavaScript 文件，约 28,200 行；
- 约 12,579 行、445 KB 的单体入口 `src/index.js`；
- 商城、Admin、平台租户、流量商、支付、风控、客服、合同、上传、iOS 等全部路由注册点；
- MongoDB/JSON 双存储、三类工作区、多租户解析、缓存刷新和写入保护；
- 拉卡拉、风险开放平台、阿里云 OSS、Nominatim、Puppeteer/Chromium 等外部集成；
- 31 个测试文件、228 个 `node:test` 用例，以及生产/运维辅助脚本；
- 现有 `API.md`、`RISK_CONTROL_API.md` 与当前代码之间的覆盖差异；
- Admin 前端对 API 的关键调用契约，特别是租户删除能力。

总体上，项目已经不是简单的商城 Mock API，而是一个同时承载商城端、运营后台、平台多租户、流量渠道、合作方网关、支付、风控、合同与客服的综合 Koa 服务。核心业务能力较完整，数据持久化保护和若干独立模块的测试也较扎实；但认证体系仍保留大量 Mock 设计，支付回调验签、用户身份绑定、银行卡数据暴露等问题不适合直接按生产安全标准使用。

## 2. 技术栈与运行方式

| 类别 | 当前实现 |
| --- | --- |
| 运行时 | Node.js，CommonJS |
| Web 框架 | Koa 3、`@koa/router` |
| 跨域与请求体 | `@koa/cors`、`koa-bodyparser` |
| 上传 | `@koa/multer`，内存存储后上传 OSS |
| 静态资源 | `koa-static` + `koa-mount` |
| 主数据库 | MongoDB 7 驱动，按业务实体分集合 |
| 本地回退 | JSON 文件；主存储仅在 `ALLOW_JSON_FALLBACK=true` 时允许回退 |
| 对象存储 | Ali OSS |
| 合同 PDF | Puppeteer Core、`@sparticuz/chromium`、浏览器 CLI 回退 |
| 支付 | 拉卡拉聚合收银台，RSA-SHA256 请求签名 |
| 风控 | 自有 `/risk-api` 验签代理 + 华东云/风险开放平台上游 |
| 测试 | Node.js 内置 `node:test` + `assert`，部分源码契约测试 |
| 开发启动 | `npm run dev`，`nodemon` 监听 `src/**/*.js|json` |
| 生产启动 | `npm start` 或 PM2 `ecosystem.config.cjs` |
| 默认端口 | `3110`，可由 `PORT` 覆盖 |

主要 npm 命令：

| 命令 | 作用 | 当前状态 |
| --- | --- | --- |
| `npm test` | 先执行根目录乱码检查，再运行 `tests/*.test.js` | 有效 |
| `npm run check:mojibake` | 检查整个仓库 UTF-8/中文乱码 | 有效 |
| `npm run dev` | 开发模式热重载 | 会启动服务并尝试数据库连接 |
| `npm start` | 生产模式启动服务 | 会连接/初始化持久化，不应作为只读检查使用 |
| `npm run benchmark:load` | 预期运行压力测试 | 当前引用的 `scripts/load-benchmark.cjs` 不存在，会失败 |

PM2 配置使用进程名 `bossapi`、工作目录为 API 根目录、默认端口 `3110`，设置重启次数、最小存活时间、延迟重启与独立日志文件。当前配置是单应用单实例，没有声明 `instances` 或 cluster 模式。

## 3. 服务入口与中间件链

### 3.1 路由前缀

- `/api`：商城、Admin、平台、多租户、支付、流量、客服、上传、iOS 和合作方网关的主前缀；
- `/risk-api`：对外风控签名代理；
- `/static` 与 `/api/static`：映射 `1.api/public`；
- 哆点点网关同时注册在 `/api + DUODIANDIAN_ROUTE_PREFIX` 和不带 `/api` 的 `DUODIANDIAN_ROUTE_PREFIX`；
- 浙银与半流程网关由开关控制，注册在 `/api + 各自 routePrefix`。

### 3.2 请求处理顺序

1. 全开放 CORS；
2. 挂载静态目录；
3. 解析 JSON、表单和文本，请求体上限统一为 12 MB；
4. 解析租户和工作区，并用 `AsyncLocalStorage` 保存当前请求上下文；
5. Mongo 模式下创建单请求 refresh 去重上下文；
6. 按路由的 refresh plan 执行全量、部分集合刷新或跳过刷新；
7. 在租户业务工作区登记已知租户元数据；
8. 执行业务路由；
9. 默认在写请求响应结束前等待当前作用域 Mongo 持久化队列；
10. 依次挂载 `/api`、哆点点无 `/api` 兼容路由、`/risk-api`。

### 3.3 启动流程

服务启动时会：

1. 根据 `NODE_ENV` 加载 `.env.development` 或 `.env.production`；
2. 清理代理环境变量并合并 `NO_PROXY`；
3. 尝试连接 MongoDB；
4. 从 Mongo hydrate 当前快照，必要时迁移旧 `appState/main`；
5. 若要求 Mongo 但未连接成功则退出；
6. 若未连接 Mongo 且未显式允许 JSON 回退也退出；
7. 确保商品目录、哆点点渠道和流量门户账号存在；
8. 对账分期完成状态；
9. 持久化流量渠道/合作方数据；
10. 最后监听端口。

因此，静态分析和语法检查不应通过 `npm start` 验证，否则可能触发 Mongo 连接、旧数据迁移、种子写入和状态对账。

## 4. 多租户与工作区隔离

### 4.1 三种工作区

| 工作区 | Mongo 数据库 | 用途 |
| --- | --- | --- |
| `core` | `${dbName}__core` | 总部/平台级元数据与平台账号 |
| `self` | `${dbName}__self` | 平台自营业务 |
| `tenant` | 根库或 `${dbName}__tenant_${tenantId}` | 默认商城或具体租户业务 |

`tenantId=default` 使用根业务库；其它租户使用独立数据库。上下文由 `AsyncLocalStorage` 传递，因此 `readDb()`、`writeDb()` 和 `mongo.getMongoDb()` 会自动指向当前请求的工作区。

### 4.2 租户解析顺序

1. `x-tenant-id`；
2. `x-tenant`、`x-org-id`、`x-client-id`；
3. Query 中的 `tenantId`、`tenant`、`orgId`、`clientId`；
4. Host 的第一个子域；
5. `default`。

租户标识会转小写，只保留字母、数字、下划线和中划线，最长 64 位。

工作区来自 `x-workspace-type`、`x-workspace` 或 Query。请求 `core/self` 时，代码会验证 Bearer 对应的是有效平台账号，否则强制回落到 `tenant`。该保护能阻止单独伪造工作区头直接进入总部库。

### 4.3 后台账号作用域

- `scopeType=platform`：可访问全部租户，`scopeTenantIds=['*']`；
- `scopeType=tenant`：只能访问账号绑定的租户集合；
- 平台账号进入具体租户后当前实现允许读、写、删；
- `x-admin-username` 用于同手机号跨数据库账号的消歧；
- 平台账号和租户账号都必须能解析到实际 `adminAccounts` 记录，单独伪造角色头通常不能通过受保护接口。

## 5. 数据模型与持久化

### 5.1 主快照集合

| 集合 | 主要内容 |
| --- | --- |
| `products` | 商品、分类、销售模式、价格、卡包本金、上下架状态、图片 |
| `orders` | 订单、支付类型、物流、风控、卡包、合同、分期计划、协商记录、催收备注 |
| `users` | 商城账号、实名资料、额度、注册渠道、紧急联系人、风险快照、黑名单 |
| `adminAccounts` | 后台账号、角色、作用域、状态、菜单与动作权限 |
| `addresses` | 收货地址及默认地址 |
| `bankCards` | 银行卡名称、卡种、卡号、持卡人 |
| `bills` | 兼容账单数据；当前分期账单主要由订单计划动态生成 |
| `trafficChannels` | 推广渠道、点击、状态、备注 |
| `trafficPartners` | 流量商门户账号及绑定渠道 |
| `partnerGatewayApplications` | 哆点点进件、异步审核、免登票据与回调记录 |
| `csSessions` | 客服会话、消息、访客密钥和双方未读数 |
| `lakalaPayments` | 拉卡拉预订单、状态、渠道、回调原文与支付时间 |
| `dashboardSimulationConfigs` | 财务汇算模拟配置 |

元数据位于 `app_meta`，主文档 `_id=main`，保存 `_meta` 与更新时间。旧版整库单文档 `appState/main` 在启动时迁移到分集合，成功后删除旧文档。

### 5.2 独立集合

| 集合 | 所属模块 | 说明 |
| --- | --- | --- |
| `mallContactUploads` | 商城/iOS 通讯录 | 上传会话、账号、订单、批次数和完成时间 |
| `mallContactUploadBatches` | 商城/iOS 通讯录 | 以 `uploadId:batchIndex` 保存分批联系人 |
| `halfFlowTrafficApplications` | 半流程网关 | 独立申请、审批、回调抢占、商城账号绑定与免登 token |
| `zheyinTrafficApplications` | 浙银网关 | 准入、授信申请、审核、商城账号绑定与免登 token |

### 5.3 快照与写入机制

- 内存快照按 `core`、`self`、`tenant:<id>` 分开缓存；
- `MONGO_REFRESH_MODE=version` 时仅在 `app_meta.updatedAt` 变化后全量刷新；
- `every_request` 每次读取全快照，适合作为一致性回滚模式；
- `single_instance` 信任单进程内存，只适合单实例；
- 同一个请求中的 Mongo refresh 会去重，同一 scope 的 hydrate 会串行化；
- 支持全库、指定集合和单实体持久化；
- 每个 scope 的写入通过 Promise 队列串行；
- 默认写请求在响应前等待落库，避免紧随其后的 GET 读到旧快照；
- Mongo refresh 失败时，GET 可继续使用内存快照，写请求会返回 503 以保护线上数据；
- 全量持久化前有“大比例缩减”保护，防止陈旧快照批量删除 Mongo 数据；
- `MONGODB_REQUIRED=true` 或 `DISABLE_JSON_STORE=true` 可强制 Mongo；
- JSON 回退只应在本地调试使用。

## 6. 认证、密码与权限

### 6.1 商城用户

- 密码摘要：`SHA-256(MALL_PASSWORD_PEPPER + ':' + password)`；
- 支持密码登录和短信验证码登录；
- 注册短信与登录短信使用两个进程内 `Map`；
- 验证码默认 6 位、5 分钟有效、60 秒内不重复发送，验证成功后消费；
- 登录返回 `mock-token-{手机号}`；
- 部分新接口从 Bearer 解析手机号，但大量旧商城接口仅信任 `?phone=` Query；
- 用户资料对外会去掉 `passwordHash` 和 `adminPasswordPlain`。

### 6.2 后台账号

角色包括：

| 角色 | 代码值 | 默认定位 |
| --- | --- | --- |
| 超级管理员 | `super_admin` | 平台、租户、账号、权限、全部业务 |
| 老板 | `boss` | 租户业务与多数管理功能，不含平台租户管理 |
| 审核员 | `reviewer` | 审核、订单、用户和客服的受限操作 |
| 催收员 | `collector` | 卡包数据、待收、还款和催收相关操作 |

实现特点：

- 后台密码当前以明文写入 `adminAccounts.password` 并直接比较；
- 后台 token 同样是 `mock-token-{账号手机号}`；
- `ENFORCE_ADMIN_RBAC` 默认开启；
- 权限模型包含菜单权限和动作权限，如 `orders.review:review`、`orders.cardData:markPaid`；
- `super_admin` 的动作权限直接放行；
- 老板默认拥有除平台租户管理外的大部分功能；
- 受保护路由不仅检查角色，还检查有效账号、租户作用域和实际权限；
- `resolveAdminRole()` 保留 `x-admin-role`、`x-user-role` 和 Query `adminRole` 兼容入口，但后续 `requireAdminPermission()` 仍要求解析出实际账号。

### 6.3 引导账号

空库会注入一个平台超管。优先读取：

- `BOOTSTRAP_SUPER_ADMIN_USERNAME`；
- `BOOTSTRAP_SUPER_ADMIN_PHONE`；
- `BOOTSTRAP_SUPER_ADMIN_PASSWORD`。

代码仍包含历史兼容默认用户名、手机号和 4 位密码。生产环境必须显式配置强凭证，不能依赖代码默认值。本文不记录实际 `.env.development` 或 `.env.production` 中的秘密。

## 7. 通用响应与接口约定

大多数 `/api` 成功响应：

```json
{
  "success": true,
  "code": 0,
  "msg": "ok",
  "data": {}
}
```

失败通常通过 `fail()` 返回：

```json
{
  "success": false,
  "code": 400,
  "msg": "错误说明",
  "data": null
}
```

例外包括：

- `/risk-api` 使用独立的签名协议和业务错误码；
- 半流程、浙银、哆点点网关按合作方协议封装结果；
- 合同预览直接返回 HTML；
- 用户导出直接返回带 BOM 的 CSV；
- 拉卡拉通知按支付模块约定返回文本/对象。

## 8. `/api` 功能与技术实现

### 8.1 健康、地理和静态资源

| 方法与路径 | 功能 | 技术实现 |
| --- | --- | --- |
| `GET /api/health` | 服务、云接口、Mongo 和持久化健康状态 | 查询每个实体集合数量、`app_meta` 更新时间和旧 `appState` 是否残留；不返回数据库密码 |
| `GET /api/geocode/reverse` | 经纬度逆地理解析 | 校验范围后请求 Nominatim 或 `REVERSE_GEOCODE_URL`，整理中文地址 |
| `GET /static/*` | 公共静态文件 | 映射 `1.api/public` |
| `GET /api/static/*` | 反代兼容静态文件 | 与 `/static` 指向同一目录 |

### 8.2 商品

| 方法与路径 | 功能 | 技术实现 |
| --- | --- | --- |
| `GET /api/products` | 商品列表、分类/关键字/销售模式筛选 | 支持 `mall`、`installment`，可走 Mongo 单集合读取和短缓存；普通请求只看上架商品 |
| `GET /api/products/:id` | 商品详情 | 统一旧分类键，后台请求额外检查对应商品分区权限 |
| `POST /api/products` | 新建商品 | 校验价格、分类、销售模式等，按当前最大数值 ID 加一 |
| `PATCH /api/products/:id` | 编辑或上下架 | 单独识别 `toggleOnSale` 权限，其它字段要求 `update` |
| `DELETE /api/products/:id` | 删除商品 | 按销售模式检查 `delete` 权限后持久化 `products` |

分类支持 `phone`、`digital`、`appliance`、`cosmetics`，旧 `travel/mobile/jewelry` 等键只在读取时映射。销售模式区分普通商城和先享后付。

### 8.3 商城注册与登录

| 方法与路径 | 功能 | 技术实现 |
| --- | --- | --- |
| `POST /api/auth/register/sms/send` | 注册验证码 | 校验未注册手机号，调用风控上游短信接口，进程内记录验证码 |
| `POST /api/auth/login/sms/send` | 登录验证码 | 仅已注册手机号可发送，与注册验证码分桶 |
| `POST /api/auth/register` | H5/Android 完整注册 | 校验姓名、身份证、密码、两位紧急联系人、推广渠道和短信验证码，写入用户 |
| `POST /api/auth/login` | 密码或短信登录 | 返回商城用户视图、Mock Bearer 和可能存在的后台角色 |

注册渠道来自 `channel/registerChannelCode`。显式传入不存在或停用的渠道会失败；自然流量可不绑定渠道。用户默认额度由 `MALL_DEFAULT_CREDIT_QUOTA` 决定，非法值回退 2750。

### 8.4 Admin 登录、Profile、权限和账号

| 方法与路径 | 功能 |
| --- | --- |
| `POST /api/admin/login`、`POST /api/login` | 后台登录及旧路径兼容 |
| `GET /api/admin/profile` | 当前后台账号、角色和有效权限 |
| `GET /api/admin/permissions/catalog` | 菜单与动作权限目录 |
| `GET /api/admin/accounts` | 当前作用域账号列表 |
| `POST /api/admin/accounts` | 新建租户后台账号 |
| `PATCH /api/admin/accounts/:id` | 修改名称、手机号、角色、状态、密码和权限 |
| `DELETE /api/admin/accounts/:id` | 删除后台账号，含租户库账号定位 |

账号管理会限制角色提升、权限授予范围、老板账号跨租户重名/手机号冲突，并防止普通账号管理超出自身授权边界。

### 8.5 平台与租户

| 方法与路径 | 功能 |
| --- | --- |
| `GET /api/platform/tenants` | 已知租户列表及账号/业务概况 |
| `POST /api/platform/tenants` | 注册租户标识 |
| `POST /api/platform/tenants/onboard` | 一次性创建租户、老板账号并初始化租户数据 |
| `GET /api/platform/mall-users` | 跨租户商城用户汇总 |
| `GET /api/platform/dashboard/summary` | 平台总览 |
| `GET /api/platform/audit-logs` | 平台审计摘要 |
| `GET /api/platform/admin-accounts` | 跨租户后台账号 |
| `GET /api/platform/accounts` | 总部账号列表 |
| `POST /api/platform/accounts` | 新建总部/平台账号 |
| `PATCH /api/platform/accounts/:id` | 修改总部账号 |
| `DELETE /api/platform/accounts/:id` | 删除总部账号 |

当前源码没有 `DELETE /api/platform/tenants/:id`。Admin 租户管理页面已经调用普通删除和 `?wipeAll=1` 强制清退两个版本，因此这两项操作当前会遇到 404/405，详见风险与契约差异章节。

### 8.6 流量渠道与流量商门户

| 方法与路径 | 功能 |
| --- | --- |
| `GET /api/admin/traffic-channels` | 渠道列表、注册人数和门户绑定 |
| `GET /api/admin/traffic-channels/overview` | 一次返回渠道、门户统计和老客户汇总 |
| `GET /api/admin/traffic-channels/daily-disbursement` | 指定日期按注册渠道统计发卡、金额、本金、利润和客单价 |
| `GET /api/admin/traffic-channels/quality` | 注册转化、分期占比、逾期、复购和人均金额 |
| `GET /api/admin/traffic-channels/portal-stats` | 与流量商门户同口径的全渠道统计 |
| `POST /api/admin/traffic-channels` | 新建渠道，可同步创建流量商门户账号 |
| `PATCH /api/admin/traffic-channels/:id` | 修改名称、备注、状态和门户账号 |
| `DELETE /api/admin/traffic-channels/:id` | 无注册用户时删除渠道，并解绑/删除门户账号 |
| `POST /api/traffic/channel-click` | 推广落地页点击计数 |
| `POST /api/traffic-partner/login` | 流量商门户登录 |
| `GET /api/traffic-partner/stats` | 仅返回账号绑定且启用的渠道统计和通过客户行 |
| `GET /api/admin/traffic-partners` | 流量商账号列表 |
| `POST /api/admin/traffic-partners` | 新建流量商账号并绑定渠道 |
| `PATCH /api/admin/traffic-partners/:id` | 修改账号、密码、状态和渠道集合 |

统计口径中，每个注册用户只取首单进行渠道归因。申请数、通过数、点击注册率、申请转化率、动态逾期率等都复用同一批函数，避免 Admin 与流量商门户口径漂移。老客户复购另行统计，不混入首单渠道转化。

### 8.7 用户管理、白名单、风险和导出

| 方法与路径 | 功能 |
| --- | --- |
| `GET /api/users` | 注册、未下单、下单中、已发卡包等用户视图，支持分页、搜索和渠道筛选 |
| `GET /api/users/export` | 注册用户或已通过客户 CSV 导出，可选字段、日期、渠道和手机号脱敏 |
| `GET /api/users/by-phone` | 按手机号查用户 |
| `GET /api/users/:id` | 用户详情与订单聚合 |
| `POST /api/users` | Admin 创建商城用户 |
| `PATCH /api/users/:id` | 修改资料、额度、密码、备注、黑名单和签约序列号 |
| `DELETE /api/users/:id` | 删除用户并清理地址、银行卡；订单不会随之删除 |
| `PATCH /api/users/:id/registered-whitelist/remove` | 从注册白名单移除 |
| `PATCH /api/users/:id/registered-whitelist/restore` | 恢复注册白名单 |
| `PATCH /api/users/:id/register-channel` | 修正注册渠道或改为商城自然注册 |
| `GET /api/users/:id/mall-contacts` | 管理端查看通讯录上传历史 |
| `GET /api/users/:id/mall-contacts/:uploadId/contacts` | 分页查看指定上传批次的联系人 |
| `GET /api/users/:id/bill-risk` | 查看流水风控状态和报告历史 |
| `POST /api/users/:id/bill-risk/mail` | 创建流水风控邮箱和处理页 |
| `POST /api/users/:id/risk-slot/:slotKey` | 执行 14 槽位中的指定风控项 |
| `POST /api/users/:id/risk-check` | 执行管理端组合风险检查 |

用户列表可在 Mongo 中先分页再 enrich，避免把全部订单/用户加载到内存后再分页。复杂筛选无法安全下推时自动回退内存实现。

逾期自动黑名单是单向规则：用户存在逾期分期时可自动拉黑，但不会自动解黑；管理员人工解黑后设置抑制标志，避免同一逾期周期立即再次自动拉黑。

### 8.8 商城“我的”、订单、卡包和合同

| 方法与路径 | 功能 |
| --- | --- |
| `GET /api/my/summary` | 订单角标、银行卡数量、待还金额 |
| `GET /api/my/orders` | 当前手机号订单列表及分期完成状态 |
| `GET /api/card-packages` | 可领取卡包订单 |
| `GET /api/card-packages/:orderId/contract-view` | 本地 Mock 合同 HTML 预览/签名页 |
| `GET /api/card-packages/:orderId/contract-flow` | 创建或查询真实电子合同，或返回 Mock 合同数据 |
| `POST /api/card-packages/:orderId/contract-ack` | 验证签署完成并保存签署时间 |
| `POST /api/card-packages/:orderId/contract-sign-reset` | 清理本站签署记录和 PDF 缓存，重新签署 |

合同支持两种模式：

- **真实电子签**：创建合同、确保个人签约用户、添加签署方、查询签署状态；
- **本地 Mock**：动态 HTML、Canvas 手写签名、按同一订单数据生成 PDF，并缓存 PDF 文件。

合同 PDF 会依次尝试已配置浏览器、Puppeteer 和 Linux Sparticuz Chromium。可配置 CLI 超时、执行文件、CLI 优先级和 Linux 策略。卡包合同流程在新审批订单上会先要求完成授权通讯录上传。

### 8.9 地址、银行卡和账单

| 方法与路径 | 功能 |
| --- | --- |
| `GET /api/addresses` | 查询手机号名下地址 |
| `POST /api/addresses` | 新建地址并维护唯一默认地址 |
| `PATCH /api/addresses/:id` | 编辑地址 |
| `PATCH /api/addresses/:id/default` | 设置默认地址 |
| `GET /api/bank-cards` | 查询银行卡并计算掩码字段 |
| `POST /api/bank-cards` | 新增 12～19 位银行卡 |
| `DELETE /api/bank-cards/:id` | 删除手机号名下银行卡 |
| `GET /api/bills` | 从分期订单动态生成账单、当月待还、全部待还和最低还款 |
| `POST /api/bills/repay` | 单期或全部还款；未发卡包不可还款 |
| `POST /api/bills/repay-negotiated` | 支付协商金额并应用剩余应还日 |

账单并不是简单读取 `bills` 集合，而是遍历当前用户的先享后付订单和 `installmentPlan` 动态构建。审核中的订单会展示“审核中”，但不计入待还汇总。

### 8.10 拉卡拉支付

| 方法与路径 | 功能 |
| --- | --- |
| `POST /api/payment/lakala/preorder` | 创建聚合收银台预订单 |
| `POST /api/payment/lakala/sync-pending` | 批量查询并同步待支付记录 |
| `GET /api/payment/lakala/status/:outTradeNo` | 查询单笔支付状态，必要时同步上游 |
| `POST /api/payment/lakala/mock-complete/:outTradeNo` | 开发 Mock 支付完成 |
| `POST /api/payment/lakala/notify` | 接收支付结果通知并落业务状态 |
| `GET /api/payment/lakala/config` | 返回前端可见支付配置和 Mock 状态 |

支持的业务类型：

- `order_full`：全款订单；
- `bill_repay`：单期账单还款；
- `bill_repay_negotiated`：协商金额支付；
- `bill_repay_all`：全部待还结清。

预订单会先写入 `lakalaPayments`，支付成功通过统一服务幂等更新订单/分期计划，并记录实际支付渠道。拉卡拉出站请求使用 RSA-SHA256 签名，客户端也具备平台响应验签能力；但当前入站通知路由没有调用签名验签，见第 17 章。

### 8.11 Admin 财务、订单和催收

| 方法与路径 | 功能 |
| --- | --- |
| `GET /api/admin/orders/sidebar-counts` | 待审核、已审核、卡包数据等侧栏计数 |
| `GET /api/admin/dashboard/kpis` | 真实订单财务 KPI |
| `POST /api/admin/dashboard/simulation-kpis` | 按模拟参数计算财务汇算 |
| `PUT /api/admin/dashboard/simulation-config` | 保存模拟配置 |
| `GET /api/orders` | Admin 订单列表、分页、搜索、风险、还款、渠道筛选 |
| `GET /api/orders/:id` | 订单详情、买家、渠道、紧急联系人和老客户标记 |
| `GET /api/orders/:id/risk-detail` | 订单风险详情 |
| `GET /api/orders/pending-receivable` | 指定应还日的已还/未还明细和动态统计 |
| `GET /api/admin/orders/repayment-records` | 成功在线还款流水、支付渠道、买家和渠道归因 |
| `PATCH /api/orders/:id/installments/:period/collection-remark` | 催收备注 |
| `PATCH /api/orders/:id/pay` | 标记全款订单支付 |
| `PATCH /api/orders/:id/installments/:period/pay` | 标记或撤销期次还款 |
| `PATCH /api/orders/:id/installments/:period/due-date` | 延期或修改协商还款日 |
| `PATCH /api/orders/:id/installments/:period/settle-amount` | 修改未还期次应还总额/本金 |
| `PATCH /api/orders/:id/installments/:period/negotiate` | 登记协商金额、剩余金额和日期 |
| `PATCH /api/orders/:id/installments/:period/negotiation/history/:historyIndex/paid` | 标记/撤销单条协商支付记录 |
| `PATCH /api/orders/:id/status` | 审核、驳回、重新审核和状态流转 |
| `PATCH /api/orders/:id/shipment` | 登记/清空快递单号并联动状态 |
| `PATCH /api/orders/:id/card-package` | 发放/撤销卡包并计算还款日 |
| `PATCH /api/orders/:id/card-package-contract` | Admin 维护合同签署状态 |
| `DELETE /api/orders/:id` | 按订单阶段和 RBAC 删除订单 |

真实 KPI 包括销售额、本金、已收、待收、逾期、利润、今日/明日/7 日应还、延期金额、订单结清率和动态逾期指标。老板视图会隐藏 `principalProfit`。

### 8.12 商城下单与订单状态机

`POST /api/orders` 的关键流程：

1. 从 Bearer 找到注册商城账号；
2. 校验商品存在、上架、数量和账号黑名单；
3. 阻止存在未结清订单的账号再次下单；
4. 先享后付订单校验商品总额不超过用户额度；
5. 老客户可在服务端重新校验满足条件后免重复风控；
6. 其它先享后付订单消费已完成的风控 wave、复用哆点点预审，或直接执行 7 项上游风控；
7. 保存风控摘要、订单和可能更新的用户风险快照；
8. 落库后通知哆点点风控通过/拒绝状态。

主要状态：

| 状态 | 业务含义 | 关键约束 |
| --- | --- | --- |
| `reviewing` | 待审核；风控失败仍保持该订单状态 | 审核员可通过或驳回；风控失败可重新审核 |
| `shipping` | 已审核、待发货 | 有快递单号时不能直接退回该状态 |
| `receiving` | 已发货、待收货 | 必须先填写快递单号 |
| `enjoying` | 已完成/已结清 | 先享后付需卡包已发且还款完成 |

先享后付从审核通过到 `shipping` 时，会为新订单标记“合同前需上传通讯录”。卡包发放前要求合同已签，首次发放后以发放时间为锚点：包含发放日的第 10 天到期，即代码加 9 天。撤销卡包会清空未还、未协商期次的应还日。

延期、协商和统计使用“有效应还日”：协商待支付的剩余日期优先，否则历史 `dueDate` 不得早于卡包发放后的真实还款日。延期当日可记录 `defer_as_collected` 展示事件，使当日统计视为已收，但不篡改真实还款状态。

### 8.13 流水风控

| 方法与路径 | 功能 |
| --- | --- |
| `GET /api/mall/me/bill-risk` | 商城用户查看处理入口，不返回后台报告内容 |
| `POST /api/users/:id/bill-risk/mail` | Admin 创建动态邮箱/流程页面 |
| `POST /api/bill-risk/callback` | 上游回调并关联用户报告 |
| `GET /api/users/:id/bill-risk` | Admin 查看历史报告 |

实现会缓存上游 token，用 RSA 公钥分块加密登录签名，创建动态邮箱与 H5 处理页。报告默认最多保留 30 条。回调优先按 `dockingSign` 关联，也可按身份证和姓名匹配用户。

### 8.14 客服

| 方法与路径 | 功能 |
| --- | --- |
| `POST /api/mall/cs/session/open` | 登录用户或游客打开/恢复会话 |
| `GET /api/mall/cs/session` | 商城轮询会话消息 |
| `POST /api/mall/cs/messages` | 商城发送文本 |
| `POST /api/mall/cs/messages/image` | 商城发送 OSS 图片 |
| `GET /api/admin/cs/badge` | Admin 未读角标 |
| `GET /api/admin/cs/unread-sum` | Admin 未读消息总数 |
| `GET /api/admin/cs/sessions` | 会话列表和在线状态 |
| `GET /api/admin/cs/sessions/:sessionId` | 消息详情、增量/分页读取、可标记已读 |
| `POST /api/admin/cs/sessions/:sessionId/messages` | 客服回复文本 |
| `POST /api/admin/cs/sessions/:sessionId/messages/image` | 客服回复图片 |

登录商城用户通过 Bearer 绑定 `mallUserId`；游客通过 `visitorKey + authSecret` 识别。消息保存在 `csSessions.messages` 数组中，前端采用轮询读取，在线状态由最近轮询时间推断。

### 8.15 图片上传

| 方法与路径 | 功能 | 校验 |
| --- | --- | --- |
| `POST /api/uploads/id-card` | H5/Android 身份证图片 | JPG/PNG/WebP、默认 5 MB、magic/MIME、像素、scene |
| `POST /api/uploads/public-image` | 商品/客服/通用图片 | JPG/PNG/WebP/GIF、默认 8 MB、magic/MIME、biz/scene |

OSS 对象键按环境、业务、日期、手机号和 scene 组织。公网 URL 可由 `OSS_PUBLIC_BASE_URL` 控制；未配置 OSS 时返回明确错误。

## 9. Android/H5 通讯录与合同门禁

独立 `mallContacts` 模块提供：

| 方法与路径 | 功能 |
| --- | --- |
| `GET /api/mall/contacts/status` | 查看订单是否需要、是否已完成通讯录授权 |
| `POST /api/mall/contacts/upload/start` | 创建上传会话 |
| `POST /api/mall/contacts/upload/batch` | 分批上传，默认每批最多 200 条 |
| `POST /api/mall/contacts/upload/complete` | 校验批次数、拒绝空数据、更新订单/用户摘要 |
| `GET /api/mall/contract-pending` | 找到最新待签合同订单及通讯录状态 |

联系人只保留轻量字段，去掉头像、原始对象等大字段。批次使用固定 `uploadId:batchIndex`，重复上传同一批次会覆盖而不是追加。完成后可跨批次按手机号去重。Admin 通过用户接口分页查看上传历史和联系人。

门禁只作用于新审批的先享后付订单：历史订单未设置 required 标记时不会被突然阻断。订单进入合同流程和提交签署 ACK 时都再次检查，避免只依赖前端页面状态。

## 10. iOS 专用接口

iOS 模块通过依赖注入独立注册，避免复用旧注册接口时收集超出 App Store 审核场景的实名资料。

| 方法与路径 | 功能 |
| --- | --- |
| `POST /api/ios/auth/register/sms/send` | iOS 注册短信 |
| `POST /api/ios/auth/register` | 仅手机号、验证码、密码、渠道的基础注册 |
| `GET /api/ios/installment/profile` | 返回脱敏的先享后付资料完成状态 |
| `PUT /api/ios/installment/profile` | 后置提交实名、三张证件图和两位联系人 |
| `POST /api/ios/uploads/id-card` | 必须登录、限定 scene 的证件上传 |
| `POST /api/ios/installment-risk/wave` | 创建属于当前用户的风控 wave |
| `POST /api/ios/installment-risk/wave/:waveId/step/:stepKey` | 单步执行并记录结果 |
| `POST /api/ios/installment/orders` | 资料完整且全部风控通过后创建订单 |
| `POST /api/ios/orders/:orderId/contacts/upload/start` | iOS 订单通讯录上传开始 |
| `POST /api/ios/orders/:orderId/contacts/upload/batch` | iOS 分批通讯录 |
| `POST /api/ios/orders/:orderId/contacts/upload/complete` | 完成通讯录并更新合同门禁 |
| `GET /api/ios/account/deletion-eligibility` | 注销前检查订单、分期、合同和支付阻塞项 |
| `POST /api/ios/account/delete` | 密码确认后硬删除或匿名化留存 |

iOS 身份证 URL 必须属于配置的 OSS origin、当前环境路径、当前手机号和正确 scene。上传响应使用私有/不缓存策略。注销时：

- 有审核中、发货中、收货中、未结清分期、未完成合同或 pending/processing 支付时阻止；
- 无历史订单/支付时硬删除账号和附属数据；
- 有合法留存记录时删除用户主档，将订单/支付匿名化；
- 默认留存 1825 天，可由 `IOS_ACCOUNT_LEGAL_RETENTION_DAYS` 配置；
- 同步删除通讯录和账号拥有的身份证 OSS 对象。

## 11. `/risk-api` 风控代理

### 11.1 下游验签

请求签名公式：

```text
sign = md5(appid + "#" + stableJson(data) + "#" + time + "#" + appkey + "#" + randOrNostr)
```

实现支持：

- 单组 `RISK_CONTROL_APP_ID/APP_KEY`；
- `RISK_CONTROL_CREDENTIALS_JSON` 多应用凭证；
- 默认 ±300 秒时间偏差；
- 稳定 JSON 序列化；
- `timingSafeEqual` 常量时间签名比较；
- 下游验签凭证与上游签名凭证分离；
- 未配置、超时、上游非 JSON 和业务失败都有独立错误码。

### 11.2 全部路由

| 方法与路径 | 上游能力 |
| --- | --- |
| `GET /risk-api/health` | 服务与凭证配置状态 |
| `POST /risk-api/v1/ping` | 验签联调并回显 data |
| `POST /risk-api/v1/court-detail-pro` | 法院信息个人高级版 |
| `POST /risk-api/v1/execution-pro` | 法院被执行高级版 |
| `POST /risk-api/v1/probe-c-enc` | 探针 C-MD5 |
| `POST /risk-api/v1/radar-v4-enc` | 全景雷达 V4-MD5 |
| `POST /risk-api/v1/ocr-identify` | 身份证 OCR |
| `POST /risk-api/v1/personal3` | 个人三要素 |
| `POST /risk-api/v1/ds-phone-time` | 在网时长 |
| `POST /risk-api/v1/ds-phone-state` | 运营商状态 |
| `POST /risk-api/v1/mobile2` | 运营商二要素 |
| `POST /risk-api/v1/auth-person-mobile3` | 个人运营商三要素 |
| `POST /risk-api/v1/auth-company-mobile3` | 企业运营商三要素 |
| `POST /risk-api/v1/captcha-verify` | 认证验证码校验 |
| `POST /risk-api/v1/captcha-resend` | 重发认证验证码 |
| `POST /risk-api/v1/get-auth-record-info` | 实名认证记录 |
| `POST /risk-api/v1/auth-person-face` | 个人人脸活体 |
| `POST /risk-api/v1/user-face-result` | 人脸核身结果 |
| `POST /risk-api/v1/add-personal-user` | 添加个人签约用户 |
| `POST /risk-api/v1/add-enterprise-user` | 添加企业签约用户 |
| `POST /risk-api/v1/create-contract` | 创建电子合同 |
| `POST /risk-api/v1/add-signer` | 添加签署方 |
| `POST /risk-api/v1/get-contract` | 查询合同 |
| `POST /risk-api/v1/cl-sms-send` | 验证码短信 |
| `POST /risk-api/v1/cl-sms-notify` | 通知短信 |

### 11.3 商城下单风控

先享后付下单的正常风控包固定执行 7 步：

1. `mobile2`；
2. `ds-phone-time`；
3. `ds-phone-state`；
4. `court-detail-pro`；
5. `execution-pro`；
6. `personal3`；
7. `probe-c-enc`。

每一步不仅判断 HTTP 是否成功，还解析上游业务结果。只有 7 步全部通过，wave 才可被下单消费。wave 绑定姓名、手机号和身份证，默认 30 分钟过期，成功下单后立即删除。

管理端风险详情另有 14 槽位，覆盖 OCR、运营商、法院、雷达、短信、物流、合同和人脸等能力。部分槽位需要前一步产生的序列号或验证码，没有条件时会明确跳过或失败。

## 12. 合作方流量网关

### 12.1 哆点点

默认前缀由 `DUODIANDIAN_ROUTE_PREFIX` 配置，同时兼容带和不带 `/api` 两套入口。

| 方法与相对路径 | 功能 |
| --- | --- |
| `POST /checkPrefix`、`POST /checkPrefIx` | 按手机号前缀检查用户、订单和进件冲突，返回阻塞号码 MD5 |
| `POST /contractQuery` | 返回用户协议和隐私政策 URL |
| `POST /apply` | 保存完整进件、生成合作方订单号、异步执行 7 项预风控 |
| `POST /login/consume` | 一次性消费免登 token，返回商城登录态 |
| `POST /getUrl` | 获取 H5 地址；审核通过后签发/轮换免登 token |
| `POST /order/status/notify` | 记录订单状态回调 |
| `POST /order/bindCard/notify` | 记录绑卡回调 |
| `POST /order/replayPlan/notify` | 记录还款计划回调 |
| `POST /order/replay/notify` | 记录还款回调 |
| `POST /order/sign/notify` | 记录签约回调 |

入站协议使用参数排序后的 MD5 业务签名和 AES-ECB 加解密，并校验 partner 与时间偏差。进件资料会归档安全快照和身份 hash；异步审核通过后才创建/绑定商城用户，并向合作方发送 `AUDIT_PASS/AUDIT_REJECT`。商城订单后续会发送风控、放款和结清通知，成功通知在当前进程中去重。

### 12.2 浙银/上海企浩网关

仅 `ZHEYIN_TRAFFIC_ENABLED=true` 且路由、channel、AES key/IV 完整时注册：

| 方法与相对路径 | 功能 |
| --- | --- |
| `POST /admission` | MD5 身份准入和冲突检查 |
| `POST /contracts` | 按场景返回合同清单 |
| `POST /credit/apply` | 授信申请并异步审核 |
| `POST /credit/query` | 查询审核状态和额度 |
| `POST /app/link` | 等待短时审核结果，绑定商城用户并生成 H5 免登链接 |
| `POST /login/consume` | 一次性消费登录 token |

协议使用 AES-CBC/PKCS5Padding + Base64，并校验 channel 和时间。申请保存在独立 `zheyinTrafficApplications`，不会写入哆点点集合。审批通过后才绑定商城用户，通知合作方授信结果。

### 12.3 半流程网关

仅 `HALF_FLOW_TRAFFIC_ENABLED=true` 且全部配置通过严格校验时注册：

| 方法与相对路径 | 功能 |
| --- | --- |
| `POST /admission` | 手机和身份证 MD5 准入 |
| `POST /apply` | 提交实名、认证、设备、单位和联系人资料 |
| `POST /app/link` | 审批后首次创建/复用本模块商城用户，生成 H5 链接 |
| `POST /login/consume` | 一次性消费免登 token |

协议要求 `ChannelCode`，数据使用 AES-CTR 加密；兼容合作方额外添加的合法 PKCS7 padding。生产环境强制回调和 H5 URL 使用 HTTPS，数值配置有安全范围校验。申请独立保存在 `halfFlowTrafficApplications`，并通过 Mongo 原子 claim 防止并发重复通知、重复创建用户和重复消费 token。

## 13. 环境变量分组

本文只列配置类别和关键变量名，不读取或披露真实环境值。

| 类别 | 关键变量 |
| --- | --- |
| 进程 | `NODE_ENV`、`PORT`、`API_REQUIRED_NO_PROXY` |
| Mongo | `MONGODB_URI`、`MONGODB_DB_NAME`、`MONGODB_MAX_POOL_SIZE`、`MONGODB_REQUIRED`、`ALLOW_JSON_FALLBACK`、`MONGO_REFRESH_MODE`、`MONGO_AWAIT_PERSIST`、`MONGO_SKIP_MUTATION_FLUSH` |
| Admin 优化 | `API_ADMIN_READ_OPTIMIZE`、`API_LIST_PAGINATE_BEFORE_ENRICH`、两个缓存 TTL、慢日志阈值 |
| 引导账号 | `BOOTSTRAP_SUPER_ADMIN_*`、`BOOTSTRAP_INJECT_DEFAULT_MALL_USER` |
| 商城身份 | `MALL_PASSWORD_PEPPER`、`MALL_DEFAULT_CREDIT_QUOTA`、注册/登录短信模板和 TTL |
| 风控下游 | `RISK_CONTROL_APP_ID`、`RISK_CONTROL_APP_KEY`、`RISK_CONTROL_CREDENTIALS_JSON`、时间偏差、强制凭证开关 |
| 风控上游 | `RISK_UPSTREAM_BASE_URL`、`RISK_UPSTREAM_APP_ID`、`RISK_UPSTREAM_APP_KEY`、各接口 PATH、超时、下单跳过开关 |
| 华东云兼容 | `HD_CLOUD_*`、`CLOUD_*` |
| 合同 | `MALL_CARD_PACKAGE_CONTRACT_*`、商户资料、`MALL_PUBLIC_API_ORIGIN`、Puppeteer/Chromium 参数 |
| OSS | `OSS_REGION`、`OSS_BUCKET`、Access Key、Endpoint、Public Base、Prefix、环境标签、图片上限 |
| 拉卡拉 | `LAKALA_APP_ID`、商户/终端/序列号、私钥、平台公钥、通知/回跳 URL、API Base、Mock、支付模式 |
| 流水风控 | `BILL_RISK_*`，包括账号、密码、公钥、回调签名、URL、超时、历史上限 |
| 哆点点 | `DUODIANDIAN_*` |
| 浙银 | `ZHEYIN_TRAFFIC_*` |
| 半流程 | `HALF_FLOW_TRAFFIC_*`；当前代码支持，但 `.env.example` 尚未收录 |
| iOS 注销 | `IOS_ACCOUNT_LEGAL_RETENTION_DAYS`；当前代码支持，但 `.env.example` 尚未收录 |

环境加载优先级：进程已有变量 > `.env.${NODE_ENV}` > `.env` 补充 > `.env.local` 强制覆盖 > 仓库根 `.env` 补充。`.env.local` 是唯一会主动覆盖前面值的文件。

## 14. 脚本与运维能力

| 文件 | 功能与注意事项 |
| --- | --- |
| `ecosystem.config.cjs` | PM2 单进程生产启动、日志和重启策略 |
| `scripts/ensure-admin-indexes.cjs` | 遍历根/core/self/tenant 库，为订单和用户创建 Admin 查询索引；会真实连接并修改 Mongo 索引 |
| `scripts/lakala-print-counter-request.js` | 打印聚合收银台请求并尝试真实下单；不是只读脚本 |
| `scripts/test-admin-permissions.cjs` | 独立权限契约断言，不在 `npm test` 中 |
| `scripts/test-installment-due-date.cjs` | 旧的 14 天还款日断言，与当前“含发放日第 10 天”实现不一致 |
| `backup-current-online.cjs` | 读取生产 URI并导出多个硬编码数据库的 EJSON 备份；只读数据库但会访问线上和写本地备份目录 |
| `readMallDefaultQuota.cjs` | 供 Shop/Admin Vite 构建读取 API 环境的默认额度 |

`package.json` 中的 `benchmark:load` 指向不存在的 `scripts/load-benchmark.cjs`，当前无法执行。

## 15. 自动化测试覆盖

当前共有 31 个测试文件、228 个 `node:test` 用例。

| 测试域 | 文件/用例概况 |
| --- | --- |
| 哆点点 | 35 个；签名加密、路由、隔离、异步预审、一次性登录、回调与 Mongo refresh plan |
| 半流程 | 40 个；配置、协议向量、schema、并发幂等、回调 claim、商城用户绑定、登录消费 |
| 浙银 | 8 个；协议、路由、准入、授信、查询、短等待和懒绑定 |
| iOS | 34 个；独立路由、最小注册、资料、上传、风控、订单、通讯录、注销及前端源码契约 |
| 通讯录 | 21 个；策略、路由、JSON/Mongo store、批次覆盖、分页和删除 |
| 待收/分期 | 45 个以上；还款日、延期、协商、结清、动态指标和黑名单 |
| Mongo/优化 | 管理端分页、侧栏计数、refresh guard、单实体持久化和入口保护 |
| 源码契约 | 白名单、注册渠道、人工拒绝原因、无重置入口、作用域持久化 |

覆盖较弱或没有直接自动化验证的区域：

- 主 `src/index.js` 大量路由的真实 Koa 端到端鉴权；
- 商城旧接口的手机号归属和越权保护；
- 拉卡拉通知签名、重放和伪造成功场景；
- Admin 登录暴力尝试、token 生命周期和密码存储；
- 平台租户完整创建/删除生命周期；
- OSS 公共上传的滥用、限频和对象所有权；
- `/risk-api` 全部路由的端到端验签/上游错误映射；
- 客服长会话数组增长、分页和多实例一致性。

## 16. 源码职责索引

| 文件/目录 | 职责 |
| --- | --- |
| `src/index.js` | Koa 入口、绝大多数业务函数和主路由，当前是最大的维护热点 |
| `src/store.js` | JSON/Mongo 快照、hydrate、refresh、持久化队列和删除保护 |
| `src/mongo.js`、`src/mongoConfig.js` | Mongo 连接、作用域数据库和环境配置 |
| `src/tenantContext.js`、`src/tenantResolver.js` | AsyncLocalStorage 工作区与租户解析 |
| `src/adminPermissions.js` | 权限树、默认权限、归一化和兼容判断 |
| `src/adminMongoReadOptimize.js` | Admin 订单/用户 Mongo 分页和计数下推 |
| `src/adminRepaymentRecords.js` | 在线还款记录筛选、渠道解析和聚合 |
| `src/pendingReceivableStats.js` | 待收、逾期、结清率、风险调整收入等统计口径 |
| `src/installment*.js` | 发卡还款日、延期、协商日期和显示事件 |
| `src/orderRepaymentSettlement.js` | 订单是否结清及商城展示状态 |
| `src/overdueUserBlacklist.js` | 逾期自动拉黑和人工抑制 |
| `src/billRiskControl.js` | 流水风控 token、加密、邮箱流程和回调 |
| `src/payment/*` | 拉卡拉客户端、支付业务服务与路由 |
| `src/riskControl/*` | 验签凭证、上游客户端、7 步风控、14 槽位和 `/risk-api` |
| `src/cardPackageContract*.js` | 合同 HTML 和 PDF 生成 |
| `src/oss.js` | OSS 配置、对象键和上传 |
| `src/mallContacts/*` | 通讯录策略、存储和路由 |
| `src/ios/*` | iOS 最小注册、资料、上传、风控下单、通讯录和注销 |
| `src/duodiandianGateway.js` | 哆点点完整协议、进件、预审、免登和通知 |
| `src/zheyinTrafficGateway/*` | 浙银独立配置、加密、仓储、服务、通知和路由 |
| `src/halfFlowTrafficGateway/*` | 半流程独立配置、CTR 协议、schema、并发安全仓储、服务和路由 |
| `src/mallRegisterSms.js` | 注册/登录短信验证码、模板与上游发送 |
| `src/defaultBootstrap.js` | 空库超管种子 |
| `src/loadEnv.js`、`src/cloudConfig.js` | 环境加载、代理清理、华东云配置 |
| `src/trafficPartnerApprovedRows.js`、`src/userRegisterChannel.js` | 流量商通过客户行和注册渠道归因 |

## 17. 已识别风险与契约差异

以下按生产影响排序。它们是对当前源码的客观记录，本次未修改代码。

### 17.1 P0：拉卡拉支付通知未验证回调签名

`POST /api/payment/lakala/notify` 直接把 body 交给 `handleNotifyPayload()`。在该路由和支付服务中未发现对通知签名的验证调用。只要攻击者知道一个已存在的 `outTradeNo` 并伪造成功状态，就可能触发订单支付、单期还款、协商支付或全部结清。

虽然拉卡拉客户端实现了平台公钥验签能力，正常查询响应也可验签，但入站通知路径没有使用它。这是当前最高优先级风险。

### 17.2 P0：商城和后台 token 可预测，且大量商城接口只信任 Query 手机号

商城和 Admin 都返回 `mock-token-{手机号}`，没有随机会话、签名、过期时间、撤销机制或服务端 session。知道手机号即可构造 token。

同时 `getUserPhone(ctx)` 只读取 `ctx.query.phone`，以下敏感功能据此识别用户：我的汇总、我的订单、卡包、合同、地址、银行卡、账单、直接还款、协商支付、紧急联系人和流水风控等。攻击者可替换手机号读取或操作他人数据。

这意味着当前系统的 Bearer 和 `?phone=` 都只能视作联调身份，不应视作生产认证。

### 17.3 P1：地址、银行卡和上传存在对象所有权缺口

- `POST /addresses` 接受 body 中任意 `userPhone`；
- `PATCH /addresses/:id` 和设置默认地址只按地址 ID 定位，没有校验当前登录用户；
- `POST /bank-cards` 接受 body 中任意 `userPhone`；
- `GET /bank-cards` 返回 `{...item, cardNoMasked}`，因此响应仍包含完整 `cardNo`，掩码字段并未移除原始卡号；
- `POST /uploads/id-card` 接受 body 中手机号，没有 Bearer 所有权校验；
- `POST /uploads/public-image` 在商品上传没有任何 Admin 头时不会进入 Admin 权限校验，`cs/common` 也没有统一登录校验；
- `mallContacts.resolvePhone()` 优先使用 Query 手机号，再使用 Bearer，知道订单 ID 时可能替他人操作通讯录流程。

### 17.4 P1：后台和流量商凭证仍是明文/可预测实现

- `adminAccounts.password` 明文保存、直接比较，最小长度可低至 4；
- `trafficPartners.password` 也明文保存；
- 流量商 token 固定为 `traffic-partner-token-{partner.id}`，无过期和签名；
- 后台 token 固定为账号手机号；
- 登录、短信、支付、上传等入口未见统一限频、失败次数锁定或 CAPTCHA；
- CORS 使用无参数 `cors()`，默认对任意来源开放。

### 17.5 P1：流水风控回调签名可因缺少配置而完全放行

`BILL_RISK_CALLBACK_SIGN_SECRET` 未配置时，`verifyCallbackSign()` 直接返回 true。生产环境若漏配该变量，外部可伪造报告回调。生产启动应对该配置做 fail-fast，而不是静默降级。

### 17.6 P1：短信验证码和风控 wave 只存在单进程内存

- 注册/登录验证码在进程内 `Map`，重启后丢失，多实例不共享；
- 验证码使用 `Math.random()`，没有发现错误次数上限；
- 先享后付 wave 及 iOS wave 所有权也在进程内 `Map`，TTL 30 分钟；
- 多实例时创建和消费可能落到不同进程，导致合法请求失败；
- 重启会丢失全部待消费状态。

### 17.7 P1：租户选择仍依赖客户端输入

`core/self` 有平台账号夹紧保护，但普通 `tenantId` 由 Header、Query 或 Host 决定。商城 token 又可预测，因此如果 API 入口允许客户端自由设置 `x-tenant-id`，跨租户边界主要依赖“目标库中是否存在该手机号/记录”，而不是可信租户会话。生产网关应固定/清洗租户头，服务端认证也应把 token 与 tenant 绑定。

### 17.8 P2：Admin 前端已有删除租户操作，API 未实现

`3.admin/src/views/TenantManagePage.vue` 调用：

```text
DELETE /api/platform/tenants/:id
DELETE /api/platform/tenants/:id?wipeAll=1
```

`1.api/src/index.js` 没有注册对应路由。已有的 `unregisterKnownTenantId()`、租户开通回滚和删除租户账号辅助函数不是 HTTP 删除实现。因此“删除空租户”和“强制清退”在当前前后端组合下不可用。

### 17.9 P2：运行与配置文档存在漂移

- `API.md` 只覆盖早期商品、用户、地址、账单、订单和账号接口，缺少当前多数路由；
- `.env.example` 没有收录代码已使用的 `HALF_FLOW_TRAFFIC_*` 与 `IOS_ACCOUNT_LEGAL_RETENTION_DAYS`；
- `npm run benchmark:load` 的入口文件不存在；
- `scripts/test-installment-due-date.cjs` 仍断言发卡后 14 天，而当前正式实现和测试是“含发放日第 10 天”；
- `scripts/lakala-print-counter-request.js` 名称像打印脚本，但结尾会尝试真实调用拉卡拉创建 0.01 元订单；
- `backup-current-online.cjs` 直接读取生产环境 URI，并硬编码多个数据库名称，执行前需要明确授权和备份目录检查。

### 17.10 P2：可观测性和数据体积风险

- `/api/health` 无鉴权暴露数据库名、各集合数量、云接口地址摘要和迁移状态；
- 客服全部消息保存在单个 session 文档数组内，长期会话可能持续增长；
- 全局 JSON body 上限 12 MB，且没有统一请求频率限制；
- `src/index.js` 超过 1.2 万行，路由、鉴权、状态机、统计和基础设施高度耦合，修改回归面较大；
- 哆点点成功通知的部分去重状态在当前进程内，多实例下应依赖持久化幂等键进一步保证。

## 18. 现有实现中的保护点

为避免风险章节掩盖已有工程保护，当前代码也具备以下明确措施：

- Mongo refresh 失败时阻断写请求，避免基于陈旧快照覆盖线上数据；
- 快照删除前检查异常大比例缩减；
- 每个租户/工作区独立快照、独立写入队列；
- `core/self` 工作区必须由有效平台账号进入；
- 身份证图片检查 MIME、magic、尺寸和像素；
- iOS 身份证 URL 检查 OSS origin、手机号、环境和 scene；
- 风控签名使用稳定 JSON、时间窗和常量时间比较；
- 半流程网关使用 Mongo 原子 claim 处理并发回调和 token 消费；
- 下单不只信任客户端老客户标志，服务端重新计算资格；
- 分期还款、合同、卡包发放和物流流转有服务端状态约束；
- 通讯录门禁在合同 flow 和 ack 两处重复校验；
- iOS 注销先检查未完成业务，再区分硬删除与合法留存匿名化；
- 默认写请求等待 Mongo 落库，减少“写完立即读旧”的一致性问题。

## 19. 分析边界

- 本文依据 2026-08-24 工作区源码，不保证未来提交仍完全一致；
- 未读取或披露 `.env.development`、`.env.production` 的真实秘密值；
- 未启动 Koa、Mongo、OSS、拉卡拉、风控或地理服务；
- 未执行 `ensure-admin-indexes`、支付打印、线上备份等会连接外部系统的脚本；
- 未修改任何 API 源码、配置、测试、数据库或业务数据；
- 安全问题来自静态代码路径判断，正式上线前仍建议进行带隔离测试数据的鉴权、回调验签和越权专项测试。

## 20. 最终结论

`1.api` 已实现商城主流程、后台运营、多租户、流量归因、三类合作网关、风险编排、拉卡拉支付、电子合同、通讯录门禁、客服和 iOS 合规注销，是整个项目的核心业务中枢。Mongo 快照保护、分期口径、合作网关隔离和 iOS 独立模块已有较好的工程化基础。

当前最需要优先治理的不是功能数量，而是生产身份与信任边界：必须先补拉卡拉通知验签，把 Mock token/Query 手机号替换为不可伪造且绑定租户的会话，补齐地址/银行卡/上传对象所有权，去除完整卡号返回，并强制关键回调签名配置。随后再补租户删除契约、运行脚本漂移和主入口拆分，项目才更适合作为可持续维护的线上 API。
