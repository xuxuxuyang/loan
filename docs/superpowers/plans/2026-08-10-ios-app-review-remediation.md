# iOS App 审核整改实施计划

> **执行要求：** 使用 `superpowers:executing-plans` 按任务顺序实施。涉及代码功能时先写失败测试，再写最小实现。每批文件修改后都必须从项目根目录运行 `node scripts/check-mojibake.js .`。

**目标：** 只为原生 iOS App 增加符合 App Store Guideline 5.1.1(v) 的简化注册、先享后付资料后移、有限通讯录授权和账号注销能力，同时保证 H5、Android、现有接口和历史数据不变。

**架构：** 页面薄壳按 `Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'` 分流。iOS 页面和 API 客户端位于独立目录，后端使用 `/ios/*` 独立路由模块。现有组件与默认路由保持原样。

**技术栈：** Vue 3、TypeScript、Vite、Capacitor 7、Swift/Contacts、Koa、Node.js CommonJS、Node test runner。

## 全局约束

- 不修改 H5 和 Android 核心组件的内部业务逻辑。
- 不放宽或改变 `/auth/register`、`/orders`、`/mall/contacts/*` 的默认校验和契约。
- 不执行数据库迁移、回填、批量更新、批量删除或启动时补字段。
- 不连接生产 MongoDB、生产 OSS、生产短信或生产风控服务进行测试。
- 不创建审核账号差异、审核期服务端开关或审核后恢复旧流程的 OTA 方案。
- 不提交、合并、推送或部署，除非用户另行明确要求。
- 每个任务完成后运行根目录乱码检查；任何失败都必须先修复再进入下一任务。

---

## Task 1：冻结 H5 和 Android 基线

**文件：**

- 新增：`1.api/tests/iosLegacyContractBaseline.test.js`
- 新增：`2.shop/src/utils/iosNativePlatform.test.ts`
- 读取但不修改：`2.shop/src/components/auth/RegisterForm.vue`
- 读取但不修改：`2.shop/src/components/order/create.vue`
- 读取但不修改：`2.shop/src/components/my/CardPackageSection.vue`

**目标：** 在增加 iOS 分支前，用契约测试固定旧平台仍使用旧组件、旧接口和旧字段。

- [ ] 记录 H5/Android 注册请求仍调用 `POST /auth/register`，并包含当前必填实名与紧急联系人字段。
- [ ] 记录旧订单创建仍调用 `POST /orders`。
- [ ] 记录旧卡包联系人上传仍调用 `/mall/contacts/*`。
- [ ] 增加静态隔离断言：旧核心组件中不得出现 `/ios/` 路径。
- [ ] 增加后端契约测试：不传身份证号或紧急联系人时，原 `/auth/register` 仍按当前规则拒绝。
- [ ] 使用完全内存化夹具和假短信校验，不读取任何生产连接配置。

运行：

```powershell
node --test 1.api/tests/iosLegacyContractBaseline.test.js
node scripts/check-mojibake.js .
```

预期：基线测试通过，工作树中没有业务数据文件变化。

---

## Task 2：增加统一 iOS 原生判断和页面薄壳分发

**文件：**

- 新增：`2.shop/src/utils/iosNativePlatform.ts`
- 修改：`2.shop/src/views/MallRegisterView.vue`
- 修改：`2.shop/src/views/MallOrderCreateView.vue`
- 修改：`2.shop/src/views/MallCardPackageView.vue`
- 修改：`2.shop/src/views/MallMyView.vue`
- 修改：`2.shop/src/composables/useAppOtaUpdate.ts`

**接口：**

```ts
export function isIosNativeApp(): boolean
```

实现必须只返回：

```ts
Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'
```

- [ ] 先写平台矩阵测试：Web 为 `false`、Android 原生为 `false`、iOS 原生为 `true`。
- [ ] 新增平台工具，不读取 User-Agent、域名、账号或远程配置。
- [ ] 四个页面薄壳使用平台工具选择组件；非 iOS 分支保留现有 import 和渲染结果。
- [ ] iOS 组件先使用明确的占位导入目标，随后任务补齐实际文件；不得把 iOS 业务写入薄壳。
- [ ] `runAppOtaCheck()` 在原生 iOS 判断后立即返回；Web 和 Android 原有执行顺序保持不变。
- [ ] 断言 Android 原生仍会执行现有 `CapacitorUpdater.notifyAppReady()` 分支。

