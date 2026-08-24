# Shop Android 功能与技术实现分析

> 分析对象：`2.shop` Android 端  
> 分析日期：2026-08-24  
> 文档性质：基于当前仓库源码的静态分析；未连接真实设备、生产 API、拉卡拉、合同平台或应用分发平台。

## 1. Android 端定位

Android 端不是独立重写的原生商城，而是 Capacitor 7 App：

- Vue 3/Vite 构建出的 `dist` 作为应用内 Web 资源；
- `BridgeActivity` 承载 WebView；
- 商品、登录、下单、订单、账单、卡包、客服等业务逻辑与 H5 共用；
- Android 原生 Java 代码补充联系人权限/读取、系统设置跳转和自定义 Deep Link；
- Capgo Capacitor Updater 提供 Android Web 资源 OTA；
- Gradle/Keystore 脚本负责 APK 构建与签名。

因此 Android 文档中的“页面功能”大多对应 `src` 下共享 Vue 代码，“Android 特有实现”对应 `android`、`capacitor.config.ts` 和原生分支 composable。

## 2. 分析范围

已核对：

- 全部共享业务源码：`2.shop/src`；
- Android 原生源码：`2.shop/android/app/src/main`；
- Gradle 配置：`2.shop/android/*.gradle`、`android/app/*.gradle`、Gradle Wrapper；
- Capacitor 配置与生成的插件清单；
- Android 打包、签名、OTA 脚本；
- Android/原生行为相关测试；
- 为识别平台差异，同时核对 H5 与 iOS 代码。

未把 `node_modules`、`.gradle`、`build`、Android SDK 镜像、APK、图片二进制和其它生成物当作一方业务源码解释。

## 3. 技术架构

### 3.1 分层

| 层级 | 代码位置 | 职责 |
| --- | --- | --- |
| Web UI | `src/views`、`src/components` | 所有商城页面、表单、弹层与交互 |
| Web 业务 | `src/composables`、`src/utils` | 登录、商品、订单、风控、支付、账单、卡包、客服、租户 |
| Capacitor 桥 | `src/composables/useAndroidContacts.ts` | 注册并调用 `MallContacts` 原生插件 |
| Android Activity | `android/app/src/main/java/com/wenshuo/mall/MainActivity.java` | 注册插件、启动 Capacitor WebView、配置混合内容 |
| Android 插件 | `MallContactsPlugin.java` | 申请 `READ_CONTACTS`、读取联系人、打开系统设置 |
| Android 配置 | Manifest、Gradle、resources | 权限、Deep Link、SDK、版本、图标、启动页、签名 |
| OTA | `useAppOtaUpdate.ts`、Capgo 插件、`build-ota-bundle.sh` | 启动检查 manifest、下载并切换 Web bundle |

### 3.2 关键版本

| 项目 | 当前配置 |
| --- | --- |
| Capacitor Core/Android | `7.4.x` |
| Android Gradle Plugin | `8.7.2` |
| Gradle Wrapper | `8.11.1` |
| Java 编译目标 | Java 21 |
| `minSdkVersion` | 23 |
| `compileSdkVersion` | 35 |
| `targetSdkVersion` | 35 |
| Application ID/namespace | `com.wenshuo.mall` |
| Android `versionCode` | 3 |
| Android `versionName` | `1.1.1` |
| `package.json` 版本 | `1.1.3` |
| 屏幕方向 | Android Manifest 固定竖屏 |

Android 版本号与 Web package 版本当前不一致，发布流程需要明确哪一个用于 APK 升级、哪一个用于 OTA 版本。

## 4. Android 启动与运行流程

1. Android 启动 `MainActivity`；
2. `MainActivity.onCreate()` 在 `super.onCreate()` 前注册 `MallContactsPlugin`；
3. Capacitor 加载打包在应用内的 `dist`；
4. Vue `main.ts` 启动路由、租户拦截器和共享业务；
5. `runAppOtaCheck()` 判断当前是原生 Android，先调用 `notifyAppReady()`，再按配置检查 OTA；
6. 商品接口如果在原生启动阶段失败，会按 1/2/3/5/8/12/18 秒延迟重试，总等待窗口约 49 秒；
7. 登录用户启动后还会调用 `/mall/contract-pending` 检查是否有待继续签署的合同；命中时跳转卡包页并自动开启对应订单流程。

Capacitor 配置：

