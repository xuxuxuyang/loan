# Admin 后台功能与技术实现分析

> 分析对象：`3.admin` 主运营后台  
> 分析日期：2026-08-24  
> 文档性质：基于当前仓库源码的静态分析，不代表线上接口、第三方服务或生产数据的实时状态。

## 1. 分析范围

本次扫描覆盖 `3.admin` 中 74 个非生成文件，重点包括：

- 应用入口、壳层和全局样式：`src/main.ts`、`src/App.vue`、`src/style.css`；
- 路由、登录会话、权限和租户工作区：`src/router`、`src/composables`；
- 全部业务页面：`src/views`；
- 订单共享状态、风险展示、合同、用户注册资料和客服组件：`src/stores`、`src/components`；
- 数据转换与业务规则：`src/utils`、`src/constants`、`src/api`；
- 构建与环境配置：`package.json`、`vite.config.ts`、`tsconfig*.json`、`.env.*`、`index.html`；
- 自动化验证：`tests` 下 5 个 Node 测试文件。

以下目录和文件不作为一方业务源码逐行解释：`node_modules`、`dist`、`build`、`coverage`、依赖锁文件、图片二进制和自动生成的 `components.d.ts`。锁文件已用于确认依赖形态，但不展开包级实现。

本次不包含 `4.admin-liuliang`。该目录是独立的流量合作方后台，不属于主运营后台 `3.admin`，应另行分析，避免把两套账号、权限和业务边界混在一起。

## 2. 总体结论

`3.admin` 是一套 Vue 3 桌面端单页管理系统，覆盖商城运营的主要后台流程：登录与权限、财务看板、订单审核与履约、应收和还款、用户与风控、商品、后台账号、租户子系统、流量渠道和在线客服。

核心架构特点：

- Vue 3 Composition API + TypeScript + Vue Router + Vite；
- Element Plus 按需注册，NProgress 负责路由加载反馈；
- 没有 Pinia/Vuex，订单使用模块级 `ref` 共享状态，其它页面以组件本地状态和组合式函数为主；
- 登录会话保存在 `localStorage`，前端同时实施路由级菜单权限和按钮级动作权限；
- 同一后台支持总部核心库、平台自营库、普通租户库三类工作区，通过请求头切换数据域；
- 页面接口以原生 `fetch` 为主，统一补充管理员身份、角色、租户和工作区请求头；
- 功能明显偏桌面运营场景，固定侧栏和大量宽表格是主要交互形态，不是移动端优先设计；
- 多个页面直接承担复杂业务编排，`OrdersPage.vue`、`UsersPage.vue`、`UserRiskDetailDialog.vue` 等单文件超过 3000 行，功能完整但维护成本较高。

## 3. 技术栈与工程实现

| 层级 | 技术/依赖 | 当前用途 |
| --- | --- | --- |
| UI 框架 | Vue `3.5.x` | `<script setup>`、响应式状态、计算属性、组件通信 |
| 路由 | Vue Router `4.6.x` | HTML5 History、懒加载、登录守卫、角色/菜单权限守卫 |
| 类型与构建 | TypeScript `6.0.x`、Vite `8.0.x` | 类型检查、开发服务、生产构建、代码分块 |
| UI 组件 | Element Plus `2.13.x` | 表单、表格、分页、弹窗、上传、提示、Loading |
| 图标 | `@element-plus/icons-vue` | 菜单、按钮和状态图标 |
| 进度反馈 | NProgress | 路由切换顶部进度条 |
| 图表依赖 | ECharts `6.x` | 已声明并配置独立构建分块，但当前一方源码未发现实际导入 |
| 测试 | Node 内置测试运行器 | 5 个静态结构/工具函数回归测试 |

`cnpm` 被列为运行依赖，但当前 `src` 未发现导入。ECharts 也未发现源码使用；两者都属于可复核的依赖精简候选，不能只凭静态未引用直接删除，仍需结合部署脚本和运行环境确认。

## 4. 应用架构

### 4.1 分层关系

```text
index.html
  -> src/main.ts
     -> Vue App + Router + Element Plus Loading + 租户 Fetch 拦截器
        -> src/App.vue（侧栏、顶栏、标签页、角标、工作区状态）
           -> src/router/index.ts（路由懒加载与访问守卫）
              -> src/views/*（业务页面）
                 -> src/composables/*（会话、权限、请求头、轮询）
                 -> src/stores/useOrdersStore.ts（订单共享状态与写操作）
                 -> src/components/*（风控、合同、客服、注册资料等）
                 -> src/utils/*（映射、金额/日期、风险事实、租户工具）
                    -> `VITE_MALL_API_BASE` 对应的后端 API
```

### 4.2 启动流程

`src/main.ts` 的启动顺序：

1. 引入 Element Plus 必要样式、NProgress 样式和全局样式；
2. 创建 Vue 应用并安装 Router；
3. 全局注册 Element Plus `v-loading` 指令；
4. 安装租户 Fetch 拦截器；
5. 挂载到 `#app`。

页面组件由 `unplugin-vue-components` 与 `ElementPlusResolver` 自动按需注册，生成的类型声明位于 `src/components.d.ts`。

### 4.3 壳层与全局交互

`src/App.vue` 负责：

- 根据角色、菜单权限和工作区动态过滤侧栏；
- 展示后台品牌、管理员头像、姓名、角色和当前租户；
- 在租户工作区提供“返回总部”；
- 退出登录并清除本地会话与访问标签；
- 维护最多 20 个已访问页面标签，固定保留角色首页；
- 展示“未审核订单”“已审核订单”数量和客服未读红点；
- 在非订单页面每 15 秒读取轻量订单角标接口；
- 在非客服页面每 15 秒读取客服未读状态；
- 页面不可见时停止无意义轮询，回到前台后恢复；
- 对账号、商品、流量等重页面延迟角标请求，降低首屏并发读取压力。

## 5. 登录、会话与身份请求头

### 5.1 登录

主要代码：`src/views/LoginPage.vue`、`src/components/auth/*`。

- `POST /admin/login` 提交后台用户名和密码；
- 登录成功后保存 token、用户名、姓名、角色、登录时间、租户范围、工作区和权限；
- 支持安全的 `redirect` 回跳，未提供有效回跳时按角色与菜单权限选择首页；
- 已登录访问 `/login` 会自动进入后台首页；
- 登录页包含签运、欢迎庆祝和雨幕动画，并适配 `prefers-reduced-motion`；
- 进入后台后调用 `GET /admin/profile` 同步显示名和最新权限，权限调整不必强制重新登录即可刷新前端菜单。

