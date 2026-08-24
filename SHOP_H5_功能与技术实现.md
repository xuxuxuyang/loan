# Shop H5 功能与技术实现分析

> 分析对象：`2.shop` H5 / 浏览器端  
> 分析日期：2026-08-24  
> 文档性质：基于当前仓库源码的静态分析，不代表线上接口、第三方平台或生产数据的实时状态。

## 1. 分析范围

本次扫描覆盖了 H5 运行直接相关的全部一方文本源码与配置：

- 应用入口、路由与全局样式：`2.shop/src/main.ts`、`2.shop/src/App.vue`、`2.shop/src/router`、`2.shop/src/assets/styles`；
- 页面与组件：`2.shop/src/views`、`2.shop/src/components`；
- 业务状态与接口封装：`2.shop/src/composables`、`2.shop/src/api`、`2.shop/src/utils`、`2.shop/src/config`；
- H5/PWA 静态文件：`2.shop/index.html`、`2.shop/public`；
- 构建与类型配置：`2.shop/package.json`、`2.shop/vite.config.ts`、`2.shop/tsconfig*.json`、`2.shop/.env.example`；
- 自动化验证：`2.shop/tests`；
- 为识别跨端差异，同时核对了 Capacitor、Android 与 iOS 一方源码。

以下内容不作为业务源码逐行解释：`node_modules`、`dist`、`ota-out`、Gradle/Xcode 构建产物、Pods、图片二进制和第三方生成文件。`public/mall-zone-products.seed.json` 与预览页已核对，但它们是种子预览工具，不是商城运行时商品数据源。

## 2. 总体结论

Shop H5 是一套 Vue 3 单页商城，同时也是 Android/iOS Capacitor App 的共享 Web 业务层。H5 直接运行在浏览器中，具备完整的商品浏览、注册登录、普通商城购买、先享后付、订单、地址、银行卡、账单、卡包合同、在线客服、渠道归因、APK 下载引导与 PWA 安装能力。

核心架构特点：

- Vue 3 Composition API + TypeScript + Vite；
- Vue Router 5，HTML5 History 路由；
- 没有 Pinia/Vuex，使用 `spa-shim.ts` 中基于 `Map<string, Ref>` 的 `useState` 维护进程内共享状态；
- 使用 Cookie 保存注册标记与登录手机号，`localStorage/sessionStorage` 保存渠道、客服访客凭证、支付恢复信息等；
- 使用 `ofetch` 的 `$fetch` 调用商城 API；默认同源 `/api`，开发环境可由 Vite 代理到后端；
- Element Plus 按需自动导入，Tailwind CSS 4 与 SCSS 混合承担界面样式；
- 生产 H5 注册 Service Worker，提供应用壳与静态资源缓存；API、支付请求不缓存；
- 与原生端共享绝大多数 Vue 页面，通过 Capacitor 平台判断启用联系人、OTA、iOS 审核隐藏等差异逻辑。

## 3. 技术栈与工程实现

| 层级 | 技术/依赖 | 当前用途 |
| --- | --- | --- |
| UI 框架 | Vue `3.5.x` | `<script setup>`、响应式状态、异步组件、Teleport 弹层 |
| 路由 | Vue Router `5.0.x` | HTML5 History、页面懒加载、路由守卫、深链参数 |
| 构建 | Vite `8.0.x`、TypeScript `6.0.x` | 开发服务器、类型检查、生产构建、代码分块 |
| UI 组件 | Element Plus `2.13.x` | 表单、上传、选择器、对话框、消息提示 |
| 样式 | Tailwind CSS 4、SCSS | 移动端布局、主题、WebView 兼容、安全区 |
| 网络 | `ofetch` | JSON、查询参数、表单上传与错误体解析 |
| Cookie | `js-cookie` | 注册标记、登录手机号持久化 |
| 图标 | Iconify + Tabler 离线图标集 | 启动时本地注册，避免运行时访问外部图标服务 |
| 地区数据 | `element-china-area-data` | 地址编辑时动态加载省市区数据 |
| PWA | Web App Manifest + Service Worker | 添加到主屏幕、应用壳缓存、离线导航回退 |
| 跨端 | Capacitor 7 | 同一 Web 业务层复用到 Android/iOS；H5 中原生能力自动停用 |
| 支付 | 拉卡拉 API + 收银台跳转 | 普通订单、单笔账单、协商支付、一键还款 |

### 3.1 启动流程

`src/main.ts` 的启动顺序如下：

