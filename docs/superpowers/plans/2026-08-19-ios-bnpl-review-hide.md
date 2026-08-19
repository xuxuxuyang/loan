# iOS 先享后付审核隐藏实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 只在 Capacitor 原生 iOS App 中隐藏先享后付入口、商品、流程和历史数据展示，同时完整保留 H5、Android、后端和线上数据。

**Architecture:** 新增单一的 iOS 审核隐藏判断，所有展示点和路由都只消费这一判断。iOS 在渲染前过滤先享后付数据并拦截深链；现有组件、路由和业务实现不删除，H5 与 Android 继续走原分支。

**Tech Stack:** Vue 3、TypeScript、Vue Router 5、Capacitor 7、Node.js `node:test`、Vite 8

## Global Constraints

- 只修改 `2.shop` 的 iOS 客户端呈现，不修改 `1.api`、`3.admin`、`4.admin-liuliang`、数据库或线上数据。
- 不删除先享后付组件、路由、接口调用或历史数据处理代码；使用 iOS 条件和中文注释保留原实现。
- H5 和 Android 的先享后付入口、商品、下单和历史数据展示必须保持现状。
- 平台判断必须同时满足 `Capacitor.isNativePlatform()` 和 `Capacitor.getPlatform() === 'ios'`。
- 最终必须在项目根目录运行 `node scripts/check-mojibake.js .` 并通过。

---

## File Structure

- Create: `2.shop/src/utils/iosBnplReviewVisibility.ts` — 唯一的 iOS 审核隐藏平台判断。
- Create: `2.shop/tests/iosBnplReviewVisibility.test.mjs` — 源码契约测试，覆盖平台隔离、路由、商品发现、下单和历史数据隐藏。
- Modify: `2.shop/src/router/index.ts` — 保留原路由并为 iOS 添加受限深链守卫。
- Modify: `2.shop/src/App.vue` — iOS 不挂载先享后付流量弹窗。
- Modify: `2.shop/src/views/MallHomeView.vue` — iOS 默认且固定为普通商城专区。
- Modify: `2.shop/src/components/index/HomeBannerMobile.vue` — iOS 不渲染先享后付分区入口。
- Modify: `2.shop/src/views/MallListView.vue` — iOS 分类和商品数据排除先享后付。
- Modify: `2.shop/src/components/search/MallSearchMobile.vue` — iOS 搜索目录和文案排除先享后付。
- Modify: `2.shop/src/views/MallProductDetailView.vue` — iOS 拦截先享后付商品深链。
- Modify: `2.shop/src/components/order/create.vue` — iOS 拦截缓存或深链进入的先享后付下单。
- Modify: `2.shop/src/components/my/MyCenterMobile.vue` — iOS 隐藏账单、卡包和推荐区。
- Modify: `2.shop/src/components/my/order/MyOrderMobile.vue` — iOS 过滤历史先享后付订单。
- Modify: `2.shop/src/components/my/user-agreement/UserAgreementContent.vue` — iOS 隐藏金融服务条款并保留普通商品条款。
- Modify: `2.shop/src/components/my/privacy-policy/PrivacyPolicyContent.vue` — iOS 使用普通交易信息文案，原文保留给 H5/Android。

---

### Task 1: 统一平台判断与 iOS 深链守卫

**Files:**
- Create: `2.shop/tests/iosBnplReviewVisibility.test.mjs`
- Create: `2.shop/src/utils/iosBnplReviewVisibility.ts`
- Modify: `2.shop/src/router/index.ts`
- Modify: `2.shop/src/App.vue`

**Interfaces:**
- Produces: `isIosBnplReviewHidden(): boolean`，供后续所有页面消费。
- Produces: `IOS_BNPL_RESTRICTED_ROUTE_NAMES` 路由内常量，只用于路由守卫。
- Consumes: `isIosNativeApp(): boolean` from `2.shop/src/utils/iosNativePlatform.ts`。

- [ ] **Step 1: 写平台隔离和路由守卫的失败测试**

创建 `2.shop/tests/iosBnplReviewVisibility.test.mjs`，先加入以下测试：