### 5.2 会话持久化

会话键为：

```text
mall-admin-session
```

存储位置为 `localStorage`，字段包括：

- `token`；
- `username`、`name`；
- `role`；
- `loginAt`；
- `scopeType`；
- `workspaceType`；
- `tenantId`、`scopeTenantIds`；
- `permissions.menus`、`permissions.actions`。

历史 `customer_service` 角色在读取会话时会迁移为 `reviewer`。旧会话缺少范围字段时，会根据平台用户名白名单和角色推断是平台账号还是租户账号。

### 5.3 管理请求头

`withAdminAuthHeaders()` 生成：

| 请求头 | 来源 | 用途 |
| --- | --- | --- |
| `Authorization` | 会话 token | 后端身份认证 |
| `x-admin-role` | 会话角色 | 角色上下文，不能替代后端鉴权 |
| `x-admin-username` | 登录用户名 | 在多数据库存在同手机号账号时消歧 |
| `x-tenant-id` | 当前租户 | 指定商城租户 |
| `x-workspace-type` | 当前工作区 | 在 `core`、`self`、`tenant` 间路由数据 |

源码注释指出 Bearer token 可能采用手机号形式的 mock token，仅靠 token 无法可靠区分多库同号账号，因此显式补充 `x-admin-username`。生产环境仍必须由后端验证 token、账号状态、角色、租户归属和每个动作权限，不能信任浏览器可修改的请求头。

## 6. 多租户与工作区

后台同时表达两种范围：

- `scopeType=platform`：总部/平台账号；
- `scopeType=tenant`：普通租户后台账号。

请求再细分三类工作区：

| 工作区 | 数据含义 | 典型接口/数据 |
| --- | --- | --- |
| `core` | 总部元数据 | `/platform/tenants`、总部 `/platform/accounts` |
| `self` | 平台自营业务库 | 平台默认业务工作区 |
| `tenant` | 具体商城租户业务库 | 用户、订单、商品、渠道、客服、账单 |

`withMallTenantHeaders()` 强制使用 `x-workspace-type: tenant`，用于商城业务数据。平台账号进入某个租户后，会把 `workspaceType` 改为 `tenant` 并更新 `tenantId`；返回总部时恢复核心/自营上下文。

`installTenantFetchInterceptor()` 会在调用方遗漏时为全局 `fetch` 补充 `x-tenant-id`。这是兼容兜底，不改变各业务调用仍应显式选择正确工作区的要求。

平台专页有双重保护：普通租户不能进入；平台账号已经切入租户工作区时也不能通过深链进入总部专页，必须先返回总部，防止误把租户数据当成总部数据。

## 7. 路由、页面与权限目录

| 路径 | 页面 | 默认角色范围 | 权限 key | 功能 |
| --- | --- | --- | --- | --- |
| `/login` | `LoginPage` | 公开 | - | 后台登录 |
| `/dashboard` | `DashboardPage` | 超管/老板兼容 | `dashboard` | 财务报表 |
| `/dashboard/plan` | `DashboardSimulationPage` | 全角色 | `dashboardSimulation` | 财务汇算模拟 |
| `/orders/review` | `OrderReviewPage` | 超管、审核、催收 | `orders.review` | 未审核订单 |
| `/orders` | `OrdersPage` | 超管、审核、催收 | `orders.approved` | 已审核订单 |
| `/orders/card-data` | `OrdersPage` | 超管、审核、催收 | `orders.cardData` | 卡包/订单数据 |
| `/orders/receivable/today` | `ReceivableByDatePage` | 超管、催收 | `orders.receivable.today` | 今日待收 |
| `/orders/receivable/tomorrow` | `ReceivableByDatePage` | 超管、催收 | `orders.receivable.tomorrow` | 明日待收 |
| `/orders/receivable/data` | `ReceivableByDatePage` | 超管、催收 | `orders.receivable.data` | 指定日期待收 |
| `/orders/repayment-records` | `RepaymentRecordsPage` | 超管、催收 | `orders.repayment.records` | 还款记录 |
| `/users` | `UsersPage` | 超管 | `users.registered` | 注册用户 |
| `/users/registered-whitelist` | `UsersPage` | 超管 | `users.registeredWhitelist` | 注册白名单 |
| `/users/no-order` | `UsersPage` | 超管 | `users.noOrder` | 未下单用户 |
| `/users/ordering` | `UsersPage` | 超管 | `users.ordering` | 下单用户 |
| `/users/card-package-issued` | `UsersPage` | 超管 | `users.cardPackageIssued` | 已发卡包客户 |
| `/accounts` | `AccountManagePage` | 超管、老板 | `accounts` | 后台账号与权限 |
| `/tenants` | `TenantManagePage` | 平台严格超管 | `tenants.system` | 子系统管理 |
| `/tenants/mall-users-data` | `TenantMallUsersDataPage` | 平台严格超管 | `tenants.mallUsersData` | 跨租户用户数据 |
| `/traffic` | `TrafficManagementPage` | 超管 | `traffic` | 流量渠道管理 |
| `/products/mall` | `ProductsPage` | 超管 | `products.mall` | 普通商城商品 |
| `/products/installment` | `ProductsPage` | 超管 | `products.installment` | 先享后付商品 |
| `/cs-messages` | `CsMessagesPage` | 超管、审核、催收 | `cs.messages` | 在线客服 |

兼容重定向：`/platform -> /tenants`、`/products -> /products/mall`，旧的 dashboard 待收路径重定向到 orders 下的新路径。

## 8. 角色与 RBAC 实现

### 8.1 角色

当前角色：

- `super_admin`：超级管理员；
- `boss`：老板；
- `reviewer`：审核员；
- `collector`：催收员。

未配置细粒度权限的旧账号使用角色兼容逻辑。老板默认可继承路由中的超级管理员角色范围，但“子系统管理”和“子系统数据”设置了严格超管，不允许老板继承。

配置了 `permissions` 后，侧栏和普通业务路由主要按菜单 `view` 权限决定；动作按钮再按当前菜单下的 action 决定。`super_admin` 在动作权限函数中直接放行。平台范围、严格超管和工作区限制仍独立生效。

### 8.2 默认首页

| 角色 | 首选首页 |
| --- | --- |
| 超级管理员 | 账号管理 |
| 老板 | 财务报表 |
| 审核员 | 未审核订单 |
| 催收员 | 今日待收 |

首选页没有 `view` 权限时，按权限目录顺序进入第一个可访问页面。