1. 离线注册 Tabler 图标集；
2. 路由前置守卫捕获 `?channel=`，记录注册归因并上报渠道点击；
3. 调用 `runAppOtaCheck()`；H5 因非原生平台立即返回；
4. 创建 Vue 应用并安装 Router；
5. 安装租户 Fetch 拦截器，为没有 `x-tenant-id` 的原生 `window.fetch` 请求补充租户头；
6. 挂载到 `#app`；
7. 检查 Android 待处理合同；H5 因非 Android 原生平台立即返回；
8. 非开发环境在 `window.load` 后注册 `/sw.js`。

### 3.2 API 地址与租户

- `VITE_MALL_API_BASE` 未配置时使用同源 `/api`；
- 开发环境的 `SHOP_API_PROXY_TARGET` 可代理 `/api` 和 `/static`；
- 租户优先取 `VITE_TENANT_ID`，其次取三级及以上域名的首段，localhost/IP 回退 `default`；
- `installTenantFetchInterceptor()` 修改全局 `window.fetch`，自动补 `x-tenant-id`；
- 卡包合同和通讯录相关请求还会显式追加 `tenantId` 查询参数，以兼容 iframe 与跨源合同地址。

## 4. 路由与页面功能

| 路径 | 路由名 | 页面/主要组件 | H5 功能 |
| --- | --- | --- | --- |
| `/` | `index` | `MallHomeView` | 首页、先享后付/商城专区切换、分类、商品推荐、搜索与客服入口 |
| `/installment` | `installment` | `MallInstallmentView` | 先享后付商品专区 |
| `/list` | `list` | `MallListView` | 全部、先享后付、手机、数码、家电、美妆分类列表 |
| `/search` | `search` | `MallSearchView` | 按名称、简介、描述、发货地搜索全部商品 |
| `/product/:id` | `product-detail` | `MallProductDetailView` | 商品轮播、详情图、价格、发货地、额度校验、购买入口 |
| `/login` | `login` | `MallLoginView` | 短信登录、密码登录、合作渠道免登消费 |
| `/register` | `register` | `MallRegisterView` | H5 实名注册、证件上传、紧急联系人、渠道归因 |
| `/order-create` | `order-create` | `MallOrderCreateView` | 地址选择、普通购买、先享后付风控与订单提交 |
| `/orders` | `orders` | `MallOrdersView` | 订单状态筛选、支付、物流、卡包状态 |
| `/address` | `address` | `MallAddressView` | 地址新增、编辑、设默认、下单选址 |
| `/bank-card` | `bank-card` | `MallBankCardView` | 银行卡列表、新增、删除 |
| `/bill` | `bill` | `MallBillView` | 账单、还款、协商支付、一键还款 |
| `/bill-risk-result` | `bill-risk-result` | `MallBillRiskResultView` | 流水报告提交成功/失败/处理中结果页 |
| `/card-package` | `card-package` | `MallCardPackageView` | 卡包列表、合同、App 通讯录授权引导、客服领取、流水上传 |
| `/cs-chat` | `cs-chat` | `MallCsChatView` | 登录用户或访客在线客服，文字/图片消息与轮询 |
| `/privacy-policy` | `privacy-policy` | `MallPrivacyPolicyView` | 隐私政策 |
| `/user-agreement` | `user-agreement` | `MallUserAgreementView` | 用户注册协议 |
| `/traffic-login` | `traffic-login` | `MallTrafficLoginView` | 将合作方免登参数转交 `/login?trafficLogin=1` |
| `/app-download` | `app-download` | `MallAppDownloadView` | 登录后启动 APK 下载或显示 iPhone PWA 指引 |
| 其它路径 | `not-found` | 重定向 | 统一回首页，不提供独立 404 页面 |

底部导航固定为“首页 / 商品 / 我的”。路由跳转统一通过 `useCustomRouting()` 尽量保留 `db` 查询参数；代码也保留了 `route.params.channel` 兼容逻辑，但当前路由表没有声明 `/:channel/...` 路由。

## 5. 功能与技术实现

### 5.1 首页与商品分区

主要代码：

- `src/views/MallHomeView.vue`
- `src/components/index/HomeBannerMobile.vue`
- `src/components/index/HomeListMobile.vue`
- `src/components/index/InstallmentZoneMobile.vue`
- `src/composables/useTeaProducts.ts`

功能实现：