```js
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = relativePath => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8')

test('limits the review hide switch to the native iOS runtime', () => {
  const source = read('../src/utils/iosBnplReviewVisibility.ts')
  assert.match(source, /isIosNativeApp\(\)/)
  assert.match(source, /export function isIosBnplReviewHidden\(\): boolean/)
  assert.doesNotMatch(source, /userAgent|VITE_|import\.meta\.env/)
})

test('keeps routes declared but redirects finance routes only behind the iOS switch', () => {
  const source = read('../src/router/index.ts')
  for (const name of ['installment', 'bill', 'bill-risk-result', 'card-package', 'traffic-login']) {
    assert.match(source, new RegExp(`name: '${name}'`))
    assert.match(source, new RegExp(`'${name}'`))
  }
  assert.match(source, /isIosBnplReviewHidden\(\)/)
  assert.match(source, /router\.beforeEach/)
  assert.match(source, /return \{ path: '\/', replace: true \}/)
})

test('does not mount the finance lead dialog in the iOS review path', () => {
  const source = read('../src/App.vue')
  assert.match(source, /isIosBnplReviewHidden/)
  assert.match(source, /<TrafficCreditLeadDialog v-if="!hideIosBnplForReview"/)
})
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node --test tests/iosBnplReviewVisibility.test.mjs`（工作目录 `2.shop`）

Expected: FAIL，首个失败为找不到 `src/utils/iosBnplReviewVisibility.ts`，证明审核隐藏能力尚不存在。

- [ ] **Step 3: 实现唯一的平台判断**

创建 `2.shop/src/utils/iosBnplReviewVisibility.ts`：

```ts
import { isIosNativeApp } from '~/utils/iosNativePlatform'

/** App Store 审核期仅隐藏原生 iOS 的先享后付能力；H5 与 Android 保持原状。 */
export function isIosBnplReviewHidden(): boolean {
  return isIosNativeApp()
}
```

- [ ] **Step 4: 保留路由并添加 iOS 专属守卫**

在 `2.shop/src/router/index.ts` 导入 `isIosBnplReviewHidden`，并在 `afterEach` 之前加入：

```ts
const IOS_BNPL_RESTRICTED_ROUTE_NAMES = new Set([
  'installment',
  'bill',
  'bill-risk-result',
  'card-package',
  'traffic-login',
])

router.beforeEach((to) => {
  // App Store 审核期仅阻止原生 iOS 进入先享后付关联页，原路由保留给 H5/Android。
  if (isIosBnplReviewHidden() && IOS_BNPL_RESTRICTED_ROUTE_NAMES.has(String(to.name || ''))) {
    return { path: '/', replace: true }
  }
})
```

现有五条路由声明不得删除或注释掉。

同时调整现有 `afterEach` 预加载：iOS 首页只调用 `ensureMallShowcaseProductsLoaded()`；原 `/installment` 和非 iOS 首页继续调用 `ensureMallProductsLoaded()`，避免 iOS 首页后台请求先享后付商品。

- [ ] **Step 5: iOS 不挂载流量金融弹窗**

在 `2.shop/src/App.vue` 中保留 `TrafficCreditLeadDialog` 导入，并添加：

```ts
import { isIosBnplReviewHidden } from '~/utils/iosBnplReviewVisibility'

const hideIosBnplForReview = isIosBnplReviewHidden()
```

模板改为：

```vue
<TrafficCreditLeadDialog v-if="!hideIosBnplForReview" />
```

- [ ] **Step 6: 运行测试并确认通过**

Run: `node --test tests/iosBnplReviewVisibility.test.mjs`（工作目录 `2.shop`）

Expected: 3 tests PASS。

- [ ] **Step 7: 提交平台隔离和路由守卫**

```bash
git add 2.shop/tests/iosBnplReviewVisibility.test.mjs 2.shop/src/utils/iosBnplReviewVisibility.ts 2.shop/src/router/index.ts 2.shop/src/App.vue
git commit -m "feat: 隐藏iOS先享后付路由入口"
```

---

### Task 2: 隐藏 iOS 商品发现、详情和下单路径

**Files:**
- Modify: `2.shop/tests/iosBnplReviewVisibility.test.mjs`
- Modify: `2.shop/src/views/MallHomeView.vue`
- Modify: `2.shop/src/components/index/HomeBannerMobile.vue`
- Modify: `2.shop/src/views/MallListView.vue`
- Modify: `2.shop/src/components/search/MallSearchMobile.vue`
- Modify: `2.shop/src/views/MallProductDetailView.vue`
- Modify: `2.shop/src/components/order/create.vue`

