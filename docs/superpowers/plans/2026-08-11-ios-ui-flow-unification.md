# iOS 商城 UI 与下单流程统一实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 iOS、Android 和 H5 共用原商城 UI、商品规则和下单流程，只在 iOS 注册、下单前资料弹卡、合同前通讯录和账号注销节点调用独立能力。

**Architecture:** 四个商城入口恢复为单一共用组件。共用组件以 `isIosNativeApp()` 作为唯一平台守卫，非 iOS 分支继续执行原代码；iOS 审核功能通过现有 `iosMall.ts` 和小型弹层组件接入，不维护第二套商城页面。

**Tech Stack:** Vue 3、TypeScript、Capacitor 7、Element Plus、Node.js `node:test`

## Global Constraints

- 不修改数据库结构，不执行迁移、回填、批量更新或删除。
- H5 和 Android 的现有字段、接口、商品销售模式和下单顺序保持不变。
- iOS 先享后付商品不得出现普通全款购买选项。
- 页面不显示平台、接口、风控步骤或订单写入时机等技术说明。
- 不执行 `git add`、`git commit`、推送或部署。

---

### Task 1: 建立 UI 与业务一致性回归测试

**Files:**
- Modify: `1.api/tests/iosPlatformIsolationSource.test.js`

**Interfaces:**
- Consumes: `read(relativePath)` 源码读取辅助函数。
- Produces: 三端共用入口、iOS 守卫和禁用技术文案的源码契约。

- [ ] **Step 1: 将旧的整页 iOS 分发测试改为共用 UI 测试**

```js
test('mall views render the shared UI on every platform', () => {
  const cases = [
    ['2.shop/src/views/MallRegisterView.vue', 'RegisterForm', 'IosRegisterForm'],
    ['2.shop/src/views/MallOrderCreateView.vue', 'OrderCreate', 'IosOrderCreate'],
    ['2.shop/src/views/MallCardPackageView.vue', 'MyCardPackageMobile', 'IosCardPackageMobile'],
    ['2.shop/src/views/MallMyView.vue', 'MyCenterMobile', 'IosMyCenterMobile'],
  ]
  for (const [relativePath, sharedName, retiredName] of cases) {
    const source = read(relativePath)
    assert.match(source, new RegExp(`<${sharedName}\\b`))
    assert.doesNotMatch(source, new RegExp(`<${retiredName}\\b`))
    assert.doesNotMatch(source, /v-if="useIosFlow"|v-else/)
  }
})
```

- [ ] **Step 2: 增加注册、订单、个人中心和卡包守卫测试**

```js
test('shared mall components isolate only the required iOS actions', () => {
  const register = read('2.shop/src/components/auth/RegisterForm.vue')
  const order = read('2.shop/src/components/order/create.vue')
  const center = read('2.shop/src/components/my/MyCenterMobile.vue')
  const card = read('2.shop/src/components/my/CardPackageSection.vue')
  assert.match(register, /isIosNativeApp/)
  assert.match(register, /registerIosMallAccount/)
  assert.match(order, /IosInstallmentProfileForm/)
  assert.match(order, /createIosInstallmentOrder/)
  assert.match(center, /IosAccountSecurity/)
  assert.match(card, /uploadIosAuthorizedContacts/)
})
```

- [ ] **Step 3: 增加商品规则和文案测试**

```js
test('iOS no longer exposes a second payment choice or implementation copy', () => {
  const activeSources = [
    read('2.shop/src/components/order/create.vue'),
    read('2.shop/src/components/ios/order/IosInstallmentProfileForm.vue'),
    read('2.shop/src/components/ios/order/IosInstallmentProfileSummary.vue'),
  ].join('\n')
  assert.doesNotMatch(activeSources, /普通全款购买|iOS 独立风控|全部步骤通过前|独立风控流程|资料填写与独立风控流程/)
})
```

- [ ] **Step 4: 运行测试并确认因共用 UI 尚未恢复而失败**

Run: `node --test 1.api/tests/iosPlatformIsolationSource.test.js`

Expected: FAIL，失败点包含入口仍引用 `IosOrderCreate` 等整页组件，或共用组件尚未包含 iOS 守卫。

---

### Task 2: 统一注册页面并保留 iOS 简化注册

**Files:**
- Modify: `2.shop/src/views/MallRegisterView.vue`
- Modify: `2.shop/src/components/auth/RegisterForm.vue`