### 8.3 动作权限

前端识别的动作包括：

`view`、`reply`、`review`、`issueCard`、`fillTracking`、`markPaid`、`delayRepayment`、`settleAmount`、`negotiateRepayment`、`revokePaid`、`updateStatus`、`updateContract`、`setQuota`、`remark`、`blacklist`、`riskCheck`、`resetPassword`、`toggleOnSale`、`uploadImage`、`toggleStatus`、`changeRole`、`editChannel`、`bindPortalAccount`、`purgeTenantData`、`export`、`remove`、`create`、`update`、`delete`、`permission`、`switchTenant`。

这些权限控制前端可见性和交互入口，但不是安全边界。所有写接口仍需在后端重复验证操作人、权限、租户和目标资源。

## 9. 功能与技术实现

### 9.1 财务报表

主要代码：`src/views/DashboardPage.vue`。

- `GET /admin/dashboard/kpis` 读取经营指标；
- 展示商城订单、卡包金额、应收本金、利润、回款、到期、结清、逾期等统计；
- 页面按后端返回快照渲染卡片和汇总区域；
- “实际收入”只对 `super_admin` 显示，其他角色不会在前端展示；
- 刷新按钮重新读取，不在前端自行修改财务数据。

财务指标口径最终以服务端聚合为准。前端只负责格式化和显隐，不能从页面名称推断会计确认口径。

### 9.2 财务汇算模拟

主要代码：`src/views/DashboardSimulationPage.vue`。

- `POST /admin/dashboard/simulation-kpis` 根据输入或当前配置计算模拟指标；
- 展示投入、订单、卡包、回款、利润等试算结果；
- 使用请求序号防止较慢旧请求覆盖较新的结果；
- 代码保留对 `/admin/dashboard/simulation-config` 的 `PUT` 分支，但当前页面没有调用入口，不能视为已开放的可见功能。

### 9.3 未审核订单

主要代码：`src/views/OrderReviewPage.vue`、`src/stores/useOrdersStore.ts`。

- 通过 `GET /orders` 并传 `listScope=pending` 获取待审核列表；
- 支持关键词、注册渠道、风险状态和分页；
- 区分“待审核”和“风控未通过”；
- 点击用户或风控入口读取关联用户档案；优先使用 `mallUserId`，其次才按注册手机号查找；
- 审核通过通过 `PATCH /orders/:id/status` 修改订单状态；
- 审核不通过保留订单 `reviewing`，写入 `riskStatus=failed` 和必填的人工原因；
- 重新审核把 `riskStatus` 恢复为 `passed`；
- 删除订单前二次确认，调用 `DELETE /orders/:id`；
- 操作完成后主动刷新订单侧栏角标。

审核前会读取用户风控档案完整度。七项风控或雷达资料不完整时，页面显示醒目警告和确认内容，但没有强制禁止人工通过；最终审批责任仍落在操作人和后端规则。

### 9.4 已审核订单与订单数据

主要代码：`src/views/OrdersPage.vue`、`src/stores/useOrdersStore.ts`。

两个路由复用同一页面：

- `/orders` 使用已审核列表口径；
- `/orders/card-data` 展示更完整的卡包/订单数据列。

通用能力：

- 关键词、订单状态、支付类型、还款状态、日期和注册渠道过滤；
- 服务器分页，单页最大 100 条；
- 显示注册用户、收货人、商品、金额、卡包金额、渠道、订单和还款状态；
- 区分注册账号手机号与收货手机号，打开风控档案时优先使用注册用户 ID；
- 根据快递单号和期次状态计算管理端展示状态；
- 卡包已发放时，管理端把订单显示为“已完成”；
- 标记待发货/待收货/已完成或回退重新审核；
- 填写或清空快递单号；
- 标记卡包发放/取消发放；
- 标记卡包合同已签/未签；
- 拉取合同流程并在 iframe 弹窗中查看签署合同；
- 查看关联用户的注册资料与风控档案；
- 删除订单。

卡包发放的前置确认：

1. 紧急联系人资料完整；
2. 先享后付合同已签署；
3. 操作人确认合同签名与本人一致。

前端会禁用或提示不满足条件的操作，后端仍应重复校验这些条件，避免直接构造请求绕过页面。

### 9.5 分期还款管理

订单期次弹窗支持：

- 查看每期本金、费用、应还金额、原始还款日和有效还款日；
- 标记某期已还/未还：`PATCH /orders/:id/installments/:period/pay`；
- 按天延期或指定协商还款日：`PATCH /orders/:id/installments/:period/due-date`；
- 修改结清金额：`PATCH /orders/:id/installments/:period/settle-amount`；
- 登记部分协商还款和剩余金额到期日：`PATCH /orders/:id/installments/:period/negotiate`；
- 标记协商历史某笔已支付/撤销：`PATCH /orders/:id/installments/:period/negotiation/history/:historyIndex/paid`；
- 展示用户前台尚未支付的协商款、历史记录和被后续协商替代的状态；
- 所有期次已还后把本地订单状态重算为已完成；撤销时按物流信息回退到待发货或待收货。

接口 PATCH 返回的订单可能没有用户和渠道 enrichment。`mergePatchedOrder()` 会保留当前列表中的买家姓名、注册手机号、用户 ID、备注、紧急联系人和渠道字段，避免更新还款后表格身份信息被空值覆盖。

### 9.6 今日、明日与指定日期待收

主要代码：`src/views/ReceivableByDatePage.vue`。

三个路由通过 route meta 控制日期：

- 今日：偏移 0 天；
- 明日：偏移 1 天；
- 待收数据：显示日期选择器。

功能包括：

- `GET /orders/pending-receivable` 获取指定日的应收期次；
- 支持全部、已还、未还过滤和关键词查询；
- 显示应收金额、笔数、已收率和“延期按已收”统计；
- 同时显示注册用户与实际收货人，避免账号归属混淆；
- 展示注册渠道、订单、期次、还款日、状态和催收备注；
- `PATCH /orders/:id/installments/:period/collection-remark` 更新单期催收备注；
- 服务端分页。

“延期按已收”属于管理报表口径，不等同于真实资金到账，财务和催收使用时应区分。

### 9.7 还款记录

主要代码：`src/views/RepaymentRecordsPage.vue`。

- `GET /admin/orders/repayment-records` 查询已支付记录；
- 支持日期和关键词过滤、分页；
- 展示付款金额、状态、方式、支付时间、交易号、订单号、用户、渠道和备注；
- 页面是只读查询，不提供改款或撤销入口。