**Interfaces:**
- Consumes: `isIosBnplReviewHidden(): boolean`。
- Preserves: `TeaProduct.salesMode === 'installment'` 的现有 H5/Android 展示和下单分支。

- [ ] **Step 1: 写商品发现和下单隐藏的失败测试**

向 `2.shop/tests/iosBnplReviewVisibility.test.mjs` 追加：

```js
test('pins the iOS home and list to regular mall products', () => {
  const home = read('../src/views/MallHomeView.vue')
  const banner = read('../src/components/index/HomeBannerMobile.vue')
  const list = read('../src/views/MallListView.vue')
  assert.match(home, /hideIosBnplForReview/)
  assert.match(home, /hide-installment-zone="hideIosBnplForReview"/)
  assert.match(banner, /hideInstallmentZone/)
  assert.match(banner, /v-if="!hideInstallmentZone"/)
  assert.match(list, /hideIosBnplForReview/)
  assert.match(list, /item\.key !== 'installment'/)
})

test('removes installment products from iOS search before rendering', () => {
  const source = read('../src/components/search/MallSearchMobile.vue')
  assert.match(source, /hideIosBnplForReview/)
  assert.match(source, /if \(!hideIosBnplForReview\)/)
  assert.match(source, /仅搜索商城专区的全部商品/)
})

test('blocks cached or deep-linked installment products before iOS checkout', () => {
  const detail = read('../src/views/MallProductDetailView.vue')
  const checkout = read('../src/components/order/create.vue')
  assert.match(detail, /hideIosBnplForReview/)
  assert.match(detail, /salesMode === 'installment'/)
  assert.match(detail, /smartNavigate\('\/'\)/)
  assert.match(checkout, /hideIosBnplForReview/)
  assert.match(checkout, /selectedProduct\.value\?\.salesMode === 'installment'/)
  assert.match(checkout, /先享后付商品在当前 iOS 版本暂不可用/)
})
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node --test tests/iosBnplReviewVisibility.test.mjs`（工作目录 `2.shop`）

Expected: 新增 3 tests FAIL，因为页面尚未消费审核隐藏判断。

- [ ] **Step 3: 修改首页和 Banner**

在 `MallHomeView.vue` 中加入 `hideIosBnplForReview`，把 `activeHomeZone` 初始值设置为：

```ts
const hideIosBnplForReview = isIosBnplReviewHidden()
const activeHomeZone = ref<'installment' | 'mall'>(hideIosBnplForReview ? 'mall' : 'installment')
```

把首页的先享后付状态改为 `useTeaProducts({ immediate: !hideIosBnplForReview })`，仅当 `!hideIosBnplForReview` 时接受 `category=installment`，并向 Banner 传入：

```vue
:hide-installment-zone="hideIosBnplForReview"
```

在 `HomeBannerMobile.vue` 的 props 增加 `hideInstallmentZone: boolean`，并给原“先享后付” `<article>` 添加：

```vue
<!-- App Store 审核期仅在原生 iOS 隐藏；原入口继续服务 H5/Android。 -->
<article v-if="!hideInstallmentZone">
```

- [ ] **Step 4: 修改列表和搜索数据源**

在 `MallListView.vue` 中：

```ts
const hideIosBnplForReview = isIosBnplReviewHidden()
const categories = useMallCategories().filter(item => !hideIosBnplForReview || item.key !== 'installment')
const selectedCategory = ref<MallCategoryKey>(hideIosBnplForReview ? 'phones' : 'installment')
```

iOS 忽略 URL 中的 `installment` 分类；`all` 分类在 iOS 只返回 `mallProducts`，不拼接 `installmentProducts`。

在 `MallSearchMobile.vue` 中，仅当 `!hideIosBnplForReview` 时把 `installmentProducts` 写入 `catalog`；空搜索说明使用：

```vue
{{ hideIosBnplForReview ? '仅搜索商城专区的全部商品，找到心仪好物。' : '将搜索先享后付与商城专区的全部商品，找到心仪好物。' }}
```

原先享后付标签分支保留，不在 iOS 数据源中触发。

- [ ] **Step 5: 拦截商品详情和下单深链**