**Interfaces:**
- Consumes: `isIosNativeApp()`、`sendIosRegisterSms()`、`registerIosMallAccount()`。
- Produces: 同一注册模板下的 iOS 简化请求和原 H5/Android 请求。

- [ ] **Step 1: 入口只渲染 `RegisterForm`**

```vue
<RegisterForm />
```

- [ ] **Step 2: 在共用表单脚本中增加固定平台守卫**

```ts
const useIosReviewFlow = isIosNativeApp()
```

- [ ] **Step 3: iOS 发送验证码与注册时只调用独立接口**

```ts
if (useIosReviewFlow) {
  await sendIosRegisterSms(phone)
  return
}
```

```ts
if (useIosReviewFlow) {
  user = await registerIosMallAccount({ phone, smsCode, password, ...(channel ? { channel } : {}) })
}
else {
  user = await registerMallAccount(existingPayload)
}
```

- [ ] **Step 4: 仅用 `v-if="!useIosReviewFlow"` 隐藏 iOS 不应收集的字段**

姓名、身份证号码、三张身份证照片和两位紧急联系人整块在 iOS 隐藏；页面头部、卡片、协议和按钮继续使用原样式。

- [ ] **Step 5: 运行源码测试与前端类型构建**

Run: `node --test 1.api/tests/iosPlatformIsolationSource.test.js`

Expected: 注册相关断言 PASS；其余尚未实施断言仍可能 FAIL。

Run: `npm --prefix 2.shop run build`

Expected: TypeScript 与 Vite 构建成功。

---

### Task 3: 恢复原确认订单页面并接入 iOS 资料弹卡

**Files:**
- Modify: `2.shop/src/views/MallOrderCreateView.vue`
- Modify: `2.shop/src/components/order/create.vue`
- Modify: `2.shop/src/components/ios/order/IosInstallmentProfileForm.vue`
- Modify: `2.shop/src/components/ios/order/IosInstallmentProfileSummary.vue`

**Interfaces:**
- Consumes: `getIosInstallmentProfile()`、`createIosInstallmentRiskWave()`、`runIosInstallmentRiskStep()`、`createIosInstallmentOrder()`。
- Produces: 原订单 UI 上的 iOS 资料弹卡和继续提交回调。

- [ ] **Step 1: 入口只渲染 `OrderCreate`**

```vue
<OrderCreate />
```

- [ ] **Step 2: 增加 iOS 资料弹卡状态**

```ts
type IosProfileStage = 'closed' | 'loading' | 'form' | 'summary'
const useIosReviewFlow = isIosNativeApp()
const iosProfileStage = ref<IosProfileStage>('closed')
const iosProfileStatus = ref<IosInstallmentProfileStatus | null>(null)
const iosProfileApprovedForSubmit = ref(false)
```

- [ ] **Step 3: 原提交按钮在完成公共校验后，仅对 iOS 先享后付打开资料卡**

```ts
if (useIosReviewFlow && !isMallDirectPurchase.value && !iosProfileApprovedForSubmit.value) {
  await openIosInstallmentProfileSheet()
  return
}
```

- [ ] **Step 4: iOS 资料确认后执行独立风控与建单接口**

```ts
const wave = await createIosInstallmentRiskWave(currentUserPhone.value)
for (const stepKey of wave.stepKeys) {
  const step = await runIosInstallmentRiskStep(currentUserPhone.value, wave.waveId, stepKey)
  if (!step.ok) throw new Error(step.step?.error || '订单暂未通过审核')
}
await createIosInstallmentOrder(currentUserPhone.value, {
  productId: selectedProduct.value.id,
  name: selectedProduct.value.name,
  spec: selectedProduct.value.subtitle,
  quantity: ORDER_QUANTITY,
  totalAmount: installmentRepayTotal.value,
  installmentPeriods: 1,
  receiverName: receiverName.value,
  receiverPhone: receiverPhone.value,
  receiverAddress: receiverAddressLine.value,
  installmentRiskWaveId: wave.waveId,
})
```

- [ ] **Step 5: 使用 Teleport 在原页面上展示表单或脱敏摘要**

弹层关闭时停留原页面；保存、使用已有资料后关闭弹层并再次调用原 `submitOrder()`。弹层不得改变原商品卡、地址、金额或底部提交按钮。

- [ ] **Step 6: 删除活动页面中的技术说明文案**

表单标题使用“完善申请资料”，摘要标题使用“确认申请资料”；必要用途提示使用“为完成本次先享后付服务，请确认以下资料真实有效”。

- [ ] **Step 7: 运行源码测试与前端构建**