运行：

```powershell
npm --prefix 2.shop run build
node scripts/check-mojibake.js .
```

预期：前端构建通过，iOS 以外平台仍加载原组件。

---

## Task 3：建立 iOS 后端模块骨架和公共校验

**文件：**

- 新增：`1.api/src/ios/index.js`
- 新增：`1.api/src/ios/router.js`
- 新增：`1.api/src/ios/auth.js`
- 新增：`1.api/src/ios/profile.js`
- 新增：`1.api/src/ios/masking.js`
- 新增：`1.api/src/ios/validation.js`
- 修改：`1.api/src/index.js`
- 新增：`1.api/tests/iosAppReviewRemediation.test.js`

**模块接口：**

```js
registerIosAppRoutes(router, deps)
```

依赖由 `1.api/src/index.js` 注入，至少包含：`readDb`、精确写入函数、`success`、`fail`、手机号规范化、短信发送/核销、密码哈希/校验、风控 wave、订单持久化、联系人 store 和 OSS 私有对象删除能力。

- [ ] 先写测试证明模块缺少必要依赖时启动失败，并给出依赖名。
- [ ] 新增 `/ios/*` 路由模块，路由注册本身不得读写数据库。
- [ ] `1.api/src/index.js` 只增加 require、依赖注入和路由注册，不修改原路由处理器。
- [ ] 新增稳定业务错误结构 `{ success: false, code, msg }`，保持成功响应 `{ success: true, data }`。
- [ ] 增加日志脱敏测试，禁止记录密码、身份证号、图片 URL 和联系人数据。
- [ ] 后端测试使用内存 DB、假短信、假 OSS、假风控和临时联系人 store。

运行：

```powershell
node --test 1.api/tests/iosAppReviewRemediation.test.js
node scripts/check-mojibake.js .
```

预期：模块可独立装配，原接口测试保持通过。

---

## Task 4：实现 iOS 简化注册

**文件：**

- 新增：`2.shop/src/api/modules/iosMall.ts`
- 新增：`2.shop/src/components/ios/auth/IosRegisterForm.vue`
- 修改：`1.api/src/ios/auth.js`
- 修改：`1.api/src/ios/router.js`
- 修改：`1.api/tests/iosAppReviewRemediation.test.js`

**接口：**

```http
POST /ios/auth/register/sms/send
POST /ios/auth/register
```

注册请求类型：

```ts
interface IosRegisterRequest {
  phone: string
  smsCode: string
  password: string
  channel?: string
}
```

- [ ] 先写失败测试：手机号非法、验证码非法、密码少于 6 位、重复手机号、无效渠道。
- [ ] 写测试证明请求不含 `name`、`idNumber`、图片或 `emergencyContacts` 时可以成功注册。
- [ ] 写测试证明即使客户端额外传入实名字段，iOS 注册服务也忽略这些字段且不落库。
- [ ] 注册使用现有短信底层能力和用户写入方式，不调用原 `/auth/register` 路由处理器。
- [ ] 新用户使用当前系统允许的默认展示名；不写虚构身份证或联系人占位值。
- [ ] iOS 注册组件只显示手机号、验证码、密码、确认密码和注册协议。
- [ ] 注册成功后复用现有商城登录 Cookie/状态，失败时按稳定错误码显示文案。
- [ ] 旧 `RegisterForm.vue` 保持不变。

运行：

```powershell
node --test 1.api/tests/iosAppReviewRemediation.test.js
npm --prefix 2.shop run build
node scripts/check-mojibake.js .
```

---

## Task 5：实现 iOS 先享后付资料状态、上传和原子保存

**文件：**

- 新增：`2.shop/src/components/ios/order/IosInstallmentProfileForm.vue`
- 新增：`2.shop/src/components/ios/order/IosInstallmentProfileSummary.vue`
- 修改：`2.shop/src/api/modules/iosMall.ts`
- 修改：`1.api/src/ios/profile.js`
- 修改：`1.api/src/ios/router.js`
- 修改：`1.api/tests/iosAppReviewRemediation.test.js`