- 首页默认展示“先享后付”，可切换到“商城专区”；
- 商城专区按手机、数码产品、家用电器、化妆品分类；
- `/list` 增加“全部”和“先享后付”筛选，列表按价格升序展示；
- 商品通过 `GET /products?salesMode=installment|mall` 分两组拉取并放入共享状态；
- 请求使用 in-flight Promise 去重，同一类商品成功拉取后本次页面会话不重复请求；
- 原生启动时会重试商品请求，H5 失败一次即返回，不做长重试；
- 接口分类兼容旧值 `travel/calligraphy/mobile/jewelry/phone/appliance`，归一化到现有四类；
- 商品图片失败后替换为本地生成的 SVG 占位图；
- `public/mall-zone-products.seed.json` 的 24 条数据及 `mall-zone-preview.html` 仅用于种子预览，不被运行时商品列表直接读取。

### 5.2 搜索

主要代码：`src/components/search/MallSearchMobile.vue`。

- 关键词同步到 `/search?q=...`；
- 首次有关键词时才加载完整商品目录；
- 在商品名称、副标题、详情描述、发货地中做前端包含匹配；
- 结果同时标记“先享后付”或“商城”；
- 没有关键词、加载中、无结果均有独立状态；
- 点击结果进入 `/product/:id`。

### 5.3 商品详情与购买前额度校验

主要代码：`src/views/MallProductDetailView.vue`、`src/components/mall/MallProductDetailGallery.vue`。

- 优先从已加载的共享商品状态查找；深链或缓存未命中时调用 `GET /products/:id`；
- 展示主图、详情图横向轮播、商品描述、发货地、价格和销售模式；
- 先享后付商品使用用户授信额度校验商品小计；超额时禁用提交并提示；
- 未登录点击购买会先进入登录页，登录后按重定向继续；
- 商城商品按钮文案为“立即购买”，先享后付为“提交订单”。

### 5.4 H5 注册

主要代码：`src/components/auth/RegisterForm.vue`、`src/composables/useMallAuth.ts`。

H5 注册要求：

- 真实姓名；
- 11 位手机号；
- 6 位短信验证码；
- 至少 6 位密码及二次确认；
- 18 位二代身份证号；
- 身份证正面、反面、手持身份证三张图片；
- 两位紧急联系人；
- 勾选用户协议和隐私政策。

证件上传流程：

1. 浏览器优先用 `createImageBitmap` 解码，失败时回退 `<img>`；
2. 长边限制为 1280px；
3. Canvas 转为质量 0.82 的 JPEG；
4. 通过 `POST /uploads/id-card` 上传，表单只保留 URL；
5. 注册时把 URL 与实名资料一并提交到 `POST /auth/register`。

紧急联系人校验包括：姓名只能包含中英文、空格与间隔点，手机号必须为大陆 11 位号码，两人号码不能相同，且不能等于注册手机号。

### 5.5 登录与会话

主要代码：`src/components/auth/LoginForm.vue`、`src/composables/useMallAuth.ts`、`src/spa-shim.ts`。

- 支持短信验证码登录和密码登录；
- 验证码发送后有 60 秒倒计时；
- 未注册手机号会引导到注册页，并保留下载、渠道、重定向参数；
- 登录手机号保存在 `mall_login_phone` Cookie，有效期 30 天；
- 注册标记保存在 `mall_registered` Cookie，有效期 1 年；
- 共享状态保存当前 profile 与手机号；刷新后调用 `GET /users/by-phone?phone=...` 恢复资料；
- 登出会清空 Cookie 和内存 profile；
- 登录接口返回的 `token` 当前没有持久化使用，后续需要鉴权的接口由前端构造 `Bearer mock-token-{手机号}`。

最后一点是当前实现的重要安全边界：前端会话的可信根主要是手机号 Cookie 和可预测的 mock token，生产安全必须由后端再次鉴权、校验订单归属与权限，不能只信任前端参数。

### 5.6 渠道归因与点多多免登

主要代码：

- `src/composables/useRegisterChannel.ts`
- `src/utils/duodiandianLogin.ts`
- `src/views/MallTrafficLoginView.vue`
- `src/views/MallLoginView.vue`

渠道归因：

- 从 URL `?channel=` 捕获渠道，只接受最长 40 位的字母、数字、下划线和横线；
- 首个有效渠道锁定 30 天，优先写 `localStorage`，失败时回退 `sessionStorage`；
- 同一会话同一渠道只调用一次 `POST /traffic/channel-click`；
- 注册成功后清除待归因渠道；
- 未登录首页可显示一次“立即领取额度”弹窗，并把渠道带入注册页。

点多多/合作方免登：

