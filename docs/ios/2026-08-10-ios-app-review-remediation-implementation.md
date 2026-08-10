# iOS App 审核整改实现与提审操作手册

- **审核条款：** App Store Review Guideline 5.1.1(v)
- **Submission ID：** `57e41734-eb99-43b9-bc7e-b7669cf29d55`
- **原审核日期：** 2026-07-28
- **原审核设备：** iPhone 17 Pro Max
- **原审核版本：** 1.0 (3)
- **适用范围：** 仅原生 iOS App

## 1. 使用说明

本文是 iOS 整改的开发、联调、测试、上线和再次提审手册。实施人员必须同时遵守以下两份文档：

- `docs/superpowers/specs/2026-08-10-ios-app-review-remediation-design.md`
- `docs/superpowers/plans/2026-08-10-ios-app-review-remediation.md`

发生冲突时，优先级为：用户明确要求、项目 `AGENTS.md`、设计说明、实施计划、本文操作细节。

本文不授权任何生产数据库操作。禁止使用生产账号或生产连接完成自动化测试。

## 2. 必须保持不变的线上业务

### 2.1 H5

- 继续使用 `RegisterForm.vue`。
- 继续调用 `/auth/register`。
- 继续执行现有实名和紧急联系人校验。
- 继续使用现有 `/orders`、`/mall/contacts/*` 和合同接口。
- 不加载 `src/components/ios/**`。

### 2.2 Android

- 与 H5 使用相同的现有注册和订单核心组件。
- 继续执行现有 Android 通讯录和 OTA 逻辑。
- 不调用 `/ios/*`。
- 不修改 Android Manifest、原生权限和构建脚本。

### 2.3 数据

- 不迁移、不回填、不批量更新、不批量删除。
- 不在启动时扫描历史用户或自动补实名字段。
- 不增加修改历史数据的运维脚本。
- 只有用户本人主动操作产生单账号、单订单或单上传会话写入。

## 3. 目标目录结构

### 3.1 商城前端

```text
2.shop/src/
├─ api/modules/
│  └─ iosMall.ts
├─ utils/
│  └─ iosNativePlatform.ts
└─ components/ios/
   ├─ auth/
   │  └─ IosRegisterForm.vue
   ├─ order/
   │  ├─ IosOrderCreate.vue
   │  ├─ IosInstallmentProfileForm.vue
   │  └─ IosInstallmentProfileSummary.vue
   └─ my/
      ├─ IosMyCenterMobile.vue
      ├─ IosAccountSecurity.vue
      ├─ IosCardPackageMobile.vue
      └─ IosContactsConsent.vue
```

### 3.2 后端

```text
1.api/src/ios/
├─ index.js
├─ router.js
├─ auth.js
├─ profile.js
├─ installment.js
├─ contacts.js
├─ accountDeletion.js
├─ masking.js
└─ validation.js
```

后端测试统一放在：

```text
1.api/tests/iosAppReviewRemediation.test.js
1.api/tests/iosLegacyContractBaseline.test.js
```

## 4. 平台分流实现

### 4.1 唯一判断函数

```ts
import { Capacitor } from '@capacitor/core'

export function isIosNativeApp(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'
}
```

禁止增加以下回退判断：

- `navigator.userAgent`；
- iPhone 屏幕尺寸；
- App Store 审核账号；
- 域名或 API Host；
- 服务端返回的审核状态；
- 日期、版本审核期或灰度名单。

### 4.2 页面薄壳

四个页面壳层只选择组件，不承载业务：

```vue
<script setup lang="ts">
import LegacyComponent from '~/components/existing/LegacyComponent.vue'
import IosComponent from '~/components/ios/example/IosComponent.vue'
import { isIosNativeApp } from '~/utils/iosNativePlatform'

const useIosFlow = isIosNativeApp()
</script>

<template>
  <IosComponent v-if="useIosFlow" />
  <LegacyComponent v-else />
</template>
```

非 iOS 分支的组件、props、生命周期和路由必须与改动前一致。平台分流测试需要覆盖 Web、Android 原生和 iOS 原生三种返回值。

### 4.3 iOS OTA

`runAppOtaCheck()` 的第一段判断顺序固定为：

```ts
if (!Capacitor.isNativePlatform()) {
  return
}
if (Capacitor.getPlatform() === 'ios') {
  return
}
```

Android 随后继续执行现有 `notifyAppReady`、manifest、download 和 set 流程。iOS 不下载、不激活通用 OTA bundle，确保 App Store 审核行为与发布后的同一构建一致。

## 5. iOS 注册实现

