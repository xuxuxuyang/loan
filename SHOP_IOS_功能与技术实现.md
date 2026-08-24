# Shop iOS 功能与技术实现分析

> 分析对象：`2.shop` iOS 端  
> 分析日期：2026-08-24  
> 文档性质：基于当前仓库源码的静态分析；Windows 环境未执行 Xcode、CocoaPods 或真机编译。

## 1. iOS 端定位

iOS 端同样是 Capacitor App：Swift 原生壳加载 Vue 3/Vite 构建的共享 Web 业务层。当前版本同时存在两类 iOS 逻辑：

1. **当前正式接入路径**：共享 `MallHomeView`、`RegisterForm`、`order/create.vue`、`MyCenterMobile` 根据 Capacitor iOS 平台做条件分支；
2. **独立 iOS 候选组件**：`IosRegisterForm`、`IosOrderCreate`、`IosMyCenterMobile`、`IosCardPackageMobile` 等文件仍在仓库，但没有被当前路由或正式页面导入。

当前最重要的产品事实是：`isIosBnplReviewHidden()` 对所有原生 iOS 运行时直接返回 `true`，因此 App Store 审核版永久隐藏/阻止先享后付、账单、卡包和流量免登相关入口。该逻辑没有日期、远端开关或环境变量；只要是原生 iOS 就生效。

## 2. 分析范围

已核对：

- 全部共享 Vue/TypeScript 业务源码：`2.shop/src`；
- iOS Swift、Storyboard、Info.plist、Assets 与 Xcode 工程配置；
- CocoaPods 与 Capacitor 配置；
- iOS 专用 API 模块、联系人插件、账号注销、资料/风控候选流程；
- iOS 安全区、路由兼容、审核隐藏和联系人测试；
- H5/Android 对照实现。

未把 Pods、DerivedData、build、node_modules、图片二进制和其它生成产物当作一方业务源码解释。

## 3. 技术架构

### 3.1 分层

| 层级 | 代码位置 | 职责 |
| --- | --- | --- |
| Web 页面 | `src/views`、`src/components` | 当前 iOS 实际商城 UI |
| 平台开关 | `iosNativePlatform.ts`、`iosBnplReviewVisibility.ts` | 判断 Capacitor 原生 iOS、隐藏先享后付 |
| iOS API | `src/api/modules/iosMall.ts` | iOS 注册、资料、风控、订单、联系人、注销 |
| Capacitor 桥 | `useAndroidContacts.ts` | 名称沿用 Android，但实际同时支持 iOS |
| Bridge Controller | `MallBridgeViewController.swift` | 注册 `MallContactsPlugin` 实例 |
| iOS 插件 | `MallContactsPlugin.swift` | 联系人权限、有限授权、读取联系人、打开设置 |
| App 生命周期 | `AppDelegate.swift` | URL Scheme/Universal Link 交给 Capacitor 代理 |
| 原生配置 | `Info.plist`、Storyboard、Xcode project、Podfile | 权限、版本、方向、启动页、依赖、签名 |

### 3.2 关键版本与工程设置

| 项目 | 当前配置 |
| --- | --- |
| Capacitor iOS | `7.6.5` |
| 最低 iOS | 14.0 |
| Swift | 5.0 |
| Bundle ID | `com.wenshuo.mall` |
| Marketing Version | `1.0` |
| Build Number | `1` |
| `package.json` 版本 | `1.1.3` |
| 目标设备 | iPhone + iPad (`1,2`) |
| 签名 | Automatic |
| CocoaPods | Capacitor、CapacitorCordova、CapgoCapacitorUpdater |

iOS 原生版本、Android 版本和 Web package 版本目前没有统一：iOS 为 1.0(1)，Android 为 1.1.1(3)，Web package 为 1.1.3。

## 4. 当前 iOS 审核隐藏机制

### 4.1 判定

`isIosNativeApp()` 要求：

```text
Capacitor.isNativePlatform() === true
且 Capacitor.getPlatform() === 'ios'
```

`isIosBnplReviewHidden()` 直接返回该判定。因此：

