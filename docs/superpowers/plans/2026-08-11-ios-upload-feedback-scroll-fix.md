# iOS Upload Feedback And Product Scroll Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 iOS 身份证图片回显、资料弹卡提示遮挡和商品详情无法滚动，同时保持 H5、Android、后端和数据库不变。

**Architecture:** 图片预览与高层提示封装在 iOS 资料组件内；商品详情只通过 `isIosNativeApp()` 增加 iOS WebView 滚动容器；下单页只在 iOS 组件销毁时释放自己留下的 `body` 滚动锁。

**Tech Stack:** Vue 3、TypeScript、Element Plus、Capacitor、Node.js source contract tests、Vite

## Global Constraints

- 不修改 `1.api/src`、数据库结构或线上数据。
- 不改变 H5 和 Android 的页面、接口和业务流程。
- 不执行 `git add`、`git commit` 或 `git push`，Git 操作由用户完成。
- 修改后必须运行根目录 `node scripts/check-mojibake.js .`。

---

### Task 1: 添加失败的 iOS 展示与滚动隔离契约

**Files:**
- Modify: `1.api/tests/iosPlatformIsolationSource.test.js`

**Interfaces:**
- Consumes: 现有 `read()` 源码读取助手。
- Produces: 图片预览、9000 层提示、iOS 独立滚动容器与离页清锁的源码约束。

- [ ] **Step 1: 写失败测试**

新增断言：

```js
assert.match(profileForm, /URL\.createObjectURL/)
assert.match(profileForm, /URL\.revokeObjectURL/)
assert.match(profileForm, /:src="previewUrls\[scene\]"/)
assert.match(profileForm, /zIndex:\s*9000/)
assert.match(profileForm, /customClass:\s*'ios-profile-feedback'/)
assert.match(productDetail, /isIosNativeApp/)
assert.match(productDetail, /ios-product-detail-scroll/)
assert.match(order, /onBeforeUnmount/)
assert.match(order, /restoreIosBodyOverflow/)
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --test 1.api/tests/iosPlatformIsolationSource.test.js`

Expected: 新增断言因预览、顶层提示或滚动修复尚不存在而失败。

### Task 2: 实现 iOS 图片回显和顶层提示

**Files:**
- Modify: `2.shop/src/components/ios/order/IosInstallmentProfileForm.vue`

**Interfaces:**
- Consumes: `uploadIosIdCard(phone, file, scene)` 返回的服务端 URL。
- Produces: `previewUrls[scene]` 本地预览和同步的 `showIosProfileFeedback(type, message)` 顶层提示状态。

- [ ] **Step 1: 增加预览生命周期**

```ts
const previewUrls = reactive<Record<IosIdCardScene, string>>({ front: '', back: '', handheld: '' })

function replacePreview(scene: IosIdCardScene, nextUrl: string) {
  if (previewUrls[scene]) URL.revokeObjectURL(previewUrls[scene])
  previewUrls[scene] = nextUrl
}

onBeforeUnmount(() => {
  Object.values(previewUrls).filter(Boolean).forEach(url => URL.revokeObjectURL(url))
})
```

- [ ] **Step 2: 增加 iOS 专用提示**

```ts
const feedback = ref<{ type: 'success' | 'warning' | 'error', message: string } | null>(null)
let feedbackTimer: ReturnType<typeof setTimeout> | undefined

function showIosProfileFeedback(type: 'success' | 'warning' | 'error', message: string) {
  feedback.value = { type, message }
  if (feedbackTimer) clearTimeout(feedbackTimer)
  feedbackTimer = setTimeout(() => { feedback.value = null }, 3000)
}
```

模板使用 `<Teleport to="body">` 渲染 `z-[10000]` 的固定顶部提示，并设置 `role="status"` 与 `aria-live="assertive"`。不得动态导入 Element Plus Message。

- [ ] **Step 3: 上传成功后渲染缩略图**

上传完成后把本地 Object URL 写入 `previewUrls[scene]`，模板使用 `<img :src="previewUrls[scene]">` 铺满上传框，并增加底部“点击重新选择”遮罩。

- [ ] **Step 4: 解除提示对业务流程的阻断**

`onImageChange()`、`warn()` 和 `submit()` 同步调用 `showIosProfileFeedback()`，不得使用 `await showIosProfileFeedback(...)`。`saveIosInstallmentProfile()` 成功后立即执行 `emit('saved', status)`，提示展示失败不能阻止进入后续下单流程。

### Task 3: 修复 iOS 商品详情滚动与滚动锁泄漏

**Files:**
- Modify: `2.shop/src/views/MallProductDetailView.vue`
- Modify: `2.shop/src/components/order/create.vue`

**Interfaces:**
- Consumes: `isIosNativeApp(): boolean`。
- Produces: `ios-product-detail-scroll` iOS 独立滚动容器和 `restoreIosBodyOverflow()` 离页清理。

- [ ] **Step 1: 增加 iOS 商品详情滚动容器**

```vue
<div :class="isIosApp ? 'ios-product-detail-scroll' : 'min-h-screen'">
```

```css
.ios-product-detail-scroll {
  height: 100dvh;
  min-height: 100dvh;
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
```

- [ ] **Step 2: iOS 下单页离开时释放滚动锁**

保存进入页面前的 `body.style.overflow`。新增 `restoreIosBodyOverflow()`，并在 `onBeforeUnmount` 中仅当 `useIosReviewFlow` 为真时恢复原值。

- [ ] **Step 3: 运行目标测试确认 GREEN**

Run: `node --test 1.api/tests/iosPlatformIsolationSource.test.js`

Expected: 相关测试全部通过。

### Task 4: 完整验证

**Files:**
- Verify only; no production writes.

- [ ] **Step 1: 构建前端**

Run: `npm.cmd --prefix 2.shop run build`

Expected: exit code 0。

- [ ] **Step 2: 运行 API 全量测试**

Run: `npm.cmd --prefix 1.api test`

Expected: 0 failures。

- [ ] **Step 3: 运行静态检查**

```powershell
node scripts/check-mojibake.js .
git diff --check
git diff --name-only -- 1.api/src
git status --short
```

Expected: 乱码检查与 diff 检查通过，`git diff --name-only -- 1.api/src` 无输出，仅出现本计划列出的文件。

- [ ] **Step 4: 用户自行提交**

验证通过后停止，不执行任何 Git 提交或推送操作，由用户检查差异后自行提交。