- `/traffic-login` 转到 `/login?trafficLogin=1`；
- 使用 `channel/applyNo/token/consumePath` 调用后端消费接口；
- 409 或“审核中”状态最多每 1.5 秒重试一次、最多 20 次；
- 技术性 URL、HTTP 方法和 404/405 错误会被替换为用户可读提示；
- 点多多旧链接可通过 `VITE_DUODIANDIAN_HALF_FLOW_PREFIX` 兼容半流程接口。

### 5.7 收货地址

主要代码：`src/components/my/address/MyAddressMobile.vue`、`AddressEditorDialog.vue`、`useMallMy.ts`。

- 登录后读取地址列表；
- 新增地址：`POST /addresses`；
- 编辑地址：`PATCH /addresses/:id`；
- 设默认：`PATCH /addresses/:id/default`；
- 地址按“默认优先、ID 倒序”展示；
- 省市区数据在打开编辑弹窗时动态加载，减少首屏体积；
- 从下单页进入时带 `pick=1&return=/order-create&productId=...`，点击某地址后把 `addressId` 带回下单页；
- 当前 UI 和 composable 没有删除地址功能。

### 5.8 订单创建：普通商城直付

主要代码：`src/components/order/create.vue`、`src/composables/useMallOrders.ts`。

当商品 `salesMode === 'mall'` 时：

1. 校验登录、商品、收货地址、账号黑名单、是否存在未完成订单；
2. 调用 `POST /orders` 创建 `payType=full`、未支付订单；
3. 打开 `LakalaPaySheet`，业务类型为 `order_full`；
4. 支付成功后同步远端订单并进入“待发货”筛选页。

订单页仍可对 `payType=full && status=reviewing && !paid` 的订单再次发起支付。

### 5.9 订单创建：先享后付

H5 当前先享后付流程：

1. 注册/登录与地址校验；
2. 禁止黑名单账号下单；
3. 存在任一非“已完成”订单时禁止再次下单；卡包已发放的先享后付订单视为已完成；
4. 商品小计不得超过授信额度；
5. 根据环境配置校验年龄、身份证地区、收货地址/手机号归属地；当前开发和生产配置年龄为 22 至 50 周岁（含边界），限制地区为新疆、西藏、内蒙古、青海、宁波，对应身份证前缀为 `65/54/15/63/3302`；
6. 新客户调用 `POST /mall/installment-risk/wave` 创建风控 wave，随后逐个调用 `/mall/installment-risk/wave/:waveId/step/:stepKey`；
7. 所有步骤通过后，把 `installmentRiskWaveId` 随订单提交到 `POST /orders`；
8. 老客户最近一笔先享后付订单满足“非审核中、卡包已发、已全部还款”时，使用 `riskBypassReason=returning_customer` 申请服务端复购直过；
9. 下单成功后合并响应中的账单与“我的”汇总快照，避免连续重复请求；
10. 进入订单页查看审核结果。

风控失败时，前端会去除上游步骤名称，只向用户展示归一化的审核结论。

### 5.10 订单列表与物流

主要代码：`src/components/my/order/MyOrderMobile.vue`。

- 订单以 `GET /my/orders` 为单一远端数据源；
- 前端只展示 `order.mallUserId === profile.id` 的订单，不按收货手机号归户；
- 支持全部、待审核、待发货、待收货、已完成筛选；
- 先享后付风控失败显示“审核未通过”；普通商城未支付订单显示“待支付”；
- 卡包已发放的先享后付订单即使后端状态回退，也按“已完成”展示；
- 支持复制快递单号；
- 第三方物流查询地址来自 `VITE_MALL_TRACKING_LOOKUP_URL`，用户需自行粘贴单号；
- 商品名称/规格发现 Unicode 替换字符时，会尝试用当前商品数据回填展示。

### 5.11 银行卡

主要代码：`src/components/my/bank-card/MyBankCardMobile.vue`。

- 列表：`GET /bank-cards?phone=...`；
- 新增：`POST /bank-cards`；
- 删除：`DELETE /bank-cards/:id?phone=...`；
- 卡号要求 12 至 19 位数字；
- UI 展示掩码卡号、银行、卡类型、持卡人；
- 删除前二次确认，删除后刷新“我的”汇总。

### 5.12 账单、还款与协商支付

主要代码：`src/components/my/bill/MyBillMobile.vue`、`src/composables/useMallMy.ts`。