- iPhone/iPad Safari H5 不受影响；
- 添加到主屏幕的 PWA 不受影响；
- Android App 不受影响；
- 只有 Capacitor 原生 iOS App 受影响；
- 当前没有动态恢复机制，重新构建代码前会一直隐藏。

### 4.2 被隐藏或阻止的功能

| 功能 | 当前 iOS 行为 | 实现位置 |
| --- | --- | --- |
| 首页先享后付分区 | 不渲染，首页固定商城专区 | `MallHomeView`、`HomeBannerMobile` |
| 商品列表先享后付分类 | 从分类中移除 | `MallListView` |
| 搜索先享后付商品 | 搜索目录中排除 | `MallSearchMobile` |
| 先享后付详情深链 | 识别 `salesMode=installment` 后回首页 | `MallProductDetailView` |
| 先享后付下单深链 | 再次拦截并回首页 | `order/create.vue` |
| 首页额度弹窗 | 根组件不挂载 | `App.vue` |
| `/installment` | 路由守卫重定向 `/` | `router/index.ts` |
| `/bill`、`/bill-risk-result` | 路由守卫重定向 `/` | `router/index.ts` |
| `/card-package` | 路由守卫重定向 `/` | `router/index.ts` |
| `/traffic-login` | 路由守卫重定向 `/` | `router/index.ts` |
| “我的”银行卡/账单/卡包 | 三个快捷入口全部隐藏 | `MyCenterMobile.vue` |
| “我的”先享后付推荐 | 隐藏 | `MyCenterMobile.vue` |
| 历史先享后付订单 | 列表过滤，不修改共享订单状态 | `MyOrderMobile.vue` |
| 协议/隐私文案 | 使用普通商城版本，移除先享后付描述 | 两个政策内容组件 |

“银行卡”快捷入口也被隐藏，但 `/bank-card` 不在路由限制集合中，所以知道地址的用户仍可直接进入银行卡页面。这是 UI 隐藏与路由保护不完全一致的边界。

### 4.3 当前 iOS 仍可用功能

- 普通商城首页和四类商品；
- 普通商城商品列表、搜索与详情；
- 简化注册；
- 短信/密码登录；
- 收货地址；
- 普通商城全款下单；
- 拉卡拉支付；
- 普通商城订单与物流；
- 在线客服；
- 隐私政策、用户协议；
- “账号与安全”及账号注销；
- App 下载入口（实际显示 iPhone Safari 添加到主屏幕指引）。

## 5. 当前 iOS 功能与实现

### 5.1 首页、列表、搜索与商品详情

iOS 使用共享 Vue 页面，但加载策略不同：

- 首页初始分区固定为 `mall`；
- 只拉取 `GET /products?salesMode=mall`；
- 分类为手机、数码、家电、美妆；
- `/list?category=all` 在 iOS 只表示全部普通商城商品；
- 搜索目录不合并 installment 商品；
- 商品详情仍会深链调用 `GET /products/:id`，如果接口返回 installment 商品，立即清空页面并回首页；
- 商品详情对 iOS 使用独立的 `100dvh` 内部滚动容器，修复 WebView 商品页滚动；
- 原生启动网络失败时商品 GET 使用最长约 49 秒的重试窗口。

### 5.2 iOS 简化注册

当前 `/register` 仍加载通用 `RegisterForm.vue`，但 `useIosReviewFlow=isIosNativeApp()` 后：

- 隐藏姓名；
- 隐藏身份证号；
- 隐藏身份证正面、反面、手持照上传；
- 隐藏两位紧急联系人；
- 只保留手机号、6 位验证码、密码、确认密码、协议勾选；
- 验证码调用 `POST /ios/auth/register/sms/send`；
- 注册调用 `POST /ios/auth/register`；
- 成功后把返回用户写入与通用商城相同的共享 profile、手机号 Cookie 和注册 Cookie；
- 渠道归因仍可随注册提交。

`src/components/ios/auth/IosRegisterForm.vue` 也实现了同类简化注册，但当前没有被 `MallRegisterView` 使用。