### 5.1 页面字段

| 字段 | 必填 | 校验 |
| --- | --- | --- |
| 手机号 | 是 | 中国大陆 11 位手机号，与现有规则一致 |
| 短信验证码 | 是 | 现有注册验证码规则 |
| 密码 | 是 | 至少 6 位 |
| 确认密码 | 是 | 与密码一致，只在客户端校验 |
| 注册协议 | 是 | 用户主动勾选 |

页面不得出现姓名、身份证号、身份证上传、紧急联系人、通讯录授权或“完善资料后才能注册”的提示。

### 5.2 推荐页面文案

标题：

```text
创建账号
```

辅助说明：

```text
注册商城账号只需要手机号。普通浏览和全款购买无需提供身份证或联系人信息。
```

按钮：

```text
注册并登录
```

### 5.3 注册短信接口

```http
POST /api/ios/auth/register/sms/send
Content-Type: application/json

{
  "phone": "13800138000"
}
```

成功：

```json
{
  "success": true,
  "data": {}
}
```

失败示例：

```json
{
  "success": false,
  "code": "INVALID_PHONE",
  "msg": "手机号格式不正确"
}
```

### 5.4 注册接口

```http
POST /api/ios/auth/register
Content-Type: application/json

{
  "phone": "13800138000",
  "smsCode": "123456",
  "password": "example-password",
  "channel": "appstore"
}
```

服务端处理顺序：

1. 规范化并校验手机号。
2. 校验密码长度。
3. 检查手机号未注册。
4. 校验可选渠道。
5. 核销短信验证码。
6. 创建现有商城用户记录和密码哈希。
7. 返回现有商城用户响应和登录状态所需信息。

请求中即使出现 `name`、`idNumber`、`idCardFront`、`idCardBack`、`idCardHandheld` 或 `emergencyContacts`，iOS 注册服务也必须忽略，不能落库。

## 6. 先享后付资料实现

### 6.1 进入条件

用户必须先在订单确认页主动选择“先享后付”。在此之前不得读取资料状态、跳转实名页或请求图片/通讯录权限。

进入资料流程前展示：

```text
先享后付申请说明

为了完成您主动申请的先享后付实名核验和风险审核，需要提交姓名、身份证资料和两位紧急联系人。上述资料仅用于本次及后续先享后付申请；普通全款购买无需提供。
```

操作：

```text
继续申请
改用全款购买
```

### 6.2 查询资料状态

```http
GET /api/ios/installment/profile
Authorization: Bearer <token>
```

无完整资料：

```json
{
  "success": true,
  "data": {
    "complete": false,
    "canReuse": false,
    "nameMasked": "",
    "idNumberMasked": "",
    "hasIdCardFront": false,
    "hasIdCardBack": false,
    "hasIdCardHandheld": false,
    "emergencyContactsMasked": []
  }
}
```

已有完整资料：

```json
{
  "success": true,
  "data": {
    "complete": true,
    "canReuse": true,
    "nameMasked": "张*",
    "idNumberMasked": "110***********1234",
    "hasIdCardFront": true,
    "hasIdCardBack": true,
    "hasIdCardHandheld": true,
    "emergencyContactsMasked": [
      { "nameMasked": "李*", "phoneMasked": "138****8001" },
      { "nameMasked": "王*", "phoneMasked": "139****8002" }
    ]
  }
}
```

响应禁止包含图片 URL、完整身份证号和完整联系人手机号。

### 6.3 图片上传

```http
POST /api/ios/uploads/id-card
Authorization: Bearer <token>
Content-Type: multipart/form-data

scene=front|back|handheld
file=<image>
```

只允许三种 scene。iOS 图片会在本地解码、按最大边 1280 像素缩放并转换为 JPEG 后再上传；无法解码的文件不会上传。iOS 证件上传独立使用 `Cache-Control: private, no-store`，通用 `uploadPublicImage` 的原有默认缓存策略保持不变。

资料保存接口会校验三个对象 URL 均属于当前 OSS 环境、当前登录手机号和对应的 `front`、`back`、`handheld` 场景，并拒绝重复对象。上传失败时不得把失败 URL 写入用户资料。用户上传后退出或反复替换产生的未引用对象不能由本次数据库逻辑安全识别，生产 OSS 必须为证件目录配置经法务批准的生命周期清理规则。

### 6.4 原子保存资料

```http
PUT /api/ios/installment/profile
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "张三",
  "idNumber": "110101199001011234",
  "idCardFront": "https://private-object/front-key",
  "idCardBack": "https://private-object/back-key",
  "idCardHandheld": "https://private-object/handheld-key",
  "emergencyContacts": [
    { "name": "李四", "phone": "13800138001" },
    { "name": "王五", "phone": "13900138002" }
  ]
}
```

