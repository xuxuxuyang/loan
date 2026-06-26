# Admin Mall Contacts Viewer Design

## Goal
在 admin 后台用户注册信息弹窗中增加“通讯录名单”只读展示，且只有管理员点击后才读取通讯录明细，避免拖慢现有用户列表、用户详情和线上业务流程。

## Scope
- 仅展示 Android App 已上传的通讯录数据。
- 仅展示该用户最新一次已完成上传的通讯录快照。
- 不写入、迁移、删除、重置任何用户、订单或通讯录数据。
- 不改用户注册、下单、审核、签约、通讯录上传流程。
- 不加入用户列表接口和导出接口。

## Architecture
新增一个 admin 只读接口 `GET /api/users/:id/mall-contacts`，由后台用户详情弹窗点击按钮后调用。接口按用户 ID 找到用户手机号，再查 `mallContactUploads` 最新 completed 上传记录，最后按 `uploadId` 分页读取 `mallContactUploadBatches` 中的联系人明细。

前端在 `UserRegistrationInfoScroll.vue` 内增加独立区块“通讯录名单”。默认只显示说明和“查看通讯录名单”按钮；点击后请求第一页，表格分页展示联系人姓名和手机号。关闭弹窗或切换用户时，组件状态随销毁/用户变化清空。

## Backend Contract
Endpoint: `GET /api/users/:id/mall-contacts`

Query:
- `page`: 默认 1，最小 1。
- `pageSize`: 默认 20，最大 50。

Response data:
```json
{
  "upload": {
    "uploadId": "MCU...",
    "orderId": "OD...",
    "uploadedAt": "2026-06-26T09:12:40.821Z",
    "contactsCount": 123
  },
  "list": [
    { "contactId": "1", "displayName": "张三", "phones": ["13800138000"] }
  ],
  "total": 123,
  "page": 1,
  "pageSize": 20
}
```

If no completed upload exists, return `upload: null`, `list: []`, `total: 0`.

## Performance And Safety
- 不在 `/api/users` 中附带通讯录，避免列表加载压力。
- 后端只读，不调用 `writeDb*`、不触发 flush。
- Mongo 模式下只查最新 upload 和该 upload 的 batch，分页展开后只返回当前页。
- JSON fallback 也只在点击接口时读取，保持本地/降级可用。
- `pageSize` 强制限制到 50，防止一次读取过多。

## Permissions
复用后台用户查看权限：允许拥有任一用户页 `view` 权限的后台账号查看该用户通讯录，即沿用 `requireAdminUsersActionOnAny(ctx, 'view', '查看用户通讯录')`。

## UI
在“基本信息”后新增“通讯录名单”区块：
- 未加载：说明“点击后读取，避免后台自动加载大数据”，按钮“查看通讯录名单”。
- 加载中：显示 loading。
- 无数据：显示“暂无通讯录上传记录”。
- 有数据：显示上传时间、总条数、关联订单号，以及分页表格。
- 错误：显示错误文案和重试按钮。

## Verification
- 后端新增单元/集成测试覆盖：未点击不影响 `/users`、接口权限、无数据、分页、只读。
- 前端至少通过 TypeScript 构建验证。
- 运行 mojibake 检查，确保新增中文不乱码。