在 `MallProductDetailView.vue` 的单品解析完成后，如果 iOS 审核隐藏开启且商品 `salesMode === 'installment'`，清空 `product` 并执行 `smartNavigate('/')`；在 `goBuy()` 开头加入同样判断作为第二道保护。

在 `components/order/create.vue` 中新增：

```ts
const hideIosBnplForReview = isIosBnplReviewHidden()
const isIosHiddenInstallmentProduct = computed(() =>
  hideIosBnplForReview && selectedProduct.value?.salesMode === 'installment',
)
```

在提交函数读取地址和触发任何 iOS 资料/风控逻辑之前加入：

```ts
if (isIosHiddenInstallmentProduct.value) {
  notifyWarning('先享后付商品在当前 iOS 版本暂不可用')
  await smartNavigate('/')
  return
}
```

并在监听到深链商品解析为先享后付后立即导航首页。原 iOS 资料、风控和建单分支不得删除。

- [ ] **Step 6: 运行新增测试和现有商品测试**

Run: `node --test tests/iosBnplReviewVisibility.test.mjs tests/orderEligibility.test.mjs tests/iosRouteCompatibility.test.mjs`（工作目录 `2.shop`）

Expected: 全部 PASS。

- [ ] **Step 7: 提交商品发现和下单隐藏**

```bash
git add 2.shop/tests/iosBnplReviewVisibility.test.mjs 2.shop/src/views/MallHomeView.vue 2.shop/src/components/index/HomeBannerMobile.vue 2.shop/src/views/MallListView.vue 2.shop/src/components/search/MallSearchMobile.vue 2.shop/src/views/MallProductDetailView.vue 2.shop/src/components/order/create.vue
git commit -m "feat: 隐藏iOS先享后付商品流程"
```

---

### Task 3: 隐藏 iOS 历史数据入口和金融文案

**Files:**
- Modify: `2.shop/tests/iosBnplReviewVisibility.test.mjs`
- Modify: `2.shop/src/components/my/MyCenterMobile.vue`
- Modify: `2.shop/src/components/my/order/MyOrderMobile.vue`
- Modify: `2.shop/src/components/my/user-agreement/UserAgreementContent.vue`
- Modify: `2.shop/src/components/my/privacy-policy/PrivacyPolicyContent.vue`

**Interfaces:**
- Consumes: `isIosBnplReviewHidden(): boolean`。
- Preserves: 原始 `orders`、`bills`、`cardPackages` 响应和存储，不产生任何写操作。

- [ ] **Step 1: 写历史数据和文案隐藏的失败测试**

向 `2.shop/tests/iosBnplReviewVisibility.test.mjs` 追加：

```js
test('hides finance shortcuts and recommendations only in the iOS review path', () => {
  const source = read('../src/components/my/MyCenterMobile.vue')
  assert.match(source, /hideIosBnplForReview/)
  assert.match(source, /v-if="!hideIosBnplForReview"[\s\S]*@click="handleBill"/)
  assert.match(source, /v-if="!hideIosBnplForReview"[\s\S]*@click="handleCardPackage"/)
  assert.match(source, /v-if="!hideIosBnplForReview"[\s\S]*先享后付/)
})

test('filters historical installment orders from iOS without mutating order data', () => {
  const source = read('../src/components/my/order/MyOrderMobile.vue')
  assert.match(source, /hideIosBnplForReview/)
  assert.match(source, /!hideIosBnplForReview \|\| item\.payType !== 'installment'/)
  assert.doesNotMatch(source, /splice\(|orders\.value\s*=/)
})

test('keeps original finance policy text for H5 and Android behind the iOS condition', () => {
  const agreement = read('../src/components/my/user-agreement/UserAgreementContent.vue')
  const privacy = read('../src/components/my/privacy-policy/PrivacyPolicyContent.vue')
  assert.match(agreement, /v-if="!hideIosBnplForReview"/)
  assert.match(agreement, /商品、订单与先享后付/)
  assert.match(privacy, /v-if="hideIosBnplForReview"/)
  assert.match(privacy, /v-else/)
  assert.match(privacy, /支付与先享后付相关信息/)
})
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node --test tests/iosBnplReviewVisibility.test.mjs`（工作目录 `2.shop`）