### 5.3 登录与会话

iOS 登录仍使用通用 `/auth/login/sms/send` 与 `/auth/login`，支持短信和密码。

会话实现与 H5/Android 一致：

- Cookie 保存手机号和注册标记；
- `GET /users/by-phone` 恢复 profile；
- 登录接口 token 返回后没有持久化；
- 请求使用按手机号构造的 `Bearer mock-token-{phone}`。

这意味着 iOS 注册使用 `/ios/auth/register`，登录却回到通用 `/auth/login`，后端必须保证两套账号数据完全兼容。

### 5.4 收货地址

- `GET /addresses` 读取；
- `POST /addresses` 新增；
- `PATCH /addresses/:id` 编辑；
- `PATCH /addresses/:id/default` 设默认；
- 下单页可进入地址页点选并带 `addressId` 返回；
- 省市区数据按需加载；
- 当前无删除地址。

### 5.5 普通商城下单

普通商品 `salesMode=mall` 不进入 iOS 资料/风控流程：

1. 校验登录、商品、收货地址、黑名单、进行中订单；
2. `POST /orders` 创建 `payType=full` 订单；
3. 打开拉卡拉收银台；
4. 支付成功后同步订单并进入待发货。

`order/create.vue` 内虽然保留 iOS 先享后付资料弹层和 iOS 风控分支，但 `isIosHiddenInstallmentProduct` 会在当前审核版先阻止 installment 商品进入，所以这部分当前不可达。

### 5.6 普通商城订单与物流

- 订单数据来自 `GET /my/orders`；
- 只展示 `mallUserId === profile.id` 的订单；
- 额外过滤所有 `payType=installment` 的历史订单；
- 支持状态筛选、未支付普通订单支付、复制运单号和打开第三方物流页；
- 当前 iOS “我的”订单计数也只统计非 installment 订单。

### 5.7 拉卡拉支付

与 H5/Android 共用：

- 获取支付配置；
- 创建 preorder；
- 跳转真实收银台或使用模拟支付；
- 查询支付状态；
- 使用 session 交易号和服务端 pending 同步恢复结果；
- 页面重新可见时刷新账单/订单状态。

在 iOS WebView 中使用 `window.location.replace(counterUrl)` 打开收银台。仓库没有额外 Swift 支付 SDK、ASWebAuthenticationSession 或专用返回 Scheme 处理，支付返回主要依赖 Web 页导航和可见性恢复。

### 5.8 在线客服

- 登录用户使用手机号 Authorization；
- 未登录访客使用本地 visitor/session/secret；
- 支持文本、图片；
- 每 5 秒轮询，App 退到后台时暂停；
- 回到前台后立即同步；
- 图片路径适配 API 网关；
- 消息合并避免旧轮询覆盖新发送内容。

### 5.9 账号与安全/注销

“账号与安全”只在原生 iOS 且已登录时出现在当前 `MyCenterMobile`。

流程：

1. 打开 `IosAccountSecurity.vue`；
2. `GET /ios/account/deletion-eligibility` 查询是否可注销；
3. 如有进行中订单等 blocker，逐条展示并禁止提交；
4. 用户输入当前密码；
5. 第一次点击进入最终确认状态；
6. 再次确认后调用 `POST /ios/account/delete`，body 包含密码和 `confirm=true`；
7. 成功后清空登录、订单、地址、银行卡、卡包、账单、客服和支付本地状态；
8. 跳转登录页。

接口允许后端返回两种处理结果：完全删除或“为法定义务保留后匿名化”。当前 UI 只统一提示注销成功，没有向用户展示具体 retention mode/days。

### 5.10 iPhone 安装指引

“我的 -> App下载”在 iPhone 环境不会下载 APK，而是：

- Safari 中展示“共享 -> 更多 -> 添加到主屏幕”步骤；
- 非 Safari 提示先用 Safari 打开配置的商城站点；
- 该逻辑在原生 iOS App 内也会被 UA 判定为 Apple 移动环境，因此入口更像 H5/PWA 推广，不是 App Store 更新入口。