服务端校验全部通过后，单次写入当前用户的现有字段。任一失败都不能修改已有用户资料。

校验要求：

- 姓名非空并符合现有姓名规则；
- 身份证号通过现有格式校验并统一大写 `X`；
- 三张图片 URL 均属于允许的私有对象范围；
- 恰好两位紧急联系人；
- 姓名和手机号均有效；
- 两位手机号不同；
- 联系人手机号不能等于当前注册手机号。

### 6.5 复用与更新

资料完整时只显示脱敏摘要：

```text
已保存的实名资料
姓名：张*
身份证：110***********1234
证件照片：已保存 3 张
紧急联系人：李* 138****8001、王* 139****8002
```

操作固定为：

```text
使用已有资料继续
重新填写资料
```

“重新填写资料”打开空白完整表单，不把完整敏感资料回传到客户端。提交新资料后整体替换旧资料。

## 7. 风控与订单创建

### 7.1 创建风控会话

```http
POST /api/ios/installment-risk/wave
Authorization: Bearer <token>
Content-Type: application/json

{}
```

服务端从登录用户现有资料构造风控参数，不接受客户端传入姓名、手机号或身份证覆盖。

响应：

```json
{
  "success": true,
  "data": {
    "waveId": "IRW...",
    "stepKeys": ["step-a", "step-b"]
  }
}
```

资料不完整时：

```json
{
  "success": false,
  "code": "IOS_PROFILE_INCOMPLETE",
  "msg": "请先完成先享后付实名资料"
}
```

### 7.2 执行步骤

```http
POST /api/ios/installment-risk/wave/{waveId}/step/{stepKey}
Authorization: Bearer <token>
```

客户端严格按服务端返回顺序逐步执行。任一步 `ok=false` 时立即停止，不调用订单创建。页面只显示合规的通用失败原因，不暴露上游接口、规则阈值或内部错误堆栈。

### 7.3 创建先享后付订单

```http
POST /api/ios/installment/orders
Authorization: Bearer <token>
Content-Type: application/json

{
  "productId": 1001,
  "name": "商品名称",
  "spec": "默认规格",
  "quantity": 1,
  "totalAmount": 2750,
  "installmentPeriods": 12,
  "receiverName": "张三",
  "receiverPhone": "13800138000",
  "receiverAddress": "完整收货地址",
  "installmentRiskWaveId": "IRW..."
}
```

服务端必须重新检查：

1. 当前用户存在且未被限制下单；
2. 实名资料仍完整；
3. wave 属于当前用户；
4. 服务端定义的所有步骤均成功；
5. wave 未过期、未核销；
6. 商品、金额、数量、额度和收货资料符合现有订单规则。

全部通过后才写入一笔订单并核销 wave。重复请求不能生成第二笔订单。

## 8. 通讯录有限授权和合同

### 8.1 允许请求权限的时机

必须同时满足：

- 原生 iOS；
- 用户本人已登录；
- 先享后付订单属于当前用户；
- 后台审核已通过；
- 合同尚未签署；
- 用户主动进入卡包/合同并点击继续。

App 启动、注册、登录、首页、商品详情、订单资料、风控和订单等待审核阶段均不得请求通讯录。

### 8.2 权限前置说明

标题：

```text
选择联系人以继续签署
```

正文：

```text
该先享后付订单已审核通过。继续签署合同前，需要读取并上传您在 iOS 系统中选择授权的联系人姓名和手机号，用于订单安全核验。iOS 18 及以上可以只选择部分联系人；我们不会上传未授权的联系人，也不会读取备注、地址、生日、邮箱或头像。
```

按钮：

```text
继续选择联系人
暂不继续
```

禁止使用“必须完全访问”“授权全部联系人才能使用 App”“通讯录越多通过率越高”等诱导文案。

### 8.3 原生插件行为

现有 `MallContactsPlugin.swift` 已处理：

- `.authorized`；
- iOS 18+ `.limited`；
- `.notDetermined` 首次系统请求；
- 拒绝时返回 `contacts_permission_denied`；
- 读取失败时返回 `contacts_read_failed`。

实现时保留该插件，不添加绕过系统选择范围的 Contacts 查询。`.limited` 下 `CNContactStore` 只能返回系统授权范围，前端不得要求用户再次授予完全访问。

### 8.4 上传流程

开始：