**接口：**

```http
POST /ios/uploads/id-card
GET /ios/installment/profile
PUT /ios/installment/profile
```

保存请求：

```ts
interface IosInstallmentProfileUpdate {
  name: string
  idNumber: string
  idCardFront: string
  idCardBack: string
  idCardHandheld: string
  emergencyContacts: [
    { name: string, phone: string },
    { name: string, phone: string },
  ]
}
```

状态响应：

```ts
interface IosInstallmentProfileStatus {
  complete: boolean
  canReuse: boolean
  nameMasked: string
  idNumberMasked: string
  hasIdCardFront: boolean
  hasIdCardBack: boolean
  hasIdCardHandheld: boolean
  emergencyContactsMasked: Array<{
    nameMasked: string
    phoneMasked: string
  }>
}
```

- [ ] 先测试未登录、资料缺失、身份证格式错误、图片场景错误、联系人格式错误、两位联系人重复和联系人等于本人手机号。
- [ ] 测试 GET 只返回脱敏摘要和图片存在布尔值，不返回完整身份证号、完整手机号或图片 URL。
- [ ] 测试 PUT 在任一字段失败时用户记录完全不变。
- [ ] 图片上传只接受 `front`、`back`、`handheld` 三种场景，并沿用现有大小、类型和 OSS 安全校验。
- [ ] PUT 只写现有字段 `name`、`idNumber`、`idCardFront`、`idCardBack`、`idCardHandheld`、`emergencyContacts`。
- [ ] 完整度实时计算，不写 `profileComplete`。
- [ ] 首次显示完整表单；已有资料显示脱敏摘要和“使用已有资料”“重新填写”两个动作。
- [ ] 重新填写必须提交完整新资料，不支持局部覆盖。

运行：

```powershell
node --test 1.api/tests/iosAppReviewRemediation.test.js
npm --prefix 2.shop run build
node scripts/check-mojibake.js .
```

---

## Task 6：实现 iOS 先风控、后创建订单

**文件：**

- 新增：`2.shop/src/components/ios/order/IosOrderCreate.vue`
- 修改：`2.shop/src/api/modules/iosMall.ts`
- 新增：`1.api/src/ios/installment.js`
- 修改：`1.api/src/ios/router.js`
- 修改：`1.api/tests/iosAppReviewRemediation.test.js`

**接口：**

```http
POST /ios/installment-risk/wave
POST /ios/installment-risk/wave/:waveId/step/:stepKey
POST /ios/installment/orders
```

订单请求不包含身份证资料：

```ts
interface IosInstallmentOrderRequest {
  productId: number
  name: string
  spec: string
  quantity: number
  totalAmount: number
  installmentPeriods: number
  receiverName: string
  receiverPhone: string
  receiverAddress: string
  installmentRiskWaveId: string
}
```

- [ ] 先写测试证明资料不完整时不能创建 wave。
- [ ] 测试 wave 绑定当前用户，其他用户不能执行步骤或核销。
- [ ] 测试任一步失败、超时、缺失或 wave 过期时 `/ios/installment/orders` 不产生订单。
- [ ] 测试全部步骤通过后只创建一笔订单，重复核销返回受控错误且不重复写入。
- [ ] 服务端从当前用户资料读取姓名和身份证，不接受订单请求覆盖实名信息。
- [ ] 服务端复用现有风控底层模块，但使用 iOS 独立路由和会话归属校验。
- [ ] iOS 下单页先展示普通全款与先享后付区别；只有用户选择先享后付才进入资料流程。
- [ ] 资料保存或复用后逐步执行风控，全部通过后才调用创建订单。
- [ ] 全款购买不得触发实名资料或通讯录权限。

运行：

```powershell
node --test 1.api/tests/iosAppReviewRemediation.test.js
npm --prefix 2.shop run build
node scripts/check-mojibake.js .
```

---

## Task 7：实现审核通过后的有限通讯录授权

**文件：**