- `appId`: `com.wenshuo.mall`；
- `appName`: `文硕商城`；
- `webDir`: `dist`；
- Android WebView scheme 使用 `https`；
- CapacitorUpdater 使用 manual 模式，`autoUpdate=false`。

## 5. Android 可用功能

Android 没有启用 iOS App Store 审核隐藏开关，因此共享商城功能完整可用。

### 5.1 首页、商品与搜索

- 首页支持“先享后付 / 商城专区”切换；
- 商品分为手机、数码、家电、美妆；
- 商品列表支持全部、先享后付和四个商城分类；
- 搜索覆盖商品名称、副标题、描述与发货地；
- 详情页展示主图、详情图、价格、发货地和购买入口；
- 商品图片失败时生成本地 SVG 占位图；
- 原生冷启动网络尚未就绪时自动重试商品 GET，避免首屏永久空白。

主要代码：`useTeaProducts.ts`、`MallHomeView.vue`、`MallListView.vue`、`MallSearchMobile.vue`、`MallProductDetailView.vue`。

### 5.2 注册与登录

Android 使用与 H5 相同的实名注册：

- 姓名、手机号、短信验证码、密码；
- 身份证号；
- 身份证正面、反面、手持身份证照片；
- 两位紧急联系人；
- 用户协议和隐私政策。

图片在 WebView 中压缩为最长边 1280px、质量 0.82 的 JPEG，再上传 `/uploads/id-card`。登录支持短信与密码两种方式。

会话仍以手机号 Cookie、共享状态及 `mock-token-{手机号}` 请求头为主；后端必须独立校验身份和资源归属。

### 5.3 渠道归因与免登

- `?channel=` 归因保存 30 天；
- 同一 App Web 会话同一渠道点击只上报一次；
- 注册成功后清除归因；
- 点多多等合作方链接支持 `applyNo/token/consumePath` 免登消费；
- 审核中状态最多重试 20 次；
- 技术性接口错误不会直接展示给用户。

### 5.4 普通商城购买

`salesMode=mall` 商品流程：

1. 校验登录、商品、收货地址、黑名单和进行中订单；
2. `POST /orders` 创建全款订单；
3. 拉起拉卡拉收银台；
4. 支付成功后进入待发货；
5. 返回 App 后可通过 session 交易号与服务端 pending 同步恢复支付结果。

### 5.5 先享后付

Android 使用通用 H5/Android 风控链路：

- 商品金额不得超过授信额度；
- 当前配置年龄要求为 22 至 50 周岁；
- 对受限身份证前缀、收货地址与手机号归属地区做预校验；
- 新客户创建 `/mall/installment-risk/wave` 并逐步执行服务端返回的风控步骤；
- 所有步骤通过后提交带 `installmentRiskWaveId` 的订单；
- 最近一笔订单已发卡包且全部还清的老客户，可携带 `riskBypassReason=returning_customer` 申请复购直过；
- 同一用户有未完成订单时禁止新下单；
- 黑名单用户禁止下单；
- 风控步骤名称从用户提示中剔除，只显示审核结论。

### 5.6 地址、银行卡与个人中心

- 地址支持列表、新增、编辑、设默认、下单点选；
- 省市区数据按需加载；当前没有删除地址；
- 银行卡支持列表、新增与删除，卡号校验 12 至 19 位；
- “我的”展示订单计数、银行卡数、待还金额、卡包、客服、隐私、App 下载和商品推荐；
- Android App 内点击“App 下载”仍会走登录保护，再使用配置的 APK URL；通常已安装用户不需要此入口。

### 5.7 订单与物流

- 按全部、待审核、待发货、待收货、已完成筛选；
- 订单只按 `mallUserId === profile.id` 归属；
- 普通未支付订单可再次拉起收银台；
- 先享后付卡包已发放后视为已完成；
- 支持复制物流单号；
- 第三方物流页地址由环境变量提供。

### 5.8 账单与支付

- 账单按订单分组，展示期次、状态、协商记录、待还总额与最近到期日；
- 支持单期还款、协商支付、一键还款；
- 卡包未发放时禁止还款；
- 支付统一通过拉卡拉预下单、收银台、状态查询和 pending 同步；
- 测试配置可使用模拟支付接口；
- App 从收银台切回时依赖页面重新可见事件刷新支付和账单。

### 5.9 卡包与合同

- 列出审核后可领取的现金卡包；
- 获取合同流程并在内嵌 iframe 中签署；
- 校验 iframe `postMessage` 来源和订单号；
- 签署后刷新卡包，并展示企业微信客服二维码办理领取；
- 支持专属流水上传链接；
- Android 启动时可自动发现待继续合同并跳到对应卡包。