```http
POST /api/ios/orders/{orderId}/contacts/upload/start
Authorization: Bearer <token>

{
  "totalContacts": 1
}
```

批次：

```http
POST /api/ios/orders/{orderId}/contacts/upload/batch
Authorization: Bearer <token>

{
  "uploadId": "MCU...",
  "batchIndex": 0,
  "contacts": [
    {
      "contactId": "system-contact-id",
      "displayName": "李四",
      "phones": ["13800138001"]
    }
  ]
}
```

完成：

```http
POST /api/ios/orders/{orderId}/contacts/upload/complete
Authorization: Bearer <token>

{
  "uploadId": "MCU...",
  "expectedBatchCount": 1
}
```

服务端按手机号规范化、过滤和去重，至少一条有效手机号才能完成。complete 成功后更新当前订单和用户的现有联系人上传摘要，再允许合同入口继续。

### 8.5 取消和错误

| 情况 | App 行为 | 服务端结果 |
| --- | --- | --- |
| 用户点击“暂不继续” | 关闭说明，停留卡包 | 无请求 |
| 系统权限拒绝 | 提示可稍后重试 | 无 complete |
| 系统返回空联系人 | 提示至少选择一位有效联系人 | 上传不得完成 |
| 上传中断 | 保留重试入口 | 订单仍未满足合同前置条件 |
| 订单状态已变化 | 刷新订单并停止流程 | 返回受控错误 |

## 9. 应用内账号注销

### 9.1 页面入口

```text
我的
└─ 账号与安全
   └─ 注销账号
```

入口不得隐藏在客服、隐私政策网页或外部浏览器中。

### 9.2 查询注销资格

```http
GET /api/ios/account/deletion-eligibility
Authorization: Bearer <token>
```

允许注销：

```json
{
  "success": true,
  "data": {
    "canDelete": true,
    "mode": "hard_deleted",
    "blockers": [],
    "legalRetentionDays": 1825
  }
}
```

进行中业务阻止：

```json
{
  "success": true,
  "data": {
    "canDelete": false,
    "mode": "blocked",
    "blockers": [
      {
        "code": "ACTIVE_INSTALLMENT",
        "message": "您有尚未结清的先享后付账单"
      }
    ],
    "legalRetentionDays": 1825
  }
}
```

资格查询必须只读。

### 9.3 阻断条件

以下任一情况存在时不允许注销：

- 订单待审核；
- 订单待发货；
- 订单待收货；
- 已审核订单的合同尚未完成；
- 先享后付尚未全部结清；
- 存在待还账单；
- 存在现有系统可以识别的退款、售后或争议业务。

阻断时不删除、不匿名化、不改变账号状态。

### 9.4 确认页面文案

无历史保留记录：

```text
注销后，您的登录信息、个人资料、地址、银行卡、身份证资料和已上传联系人将被永久删除，且无法恢复。
```

存在已结清历史业务：

```text
注销后，您的登录信息和非必要个人资料将被永久删除。依法必须保留的已结清交易、账务和已签合同记录将在去标识化和访问受限后按法定期限保存。
```

密码输入标签：

```text
请输入当前登录密码
```

最终按钮：

```text
永久注销账号
```

最终确认弹窗：

```text
确认永久注销？该操作无法撤销，注销成功后您将立即退出当前账号。
```

### 9.5 注销接口

```http
POST /api/ios/account/delete
Authorization: Bearer <token>
Content-Type: application/json

{
  "currentPassword": "example-password",
  "confirm": true
}
```

错误密码：

```json
{
  "success": false,
  "code": "INVALID_CURRENT_PASSWORD",
  "msg": "当前密码不正确"
}
```

进行中业务：

```json
{
  "success": false,
  "code": "ACCOUNT_HAS_ACTIVE_BUSINESS",
  "msg": "当前账号存在进行中的业务，暂时无法注销"
}
```

硬删除成功：

```json
{
  "success": true,
  "data": {
    "mode": "hard_deleted"
  }
}
```

去标识化保留成功：

```json
{
  "success": true,
  "data": {
    "mode": "anonymized_with_legal_retention",
    "retentionDays": 1825
  }
}
```

### 9.6 服务端处理顺序

1. 从 Bearer 令牌解析当前手机号和用户。
2. 验证 `confirm === true`。
3. 使用现有密码哈希验证当前密码。
4. 在同一次操作中重新计算注销资格。
5. 如果有活动业务，返回错误且不修改数据。
6. 收集当前用户自己的地址、银行卡、联系人上传和身份证图片对象键。
7. 无保留义务时删除当前用户和附属数据。
8. 有已结清历史业务时删除认证和直接个人资料，对必要交易、账务和合同去标识化。
9. 删除当前账号的联系人上传、对应批次和客服会话。
10. 对三张身份证图片逐个执行受限 OSS 删除。
11. 刷新当前操作涉及的精确持久化范围。
12. 返回删除模式，不返回已删除的敏感数据。