- `GET /bills` 返回汇总与账单列表；
- 按订单聚合期次，默认每组预览两条，可展开；
- 概览展示全部待还金额和最近到期日；
- 单期普通还款使用拉卡拉业务类型 `bill_repay`；
- 协商支付使用 `bill_repay_negotiated`，支付的是协商费用，原剩余本金和延期日期继续展示；
- 一键还款使用 `bill_repay_all`；
- 卡包未发放的订单禁止单笔和一键还款；
- 从第三方收银台回到页面后，通过 session 中的交易号轮询，随后再调用服务端 `sync-pending` 兜底；
- 页面重新可见时会延迟 400ms 再同步支付与账单，覆盖浏览器切回场景；
- composable 中还保留 `/bills/repay` 与 `/bills/repay-negotiated` 直接刷新账单状态的方法，当前 UI 的实际入口以拉卡拉预下单流程为主。

### 5.13 拉卡拉支付

主要代码：`src/composables/useLakalaPayment.ts`、`src/components/payment/LakalaPaySheet.vue`。

流程：

1. `GET /payment/lakala/config` 检查启用、模拟模式与收银台模式；
2. `POST /payment/lakala/preorder` 创建支付单；
3. 有真实 `counterUrl/payCode` 时使用 `window.location.replace()` 跳转拉卡拉收银台；
4. 自动跳转 2.5 秒后仍在当前页则显示手动入口；
5. 模拟环境可调用 `POST /payment/lakala/mock-complete/:outTradeNo`；
6. 留在页面的扫码模式通过 `GET /payment/lakala/status/:outTradeNo` 轮询，默认最长 5 分钟；
7. 收银台返回后使用 `lakala_pending_pay` session 记录恢复，并调用 `POST /payment/lakala/sync-pending` 扫描后端待同步支付。

桌面浏览器发起微信支付时会提示用户改用手机 Safari/微信或选择支付宝。

### 5.14 卡包、合同、通讯录授权与领取

主要代码：`src/components/my/CardPackageSection.vue` 及 `src/components/my/card-package/dialogs`。

- 卡包列表：`GET /card-packages`；
- 点击领取先调用 `GET /card-packages/:orderId/contract-flow`；
- 未签署时在本页 iframe 中加载合同签署地址；
- iframe URL 会修正到 API 源站并补 `tenantId`；
- 只接受合同 iframe 同源的 `postMessage`，且订单号必须与当前订单一致；
- 收到 `mall-card-package-contract-signed` 后刷新合同与卡包列表；
- 已签署后可查看合同，并展示企业微信客服二维码领取现金礼；
- 二维码和客服名称来自环境配置，图片为空时回退打包资源；
- H5 无法调用原生通讯录。如果后端返回 `CONTACTS_REQUIRED`，页面显示“下载 App / 打开 App”的授权引导，并可通过 `wenshuomall://contract?orderId=...` 尝试打开已安装 App；
- 支持读取 `GET /mall/me/bill-risk` 返回的专属流水上传链接，复制或新窗口打开；
- “紧急联系人领取前补录”旧逻辑仍保留，但 `needsEmergencyBeforeKefu` 固定为 `false`，当前不会触发，因为资料已前移到注册流程。

### 5.15 在线客服

主要代码：`src/views/MallCsChatView.vue`、`src/composables/useMallCsChat.ts`。

- 登录用户使用手机号构造 Authorization；未登录用户使用本地 visitor/session/secret 三个凭证；
- `POST /mall/cs/session/open` 创建或恢复会话；
- `GET /mall/cs/session` 每 5 秒轮询；页面隐藏时停止，重新可见时立即拉取并恢复轮询；
- `POST /mall/cs/messages` 发送最长 2000 字文本；
- `POST /mall/cs/messages/image` 上传图片；
- 本地和服务端消息按 ID 合并并按时间排序，避免慢轮询覆盖刚发送的消息；
- 客服图片的 `/static/uploads/cs/...` 会改写为 `/api/static/uploads/cs/...`，适配只反代 `/api` 的生产网关；
- 图片失效时显示“图片已失效”。

仓库还保留 `MallCsChatView.api.vue`，文件注释称其为归档版本，但当前内容与正式客服页同类且正式路由已经使用 API 聊天页；该注释存在维护歧义。

### 5.16 “我的”中心

主要代码：`src/components/my/MyCenterMobile.vue`。

- 展示头像、用户昵称/手机号、登录与退出；
- 展示四种订单状态计数；
- 提供银行卡、账单、卡包、地址、在线客服、隐私政策、App 下载入口；
- 展示低价先享后付商品推荐；
- 登录状态或手机号变化时刷新个人汇总和卡包；
- App 下载必须先登录；Android 浏览器打开配置的 APK URL，iPhone 显示 Safari 添加到主屏幕指引。