### 5.10 在线客服

- 登录用户和访客均可创建客服会话；
- 支持文字、图片；
- 每 5 秒轮询，页面退到后台时暂停；
- 消息按 ID 合并，避免慢响应覆盖新消息；
- 图片路径适配 `/api/static/uploads/cs` 网关。

## 6. Android 原生联系人功能

### 6.1 权限声明

`AndroidManifest.xml` 声明：

- `android.permission.INTERNET`；
- `android.permission.READ_CONTACTS`。

联系人权限不会在 App 启动或注册时主动请求，而是在先享后付订单审核通过、用户主动进入卡包合同签署、后端返回 `CONTACTS_REQUIRED` 后触发。

### 6.2 Java 插件

`MallContactsPlugin.java` 暴露两个 JS 方法：

| JS 方法 | 原生实现 |
| --- | --- |
| `getContacts()` | 检查/申请 `READ_CONTACTS`，后台线程读取系统联系人并返回 |
| `openAppSettings()` | 打开当前应用的系统设置页 |

读取逻辑：

- 查询 `ContactsContract.CommonDataKinds.Phone.CONTENT_URI`；
- 读取联系人 ID、显示名、手机号；
- 以联系人 ID 聚合，同一联系人可有多个手机号；
- 相同手机号去重；
- 跳过没有手机号的联系人；
- 在单线程 Executor 中读取，回到 UI 线程 resolve/reject；
- 拒绝权限返回 `contacts_permission_denied`；
- 读取异常返回 `contacts_read_failed`。

### 6.3 Web 与原生桥接

`useAndroidContacts.ts` 通过 `registerPlugin('MallContacts')` 调用原生插件：

1. 确认当前是 Android/iOS 原生平台；
2. 调用 `getContacts()`；
3. 校验至少有一个包含有效手机号的联系人；
4. 调用 `/mall/contacts/upload/start` 获取 `uploadId` 和服务端批大小；
5. 逐批调用 `/mall/contacts/upload/batch`；
6. 调用 `/mall/contacts/upload/complete` 完成快照；
7. 重新获取合同流程；
8. 权限被拒时可引导打开系统设置。

### 6.4 H5 到 Android App 的 Deep Link

Manifest 注册：

```text
wenshuomall://contract?orderId=<订单号>
```

H5 合同页发现必须在 App 完成通讯录授权时，可以尝试打开该链接。Activity 使用 `singleTask`，避免重复创建多个主实例。

当前代码只注册了 Deep Link intent-filter 和 Capacitor 默认 URL 处理，没有看到 Android Java 中针对 `orderId` 的专门解析；实际落到卡包指定订单主要依赖 App 启动后的 `/mall/contract-pending` 查询，而不是直接消费 intent 参数。

## 7. 网络与 WebView 配置

### 7.1 网络安全

Release：

- Manifest 设置 `usesCleartextTraffic=false`；
- `network_security_config.xml` 的 base config 禁止明文 HTTP。

Debug：

- 仍默认禁止明文；
- 仅允许模拟器宿主 `10.0.2.2` 使用 HTTP。

### 7.2 混合内容

`MainActivity` 对 WebView 调用：

```java
setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW)
```

这允许 HTTPS WebView 页面加载 HTTP 子资源。它与网络安全配置的“禁止 cleartext”目标存在张力：系统网络安全层可能仍拦截部分请求，但 WebView 层明确放宽了混合内容策略。生产环境应确保 API、图片、合同和支付链接全部 HTTPS，并评估是否需要这一配置。

### 7.3 其它 Manifest 设置

- `allowBackup=true`；
- 支持 RTL；
- `FileProvider` 已注册；
- Activity 处理屏幕、键盘、语言、UI mode 等配置变化；
- 启动主题使用全屏 `windowBackground` 图片，不使用 Android 12 的默认小图标 Splash 样式；
- Release 未启用代码压缩：`minifyEnabled=false`。

## 8. Android OTA

### 8.1 运行时

`runAppOtaCheck()` 只在原生 Android 执行：

1. 调用 `CapacitorUpdater.notifyAppReady()`；
2. 读取 `VITE_APP_OTA_MANIFEST_URL`；
3. 以 `cache: no-store` 拉取 `latest.json`；
4. 校验 `version` 和 `url`；
5. 比较当前 bundle 版本；内置 `builtin/built-in` 视为低于任意远程版本；
6. 下载带可选 SHA-256 checksum 的 zip；
7. `CapacitorUpdater.set(bundle)` 切换并重新加载；
8. 所有异常只记录警告，不阻塞 App 启动。