### 9.8 用户列表

主要代码：`src/views/UsersPage.vue`。

同一页面支持五种业务视图：

| 视图 | 查询口径 | 特殊行为 |
| --- | --- | --- |
| 注册用户 | 全部注册用户 | 完整管理能力 |
| 注册白名单 | `view=registered-whitelist` | 只读，允许移除/恢复白名单 |
| 未下单用户 | `view=no-order` | 只看无订单用户 |
| 下单用户 | `view=ordering` | 只看已有下单用户 |
| 已发卡包客户 | `view=card-package-issued` | 支持日期范围和脱敏导出 |

通用查询与展示：

- 渠道、注册日期、授信状态、白名单状态、关键词过滤；
- 服务端分页；
- 展示实名、手机号、身份证、额度、下单/卡包状态、渠道和内部备注；
- 默认额度从 `VITE_MALL_DEFAULT_CREDIT_QUOTA` 注入，异常时回退 2750；
- 授信状态只根据七项订单风控槽位推导，不把雷达和流水结果直接合并为同一状态。

### 9.9 用户增删改、额度与标签

根据当前页面动作权限，前端提供：

- `POST /users` 创建用户；
- `PATCH /users/:id` 修改姓名、手机号、身份证号、密码、两位紧急联系人；
- 调整授信额度；
- 编辑后台内部备注；
- 加入/移出下单黑名单；
- `PATCH /users/:id/register-channel` 调整注册渠道；
- `DELETE /users/:id` 删除用户；
- `PATCH /users/:id/registered-whitelist/remove` 移除注册白名单；
- `PATCH /users/:id/registered-whitelist/restore` 恢复注册白名单。

注册白名单页主动屏蔽普通编辑、额度、备注、黑名单和删除，只保留白名单移除/恢复操作。

代码中存在一个权限守卫不一致：列表“修改”入口按 `canEditUsers` 显示，但 `startEdit()` 内部检查的是 `canSetQuotaInCurrentView`。因此，拥有用户更新或重置密码能力但没有额度权限的账号，可能看到修改按钮却无法进入编辑状态；这是前端权限/可用性缺陷，不代表后端越权。

### 9.10 用户 CSV 导出

- `GET /users/export` 返回 CSV；
- 可选择导出字段；
- 沿用当前视图、关键词、渠道和状态过滤；
- 已发卡包客户支持独立日期范围；
- 可选择是否对手机号脱敏；
- 从 `Content-Disposition` 解析服务端文件名，缺失时生成带日期的本地文件名；
- 导出操作受 `export` 权限控制。

导出数据包含个人信息，应在后端做权限、审计、字段白名单和租户隔离；前端隐藏按钮不足以保护数据。

### 9.11 用户注册资料

主要代码：`src/components/UserRegistrationInfoScroll.vue`。

用户详情展示：

- 实名、手机号、身份证号；
- 身份证正反面和手持照片；
- 两位紧急联系人；
- 下单收货人、收货电话和完整地址，支持复制；
- 注册渠道、注册时间、额度、黑名单和备注；
- 后台密码明文字段（接口存在时）；
- App 上传的通讯录快照。

通讯录实现：

- `GET /users/:id/mall-contacts` 分页读取上传批次；
- `GET /users/:id/mall-contacts/:uploadId/contacts` 按批次懒加载联系人；
- 对上传批次和联系人分别分页/增量加载，避免一次渲染全部通讯录；
- 联系人区域滚动接近底部时继续加载。

### 9.12 用户风控档案

主要代码：

- `src/components/UserRiskDetailDialog.vue`
- `src/components/RadarV4FactsPanel.vue`
- `src/constants/installmentOrderRisk.ts`
- `src/utils/riskRowFactLines.ts`
- `src/utils/radarV4ReputationFacts.ts`
- `src/api/billRiskControl.js`

弹窗分为四类信息：

1. 用户注册资料；
2. 七项订单风控；
3. 雷达 V4 风控；
4. 流水/账单风险。

七项订单风控包括：

- 手机二要素；
- 手机在网时长；
- 手机状态；
- 法院详情；
- 被执行信息；
- 个人三要素；
- 探针 C。

操作能力：

- `GET /users/:id` 读取用户及风险快照；
- `POST /users/:id/risk-slot/:slotKey` 单独执行某个风控槽位；
- 全量检查按顺序调用多个槽位，避免并发压垮或打乱上游；
- 将供应商原始响应解析为运营可读的事实行、成功/失败/跳过状态和错误信息；
- 雷达 V4 按中文分组展示指标；
- 雷达历史最多保留 30 条，手动重查后合并新历史；
- 风控更新后回写当前用户列表，避免关闭弹窗后页面仍显示旧状态。

流水风险：

- `GET /users/:id/bill-risk` 读取状态、报告和来源链接；
- `POST /users/:id/bill-risk/mail` 生成动态收件邮箱；
- 支持复制邮箱、上传指引链接；
- 支持打开返回的报告地址和原始流水文件。

外部风控调用可能涉及实名、手机号、身份证、联系人和账单数据。前端只展示结果；数据最小化、授权凭证、供应商审计、保存期限和脱敏必须由后端及合规流程保证。

### 9.13 商品管理

主要代码：`src/views/ProductsPage.vue`。

两个路由复用同一页面：

- 普通商城商品：`salesMode=mall`；
- 先享后付商品：`salesMode=installment`。

功能包括：

- `GET /products` 查询商品；
- 分类、上下架状态和关键词过滤；
- `POST /products` 创建；
- `PATCH /products/:id` 编辑或上下架；
- `DELETE /products/:id` 删除；
- 主图和最多 24 张详情图；
- `POST /uploads/public-image` 上传公开商品图；
- 浏览器端把图片长边压到不超过 1600px，并转成质量 0.86 的 JPEG；
- 表单分类值与 API 分类 key 双向映射；
- 先享后付商品根据卡包金额自动生成副标题。

部分提交/删除函数主要依赖按钮显隐，没有在处理函数入口再次检查具体动作权限。后端必须继续作为最终授权边界。

### 9.14 后台账号管理

主要代码：`src/views/AccountManagePage.vue`。

根据工作区选择两套 API：

- 总部账号：`/platform/accounts`，请求 `core` 工作区；
- 租户账号：`/admin/accounts`，请求指定租户工作区。

功能包括：

