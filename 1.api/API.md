# API 说明（按接口分条）

服务前缀：`/api`，完整示例：`http://localhost:3110/api/...`。默认端口可用 `PORT` 调整；环境变量全量字典见 `api/.env.example`（含兼容别名）。

**后台鉴权（需权限的接口）：** 请求头常带 `x-admin-role: super_admin | reviewer | collector`，或使用 `Authorization: Bearer mock-token-手机号`（该手机号在 `adminAccounts` 中有记录时可解析角色）。细节见 `api/src/index.js` 中 `resolveAdminRole`。

**多子系统（最小实现）：** 后端优先读取 `x-tenant-id`（兼容 `x-tenant` / `x-org-id` / `x-client-id`）作为子系统；未传时尝试从 `Host` 子域首段推断，仍无值则回退 `default`。所有读写按子系统隔离。

**平台接口安全：** `/platform/*` 接口要求后台登录态且账号 `scopeType=platform`；仅前端隐藏菜单不足以绕过。平台访问会写入平台审计日志（存于 default 子系统 `_meta.platformAuditLogs`）。

---

## `GET /health`

- **用在哪：** 运维/探活（仓库内前端未接）。
- **传参：** 无。

---

## `GET /products`

- **用在哪：** `app/composables/useTeaProducts.ts`；`admin/src/views/ProductsPage.vue`。
- **传参（Query）：**
  - `category`：可选；`travel` / `calligraphy` / `mobile` / `jewelry`，或 `all`/不传表示不按分类筛。
  - `keyword`：可选；匹配名称、副标题、产地。
  - `includeAll`：可选；传 `1` 时包含未上架商品，默认只出上架。

---

## `GET /products/:id`

- **用在哪：** 当前仓库未直接调用，可供商品详情。
- **传参（Path）：**
  - `id`：商品数字 ID。

---

## `POST /products`

- **用在哪：** `admin/src/views/ProductsPage.vue`。
- **鉴权：** 超级管理员。
- **传参（Body，JSON）：**
  - `name`、`subtitle`、`description`、`origin`、`image`：文本，均必填。
  - `category`：必填；四分类之一。
  - `price`：必填；大于 0。
  - `onSale`：可选；布尔，默认 true。

---

## `PATCH /products/:id`

- **用在哪：** `admin/src/views/ProductsPage.vue`。
- **鉴权：** 超级管理员。
- **传参：**
  - Path `id`：商品 ID。
  - Body：同上字段任意子集（部分更新）。

---

## `DELETE /products/:id`

- **用在哪：** `admin/src/views/ProductsPage.vue`。
- **鉴权：** 超级管理员。
- **传参（Path）：**
  - `id`：商品 ID。

---

## `POST /auth/register`

- **用在哪：** `app/composables/useMallAuth.ts`（注册）。
- **传参（Body）：**
  - `phone`：必填；11 位手机号；`admin` 会映射为测试号。
  - `name`：必填。
  - `idCardFront`、`idCardBack`、`idCardHandheld`、`locationText`、`latitude`、`longitude`：注册资料。
  - `creditStatus`、`quota`：可选。
  - `password`：可选；填写则至少 6 位。

---

## `POST /auth/login`

- **用在哪：** `app/composables/useMallAuth.ts`（登录页）。
- **传参（Body）：**
  - `phone`：必填。
  - `loginType`：可选；默认 `sms`；`password` 为密码登录。
  - `verifyCode`：短信登录时必填。
  - `password`：密码登录时必填，至少 6 位。

---

## `GET /users/by-phone`

- **用在哪：** `app/composables/useMallAuth.ts`（同步用户资料）。
- **传参（Query）：**
  - `phone`：必填；合法 11 位。

---

## `GET /users`

- **用在哪：** `admin/src/views/UsersPage.vue`。
- **鉴权：** 超管 / 审核员 / 客服。
- **传参（Query）：**
  - `keyword`：可选；匹配用户 id / 姓名 / 手机。

---

## `POST /users`