当前版本比较不是语义化版本排序，只要字符串不同就视为可更新。因此把远程 manifest 回退到旧版本也可能触发切换。

### 8.2 产物生成

`scripts/build-ota-bundle.sh`：

- 先运行 `npm run build`；
- 版本默认取 `package.json.version`，可由 `OTA_VERSION` 覆盖；
- 把 `dist` 压缩为 `wenshuo-mall-<version>.zip`；
- 计算 SHA-256；
- 生成 `ota-out/latest.json`；
- URL 基础地址读取 `.env.production` 的 `VITE_APP_OTA_BASE_URL`，也可由环境变量覆盖；
- 脚本只生成产物和打印上传地址，不会自动上传 OSS/CDN。

OTA 只能更新 Web 资源，不能更新 Java 代码、Manifest 权限、Gradle 依赖或原生插件。涉及原生变更必须发布新 APK。

## 9. 构建与签名

### 9.1 npm/Capacitor 命令

```bash
npm run build
npm run build:app
npm run open:android
npm run build:apk
npm run icons:android
npm run build:ota
```

- `build:app`：先构建 Vue，再 `cap sync android`；
- `build:apk`：同步 Web 资源后执行 Release Gradle 构建；
- `icons:android`：从 `assets` 生成图标；
- `build:ota`：生成 Android 可用的 Web OTA zip/manifest。

### 9.2 签名

`scripts/init-android-keystore.sh`：

- 自动寻找 Android Studio JBR/JDK；
- 生成 PKCS12 keystore；
- 生成 `android/keystore.properties`；
- 支持 `ANDROID_KEYSTORE_PASSWORD` 和 `ANDROID_KEY_PASSWORD`；
- 文件由项目 `.gitignore` 保护，但仍需独立、安全备份。

`android/app/build.gradle` 在存在 `keystore.properties` 时配置 Release signing；不存在时不会自动签名。

`scripts/build-android-release.sh` 自动查找 Java，执行 `assembleRelease`，最终检查：

```text
android/app/build/outputs/apk/release/app-release.apk
```

## 10. Android 接口映射

Android 业务接口来自共享 Vue 层：

| 业务 | 主要接口 |
| --- | --- |
| 商品 | `GET /products?salesMode=...`、`GET /products/:id` |
| 注册/登录 | `/auth/register/sms/send`、`/uploads/id-card`、`/auth/register`、`/auth/login/sms/send`、`/auth/login`、`/users/by-phone` |
| 渠道/免登 | `/traffic/channel-click`、动态 `/.../login/consume` |
| 订单 | `POST /orders`、`GET /my/orders`、`PATCH /orders/:id/pay` |
| 先享后付风控 | `/mall/installment-risk/wave`、`/mall/installment-risk/wave/:waveId/step/:stepKey` |
| 地址 | `GET/POST /addresses`、`PATCH /addresses/:id`、`PATCH /addresses/:id/default` |
| 银行卡 | `GET/POST /bank-cards`、`DELETE /bank-cards/:id` |
| 账单 | `GET /bills`、`POST /bills/repay`、`POST /bills/repay-negotiated` |
| 支付 | `/payment/lakala/config`、`preorder`、`status`、`mock-complete`、`sync-pending` |
| 卡包/合同 | `GET /card-packages`、`contract-flow`、`contract-ack`、`contract-sign-reset` |
| Android 待合同 | `GET /mall/contract-pending` |
| 联系人 | `/mall/contacts/status`、`upload/start`、`upload/batch`、`upload/complete` |
| 流水 | `GET /mall/me/bill-risk` |
| 客服 | `/mall/cs/session/open`、`session`、`messages`、`messages/image` |

## 11. 本地状态与端侧数据

- Web Cookie 保存登录手机号和注册标记；
- `localStorage` 保存渠道归因、客服访客凭证和可丢弃订单快照；
- `sessionStorage` 保存渠道点击去重、额度弹窗和支付恢复信息；
- 联系人由原生读取后直接传给分批上传回调，Web 层没有把联系人数组持久化到 localStorage/Cookie；
- Keystore、签名密码不应进入 Web bundle；
- 所有 `VITE_` 变量会编译进 Web 资源，包括 OTA/CDN/API URL，不可存放秘密。