## 6. iOS 原生联系人能力

当前审核版卡包路由被阻止，因此联系人插件虽已编译接入，但正常用户路径不会触发。它是为未来/非审核版先享后付合同流程保留的原生能力。

### 6.1 权限声明

`Info.plist` 声明：

- `NSContactsUsageDescription`：订单审核通过并进入合同签署前读取用户授权的联系人；
- `NSCameraUsageDescription`：拍摄身份证正反面和手持照；
- `NSPhotoLibraryUsageDescription`：选择身份证图片。

当前 iOS 审核版不展示身份证注册和先享后付入口，但这三个权限描述仍存在于包内。只有联系人插件调用时才会弹系统联系人授权；Web 文件选择是否触发相机/相册权限由 WKWebView/iOS 行为决定。

### 6.2 Bridge 注册

- Main storyboard 的根控制器是 `MallBridgeViewController`；
- 该控制器继承 `CAPBridgeViewController`；
- `capacitorDidLoad()` 中注册 `MallContactsPlugin()`；
- Xcode Sources Build Phase 已包含两个 Swift 文件。

### 6.3 联系人插件行为

`MallContactsPlugin.swift` 暴露：

| JS 方法 | iOS 行为 |
| --- | --- |
| `getContacts()` | 检查联系人权限、必要时申请、读取系统授权范围内的联系人 |
| `openAppSettings()` | 打开当前 App 的系统设置页 |

权限处理：

- `.authorized` 允许读取；
- iOS 18+ 的 `.limited` 也允许读取；
- `.notDetermined` 调用 `requestAccess`；
- 拒绝/受限不可读返回 `contacts_permission_denied`；
- 读取失败返回 `contacts_read_failed`。

联系人读取：

- 获取 identifier、完整姓名所需字段、组织名和电话号码；
- 优先用 `CNContactFormatter` 生成完整姓名，空时回退组织名；
- 同一联系人电话号码去重；
- 跳过没有手机号的联系人；
- 后台队列读取，主线程回调 JS；
- iOS 18 limited 模式下只会返回系统授权范围内的数据。

### 6.4 联系人上传

通用卡包流程触发后：

1. 前端先展示联系人用途确认；
2. 用户继续后调用原生插件；
3. 取消/拒绝时不上传；
4. 空选择时提示前往系统设置调整范围；
5. 有效联系人通过 iOS 专用 `/ios/orders/:orderId/contacts/upload/start|batch|complete` 分批上传；
6. 完成后重新拉取合同流程。

仓库另有通用 `/mall/contacts/upload/*`，Android 使用该组接口；iOS 分支显式映射联系人 DTO 后调用 `/ios/orders/...`。

## 7. 保留但当前不可达的 iOS 先享后付实现

即使当前路由隐藏，代码中仍完整保留一套 iOS 独立服务链路。

### 7.1 资料管理

`IosInstallmentProfileForm.vue`：

- 姓名、身份证号；
- 三张身份证图片；
- 两位紧急联系人；
- 图片最长边 1280px、JPEG 质量 0.82；
- `POST /ios/uploads/id-card` 上传；
- `PUT /ios/installment/profile` 保存。

`IosInstallmentProfileSummary.vue`：

- 展示姓名/身份证掩码；
- 展示证件照和联系人完整性；
- 用户可复用已有资料或重新填写。

### 7.2 iOS 独立风控与下单

通用 `order/create.vue` 的 iOS 分支以及未接入的 `IosOrderCreate.vue` 都实现：

1. `GET /ios/installment/profile` 检查资料；
2. `POST /ios/installment-risk/wave` 创建会话；
3. 按服务端 `stepKeys` 调用 `/ios/installment-risk/wave/:waveId/step/:stepKey`；
4. 全部通过后 `POST /ios/installment/orders` 创建订单；
5. 风控未通过时不创建订单。

这套链路与 H5/Android 的 `/mall/installment-risk/* + POST /orders` 不同，属于 iOS 隔离 API。

### 7.3 iOS 独立卡包候选页