- 搜索并按超级管理员、老板、员工分组；
- 创建后台账号；
- 启用/停用；
- 修改角色；
- 重置密码；
- 删除账号；
- `GET /admin/permissions/catalog` 读取权限目录；
- 按菜单设置查看权限和动作权限；
- 套用角色默认权限。

保护逻辑：

- 平台引导超级管理员不可被普通破坏性操作处理；
- 租户老板账号受保护；
- 当前登录账号不能删除或停用自身；
- 总部和租户接口不会因为同一个页面而混用。

当前管理密码前端最小长度为 4 位，安全强度明显偏低。生产应由后端提高长度、复杂度、尝试次数、重置审计和必要的二次认证要求。

### 9.15 子系统/租户管理

主要代码：`src/views/TenantManagePage.vue`、`src/composables/useTenantScope.ts`。

仅平台严格超级管理员可访问：

- `GET /platform/tenants` 查询租户及用户/订单/商品数量；
- `POST /platform/tenants/onboard` 原子开通租户和老板账号；
- 编辑租户老板；
- 在指定租户创建、修改、停用、改角色、重置密码或删除后台账号；
- `GET /platform/admin-accounts?scopeType=tenant` 汇总租户账号；
- 切换进入某个租户工作区；
- 返回总部；
- `DELETE /platform/tenants/:id` 删除空租户。

强制清退：

- 租户存在业务数据时，普通删除会收到 409；
- 拥有 `purgeTenantData` 权限的操作人可在专门确认后调用 `DELETE /platform/tenants/:id?wipeAll=1`；
- 页面使用两阶段确认，明确提示会删除商城用户、订单、商品和租户注册；
- 该操作是永久性数据删除，文档分析期间未执行任何清退或数据写入。

后端应对强制清退增加不可绕过的严格超管校验、租户 ID 精确匹配、操作审计、备份/保留策略和幂等保护。

### 9.16 跨租户商城用户数据

主要代码：`src/views/TenantMallUsersDataPage.vue`。

- 平台严格超级管理员专页；
- `GET /platform/tenants` 提供租户筛选；
- `GET /platform/mall-users` 跨租户聚合商城用户；
- 支持租户、关键词和分页；
- 展示用户所属子系统及基础业务数据；
- 页面只读，不直接修改跨租户用户。

跨租户聚合接口具有高数据敏感性，必须由后端强制平台权限、查询范围、字段脱敏和审计。

### 9.17 流量渠道管理

主要代码：`src/views/TrafficManagementPage.vue`、`src/components/TrafficChannelNameTag.vue`。

渠道管理：

- `GET /admin/traffic-channels/overview` 获取渠道及首单归因统计；
- `GET /admin/traffic-channels` / `POST /admin/traffic-channels` 查询和创建；
- `PATCH /admin/traffic-channels/:id` 编辑名称、备注、状态和合作方门户账号；
- `DELETE /admin/traffic-channels/:id` 删除；
- 启用/停用渠道；
- 复制带 `channel` 参数的 H5 推广链接；
- 绑定或新建流量合作方门户账号；
- 为渠道标签生成稳定颜色。

统计能力：

- 渠道注册人数；
- 首单下单、审核通过、卡包发放等归因指标；
- 有审核通过订单的白名单渠道筛选；
- 老客户复购下单、通过数量、成交额和卡包金额；
- `GET /admin/traffic-channels/daily-disbursement` 按日期统计放款、应收本金、利润和客单价。

推广链接来源：

- 优先使用 `VITE_MALL_H5_ORIGIN`；
- 本地未配置时把后台 5174 端口推导为商城 5173；
- 生产未配置且当前地址为 `:8080` 时，回退到同主机 80 端口。

合作方门户账号密码从接口返回并回显在编辑表单中，属于明文敏感信息暴露。更安全的设计是仅允许设置/重置，服务端只保存不可逆摘要，前端永不回显旧密码。

### 9.18 在线客服

主要代码：

- `src/views/CsMessagesPage.vue`
- `src/components/cs/CsSessionListPanel.vue`
- `src/components/cs/CsChatPanel.vue`

功能包括：

- `GET /admin/cs/sessions` 查询会话列表；
- `GET /admin/cs/sessions/:id` 读取当前会话和消息；
- `POST /admin/cs/sessions/:id/messages` 发送文本；
- `POST /admin/cs/sessions/:id/messages/image` 上传并发送图片；
- 显示用户/访客、最后消息、未读数和在线/离线状态；
- 会话列表每 30 秒轮询；
- 当前会话每 10 秒增量轮询；
- 页面隐藏时暂停，恢复可见时立即同步；
- 使用请求序号避免切换会话后旧请求覆盖新会话；
- 本地刚发送的消息与服务端结果合并，防止慢轮询造成消息闪退；
- `/static/uploads/cs/` 图片路径可改写到 `/api/static/uploads/cs/`，适配生产反向代理。

侧栏未读红点使用轻量 `GET /admin/cs/badge`。进入客服页后由会话列表直接更新全局未读状态，避免重复轮询。

## 10. 订单状态与关键业务规则

### 10.1 状态映射

后端订单状态和前端管理状态不是一一显示：

| 条件 | 前端显示 |
| --- | --- |
| 全款未支付、审核中 | 待付款 |
| `riskStatus=failed` | 风控未通过 |
| 后端 `reviewing` | 待审核 |
| 后端 `shipping` | 待发货 |
| 后端 `receiving` | 待收货 |
| 后端 `enjoying` 或分期全部还清 | 已完成 |
| 卡包已发放 | 管理端强制显示已完成 |

因此，“已完成”既可能表示还款结束，也可能来自卡包发放后的运营展示规则。报表和后端查询不能只按前端标签推导真实资金或物流状态。

### 10.2 用户身份与物流身份

订单同时保留：

- `mallUserId`：注册用户 ID；
- `buyerPhone`：注册账号手机号；
- `user`：注册用户姓名；
- `receiverName`、`receiverPhone`、`receiverAddress`：物流收货信息。

源码特别避免把收货手机号当作注册账号手机号。用户档案查询优先用 `mallUserId`，再用注册手机号兜底，有助于减少代收货场景下的身份错配。

### 10.3 老客户判定

订单列表展示服务端下发的 `isOldCustomer`。源码注释定义为：上一笔订单已下单、卡包已发且已全部还款。前端只展示“新客户/老客户”标签，不自行重算业务资格。

## 11. API 总览

以下是前端当前直接使用或明确保留的主要接口：