不得根据客户端传入的手机号、用户 ID 或订单 ID扩大删除范围。不得使用手机号前缀、OSS 目录前缀或数据库通配条件批量删除。

### 9.7 留存规则

环境变量：

```env
IOS_ACCOUNT_LEGAL_RETENTION_DAYS=1825
```

生产启用前，法务必须书面批准：

- 适用法律依据；
- 需要保留的数据类别；
- 保留期限；
- 访问角色；
- 期限届满后的归档清理机制。

法务未批准时，不得把默认值直接视为生产合规结论。

### 9.8 App 成功处理

服务端成功后立即：

1. 清除商城用户状态；
2. 清除登录手机号 Cookie；
3. 清除注册状态 Cookie；
4. 清除 iOS 内存状态，并精确删除 `mall-orders`、三个客服凭据 key 和 `lakala_pending_pay`；不得调用 `localStorage.clear()` 或 `sessionStorage.clear()` 影响无关数据；
5. 替换导航到登录页；
6. 禁止返回手势回到已登录页面。

## 10. 后端错误码与前端文案

| 错误码 | 前端文案 | 行为 |
| --- | --- | --- |
| `INVALID_PHONE` | 手机号格式不正确 | 聚焦手机号 |
| `INVALID_SMS_CODE` | 验证码无效或已过期 | 保留手机号 |
| `PHONE_ALREADY_REGISTERED` | 该手机号已注册，请直接登录 | 提供登录入口 |
| `IOS_PROFILE_INCOMPLETE` | 请先完成先享后付实名资料 | 打开资料页 |
| `IOS_RISK_NOT_PASSED` | 本次先享后付审核未通过 | 不创建订单 |
| `IOS_CONTACTS_REQUIRED` | 请先选择至少一位联系人 | 保留重试入口 |
| `IOS_CONTACTS_PERMISSION_DENIED` | 尚未获得联系人授权，可稍后重试 | 不打开合同 |
| `ORDER_NOT_OWNED` | 无法访问该订单 | 返回订单列表 |
| `ORDER_NOT_ELIGIBLE_FOR_CONTRACT` | 当前订单状态暂不能签署合同 | 刷新订单 |
| `INVALID_CURRENT_PASSWORD` | 当前密码不正确 | 清空密码输入 |
| `ACCOUNT_HAS_ACTIVE_BUSINESS` | 当前账号存在进行中的业务，暂时无法注销 | 展示阻断明细 |

未知错误统一显示“操作失败，请稍后重试”，日志记录错误码和请求 ID，不记录敏感请求体。

## 11. iOS 原生配置

### 11.1 Info.plist 固定文案

```xml
<key>NSContactsUsageDescription</key>
<string>仅在您主动申请的先享后付订单审核通过并进入合同签署前，用于读取和上传您在系统中选择授权的联系人；普通购物无需此权限。</string>
<key>NSCameraUsageDescription</key>
<string>用于您主动申请先享后付时拍摄身份证正反面和手持身份证照片，以完成身份核验；普通购物无需此权限。</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>用于您主动申请先享后付时从相册选择身份证正反面和手持身份证照片，以完成身份核验；普通购物无需此权限。</string>
```

不得使用“提升通过率”“系统要求”“全部授权”等模糊或诱导描述。

### 11.2 Privacy Manifest

逐项检查：

- App 自身是否使用 Required Reason API；
- Capacitor、Capgo 和其他 SDK 是否附带有效隐私清单；
- 是否存在 tracking domain；
- 是否声明追踪；
- 收集数据是否链接到用户身份；
- 联系人和照片是否只用于 App 功能、风控或防欺诈等已申报目的。

隐私清单不是 App Store Connect App Privacy 的替代品，两处都要与实际代码一致。

当前仓库没有 App 级 `PrivacyInfo.xcprivacy`。这不等于可以跳过隐私清单审计；必须在 macOS 上对最终归档中的 Capacitor、Capgo 和全部三方 SDK 清单进行检查，并根据实际 Required Reason API 使用情况决定是否新增 App 级清单，不能在未审计时填写推测性的理由代码。

## 12. App Store Connect App Privacy 核对

根据最终生产实现核对以下类别：