未接入的 `IosCardPackageMobile.vue`：

- 只展示审核通过状态的卡包；
- 获取合同；
- 需要联系人时显示 `IosContactsConsent`；
- 上传 iOS 授权联系人；
- iframe 显示合同；
- 通过 `POST /card-packages/:orderId/contract-ack` 主动确认签署。

正式路由当前使用通用 `CardPackageSection.vue`，而且路由守卫阻止 iOS 进入。未来恢复时必须选择一套唯一实现，避免通用页与独立页同时演进。

## 8. iOS 专用接口

| 方法与路径 | 用途 | 当前审核版可达性 |
| --- | --- | --- |
| `POST /ios/auth/register/sms/send` | iOS 注册验证码 | 可达 |
| `POST /ios/auth/register` | iOS 简化注册 | 可达 |
| `GET /ios/account/deletion-eligibility` | 注销资格 | 可达 |
| `POST /ios/account/delete` | 注销账号 | 可达 |
| `GET /ios/installment/profile` | 资料状态/复用 | 被先享后付隐藏阻断 |
| `PUT /ios/installment/profile` | 保存申请资料 | 被阻断 |
| `POST /ios/uploads/id-card` | iOS 身份证上传 | 被阻断 |
| `POST /ios/installment-risk/wave` | 创建 iOS 风控 wave | 被阻断 |
| `POST /ios/installment-risk/wave/:waveId/step/:stepKey` | 执行风控步骤 | 被阻断 |
| `POST /ios/installment/orders` | 创建 iOS 先享后付订单 | 被阻断 |
| `POST /ios/orders/:orderId/contacts/upload/start` | 联系人上传初始化 | 卡包路由被阻断 |
| `POST /ios/orders/:orderId/contacts/upload/batch` | 联系人分批上传 | 被阻断 |
| `POST /ios/orders/:orderId/contacts/upload/complete` | 完成联系人上传 | 被阻断 |

当前普通商城仍使用共享接口：`/products`、`/auth/login`、`/users/by-phone`、`/addresses`、`/orders`、`/my/orders`、`/payment/lakala/*`、`/mall/cs/*`。

## 9. 原生配置

### 9.1 URL Scheme 与链接

`Info.plist` 注册：

```text
wenshuomall://
```

`AppDelegate` 把自定义 URL 和 Universal Link 回调交给 `ApplicationDelegateProxy`。仓库未发现 Associated Domains entitlement 或业务级 Universal Link 配置，因此当前明确可确认的是自定义 Scheme 支持；Universal Link 代理方法只是 Capacitor 模板能力。

### 9.2 启动页与 Bridge

- `LaunchScreen.storyboard` 使用 `Splash` 图片铺满；
- Main storyboard 直接实例化自定义 `MallBridgeViewController`；
- App 图标和 Splash 位于 `Assets.xcassets`；
- Capacitor `webDir=dist`，应用加载随包 Web 资源。

### 9.3 屏幕方向

- iPhone 支持竖屏、横屏左、横屏右；
- iPad 还支持倒置竖屏；
- PWA manifest 倾向 `portrait-primary`，但 iOS 原生 plist 没有锁定竖屏；
- 多数商城布局按移动端竖屏设计，横屏需要真机验证。

### 9.4 网络

`Info.plist` 没有配置 `NSAppTransportSecurity` 例外，默认遵循 iOS ATS，即远端 API、图片、合同和支付应使用 HTTPS。Capacitor 配置中的 `androidScheme=https` 对 iOS 没有同名业务意义，只是共享配置被同步到 iOS JSON。

## 10. 安全区与 WebView 兼容

全局 `main.scss` 定义：

```css
--app-safe-area-top: env(safe-area-inset-top);
--app-safe-area-bottom: env(safe-area-inset-bottom);
```

页面统一引用 CSS 变量，而不是在各组件重复直接写 `env(...)`，覆盖：

- 首页、列表、搜索、商品详情；
- 登录、注册、订单、地址、银行卡、账单、卡包；
- 客服、协议、隐私、App 下载；
- 支付、资料、账号安全等弹层。