| 模块 | 方法与路径 | 用途 |
| --- | --- | --- |
| 登录 | `POST /admin/login` | 后台登录 |
| 个人资料 | `GET /admin/profile` | 同步姓名和权限 |
| 财务 | `GET /admin/dashboard/kpis` | 财务 KPI |
| 财务模拟 | `POST /admin/dashboard/simulation-kpis` | 汇算模拟 |
| 订单角标 | `GET /admin/orders/sidebar-counts` | 未审核/已审核数量 |
| 订单 | `GET /orders`、`GET /orders/:id` | 列表与详情 |
| 订单 | `PATCH /orders/:id/status` | 状态、审核和重新审核 |
| 订单 | `PATCH /orders/:id/shipment` | 快递单号 |
| 卡包 | `PATCH /orders/:id/card-package` | 发放状态 |
| 合同 | `GET/PATCH /orders/:id/card-package-contract` | 查看流程、修改签署状态 |
| 分期 | `PATCH /orders/:id/installments/:period/pay` | 已还/未还 |
| 分期 | `PATCH /orders/:id/installments/:period/due-date` | 延期或指定还款日 |
| 分期 | `PATCH /orders/:id/installments/:period/settle-amount` | 修改结清金额 |
| 分期 | `PATCH /orders/:id/installments/:period/negotiate` | 协商部分还款 |
| 分期 | `PATCH /orders/:id/installments/:period/negotiation/history/:historyIndex/paid` | 协商历史支付状态 |
| 风控 | `GET /orders/:id/risk-detail` | 保留的订单风控详情读取 |
| 订单 | `DELETE /orders/:id` | 删除订单 |
| 待收 | `GET /orders/pending-receivable` | 日期应收列表 |
| 催收 | `PATCH /orders/:id/installments/:period/collection-remark` | 期次催收备注 |
| 还款 | `GET /admin/orders/repayment-records` | 还款记录 |
| 用户 | `GET/POST /users` | 列表、创建 |
| 用户 | `GET/PATCH/DELETE /users/:id` | 详情、编辑、删除 |
| 用户 | `GET /users/by-phone` | 按注册手机号兜底查询 |
| 用户 | `PATCH /users/:id/register-channel` | 修改注册渠道 |
| 白名单 | `PATCH /users/:id/registered-whitelist/remove` | 移除白名单 |
| 白名单 | `PATCH /users/:id/registered-whitelist/restore` | 恢复白名单 |
| 导出 | `GET /users/export` | CSV 导出 |
| 风控 | `POST /users/:id/risk-slot/:slotKey` | 单项/顺序风控调用 |
| 流水风险 | `GET /users/:id/bill-risk` | 查询报告 |
| 流水风险 | `POST /users/:id/bill-risk/mail` | 生成动态邮箱 |
| 通讯录 | `GET /users/:id/mall-contacts` | 上传批次 |
| 通讯录 | `GET /users/:id/mall-contacts/:uploadId/contacts` | 联系人明细 |
| 商品 | `GET/POST /products` | 列表、创建 |
| 商品 | `PATCH/DELETE /products/:id` | 编辑、上下架、删除 |
| 上传 | `POST /uploads/public-image` | 商品公开图片 |
| 权限 | `GET /admin/permissions/catalog` | 权限目录 |
| 总部账号 | `/platform/accounts` | 总部账号 CRUD/权限 |
| 租户账号 | `/admin/accounts` | 当前租户账号 CRUD/权限 |
| 租户 | `GET /platform/tenants` | 子系统列表 |
| 租户 | `POST /platform/tenants/onboard` | 开通租户和老板 |
| 租户 | `DELETE /platform/tenants/:id` | 删除空租户 |
| 租户 | `DELETE /platform/tenants/:id?wipeAll=1` | 永久清退全部租户数据 |
| 租户账号 | `GET /platform/admin-accounts?scopeType=tenant` | 租户账号汇总 |
| 跨租户用户 | `GET /platform/mall-users` | 用户聚合 |
| 流量 | `GET /admin/traffic-channels/overview` | 渠道和归因概览 |
| 流量 | `GET /admin/traffic-channels/daily-disbursement` | 日放款报表 |
| 流量 | `GET/POST /admin/traffic-channels` | 渠道列表、创建 |
| 流量 | `PATCH/DELETE /admin/traffic-channels/:id` | 编辑、状态、门户账号、删除 |
| 客服 | `GET /admin/cs/badge` | 未读状态 |
| 客服 | `GET /admin/cs/sessions` | 会话列表 |
| 客服 | `GET /admin/cs/sessions/:id` | 会话详情 |
| 客服 | `POST /admin/cs/sessions/:id/messages` | 文本回复 |
| 客服 | `POST /admin/cs/sessions/:id/messages/image` | 图片回复 |

`GET /orders/:id/risk-detail` 已封装为 `fetchOrderRiskDetail()`，但当前页面主要改为打开用户级风险档案，未发现该函数的实际调用。`PUT /admin/dashboard/simulation-config` 也只有通用请求函数分支，没有当前 UI 入口。

## 12. 状态管理与数据流

### 12.1 全局/模块级状态

- `useOrdersStore.ts`：模块级 `ref<OrderItem[]>`，审核页和订单页共享；
- `adminSessionRevision`：本地会话修改时递增，让依赖 `getAdminSession()` 的计算属性重新求值；
- `adminVisitedTags`：内存中的访问标签；
- `ordersMenuPendingReviewTotal`、`ordersMenuReviewedListTotal`：订单角标；
- `csMenuHasUnread`：客服未读状态。

刷新浏览器后，只有 `localStorage` 中的登录会话保留；订单、角标、标签和页面筛选会重新初始化。

### 12.2 请求与错误处理

- 业务接口普遍使用原生 `fetch`；
- `apiErrorMessage()` 和 `readApiErrorMessage()` 兼容 JSON 与文本错误体；
- 写操作成功后通常把 PATCH 返回值映射并合并到当前列表；
- 复杂页面使用 loading 状态和 Element Plus 消息反馈；
- 客服和财务模拟使用请求序号防竞态；
- 角标接口失败时静默保留上一次状态，避免频繁打扰操作人。

### 12.3 轮询频率

| 场景 | 频率 | 可见性策略 |
| --- | --- | --- |
| 非订单页订单角标 | 15 秒 | 页面隐藏暂停；订单页不持续重复轮询 |
| 非客服页客服未读 | 15 秒 | 页面隐藏暂停；客服页由会话数据接管 |
| 客服会话列表 | 30 秒 | 页面隐藏暂停 |
| 当前客服会话 | 10 秒 | 页面隐藏暂停，恢复后立即同步 |