- 新增：`2.shop/src/components/ios/my/IosCardPackageMobile.vue`
- 新增：`2.shop/src/components/ios/my/IosContactsConsent.vue`
- 修改：`2.shop/src/api/modules/iosMall.ts`
- 新增：`1.api/src/ios/contacts.js`
- 修改：`1.api/src/ios/router.js`
- 修改：`1.api/src/mallContacts/store.js`
- 修改：`1.api/tests/iosAppReviewRemediation.test.js`
- 保持不变：`2.shop/ios/App/App/MallContactsPlugin.swift`

**接口：**

```http
POST /ios/orders/:orderId/contacts/upload/start
POST /ios/orders/:orderId/contacts/upload/batch
POST /ios/orders/:orderId/contacts/upload/complete
```

- [ ] 先测试未登录、订单不属于当前用户、未审核通过、非先享后付、合同已签和空联系人列表。
- [ ] 测试联系人手机号规范化、无手机号过滤、重复号码去重和至少一条有效记录。
- [ ] 测试 start/batch/complete 上传会话不能跨用户或跨订单使用。
- [ ] iOS 页面只在用户从已审核订单主动进入合同并点击继续后显示权限前置说明。
- [ ] 调用现有 `MallContactsPlugin`，接受 `.authorized` 和 iOS 18+ `.limited` 返回的数据。
- [ ] 用户取消或拒绝时不调用 complete，不写已完成摘要，不进入合同。
- [ ] 前置说明只提供“继续选择联系人”和“暂不继续”，不诱导完全访问。
- [ ] complete 成功后重新加载合同状态；服务端仍在合同入口二次验证联系人完成状态。
- [ ] 给联系人 store 增加按当前账号删除上传和批次的方法，仅供账号注销使用；不得增加全库删除方法。

运行：

```powershell
node --test 1.api/tests/iosAppReviewRemediation.test.js
npm --prefix 2.shop run build
node scripts/check-mojibake.js .
```

物理设备验收：iOS 18+ 只选择一位联系人，服务端保存数量为 1；取消授权时保存数量为 0。

---

## Task 8：实现 iOS 应用内账号注销

**文件：**

- 新增：`2.shop/src/components/ios/my/IosMyCenterMobile.vue`
- 新增：`2.shop/src/components/ios/my/IosAccountSecurity.vue`
- 修改：`2.shop/src/api/modules/iosMall.ts`
- 新增：`1.api/src/ios/accountDeletion.js`
- 修改：`1.api/src/ios/router.js`
- 修改：`1.api/src/mallContacts/store.js`
- 修改：`1.api/src/oss.js`
- 修改：`1.api/tests/iosAppReviewRemediation.test.js`

**接口：**

```http
GET /ios/account/deletion-eligibility
POST /ios/account/delete
```

删除请求：

```ts
interface IosAccountDeleteRequest {
  currentPassword: string
  confirm: true
}
```

- [ ] 先测试未登录、错误密码、`confirm` 非 `true`、越权请求和重复请求。
- [ ] 定义进行中业务检查：待审核、待发货、待收货、合同未完成、未结清分期、待还账单及现有系统可识别的其他活动业务。
- [ ] 测试存在任一活动业务时返回 `ACCOUNT_HAS_ACTIVE_BUSINESS`，所有数据保持原样。
- [ ] 测试无依法保留记录时只删除当前用户、地址、银行卡、联系人上传/批次和三张私有图片，返回 `hard_deleted`。
- [ ] 测试只有已结清历史业务时删除认证和直接身份数据，将必须保留的交易、账务和合同记录去标识化，返回 `anonymized_with_legal_retention`。
- [ ] 留存天数读取 `IOS_ACCOUNT_LEGAL_RETENTION_DAYS`，未配置时使用 1825；非法值阻止模块启用。
- [ ] OSS 删除函数只接受从当前用户三个图片字段解析出的私有对象键，拒绝通配符、目录根和跨用户对象。
- [ ] 注销身份只取自 Bearer 令牌，忽略请求体中的手机号或用户 ID。
- [ ] iOS UI 提供资格说明、密码输入、最终确认和成功结果；成功后调用现有 logout 清除 Cookie、状态和缓存并返回登录页。
- [ ] 不提供“联系客服注销”作为替代路径。

运行：

```powershell
node --test 1.api/tests/iosAppReviewRemediation.test.js
node scripts/check-mojibake.js .
```