Capacitor 没有强制 `contentInset=always`，避免原生 inset 与 CSS safe area 双重叠加。商品详情还为 iOS 使用 `100dvh + overflow-y:auto + -webkit-overflow-scrolling:touch`。

## 11. iOS OTA 状态

Podfile 和同步后的 Capacitor 配置都包含 `CapgoCapacitorUpdater`，但 `runAppOtaCheck()` 在检测到 `platform === 'ios'` 后立即返回：

- 不调用 `notifyAppReady()`；
- 不拉取 OTA manifest；
- 不下载或切换 bundle；
- iOS 当前只使用随包 `dist`。

因此 `.env` 中的 `VITE_APP_OTA_MANIFEST_URL` 当前只对 Android 生效。`vite-env.d.ts` 中“Android/iOS 启动时读取”的注释与实际实现不一致。

若 Capgo 插件在 iOS 包内要求 app-ready 生命周期确认，需要结合插件 manual 模式和真机日志进一步验证；仅凭当前前端代码不能确认完全无副作用。

## 12. 构建与发布

仓库没有专门的 `build:ios` npm script。根据当前配置，标准流程为：

```bash
npm run build
npx cap sync ios
npx cap open ios
```

随后在 macOS/Xcode 中：

1. 确认 CocoaPods 安装/同步；
2. 选择 Team、签名证书和 Provisioning Profile；
3. 更新 Marketing Version/Build Number；
4. 真机验证权限、支付、客服、深链和安全区；
5. Archive 并提交 App Store Connect。

当前工作区是 Windows，不能在本次分析中验证 `pod install`、Swift 编译、Xcode 签名或 App Store Archive。

## 13. 本地状态与数据清理

iOS WebView 使用与 H5 相同的 Cookie/localStorage/sessionStorage：

- `mall_registered`、`mall_login_phone`；
- 渠道归因与点击去重；
- 客服 visitor/session/secret；
- 拉卡拉 pending 交易；
- 可丢弃订单快照。

注销成功后前端会清理主要共享状态、本地订单、客服凭证和支付 session。Cookie 的实际存储仍由 WKWebView 网站数据容器管理；仓库没有 Swift 层主动调用 `WKWebsiteDataStore` 全量清除。

联系人读取结果不会写入 localStorage/Cookie，而是读取后直接交给上传函数。

## 14. 测试覆盖

现有 Node 测试验证：

- 审核隐藏只作用于 Capacitor 原生 iOS；
- 受限路由仍保留声明，但守卫会重定向；
- 首页、列表、搜索、详情、下单、我的、订单和政策文案均遵守隐藏开关；
- 商品详情与下单使用静态导入，避免 WebKit 动态模块互操作问题；
- 所有 iOS 页面使用共享安全区变量；
- iOS Contacts Bridge、Storyboard/Xcode Sources 注册完整；
- iOS 18 limited 联系人授权被接受；
- 拒绝权限时不会上传联系人；
- 原生商品启动重试窗口足够覆盖首次网络权限决定。

缺口：

- 没有 XCTest/UI Test 覆盖 Swift 插件；
- 没有 iOS 模拟器/真机自动化；
- 没有 App Store 审核包快照测试；
- 没有真实相机/相册/limited contacts 测试；
- 没有真实拉卡拉跳转返回、合同 iframe、账号注销后端集成测试；
- 当前 Xcode 自带测试未见业务用例。

## 15. 已识别风险与维护事项

### 15.1 高优先级

1. **审核隐藏是硬编码永久开关**：原生 iOS 永远隐藏先享后付，没有远端配置、版本条件或审核结束恢复流程。若正式业务需要恢复，必须改代码并重新发版。
2. **UI 隐藏与路由保护不完全一致**：银行卡入口被隐藏但 `/bank-card` 可深链访问；`/login?trafficLogin=1` 也可能绕过被限制的 `/traffic-login` 入口。若要求完全隔离，需要统一路由/业务层约束。
3. **两套 iOS UI 方案并存**：通用组件内 iOS 分支已接入，独立 `Ios*` 组件未接入，未来修改容易只更新一套。
4. **鉴权仍使用可预测 mock token**：账号、订单、注销和敏感资料必须由后端做真实身份校验。
5. **敏感资料链路仍打包在审核版**：虽然入口隐藏，身份证、联系人、先享后付 API 与权限说明仍存在于二进制/Web bundle；审核、隐私清单和安全评估应按实际包内容处理。