Expected: 新增 3 tests FAIL，因为历史数据和协议仍显示原内容。

- [ ] **Step 3: 隐藏“我的”入口和推荐**

在 `MyCenterMobile.vue` 中加入：

```ts
const hideIosBnplForReview = isIosBnplReviewHidden()
```

把推荐商品状态改为 `useTeaProducts({ immediate: !hideIosBnplForReview })`。仅在 `!hideIosBnplForReview` 时调用 `ensureMallProductsLoaded()` 和 `fetchCardPackages()`，避免 iOS 在隐藏页面后台加载先享后付商品与卡包；`fetchSummary()` 继续服务普通地址、银行卡和订单统计。

给原账单按钮、卡包按钮和完整推荐区分别添加 `v-if="!hideIosBnplForReview"`。保留 `handleBill`、`handleCardPackage`、`sortedRecommendProducts` 以及原模板内容，并在三个区域前添加审核隐藏注释。

- [ ] **Step 4: 过滤 iOS 历史先享后付订单**

在 `MyOrderMobile.vue` 中加入 `hideIosBnplForReview`，将商品状态改为 `useTeaProducts({ immediate: !hideIosBnplForReview })`，并将 `userOrders` 的过滤条件改为：

```ts
return orders.value.filter(item =>
  mallOrderBelongsToLoggedIn(item, profile.value?.id)
  && (!hideIosBnplForReview || item.payType !== 'installment'),
)
```

不得修改 `orders.value`，不得调用删除或更新接口。

- [ ] **Step 5: 为 iOS 隐藏金融协议文字**

在两个正文组件中加入 `hideIosBnplForReview`。

`UserAgreementContent.vue` 保留原第四节，并增加 `v-if="!hideIosBnplForReview"`；iOS 使用独立的普通“商品与订单”第四节，只说明商品信息、订单、支付、收货和售后，不出现分期、金融机构、还款或信用记录。

`PrivacyPolicyContent.vue` 的“订单与交易信息”列表项保留原文作为 `v-else`，iOS 的 `v-if` 文案为：

```vue
<li v-if="hideIosBnplForReview"><span class="font-medium text-black/80">订单与交易信息：</span>收货人姓名、联系电话、收货地址、订单内容与支付信息等，用于完成交易与售后服务。</li>
```

- [ ] **Step 6: 运行全部商城测试**

Run: `node --test tests/*.test.mjs`（工作目录 `2.shop`）

Expected: 全部 PASS，无失败、无未处理异常。

- [ ] **Step 7: 构建 iOS 共用前端资源**

Run: `npm run build`（工作目录 `2.shop`）

Expected: `vue-tsc -b && vite build` 退出码 0，生成构建产物且无 TypeScript/Vue 编译错误。

- [ ] **Step 8: 运行根目录乱码检查和差异检查**

Run: `node scripts/check-mojibake.js .`（工作目录为项目根目录）

Expected: 输出 `Mojibake check passed`。

Run: `git diff --check`（工作目录为项目根目录）

Expected: 退出码 0，无空白错误。

- [ ] **Step 9: 提交历史数据和文案隐藏**

```bash
git add 2.shop/tests/iosBnplReviewVisibility.test.mjs 2.shop/src/components/my/MyCenterMobile.vue 2.shop/src/components/my/order/MyOrderMobile.vue 2.shop/src/components/my/user-agreement/UserAgreementContent.vue 2.shop/src/components/my/privacy-policy/PrivacyPolicyContent.vue
git commit -m "feat: 隐藏iOS先享后付历史展示"
```

---

## Final Manual Verification

- [ ] 用 iOS Release/TestFlight 构建检查首页、列表、搜索、商品详情、下单、“我的”、订单、用户协议和隐私政策。
- [ ] 在 iOS 中直接打开 `/installment`、`/bill`、`/bill-risk-result`、`/card-package`、`/traffic-login`，确认回到首页。
- [ ] 使用存在历史先享后付订单的账号，确认 iOS 不显示订单、账单和卡包，也不触发相机、相册或通讯录权限。
- [ ] 使用 Android 构建检查原先享后付入口、商品、下单、订单、账单和卡包仍可用。
- [ ] 使用浏览器 H5 检查相同完整流程，确认即使 User-Agent 模拟 iPhone 也不触发隐藏。