- **用在哪：** `admin/src/views/UsersPage.vue`。
- **鉴权：** 超级管理员。
- **传参（Body）：**
  - `name`、`phone`：必填。
  - `locationText`、`creditStatus`：信誉等；`creditStatus` 为优秀/良好/一般/风险。
  - `initialPassword` 或 `password`：可选；≥6 位则为该用户设置商城登录密码。
  - `quota`、证件图 URL 等：可选。

---

## `PATCH /users/:id`

- **用在哪：** `admin/src/views/UsersPage.vue`。
- **鉴权：** 超级管理员。
- **传参：**
  - Path `id`：用户 id。
  - Body：`name`、`phone`、`locationText`、`creditStatus`、证件字段、`latitude`、`longitude`、`quota` 等可选。
  - `newPassword`：可选；非空则须 ≥6 位，用于重置商城登录密码。

---

## `DELETE /users/:id`

- **用在哪：** `admin/src/views/UsersPage.vue`。
- **鉴权：** 超级管理员。
- **传参（Path）：**
  - `id`：用户 id（会级联删该用户地址、银行卡）。

---

## `GET /my/summary`

- **用在哪：** `app/composables/useMallMy.ts`（个人中心汇总）。
- **传参（Query）：**
  - `phone`：必填；与登录用户一致。

---

## `GET /card-packages`

- **用在哪：** `app/composables/useMallMy.ts`（卡包页 / `CardPackageSection`）。
- **传参（Query）：**
  - `phone`：必填。

---

## `GET /addresses`

- **用在哪：** `app/composables/useMallMy.ts`。
- **传参（Query）：**
  - `phone`：必填；账号手机号。

---

## `POST /addresses`

- **用在哪：** `app/composables/useMallMy.ts`。
- **传参（Body）：**
  - `userPhone` 或与账号一致的 `phone`：归属用户。
  - `receiver`：收货人姓名。
  - `phone`：收货人手机（11 位）。
  - `province`、`city`、`district`、`detail`：地址。
  - `isDefault`：是否默认。

---

## `PATCH /addresses/:id`

- **用在哪：** `app/composables/useMallMy.ts`。
- **传参：**
  - Path `id`：地址 id。
  - Body：收件人、手机、省市区、详情、`isDefault` 等，按需传。

---

## `PATCH /addresses/:id/default`

- **用在哪：** `app/composables/useMallMy.ts`。
- **传参（Path）：**
  - `id`：设为默认的地址 id。
- **Body：** 无。

---

## `GET /bank-cards`

- **用在哪：** `app/composables/useMallMy.ts`。
- **传参（Query）：**
  - `phone`：必填。

---

## `POST /bank-cards`

- **用在哪：** `app/composables/useMallMy.ts`。
- **传参（Body）：**
  - `userPhone`：账号手机。
  - `bankName`：开户行。
  - `cardNo`：卡号数字 12–19 位。
  - `owner`：持卡人。
  - `cardType`：可选；默认储蓄卡。

---

## `DELETE /bank-cards/:id`

- **用在哪：** `app/composables/useMallMy.ts`。
- **传参：**
  - Path `id`：银行卡 id。
  - Query `phone`：必填；须为该卡归属用户。

---

## `GET /bills`

- **用在哪：** `app/composables/useMallMy.ts`（账单页）。
- **传参（Query）：**
  - `phone`：必填。
- **返回备注：** `data.summary` 为概览，`data.list` 为先享后付摊平账单行。

---

## `GET /orders`

- **用在哪：** `app/composables/useMallOrders.ts`（不带筛选，拉列表）；`admin/src/stores/useOrdersStore.ts`（带筛选）。
- **传参（Query，均可选，后台常用）：**
  - `keyword`：订单号/商品名/收货人。
  - `status`：订单状态枚举，如 `reviewing`。
  - `adminStatus`：后台展示态筛选用文案。
  - `payType`：`installment` / `full`。
  - `date`：创建日期前缀匹配。

---

## `GET /orders/:id/risk-detail`

- **用在哪：** `admin/src/stores/useOrdersStore.ts`。
- **传参（Path）：**
  - `id`：订单号。

---

## `POST /orders`