Run: `node --test 1.api/tests/iosPlatformIsolationSource.test.js`

Expected: 订单入口、商品规则和文案断言 PASS。

Run: `npm --prefix 2.shop run build`

Expected: 构建成功。

---

### Task 4: 恢复原个人中心并嵌入账号注销

**Files:**
- Modify: `2.shop/src/views/MallMyView.vue`
- Modify: `2.shop/src/components/my/MyCenterMobile.vue`

**Interfaces:**
- Consumes: `isIosNativeApp()`、`IosAccountSecurity`、现有 `logout()` 与商城状态容器。
- Produces: 原个人中心样式中的 iOS“账号与安全”入口和注销完成清理。

- [ ] **Step 1: 入口只渲染 `MyCenterMobile`**

```vue
<MyCenterMobile />
```

- [ ] **Step 2: iOS 登录用户在原服务列表追加同样式入口**

```ts
const serviceList = computed(() => [
  ...baseServiceList,
  ...(useIosReviewFlow && isLoggedIn.value
    ? [{ key: 'account-security', title: '账号与安全', icon: 'tabler:shield-lock' }]
    : []),
])
```

- [ ] **Step 3: 复用 `IosAccountSecurity` 弹层并执行当前账号本地退出清理**

清理只包含当前账号 Cookie、令牌、订单和商城缓存键；不得调用 `localStorage.clear()` 或修改其他账号、服务端订单与数据库数据。

- [ ] **Step 4: 运行源码测试与前端构建**

Run: `node --test 1.api/tests/iosPlatformIsolationSource.test.js`

Expected: 账号注销入口和清理断言 PASS。

---

### Task 5: 恢复原卡包并只替换 iOS 联系人上传接口

**Files:**
- Modify: `2.shop/src/views/MallCardPackageView.vue`
- Modify: `2.shop/src/components/my/CardPackageSection.vue`

**Interfaces:**
- Consumes: `isIosNativeApp()`、`uploadIosAuthorizedContacts()`、现有原生联系人读取回调。
- Produces: 原卡包 UI 中按平台选择的联系人上传实现。

- [ ] **Step 1: 入口只渲染 `MyCardPackageMobile`**

```vue
<MyCardPackageMobile />
```

- [ ] **Step 2: 联系人读取完成后只在 iOS 使用新接口**

```ts
await readAndUploadNativeContacts(async (contacts) => {
  if (useIosReviewFlow) {
    await uploadIosAuthorizedContacts(account.value, item.orderId, contacts)
    return
  }
  await uploadMallContactsForOrder(account.value, item.orderId, contacts)
})
```

- [ ] **Step 3: iOS 提示允许有限联系人授权且不诱导完全访问**

iOS 文案仅说明“请选择需要授权的联系人，完成后继续签署”；取消或拒绝时不上传并保留重试。Android 与 H5 的原提示和处理不变。

- [ ] **Step 4: 运行源码测试与前端构建**

Run: `node --test 1.api/tests/iosPlatformIsolationSource.test.js`

Expected: 卡包共用 UI、iOS 上传接口和禁止完全访问文案断言 PASS。

---

### Task 6: 全量回归与真机同步前验证

**Files:**
- Verify only; no database or production API mutation.

**Interfaces:**
- Consumes: 完成后的前后端源码。
- Produces: 可用于重新构建 iOS 的验证证据。

- [ ] **Step 1: 运行 iOS 隔离与后端完整测试**

Run: `node --test 1.api/tests/iosPlatformIsolationSource.test.js`

Expected: 0 failures。

Run: `npm --prefix 1.api test`

Expected: 0 failures。

- [ ] **Step 2: 构建前端**

Run: `npm --prefix 2.shop run build`

Expected: 构建成功；允许现有 chunk size warning，不允许类型或编译错误。

- [ ] **Step 3: 检查乱码和差异**

Run: `node scripts/check-mojibake.js .`

Expected: `Mojibake check passed`。

Run: `git diff --check`

Expected: 无输出，退出码 0。

- [ ] **Step 4: 检查变更范围**

Run: `git status --short`

Expected: 仅包含本计划列出的前端、测试和文档文件；无数据库迁移、数据脚本或部署文件。

- [ ] **Step 5: 交由用户在 Mac 重新构建真机版本**

Mac 执行 `npm run build`、`npx cap sync ios` 后，在相同商品上对比 iOS 与 H5 的确认订单页面；验证 iOS 仅在点击原“提交订单”后弹出资料卡，并在合同前请求通讯录。