## 13. UI、样式与终端适配

- 全局采用 220px 固定侧栏 + 主内容区的 CSS Grid；
- 页面高度锁定为 `100vh`，侧栏和内容区各自滚动；
- 顶栏、访问标签、业务工具栏和表格构成主要布局；
- 主色以深红侧栏、蓝色激活态和白色内容卡片为主；
- Element Plus 与自定义 CSS 混合；
- 表格、弹窗和复杂工具栏适合 PC 运营台；
- 全局样式没有针对窄屏重排的移动端媒体查询，仅 App 动画处理了“减少动态效果”偏好；
- 在手机或窄平板上，固定侧栏和宽表格可能产生空间不足，应把“移动端后台”视为尚未专门实现的能力。

## 14. 环境、构建与部署

### 14.1 环境变量

| 变量 | 用途 | 注意事项 |
| --- | --- | --- |
| `VITE_MALL_API_BASE` | 后端 API 根地址 | 默认 `http://localhost:3110/api` |
| `VITE_MALL_H5_ORIGIN` | 生成 H5 渠道推广链接 | 未配置时按当前地址推导 |
| `VITE_TENANT_ID` | 默认商城租户 | 全局 fetch 拦截器使用 |
| `VITE_PLATFORM_USERNAMES` | 旧会话平台账号白名单 | 默认包含 `xuyang` |
| `VITE_MALL_DEFAULT_CREDIT_QUOTA` | 默认授信额度 | 由 Vite 配置调用后端共享脚本注入 |

所有 `VITE_*` 变量都会进入浏览器构建产物，不能存放数据库密码、API 私钥、供应商密钥或其它服务端秘密。

### 14.2 模式与命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | Vite 开发服务器，默认端口 5174 |
| `npm run build` | `vue-tsc -b && vite build` |
| `npm run build:subsystem` | 使用 `subsystem` mode 构建租户子系统 |
| `npm run preview` | 预览构建产物 |
| `npm run check:mojibake` | 从上级项目运行全仓乱码检查 |

环境文件包括 `.env.development`、`.env.production`、`.env.subsystem` 和 `.env.example`。

### 14.3 构建分块

Vite 手动拆分：

- Vue 与 Vue Router；
- Element Plus 数据组件；
- Element Plus 表单/弹窗组件；
- Element Plus 基础组件；
- Element Plus 图标；
- ECharts；
- 客服功能；
- 其它 vendor。

默认额度通过 `../1.api/readMallDefaultQuota.cjs` 在构建期注入，使后台与后端额度配置保持同源。该耦合意味着只复制 `3.admin` 而不保留相邻 `1.api` 目录时，Vite 配置可能无法正常加载。

## 15. 源码职责索引

### 15.1 核心入口与路由

| 文件 | 职责 |
| --- | --- |
| `src/main.ts` | 应用初始化、Router、Loading、租户拦截器 |
| `src/App.vue` | 后台壳层、菜单、顶栏、标签、角标、退出和工作区展示 |
| `src/router/index.ts` | 路由表、懒加载、登录/角色/菜单/平台守卫 |
| `src/style.css` | 全局布局、后台基础组件样式、NProgress |

### 15.2 会话、权限和轮询

| 文件 | 职责 |
| --- | --- |
| `src/composables/useAdminAuth.ts` | 会话类型、localStorage、角色兼容、平台账号识别 |
| `src/composables/useAdminApi.ts` | API 根地址、身份/租户/工作区请求头、错误解析 |
| `src/composables/useAdminPermissions.ts` | 菜单/动作权限、路径映射、默认首页 |
| `src/composables/useAdminPagePermission.ts` | 页面动作权限的响应式封装 |
| `src/composables/useTenantScope.ts` | 租户列表、租户/总部工作区切换 |
| `src/composables/useAdminVisitedTags.ts` | 访问标签增删和 20 页上限 |
| `src/composables/useAdminOrderReviewBadge.ts` | 订单侧栏角标轮询 |
| `src/composables/useAdminCsUnreadBadge.ts` | 客服未读角标轮询 |

### 15.3 主要业务页面

| 文件 | 职责 |
| --- | --- |
| `src/views/LoginPage.vue` | 登录 |
| `src/views/DashboardPage.vue` | 财务报表 |
| `src/views/DashboardSimulationPage.vue` | 财务汇算模拟 |
| `src/views/OrderReviewPage.vue` | 未审核订单、人工审批 |
| `src/views/OrdersPage.vue` | 已审核订单、订单数据、履约、分期、卡包与合同 |
| `src/views/ReceivableByDatePage.vue` | 今日/明日/指定日期待收 |
| `src/views/RepaymentRecordsPage.vue` | 还款记录 |
| `src/views/UsersPage.vue` | 五类用户视图、用户管理和导出 |
| `src/views/ProductsPage.vue` | 两类商品管理和图片上传 |
| `src/views/AccountManagePage.vue` | 总部/租户后台账号与权限 |
| `src/views/TenantManagePage.vue` | 租户开通、账号、切换、删除和清退 |
| `src/views/TenantMallUsersDataPage.vue` | 跨租户用户聚合 |
| `src/views/TrafficManagementPage.vue` | 渠道、合作方账号和归因/放款统计 |
| `src/views/CsMessagesPage.vue` | 客服会话、消息和轮询编排 |

### 15.4 关键组件与工具

| 文件/目录 | 职责 |
| --- | --- |
| `src/stores/useOrdersStore.ts` | 订单映射、过滤、PATCH 合并和业务写操作 |
| `src/components/UserRiskDetailDialog.vue` | 用户注册、七项、雷达、流水四类风控档案 |
| `src/components/UserRegistrationInfoScroll.vue` | 注册资料、物流、证件和通讯录 |
| `src/components/RadarV4FactsPanel.vue` | 雷达 V4 事实展示 |
| `src/components/CardPackageContractViewDialog.vue` | 合同 iframe 查看 |
| `src/components/cs/*` | 客服会话列表与聊天面板 |
| `src/components/auth/*` | 登录卡片和动效 |
| `src/utils/orderPatchMerge.ts` | PATCH 后保留买家 enrichment |
| `src/utils/installmentEffectiveDueDate.ts` | 有效到期日与协商剩余金额 |
| `src/utils/userRiskApproveReadiness.ts` | 审批前风险档案完整度 |
| `src/utils/riskRowFactLines.ts` | 风控原始结果转可读事实 |
| `src/utils/radarV4ReputationFacts.ts` | 雷达 V4 字段中文化和分组 |
| `src/utils/cardPackageContract.ts` | 合同流程和 URL 处理 |
| `src/utils/mallCreditQuota.ts` | 默认额度解析 |
| `src/utils/tenant.ts` | 租户解析和全局 Fetch 拦截 |
| `src/utils/progress.ts` | 路由 NProgress 封装 |