### 5.17 协议与隐私政策

- 注册和登录都要求勾选协议；
- 用户协议包含账号、行为规范、商品/订单、先享后付、知识产权、责任、终止与争议等章节；
- 隐私政策说明账户、交易、设备日志、客服信息、Cookie、共享、存储、安全、用户权利和未成年人处理；
- H5 展示包含先享后付的数据处理文案。

### 5.18 PWA 与安装

- Manifest 名称为“文硕商城”，`display=standalone`，优先竖屏；
- 支持 Apple Touch Icon、192/512 图标和 `viewport-fit=cover`；
- Service Worker 预缓存首页、manifest 与图标；
- 页面导航采用网络优先，离线时回退缓存首页；
- `/assets`、`/pwa` 和 manifest 采用缓存优先、缺失时回源并写缓存；
- `/api`、包含 `pay/payment` 的请求明确不拦截；
- iPhone App 下载入口实际上显示 Safari“添加到主屏幕”步骤，不提供 iOS 安装包直链。

## 6. H5 接口映射

| 业务域 | 方法与路径 | 前端用途 |
| --- | --- | --- |
| 商品 | `GET /products?salesMode=...` | 分别加载普通商城和先享后付商品 |
| 商品 | `GET /products/:id` | 商品详情/深链兜底 |
| 注册 | `POST /auth/register/sms/send` | H5 注册验证码 |
| 注册 | `POST /uploads/id-card` | 身份证图片上传 |
| 注册 | `POST /auth/register` | H5 实名注册 |
| 登录 | `POST /auth/login/sms/send` | 登录验证码 |
| 登录 | `POST /auth/login` | 短信或密码登录 |
| 用户 | `GET /users/by-phone` | 刷新后恢复 profile |
| 渠道 | `POST /traffic/channel-click` | 渠道点击统计 |
| 免登 | 动态 `/.../login/consume` | 合作方 token 消费 |
| 订单 | `POST /orders` | 创建普通/先享后付订单 |
| 订单 | `GET /my/orders` | 当前用户订单列表 |
| 订单 | `PATCH /orders/:id/pay` | 历史订单支付标记兼容接口 |
| 风控 | `POST /mall/installment-risk/wave` | 创建 H5 先享后付风控会话 |
| 风控 | `POST /mall/installment-risk/wave/:waveId/step/:stepKey` | 逐项执行风控 |
| 地址 | `GET/POST /addresses` | 地址列表/新增 |
| 地址 | `PATCH /addresses/:id` | 编辑地址 |
| 地址 | `PATCH /addresses/:id/default` | 设为默认地址 |
| 银行卡 | `GET/POST /bank-cards` | 列表/新增 |
| 银行卡 | `DELETE /bank-cards/:id` | 删除 |
| 我的 | `GET /my/summary` | 订单数、银行卡数、待还汇总 |
| 账单 | `GET /bills` | 账单汇总与明细 |
| 账单 | `POST /bills/repay` | composable 中的普通还款刷新契约 |
| 账单 | `POST /bills/repay-negotiated` | composable 中的协商还款刷新契约 |
| 支付 | `GET /payment/lakala/config` | 支付开关与模式 |
| 支付 | `POST /payment/lakala/preorder` | 创建拉卡拉支付单 |
| 支付 | `GET /payment/lakala/status/:outTradeNo` | 查询支付状态 |
| 支付 | `POST /payment/lakala/mock-complete/:outTradeNo` | 模拟支付完成 |
| 支付 | `POST /payment/lakala/sync-pending` | 同步服务端待处理支付 |
| 卡包 | `GET /card-packages` | 卡包列表 |
| 合同 | `GET /card-packages/:orderId/contract-flow` | 合同状态、签署/预览地址 |
| 合同 | `POST /card-packages/:orderId/contract-ack` | iOS 独立卡包组件确认签署；通用页面主要依赖 iframe ACK |
| 合同 | `POST /card-packages/:orderId/contract-sign-reset` | 合同签署重置能力，当前通用 UI 未直接暴露 |
| 联系人 | `GET /mall/contacts/status` | 原生联系人上传状态能力 |
| 联系人 | `POST /mall/contacts/upload/start|batch|complete` | Android 原生联系人分批上传；H5 本身不读取通讯录 |
| 用户资料 | `POST /mall/me/emergency-contacts` | 旧联系人补录能力，当前入口关闭 |
| 流水 | `GET /mall/me/bill-risk` | 获取专属流水上传链接 |
| 客服 | `POST /mall/cs/session/open` | 创建/恢复客服会话 |
| 客服 | `GET /mall/cs/session` | 轮询消息 |
| 客服 | `POST /mall/cs/messages` | 发送文本 |
| 客服 | `POST /mall/cs/messages/image` | 发送图片 |