---

## Task 9：更新 iOS 隐私用途说明和审核配置

**文件：**

- 修改：`2.shop/ios/App/App/Info.plist`
- 审计：`2.shop/ios/App/App/PrivacyInfo.xcprivacy`
- 保持 Android 配置不变：`2.shop/android/`

- [ ] 将 `NSContactsUsageDescription` 改为只描述先享后付审核通过后的合同前用途和有限授权。
- [ ] 增加或修正 `NSCameraUsageDescription`，说明用于主动申请先享后付的身份证拍摄。
- [ ] 增加或修正 `NSPhotoLibraryUsageDescription`，说明用于主动申请先享后付的身份证选择。
- [ ] 使用 `plutil -lint` 验证 `Info.plist`。
- [ ] 审计 Privacy Manifest 的 Required Reason API、跟踪域名和第三方 SDK 声明。
- [ ] 核对 App Store Connect App Privacy：联系方式、标识符、照片/用户内容、联系人、购买和交易数据与实际收集一致。
- [ ] 不修改 Android Manifest、Android 权限文案或 Android 构建配置。

用途说明固定文案见 `docs/ios/2026-08-10-ios-app-review-remediation-implementation.md`。

---

## Task 10：全量回归、物理设备验收和发布准备

**文件：**

- 修改：`docs/ios/2026-08-10-ios-app-review-remediation-implementation.md` 中的实测记录区
- 不修改：任何生产数据文件

- [ ] 运行后端全量测试。
- [ ] 运行商城 TypeScript 和 Vite 构建。
- [ ] 确认 H5 和 Android 注册、下单、卡包和个人中心回归通过。
- [ ] 使用网络日志确认 H5/Android 不调用 `/ios/*`。
- [ ] 使用 TestFlight 和物理 iPhone 完成简化注册、先享后付资料、风控、创建订单、后台审核、有限联系人授权、合同和注销流程。
- [ ] 录制 Apple 要求的账号创建/登录到完整注销视频。
- [ ] 核对隐私政策、App Privacy、审核备注和测试账号。
- [ ] 法务书面批准法定保留范围和 `IOS_ACCOUNT_LEGAL_RETENTION_DAYS` 生产值。

Windows/通用验证：

```powershell
npm --prefix 1.api test
npm --prefix 2.shop run build
node scripts/check-mojibake.js .
git diff --check
git status --short
```

macOS/Xcode 验证：

```bash
cd 2.shop
npx cap sync ios
plutil -lint ios/App/App/Info.plist
xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug -sdk iphonesimulator build
```

预期：所有命令退出码为 0；物理设备验收记录完整；工作树中没有数据库数据文件、Android 业务文件或 H5 核心组件变化。

---

## Task 11：上线与回滚检查点

- [ ] 后端先以加法方式发布 `/ios/*`，旧接口保持可用。
- [ ] 后端发布后先验证旧 H5/Android，再验证 TestFlight iOS。
- [ ] iOS 只提交包含固定 Web 资源的 App Store 构建，原生 iOS 不执行通用 OTA。
- [ ] 不使用审核账号、审核日期或服务端开关改变功能。
- [ ] App Store 发布后不得删除该版本依赖的 `/ios/*` 接口。
- [ ] 出现异常时只回滚代码或提交新的 iOS 修复版本，不执行数据库反向迁移。
- [ ] 如果 Apple 明确拒绝联系人要求，下一 iOS 版本隐藏整个先享后付入口，不通过 OTA 恢复。

## 完成定义

只有同时满足以下条件才可声明代码整改完成：

- iOS 注册只收集手机号、验证码和密码。
- 实名资料只在用户主动选择先享后付后收集。
- 风控全部通过前不创建订单。
- 通讯录只在订单审核通过、合同签署前请求，并支持 iOS 18+ 有限授权。
- App 内账号注销完整可用，且只影响当前账号。
- H5 和 Android 的现有组件、接口和数据行为保持不变。
- 没有迁移、回填、批量数据操作、生产测试连接或审核规避逻辑。
- 后端全量测试、商城构建、乱码检查、Git 差异检查和物理设备验收全部通过。