## 16. 自动化测试与质量现状

当前共有 5 个测试文件：

| 测试 | 覆盖内容 | 类型 |
| --- | --- | --- |
| `manualRejectReasonUi.test.mjs` | 人工拒绝原因采集、传递和展示 | 源码结构断言 |
| `orderRegisterChannelUi.test.mjs` | 订单/待收渠道列和过滤映射 | 源码结构断言 |
| `registeredWhitelistUi.test.mjs` | 白名单路由、只读限制、移除/恢复 | 源码结构断言 |
| `userRegistrationContactsLayout.test.mjs` | 通讯录空闲占位布局回归 | 源码文本断言 |
| `orderPatchMerge.test.mjs` | PATCH 后保留用户和渠道字段 | 转译并执行工具函数 |

现状判断：

- 有针对近期关键回归点的轻量测试；
- 多数测试通过正则匹配源码，能防止特定模板或字段被误删，但不能证明页面真实交互、接口契约和权限安全；
- 没有发现单独的 lint 脚本；
- 没有组件测试、浏览器端到端测试、API mock 集成测试或可视化回归；
- 高风险流程如审批、分期状态变更、租户清退、权限切换、CSV 导出和客服竞态缺少自动化行为测试。

本次文档生成时的实际验证结果：

- `npm run build` 通过，`vue-tsc -b` 和 Vite 生产构建均退出为 0；
- `node --test tests/*.test.mjs` 共执行 10 个用例，9 个通过、1 个失败；
- 失败项为 `registered whitelist page requests dedicated view and hides write actions`；测试仍匹配 `/移除白名单/`，当前 `UsersPage.vue` 的实际文案是“移出白名单/移出注册白名单”，属于测试断言与现有页面文案不一致；
- 本次只生成分析文档，未修改源码或测试，因此保留并如实记录该现存失败。

## 17. 已识别的风险与技术债

### 17.1 高风险

1. **租户强制清退不可恢复**：`wipeAll=1` 会永久删除租户业务数据和注册，必须依赖后端强授权、审计和备份策略。
2. **后台用户密码明文展示**：用户详情读取并显示 `adminPasswordPlain`，不符合密码不可逆存储原则。
3. **流量门户密码明文回显**：渠道门户账号返回旧密码并放入编辑表单，扩大泄露面。
4. **前端身份材料可被篡改**：token 位于 `localStorage`，角色、用户名、租户和工作区头均来自浏览器；后端必须独立认证授权。
5. **个人信息导出和跨租户查询敏感**：CSV、身份证、照片、通讯录、账单和跨租户用户数据需要后端审计、最小权限、脱敏和下载控制。

### 17.2 中风险

1. `localStorage` 中的 Bearer token 会扩大 XSS 成功后的会话窃取影响；应结合 CSP、输出编码、短时 token、刷新机制和必要的 HttpOnly Cookie 方案评估。
2. 管理密码最小长度只有 4 位，抗猜测能力不足。
3. 风控档案不完整只警告、不阻止人工通过；若业务要求强制完成风控，应由后端规则阻断。
4. 部分页面写操作主要依赖按钮显隐，处理函数没有全部二次检查动作权限。
5. “卡包已发即显示已完成”和“延期按已收”属于运营口径，容易与物流完成或真实回款混淆。
6. 用户编辑入口存在 `canEditUsers` 与 `canSetQuotaInCurrentView` 守卫不一致。

### 17.3 可维护性问题

1. `OrdersPage.vue`、`UsersPage.vue`、`UserRiskDetailDialog.vue` 等文件体积很大，表格、弹窗、请求和业务规则耦合在单组件中。
2. API 调用散落在页面、store、composable 和 JS 模块中，没有统一的类型化请求客户端。
3. `README.md` 仍是通用 Vue/Vite 模板，不能指导后台业务开发和部署。
4. 没有 lint 命令，测试集中在源码正则断言。
5. ECharts 和 `cnpm` 当前未发现一方源码使用。
6. `fetchOrderRiskDetail()` 与 `/simulation-config` 分支处于保留未调用状态，应确认是待接入能力还是可清理代码。
7. PC 固定布局没有完整窄屏适配。

## 18. 建议的后续治理顺序

以下是分析建议，不是本次代码改动：

1. 优先取消所有密码明文存储/返回/展示，提高后台密码策略，并补充操作审计和登录防爆破。
2. 对租户清退、跨租户查询、用户导出、人工审批和还款状态修改实施后端强制权限、二次确认、审计日志与可恢复策略。
3. 明确订单“运营完成、物流完成、账务结清”的不同状态，避免用单一“已完成”覆盖多种事实。
4. 把订单、用户和风控大页面拆成领域组件与类型化 API 模块，并对写操作统一做前端守卫和后端错误处理。
5. 增加审批、权限矩阵、分期状态机、租户切换/清退、CSV 导出和客服竞态的集成/E2E 测试。
6. 补充项目 README、API 契约、环境变量说明和上线回滚手册，再评估清理未使用依赖与保留代码。

## 19. 分析边界

- 本文只依据当前仓库代码和配置，不读取或修改生产数据库；
- 未调用任何登录、审批、支付、用户写入、租户清退或第三方风控接口；
- 接口是否在线、返回字段是否与前端类型完全一致，需要联调或契约测试确认；
- 前端按钮显隐不能证明后端已正确鉴权；
- 财务、授信、风控、老客户和渠道指标口径以服务端实际实现及业务制度为准；
- 本文描述“已实现”时，指当前源码存在对应页面和调用逻辑，不等于该能力已在所有生产租户启用。

## 20. 结论

`3.admin` 已形成覆盖运营、审核、催收、用户风控、商品、渠道、客服和多租户管理的完整主后台。它的技术主线清晰：Vue 单页应用通过本地会话、细粒度 RBAC 和工作区请求头连接多租户 API；订单、用户和风控页面承载了大量实际运营规则。

当前最需要关注的不是页面功能缺失，而是高权限系统的安全与可维护性：密码明文、浏览器会话信任边界、永久租户清退、敏感数据导出、人工审批兜底，以及超大单文件和不足的行为测试。后续治理应先保护身份和数据，再拆分复杂模块并补齐自动化验证。