## 7. 状态与本地存储

| Key | 介质 | 用途 | 生命周期 |
| --- | --- | --- | --- |
| `mall_registered` | Cookie | 已注册标记 | 约 1 年 |
| `mall_login_phone` | Cookie | 当前登录手机号 | 约 30 天 |
| `mall-register-profile` | 内存共享 Ref | 用户资料 | 页面进程 |
| `mall-login-phone` | 内存共享 Ref | 当前手机号 | 页面进程 |
| `index-tea-products-*` | 内存共享 Ref | 商品与加载状态 | 页面进程 |
| `mall-orders` | 内存 + localStorage 写入 | 订单快照；启动时会删除旧缓存，接口仍是单一数据源 | 可丢弃缓存 |
| `mall_pending_register_channel` | local/sessionStorage | 注册渠道及 30 天过期时间 | 注册成功清除 |
| `mall_channel_click_sent:*` | sessionStorage | 渠道点击去重 | 浏览器会话 |
| `mall_traffic_credit_lead_shown` | sessionStorage | 首页额度弹窗去重 | 浏览器会话 |
| `mall_cs_visitor_key/session_id/secret` | localStorage | 访客客服会话恢复 | 退出/注销时部分清理 |
| `lakala_pending_pay` | sessionStorage | 收银台返回后恢复查单 | 成功或超时清除 |

## 8. 构建、分包与环境变量

### 8.1 常用命令

```bash
npm run dev
npm run build
npm run preview
npm run check:mojibake
```

`npm run build` 先执行 `vue-tsc -b`，再执行 `vite build`。

### 8.2 分包

`vite.config.ts` 手工拆分：

- Vue/Router；
- Element Plus 基础与表单组件；
- 地区数据；
- 订单；
- 地址基础与编辑器；
- 账单；
- 卡包及卡包弹窗；
- 银行卡、订单列表、个人中心；
- 商品业务。

这能降低首页初始包体，但手工 chunk 边界依赖文件路径，目录调整时需要同步维护。

### 8.3 环境变量职责

| 变量 | 职责 |
| --- | --- |
| `VITE_MALL_API_BASE` | 商城 API 基路径 |
| `SHOP_API_PROXY_TARGET` | 本地 Vite API/静态资源代理目标 |
| `VITE_TENANT_ID` | 固定租户 ID |
| `VITE_MALL_SITE_URL` | 站点地址、iOS PWA 指引 |
| `VITE_MALL_ICP_TEXT/LINK` | 备案文本与链接 |
| `VITE_MALL_TRACKING_LOOKUP_URL` | 第三方物流查询页 |
| `VITE_MALL_KEFU_QR_URL/DISPLAY_NAME` | 客服二维码与名称 |
| `VITE_MALL_ORDER_MIN_AGE/MAX_AGE` | 下单年龄边界 |
| `VITE_MALL_ORDER_RESTRICTED_REGION_NAMES` | 受限地区名称 |
| `VITE_MALL_ORDER_RESTRICTED_ID_PREFIXES` | 受限身份证前缀 |
| `VITE_MALL_DEFAULT_CREDIT_QUOTA` | 前端默认授信覆盖；通常由 API 环境构建注入 |
| `VITE_DUODIANDIAN_HALF_FLOW_PREFIX` | 点多多免登旧接口前缀 |
| `VITE_MALL_APP_APK_URL` | 登录后 APK 下载地址 |
| `VITE_APP_OTA_MANIFEST_URL/BASE_URL` | Android App OTA；H5 本身不执行 |

所有 `VITE_` 变量都会进入前端包，不应放密钥、私钥或长期 token。

## 9. 测试覆盖

当前 `tests/*.test.mjs` 使用 Node 内置测试框架，部分通过 TypeScript 转译执行工具函数，部分通过源码结构断言验证集成约束。覆盖点包括：

- 点多多免登 URL 与用户错误文案；
- iOS 审核隐藏边界；
- iOS 路由静态导入兼容；
- 全局安全区规范；
- Android/iOS 联系人插件、分批上传与权限错误；
- 运行时环境配置；
- 原生启动商品请求重试；
- 下单年龄/地区预校验；
- 渠道持久化与登录后 APK 下载链路。

测试缺口：