| 数据类别 | iOS 收集时机 | 与身份关联 | 主要用途 |
| --- | --- | --- | --- |
| 手机号 | 注册/登录 | 是 | 账号功能、认证 |
| 姓名和身份证号 | 主动申请先享后付 | 是 | 实名核验、风控 |
| 身份证照片 | 主动申请先享后付 | 是 | 实名核验、风控 |
| 紧急联系人 | 主动申请先享后付 | 是 | 订单风险审核 |
| 通讯录选择数据 | 审核通过、合同前 | 是 | 订单安全核验 |
| 收货地址 | 创建订单 | 是 | 履约 |
| 购买和交易数据 | 创建/履行订单 | 是 | App 功能、账务 |

是否属于追踪、广告或第三方广告用途必须按实际 SDK 和数据共享情况填写。本文方案不授权将这些数据用于广告追踪。

## 13. 自动化测试

### 13.1 后端测试原则

- `NODE_ENV=test`。
- 使用内存 DB 或测试夹具。
- 联系人 store 使用临时目录或内存实现。
- 短信、OSS、风控和合同上游全部使用假实现。
- 测试环境显式清空生产连接变量。
- 测试结束后只清理测试临时目录。

### 13.2 必测用例

注册：

- 只提交手机号、验证码、密码成功；
- 不提交身份证和联系人仍成功；
- 额外敏感字段被忽略；
- 原 `/auth/register` 规则不变。

资料：

- 缺任一字段失败且原记录不变；
- 查询只返回脱敏摘要；
- 两位联系人重复失败；
- 图片对象不属于当前用户范围时失败。

风控/订单：

- 资料不完整不能创建 wave；
- wave 不能跨用户；
- 任一步失败不创建订单；
- 全部通过只创建一笔订单；
- 重复核销不重复建单。

通讯录：

- 未审核订单不能上传；
- 非本人订单不能上传；
- 空列表不能完成；
- 重复号码去重；
- 取消授权不写完成状态。

注销：

- 错误密码不修改数据；
- 活动业务阻断且数据不变；
- 无历史业务硬删除当前账号；
- 已结清历史业务去标识化；
- 其他用户数据逐字段保持不变；
- 当前账号联系人上传和批次被清理；
- OSS 删除目标只包含当前账号三张图片。

### 13.3 2026-08-10 Windows 自动化记录

- `npm.cmd --prefix 1.api test`：225 项测试通过，0 失败；测试使用内存夹具、临时 JSON 文件和 Mongo fake，没有启动 API 服务或连接生产 MongoDB、OSS、短信、风控、合同上游。
- `npm.cmd --prefix 2.shop run build`：`vue-tsc` 与 Vite 构建通过，1812 个模块完成转换；构建仅报告既有的大 chunk 性能警告。
- 根目录乱码检查通过；最终差异、保护目录和文档占位符检查以交付时最后一次命令输出为准。

## 14. 平台回归矩阵

| 场景 | iOS App | Android App | H5 |
| --- | --- | --- | --- |
| 注册页面 | 简化注册 | 现有完整注册 | 现有完整注册 |
| 注册接口 | `/ios/auth/register` | `/auth/register` | `/auth/register` |
| 全款购买 | 不收实名资料 | 保持现状 | 保持现状 |
| 先享后付资料 | 选择后收集 | 保持现状 | 保持现状 |
| 通讯录 | 审核通过、合同前 | 保持现状 | 保持现状 |
| 注销入口 | App 内完整流程 | 不在本次变更 | 不在本次变更 |
| OTA | 禁用通用 OTA | 保持现状 | 不适用 |

H5 和 Android 验收必须同时验证页面 DOM、接口 URL、请求字段和关键响应处理，不以“构建成功”替代行为回归。

## 15. 验证命令

项目根目录：

```powershell
npm --prefix 1.api test
npm --prefix 2.shop run build
node scripts/check-mojibake.js .
git diff --check
git status --short
```

macOS：

```bash
cd 2.shop
npx cap sync ios
plutil -lint ios/App/App/Info.plist
xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug -sdk iphonesimulator build
```

物理 iPhone 必测：

- 注册短信和登录状态；
- 相机和相册身份证上传；
- 首次资料填写；
- 脱敏资料复用和整体更新；
- 风控失败不建单；
- 风控通过后建单；
- 后台审核前无通讯录权限；
- 审核通过后 iOS 18+ 有限联系人授权；
- 取消授权不上传；
- 合同签署；
- 错误密码注销；
- 活动业务阻止注销；
- 可注销账号的完整删除流程。

## 16. 发布顺序

