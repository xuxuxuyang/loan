# iOS 上传回显、提示与商品详情滚动修复设计

## 目标

只修复 iOS 原生 App 的三个体验问题：身份证图片上传成功后没有缩略图回显、资料弹卡中的操作提示被遮挡、进入商品详情后无法纵向滚动。H5、Android、后端接口、数据库字段和业务数据保持不变。

## 根因

- `IosInstallmentProfileForm.vue` 只把服务端图片 URL 写入表单并显示“已上传”文字，模板没有渲染图片。
- 通用 `ElMessage` 使用默认层级，低于 iOS 资料弹卡的 `z-index: 7000`，所以提示显示在遮罩下面。
- `create.vue` 在资料弹卡打开时把 `document.body.style.overflow` 设为 `hidden`，组件离开时没有强制释放该滚动锁。
- 商品详情依赖文档根节点滚动；在 Capacitor iOS WebView 中，固定高度的 `#app` 与残留的 `body` 滚动锁会使页面失去可滚动容器。

## 设计

### 图片回显

压缩图片上传成功后，为压缩文件创建本地 Object URL，并写入按 `front`、`back`、`handheld` 区分的预览状态。上传框渲染本地缩略图，底部显示“点击重新选择”。重新上传和组件销毁时调用 `URL.revokeObjectURL`，避免本地图片内存泄漏。提交给后端的字段仍使用服务端返回的 OSS URL。

### 顶层提示

资料组件新增 iOS 专用提示函数，直接调用 Element Plus `ElMessage` 的对象参数，并固定使用 `zIndex: 9000`、`appendTo: document.body` 和专用 `customClass`。成功、失败与表单校验全部走该提示；不修改通用 `epFeedback.ts`，因此不会改变 H5 和 Android 的提示行为。

### 商品详情滚动

`MallProductDetailView.vue` 使用 `isIosNativeApp()` 判断平台。仅 iOS 原生 App 将详情根节点设为 `height: 100dvh; overflow-y: auto; -webkit-overflow-scrolling: touch`，H5 和 Android 继续使用当前文档滚动结构。

`create.vue` 在 iOS 组件销毁时恢复进入该页面前的 `body.style.overflow`，防止资料弹卡的滚动锁污染后续商品详情页面。现有 H5、Android 的弹层监听和业务流程不变。

## 验收

- 三个身份证上传框在上传成功后显示对应图片，并可重新选择。
- 上传成功、上传失败和资料校验提示显示在资料弹卡遮罩上方。
- iOS App 全新进入商品详情可以纵向滚动。
- iOS 打开资料弹卡后退出，再进入商品详情仍可以纵向滚动。
- H5 和 Android 不新增 iOS 提示、预览状态或独立滚动类。
- 不修改 `1.api/src`，不运行数据库迁移或生产接口。