- 没有浏览器端 E2E 测试；
- 没有真实支付收银台、合同 iframe、客服轮询的集成测试；
- 没有完整组件交互测试；
- 部分测试是源码正则断言，只能防止特定结构被改掉，不能证明运行时行为正确；
- `orderEligibility.test.mjs` 和 `.env.example` 仍以最大年龄 49 为示例，而当前开发/生产配置已经是 50，存在文档/测试样例漂移。

## 10. 已识别的实现边界与风险

### 10.1 高优先级

1. **鉴权模型依赖可预测 mock token**：登录接口返回 token 未被保存，多处按手机号构造 `Bearer mock-token-{phone}`。后端必须承担全部身份真实性和数据归属校验。
2. **客户端可提交手机号查询参数**：用户、地址、银行卡、账单等接口多处带 `phone`。后端不能把该参数本身视为授权依据。
3. **隐私与敏感数据范围大**：H5 注册处理身份证号、三张证件照和两位紧急联系人；必须确保 HTTPS、后端最小化存储、访问审计、数据删除与隐私政策一致。
4. **真实支付/合同高度依赖外部系统**：前端有超时、轮询、ACK 与恢复逻辑，但仅凭前端测试无法证明第三方异步通知、签约回调和账单落库完整可靠。

### 10.2 中优先级

1. `.env.example` 与 `orderEligibility.test.mjs` 仍写最大年龄 49，生产/开发实际配置为 50；新维护者可能按旧示例回退配置。
2. `MallCsChatView.api.vue` 标为“归档”，但正式 `MallCsChatView.vue` 已使用相同 API 模式；归档说明容易误导。
3. `useMallOrders` 声明接口为单一数据源，启动时删除本地缓存，但成功请求后仍写入 `mall-orders`；当前不会从该缓存恢复，属于可清理的历史兼容行为。
4. Service Worker 缓存名固定 `wenshuo-mall-shell-v1`，发布静态壳变更时若不升级缓存名，旧资源淘汰策略依赖文件 URL/hash。
5. 路由使用 HTML5 History；生产 Nginx 必须把未知前端路径回退到 `index.html`，否则直接打开深链会 404。
6. 地址支持新增/编辑/默认，但没有删除；若是产品需求而非刻意限制，需要补齐接口和 UI。

### 10.3 代码维护边界

- `src/components/ios/auth/IosRegisterForm.vue`、`ios/order/IosOrderCreate.vue`、`ios/my/IosMyCenterMobile.vue`、`ios/my/IosCardPackageMobile.vue` 当前没有被路由或正式组件导入，属于未接入/候选实现；
- H5 通用 `RegisterForm` 和通用 `order/create.vue` 内也包含 iOS 分支，存在两套 iOS 方案并存的维护成本；
- `src/api/modules/iosMall.ts` 是 iOS 专用 API，不参与 H5 正常注册与下单；
- `qrcode` 类型已声明但当前活动代码未发现二维码生成调用，客服使用图片 URL；
- `vite-env.d.ts` 注释称 OTA 用于 Android/iOS，但运行代码明确跳过 iOS，应以实现为准。

## 11. 关键源码索引

| 职责 | 文件 |
| --- | --- |
| 启动与 PWA 注册 | `2.shop/src/main.ts` |
| 全局根组件/额度弹窗 | `2.shop/src/App.vue` |
| 路由与路由守卫 | `2.shop/src/router/index.ts` |
| SPA 状态/Cookie/运行时配置 | `2.shop/src/spa-shim.ts` |
| 商品数据 | `2.shop/src/composables/useTeaProducts.ts` |
| 登录注册 | `2.shop/src/composables/useMallAuth.ts` |
| 订单 | `2.shop/src/composables/useMallOrders.ts` |
| 地址/银行卡/账单/卡包 | `2.shop/src/composables/useMallMy.ts` |
| 下单主流程 | `2.shop/src/components/order/create.vue` |
| 支付 | `2.shop/src/composables/useLakalaPayment.ts` |
| 客服 | `2.shop/src/composables/useMallCsChat.ts` |
| 卡包合同 | `2.shop/src/components/my/CardPackageSection.vue` |
| 渠道归因 | `2.shop/src/composables/useRegisterChannel.ts` |
| 租户 | `2.shop/src/utils/tenant.ts` |
| 下单预校验 | `2.shop/src/utils/orderEligibility.ts` |
| PWA | `2.shop/public/manifest.webmanifest`、`2.shop/public/sw.js` |
| 构建 | `2.shop/vite.config.ts`、`2.shop/package.json` |