1. 在隔离测试环境完成自动化测试。
2. 发布只新增 `/ios/*` 的兼容后端。
3. 用线上等价但不含真实用户数据的测试环境验证旧 H5/Android。
4. 构建 iOS App 并执行 `npx cap sync ios`。
5. 在 TestFlight 物理设备完成全链路。
6. 法务批准留存范围和期限。
7. 更新隐私政策、App Privacy 和审核备注。
8. 准备审核账号、审核订单和物理设备录屏。
9. 提交新的 iOS 构建。

后端先发布是因为新路由为加法式接口，不改变旧客户端；iOS 构建发布后必须继续保留其依赖的接口。

## 17. 监控和日志

后端按接口统计：

- 请求量、成功率、P95 延迟；
- 稳定业务错误码分布；
- 风控 wave 创建、失败、通过、核销数量；
- 订单创建幂等冲突；
- 联系人权限取消、空列表和上传完成数量；
- 注销资格阻断、密码错误和成功模式数量。

禁止记录：

- 完整手机号；
- 密码或密码哈希；
- 身份证号；
- 身份证图片 URL；
- 联系人姓名和手机号；
- 地址明文；
- 完整请求体。

## 18. 回滚方案

### 18.1 后端尚未被 App Store 版本使用

可以回滚新增 iOS 后端代码。只回滚代码，不处理数据库，不删除用户或订单。

### 18.2 App Store 版本已经发布

- 不直接删除 `/ios/*`。
- 先恢复后端兼容能力，避免已发布客户端不可用。
- 通过新的 iOS 修复版本更改客户端行为。
- 不使用通用 OTA 修改审核相关页面或权限时机。
- 不执行数据库反向迁移。

### 18.3 Apple 再次拒绝联系人要求

不改变审核账号或审核期行为。创建新的 iOS 版本，隐藏先享后付入口，只保留普通浏览和全款购买。H5 和 Android 保持现状，除非后续另有明确产品决策。

## 19. App Review 审核备注模板

### 19.1 中文模板

```text
本版本已针对 Guideline 5.1.1(v) 完成整改：

1. iOS 注册现在只要求手机号、短信验证码和密码。注册及普通购物不再要求姓名、身份证号、身份证照片、紧急联系人或通讯录权限。
2. 身份证资料和两位紧急联系人仅在用户主动选择“先享后付”后收集，用于该服务的实名核验和风险审核。用户也可以选择普通全款购买而无需提交这些资料。
3. 通讯录权限只在先享后付订单审核通过、用户准备签署合同时请求。iOS 18 及以上支持用户只选择部分联系人，App 只上传系统实际授权的联系人姓名和手机号。
4. App 已在“我的 > 账号与安全 > 注销账号”中提供完整的应用内账号注销流程。用户输入当前密码并确认后即可完成注销；不需要联系客服。

我们在 App Review Information 中提供了物理设备录屏，展示注册/登录、进入注销入口以及完整注销流程。
```

### 19.2 English template

```text
This version has been updated to address Guideline 5.1.1(v):

1. Account registration in the iOS app now requires only a phone number, SMS verification code, and password. Registration and regular shopping no longer require a name, government ID number, ID photos, emergency contacts, or Contacts permission.
2. Government ID information, ID photos, and two emergency contacts are collected only after the user explicitly chooses the Buy Now, Pay Later service. They are used for identity verification and risk review for that service. Users can instead choose regular full payment without providing this information.
3. Contacts permission is requested only after a Buy Now, Pay Later order has passed review and the user proceeds to contract signing. On iOS 18 and later, users can grant limited access, and the app uploads only the names and phone numbers returned by the system for contacts selected by the user.
4. A complete in-app account deletion flow is available at My Account > Account & Security > Delete Account. The user confirms the deletion with the current password and does not need to contact customer support.

A physical-device screen recording showing sign-in/account creation, navigation to the deletion option, and the complete deletion flow is included in App Review Information.
```

## 20. 物理设备录屏脚本

Apple 明确要求录制账号创建/登录到完整注销的流程。使用与提交构建一致的物理 iPhone 录屏，确保画面不剪切关键确认步骤。

### 20.1 录制前准备

- 安装本次提交的 Release/TestFlight 构建。
- 准备一个可注销的审核账号：无进行中订单、无待还账单。
- 如展示注册，准备未注册手机号和可接收验证码的测试通道。
- 关闭系统通知预览，避免录入无关个人信息。
- 不在视频中展示真实身份证或真实联系人。

### 20.2 必录镜头