### 15.2 中优先级

1. iOS 版本 1.0(1) 与 Web/Android 版本不一致，发布和故障定位困难。
2. iOS 包包含 updater Pod，但运行时显式跳过 OTA，也不调用 app-ready；应确认插件生命周期配置。
3. iPhone/iPad 原生允许横屏，但界面主要按竖屏设计。
4. `UIRequiredDeviceCapabilities` 包含 `armv7`，而最低 iOS 14 与现代设备/工具链已是 64 位时代；需要在 Xcode Archive 中确认兼容性和商店校验结果。
5. 账号注销接口返回的数据保留模式没有在 UI 中展示，隐私告知可能不够精确。
6. `NSContactsUsageDescription` 文案末尾为分号，且联系人/相机/相册权限说明与当前隐藏功能并存，需要法务和审核口径一致。
7. App 下载入口在已安装的原生 iOS 中仍展示 Safari PWA 指引，产品语义可能混乱。
8. `.env.example` 与年龄测试样例仍为最大 49，实际开发/生产配置为 50；恢复 iOS 先享后付时会继承实际环境配置。

### 15.3 当前未接入文件

以下组件当前只被自动组件类型声明发现，没有正式 import/路由引用：

- `src/components/ios/auth/IosRegisterForm.vue`；
- `src/components/ios/order/IosOrderCreate.vue`；
- `src/components/ios/my/IosMyCenterMobile.vue`；
- `src/components/ios/my/IosCardPackageMobile.vue`；
- `src/components/ios/my/IosContactsConsent.vue` 仅被未接入卡包组件引用。

以下 iOS 组件是当前通用下单/我的流程真实使用的：

- `IosInstallmentProfileForm.vue`；
- `IosInstallmentProfileSummary.vue`；
- `IosAccountSecurity.vue`。

前两个虽被正式通用下单组件导入，但因审核隐藏而不可达；`IosAccountSecurity` 当前可达。

## 16. 关键文件索引

| 职责 | 文件 |
| --- | --- |
| iOS 平台判断 | `2.shop/src/utils/iosNativePlatform.ts` |
| 审核隐藏 | `2.shop/src/utils/iosBnplReviewVisibility.ts` |
| 路由守卫 | `2.shop/src/router/index.ts` |
| 当前首页 | `2.shop/src/views/MallHomeView.vue` |
| 当前注册 | `2.shop/src/components/auth/RegisterForm.vue` |
| 当前下单 | `2.shop/src/components/order/create.vue` |
| 当前个人中心 | `2.shop/src/components/my/MyCenterMobile.vue` |
| iOS API | `2.shop/src/api/modules/iosMall.ts` |
| iOS 资料表单 | `2.shop/src/components/ios/order/IosInstallmentProfileForm.vue` |
| 账号注销 | `2.shop/src/components/ios/my/IosAccountSecurity.vue` |
| 原生 Bridge | `2.shop/ios/App/App/MallBridgeViewController.swift` |
| 联系人插件 | `2.shop/ios/App/App/MallContactsPlugin.swift` |
| App 生命周期 | `2.shop/ios/App/App/AppDelegate.swift` |
| 权限与包配置 | `2.shop/ios/App/App/Info.plist` |
| Xcode 工程 | `2.shop/ios/App/App.xcodeproj/project.pbxproj` |
| CocoaPods | `2.shop/ios/App/Podfile` |
| Main Storyboard | `2.shop/ios/App/App/Base.lproj/Main.storyboard` |
| Launch Screen | `2.shop/ios/App/App/Base.lproj/LaunchScreen.storyboard` |