## 12. 测试与验证覆盖

当前自动化测试覆盖：

- 原生平台商品启动重试；
- Android/iOS 联系人平台识别、联系人分块、空联系人校验；
- 权限拒绝错误识别；
- `wenshuomall://contract` URL 构造；
- 渠道登录与 APK 下载登录保护；
- 先享后付年龄/地区规则；
- 共享运行时配置与 iOS 隔离边界。

原生测试目录仍是 Capacitor 模板的 `ExampleUnitTest` 和 `ExampleInstrumentedTest`，没有针对 `MallContactsPlugin.java` 的 Android 单元/仪器测试。仓库也没有自动化真机权限、Deep Link、WebView 支付返回或 OTA 切换测试。

## 13. 已识别风险与维护事项

### 13.1 高优先级

1. **鉴权依赖 mock token**：Android 与 H5 共用可预测手机号 token；生产安全必须由后端独立保证。
2. **联系人属于高敏感权限**：Android 插件在授权后读取所有系统允许访问且含手机号的联系人，不是用户逐个选择模式。授权说明、最小化上传、保存期限和删除机制必须与隐私政策一致。
3. **混合内容被强制允许**：WebView 使用 `MIXED_CONTENT_ALWAYS_ALLOW`，可能削弱 HTTPS 页面安全边界。
4. **签名初始化脚本带默认密码回退**：如果发布人员不设置环境变量，会生成使用脚本内默认值的 keystore。正式发布应强制外部密码、限制 keystore 访问并安全备份。
5. **OTA 版本只做字符串不等比较**：可能接受回退版本；manifest/CDN 写权限和发布顺序必须严格控制。

### 13.2 中优先级

1. Android `versionName=1.1.1` 与 `package.json=1.1.3` 不一致，发布记录和 OTA manifest 容易混淆。
2. Deep Link 带 `orderId`，但原生 Activity 没有业务级解析；主要依赖服务端 pending 查询，Deep Link 精确恢复能力有限。
3. `allowBackup=true` 可能把 WebView/Cookie/本地存储纳入系统备份范围，需结合敏感数据策略评估。
4. Release 未启用 R8/ProGuard 压缩与混淆，包体和逆向成本未优化。
5. 联系人插件 Executor 没有显式 shutdown；通常随进程结束，但插件生命周期可进一步规范。
6. `FileProvider` 已注册但当前一方代码未看到具体分享/文件打开调用，属于预留配置。
7. `.env.example` 与 eligibility 测试仍以最大年龄 49 为示例，当前实际配置为 50。

### 13.3 未接入/历史代码

- `isAndroidNativeContactsAvailable()` 是专门判断方法，但通用卡包流程使用支持 Android/iOS 的 `isNativeContactsAvailable()`；
- `readAndroidDeviceContacts/openAndroidAppSettings` 只是通用方法的兼容别名；
- `MallContactsStatus` 查询能力已封装，但当前卡包主流程主要在触发上传后重新拉合同；
- Android 的 Cordova 插件模块仍存在，但当前一方插件是 Capacitor Java 插件。

## 14. 关键文件索引

| 职责 | 文件 |
| --- | --- |
| Capacitor 总配置 | `2.shop/capacitor.config.ts` |
| Android Activity | `2.shop/android/app/src/main/java/com/wenshuo/mall/MainActivity.java` |
| 联系人插件 | `2.shop/android/app/src/main/java/com/wenshuo/mall/MallContactsPlugin.java` |
| Manifest | `2.shop/android/app/src/main/AndroidManifest.xml` |
| App Gradle | `2.shop/android/app/build.gradle` |
| SDK 版本 | `2.shop/android/variables.gradle` |
| 原生桥调用 | `2.shop/src/composables/useAndroidContacts.ts` |
| 联系人上传 | `2.shop/src/composables/useMallContacts.ts` |
| 卡包合同 | `2.shop/src/components/my/CardPackageSection.vue` |
| 待合同恢复 | `2.shop/src/composables/useMallContractPending.ts` |
| OTA 运行时 | `2.shop/src/composables/useAppOtaUpdate.ts` |
| OTA 产物 | `2.shop/scripts/build-ota-bundle.sh` |
| APK 构建 | `2.shop/scripts/build-android-release.sh` |
| Keystore 初始化 | `2.shop/scripts/init-android-keystore.sh` |
| 共享下单 | `2.shop/src/components/order/create.vue` |
| 共享路由 | `2.shop/src/router/index.ts` |