1. 打开 App，展示版本和首页。
2. 进入注册页，清晰展示只有手机号、验证码、密码和确认密码。
3. 创建账号，或使用审核账号登录。
4. 进入“我的”。
5. 点击“账号与安全”。
6. 点击“注销账号”。
7. 展示注销影响和当前资格。
8. 输入当前密码。
9. 点击“永久注销账号”。
10. 在最终确认弹窗中确认。
11. 展示注销成功和自动返回登录页。
12. 尝试使用原账号登录，展示账号已不存在或不能继续登录。

### 20.3 可选补充录屏

另录一段隐私收集时机：

1. 注册和普通全款购买不要求实名资料。
2. 选择先享后付后才显示资料说明和表单。
3. 订单审核前不出现通讯录权限。
4. 审核通过、进入合同后才出现用途说明和 iOS 系统联系人选择。
5. 在 iOS 18+ 只选择一个联系人并继续。

## 21. App Review Information 填写

在 App Store Connect 的 App Review Information 中提供：

- 审核账号手机号；
- 审核账号密码；
- 如需验证码，提供稳定的审核验证码获取方式；
- 账号注销路径；
- 可演示合同流程的已审核测试订单；
- 物理设备录屏附件；
- 上述英文审核备注；
- 联系方式和测试时区。

审核账号不得拥有真实用户数据，不得因为账号属于 Apple 审核而执行不同页面或接口逻辑。

## 22. 提交前最终检查表

- [ ] iOS 注册只显示手机号、验证码和密码相关字段。
- [ ] 普通全款购买不要求实名资料。
- [ ] 先享后付入口提前说明资料范围和用途。
- [ ] 身份证与紧急联系人只在选择先享后付后收集。
- [ ] 风控失败不创建订单。
- [ ] 通讯录只在审核通过、合同签署前请求。
- [ ] iOS 18+ 有限授权实机通过。
- [ ] 取消授权不上传任何联系人。
- [ ] App 内注销完整可用。
- [ ] 进行中业务阻断文案明确且不修改数据。
- [ ] H5 和 Android 回归通过且不调用 `/ios/*`。
- [ ] iOS 通用 OTA 已禁用，Android OTA 未改变。
- [ ] 后端全量测试通过。
- [ ] 商城构建通过。
- [ ] Xcode 构建和物理设备测试通过。
- [ ] 根目录乱码检查通过。
- [ ] Git 差异检查没有空白错误。
- [ ] 没有数据库迁移、数据脚本或生产测试连接。
- [ ] 法务已批准留存范围和期限。
- [ ] App Privacy 与实际数据收集一致。
- [ ] 审核备注、审核账号和录屏已上传。

## 23. 完成判定

本整改只有在自动化测试、H5/Android 回归、iOS 物理设备全链路、隐私配置、App Store Connect 材料和账号注销录屏全部通过后才可以提交审核。任何一项失败都不得通过审核开关、账号差异、远程配置或 OTA 绕过。

## 24. 当前代码交付状态与上线边界

截至 2026-08-10，仓库已实现 iOS 页面薄壳分流、简化注册、先享后付资料后移、图片对象归属校验、先风控后建单、审核后有限联系人授权、应用内注销和 iOS OTA 退出。旧 H5/Android 核心组件和默认接口未改为 `/ios/*`。

以下事项不由 Windows 自动化测试替代，完成前不得提交审核：

- 在 macOS 执行 Capacitor 同步、`plutil` 和 Xcode 构建，并检查最终 Archive 的 Privacy Manifest；
- 在物理 iPhone 验证 iOS 18+ 有限联系人、拒绝/取消授权、HEIC/JPEG、相机、相册、拉卡拉回调、合同和完整注销录屏；
- 在生产发布前由法务批准留存字段、期限、OSS 访问策略和未引用证件对象生命周期；
- App Store Connect App Privacy、隐私政策、审核账号和审核备注必须与最终生产配置一致。

现有商城认证体系仍使用项目历史 Bearer 解析方式，本次按既定计划复用，没有替换 H5/Android 登录体系，也没有实现 Apple App Attest。若生产安全评估要求不可预测令牌或原生设备证明，应另立 iOS 独立认证/App Attest 项目，不能用 User-Agent、静态 App 密钥或审核开关替代。

账号注销会跨主业务持久化、联系人存储和 OSS 执行当前账号的数据清理。本实现严格限制目标并在每一步失败时停止，但在现有“无新集合、无迁移、无删除作业”约束下无法提供跨 Mongo/OSS 的分布式原子事务；生产上线前必须验证失败告警、重试和人工受控处置流程。本文档生成和本次自动化测试均未调用生产删除接口。