- **用在哪：** `app/components/order/create.vue`（经 `useMallOrders.createOrder`）。
- **传参（Body）：**
  - `productId`、`name`、`spec`、`totalAmount`：商品与金额。
  - `status`：可选；默认 `reviewing`。
  - `paid`：是否已付。
  - `payType`：`full` / `installment`。
  - `installmentPeriods`：先享后付期数，默认 12。
  - `payChannel`：如 `wechat`。
  - `receiverName`、`receiverPhone`、`receiverAddress`：收货信息。

---

## `PATCH /orders/:id/pay`

- **用在哪：** `app/composables/useMallOrders.ts`（`markOrderPaid`）。
- **传参：**
  - Path `id`：订单号。
  - Body：`payChannel`：可选。

---

## `PATCH /orders/:id/installments/:period/pay`

- **用在哪：** `admin/src/stores/useOrdersStore.ts`。
- **传参：**
  - Path `id`：订单号；`period`：期数。
  - Body：`paid`：布尔，该期是否已还。
- **副作用：** 当前订单为**先享后付**（`payType === 'installment'`）且**每一期** `paid` 均为 `true` 时，订单 `status` 会自动置为 `enjoying`（用户端/后台展示为「已完成」）；若从「全部已还」改回任一期未还，且订单处于 `enjoying`，则会按是否已登记快递单号退回 `receiving`（已填单号）或 `shipping`（未填单号）。
---

## `PATCH /orders/:id/status`

- **用在哪：** `admin/src/stores/useOrdersStore.ts`。
- **鉴权：** 接口内校验：超级管理员或审核员。
- **传参：**
  - Path `id`：订单号。
  - Body：`status`：如 `shipping`；审核员通常仅能推进到发货类状态。设为 `reviewing`（打回审核）时会清空快递单号。

---

## `PATCH /orders/:id/shipment`

- **用在哪：** `admin/src/stores/useOrdersStore.ts`（`updateOrderShipment`）。
- **鉴权：** 仅超级管理员。
- **传参：**
  - Path `id`：订单号。
  - Body：**必填字段** `trackingNumber`（字符串）；**传空字符串表示清空单号**并恢复未填写展示；若原已有单号且当前为 `receiving`，会退回 `shipping`（待发货）。
  - 非空时：订单为 `shipping` 会自动改为 `receiving`；已在 `receiving` 的订单可只改单号。

---

## `PATCH /orders/:id/card-package`

- **用在哪：** `admin/src/stores/useOrdersStore.ts`。
- **鉴权：** 超管 / 审核员。
- **传参：**
  - Path `id`：订单号。
  - Body：`cardPackageIssued`：布尔，卡包是否已发放。

---

## `POST /admin/login`

- **用在哪：** `admin/src/views/LoginPage.vue`。
- **传参（Body）：**
  - `username`、`password`：后台账号密码。

---

## `POST /login`

- **用在哪：** 与 `/admin/login` 相同逻辑；仓库主路径使用 `/admin/login`。
- **传参：** 同 `POST /admin/login`。

---

## `GET /admin/accounts`

- **用在哪：** `admin/src/views/AccountManagePage.vue`。
- **鉴权：** 超级管理员。
- **传参：** 无。

---

## `POST /admin/accounts`

- **用在哪：** `admin/src/views/AccountManagePage.vue`。
- **鉴权：** 超级管理员。
- **传参（Body）：**
  - `username`：4–21 位，字母开头。
  - `password`：至少 4 位。
  - `role`：仅 `reviewer` 或 `collector`（新建时；审核员含在线客服进线权限）。
  - `phone`：11 位；`name`：可选。

---

## `PATCH /admin/accounts/:id`

- **用在哪：** `admin/src/views/AccountManagePage.vue`。
- **鉴权：** 超级管理员。
- **传参：**
  - Path `id`：账号 id。
  - Body：`role`、`status`（`active`|`disabled`）、`password`、`name`，按需。

---

## `DELETE /admin/accounts/:id`

- **用在哪：** `admin/src/views/AccountManagePage.vue`。
- **鉴权：** 超级管理员。
- **传参（Path）：**
  - `id`：账号 id（内置 `admin` 不可删）。
