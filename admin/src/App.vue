<script setup lang="ts">
import type { Component } from 'vue'
import { computed, ref, watch } from 'vue'
import {
  Avatar,
  Calendar,
  ChatDotRound,
  CircleCheck,
  DataAnalysis,
  DataBoard,
  Goods,
  List,
  Promotion,
  ShoppingCart,
  Tickets,
  Setting,
  User,
} from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import AdminRoleAvatar from './components/AdminRoleAvatar.vue'
import MallBrandLogo from './components/MallBrandLogo.vue'
import { adminSessionRoleAllowed, clearAdminSession, getAdminSession, isPlatformManagingTenantWorkspace, isSuperAdminRole, type AdminSession } from './composables/useAdminAuth'
import { useTenantScope } from './composables/useTenantScope'
import { csMenuUnreadTotal, useAdminCsUnreadBadge } from './composables/useAdminCsUnreadBadge'
import {
  ordersMenuPendingReviewTotal,
  ordersMenuReviewedListTotal,
  useAdminOrderReviewBadge,
} from './composables/useAdminOrderReviewBadge'

type Role = NonNullable<AdminSession['role']>

interface MenuChild {
  label: string
  path: string
  roles?: Role[]
  icon: Component
}

interface MenuEntry {
  label: string
  path: string
  roles?: Role[]
  platformOnly?: boolean
  icon: Component
  children?: MenuChild[]
}

const route = useRoute()
const router = useRouter()
const { switchWorkspace } = useTenantScope()
const pageTitle = computed(() => String(route.meta.title || '后台管理'))
const session = ref<AdminSession | null>(getAdminSession())
const isLoginPage = computed(() => route.name === 'login')

/** 平台总览账号已切到具体子系统的 mall__tenant_x 工作区：侧栏与顶栏按「子系统后台」呈现 */
const isPlatformManagingTenant = computed(() => isPlatformManagingTenantWorkspace(session.value))

const managedTenantHeadline = computed(() => {
  if (!isPlatformManagingTenant.value) {
    return ''
  }
  const id = String(session.value?.tenantId || '').trim().toLowerCase()
  if (!id || id === 'default') {
    return '主系统'
  }
  return id
})

const allMenus: MenuEntry[] = [
{ label: '客服消息', path: '/cs-messages', icon: ChatDotRound, roles: ['super_admin', 'reviewer'] },
  

  {
    label: '订单管理',
    path: '/orders',
    icon: Tickets,
    roles: ['super_admin', 'reviewer', 'collector'],
    children: [
      { label: '未审核订单', path: '/orders/review', icon: CircleCheck, roles: ['super_admin', 'reviewer', 'collector'] },
      {
        label: '已审核订单',
        path: '/orders',
        icon: List,
        roles: ['super_admin', 'reviewer', 'collector'],
      },
      {
        label: '订单数据',
        path: '/orders/card-data',
        icon: DataBoard,
        roles: ['super_admin', 'reviewer', 'collector'],
      },
      { label: '今日待收', path: '/orders/receivable/today', icon: Calendar, roles: ['super_admin', 'collector'] },
      { label: '明日待收', path: '/orders/receivable/tomorrow', icon: Calendar, roles: ['super_admin', 'collector'] },
    ],
  },
  {
    label: '用户管理',
    path: '/users',
    icon: User,
    roles: ['super_admin'],
    children: [
      { label: '注册用户', path: '/users', icon: User },
      { label: '下单用户', path: '/users/ordering', icon: ShoppingCart },
    ],
  },
  {
    label: '产品管理',
    path: '/products/mall',
    icon: Goods,
    roles: ['super_admin'],
    children: [
      { label: '先享后付产品', path: '/products/installment', icon: Goods },
      { label: '商城产品', path: '/products/mall', icon: Goods },
    ],
  },
  { label: '账号管理', path: '/accounts', icon: Avatar, roles: ['super_admin', 'boss'] },
  { label: '流量管理', path: '/traffic', icon: Promotion, roles: ['super_admin'] },
  { label: '财务报表', path: '/dashboard', icon: DataAnalysis, roles: ['super_admin'], platformOnly: true },
  { label: '子系统管理', path: '/tenants', icon: Setting, roles: ['super_admin'], platformOnly: true },
]

const menus = computed(() => {
  const role = session.value?.role
  const scopeType = session.value?.scopeType || 'tenant'
  const hideHeadquartersEntries = scopeType !== 'platform' || isPlatformManagingTenant.value
  return allMenus
    .filter((item) => {
      if (item.platformOnly && hideHeadquartersEntries) {
        return false
      }
      return !item.roles || adminSessionRoleAllowed(role, item.roles)
    })
    .map((item) => {
      if (!item.children) return item
      return {
        ...item,
        children: item.children.filter(child => !child.roles || adminSessionRoleAllowed(role, child.roles)),
      }
    })
})

/** 进入订单相关路由时展开子菜单；离开订单模块时重建菜单避免 default-openeds 不响应的问题 */
const sideMenuKey = computed(() =>
  route.path.startsWith('/orders')
    ? 'admin-nav-orders'
    : route.path.startsWith('/products')
      ? 'admin-nav-products'
      : route.path.startsWith('/users')
        ? 'admin-nav-users'
        : 'admin-nav-default',
)

const defaultOpenedSubmenus = computed(() => {
  if (route.path.startsWith('/orders')) {
    return ['sub-/orders']
  }
  if (route.path.startsWith('/products')) {
    return ['sub-/products/mall']
  }
  if (route.path.startsWith('/users')) {
    return ['sub-/users']
  }
  return []
})

function submenuIndex(item: MenuEntry) {
  return `sub-${item.path}`
}

function roleText(role?: AdminSession['role']) {
  if (role === 'super_admin') return '超级管理员'
  if (role === 'boss') return '老板'
  if (role === 'reviewer') return '审核员'
  if (role === 'collector') return '催收员'
  return '访客'
}

function logout() {
  clearAdminSession()
  session.value = null
  void router.replace('/login')
}

function backToPlatformHeadquarters() {
  switchWorkspace('core')
  session.value = getAdminSession()
  void router.push({ name: 'tenants' })
}

watch(
  () => route.fullPath,
  () => {
    session.value = getAdminSession()
  },
  { immediate: true },
)

const csSidebarBadgeEnabled = computed(() => {
  if (isLoginPage.value) {
    return false
  }
  const r = session.value?.role
  return isSuperAdminRole(r) || r === 'reviewer'
})

const ordersSidebarBadgeEnabled = computed(() => {
  if (isLoginPage.value) {
    return false
  }
  const r = session.value?.role
  return isSuperAdminRole(r) || r === 'reviewer' || r === 'collector'
})

/** 订单管理主菜单角标 = 未审核订单 + 已审核订单（与子项角标口径一致） */
const ordersMenuParentBadgeTotal = computed(
  () => ordersMenuPendingReviewTotal.value + ordersMenuReviewedListTotal.value,
)

useAdminCsUnreadBadge(csSidebarBadgeEnabled)
useAdminOrderReviewBadge(ordersSidebarBadgeEnabled)
</script>

<template>
  <RouterView v-if="isLoginPage" />

  <div
    v-else
    class="admin-layout"
  >
    <aside class="admin-sidebar admin-sidebar--dynamic">
      <div
        class="admin-sidebar-bg"
        aria-hidden="true"
      />
      <div class="admin-sidebar-content">
        <div class="admin-logo">
          <MallBrandLogo class="admin-logo-mark" />
          <div class="admin-logo-titles">
            <span class="admin-logo-text">文硕商城</span>
            <span class="admin-logo-sub">
              <template v-if="isPlatformManagingTenant">子系统后台 · {{ managedTenantHeadline }}</template>
              <template v-else>后台管理</template>
            </span>
          </div>
        </div>
        <el-menu
          :key="sideMenuKey"
          class="admin-side-menu"
          :default-active="route.path"
          :default-openeds="defaultOpenedSubmenus"
          router
          background-color="transparent"
          text-color="#e8eef7"
          active-text-color="#fffaf5"
        >
          <template
            v-for="item in menus"
            :key="item.children?.length ? submenuIndex(item) : item.path"
          >
            <el-sub-menu
              v-if="item.children?.length"
              :index="submenuIndex(item)"
            >
              <template #title>
                <span class="admin-sub-menu-title-row">
                  <el-icon class="admin-menu-icon">
                    <component :is="item.icon" />
                  </el-icon>
                  <span class="admin-menu-title">{{ item.label }}</span>
                  <span
                    v-if="item.path === '/orders' && ordersMenuParentBadgeTotal > 0"
                    class="admin-cs-menu-badge"
                  >{{ ordersMenuParentBadgeTotal > 99 ? '99+' : ordersMenuParentBadgeTotal }}</span>
                </span>
              </template>
              <el-menu-item
                v-for="child in item.children"
                :key="child.path"
                :index="child.path"
              >
                <el-icon class="admin-menu-icon admin-menu-icon--child">
                  <component :is="child.icon" />
                </el-icon>
                <span class="admin-menu-child-label-row">
                  <span class="admin-menu-child-label-text">{{ child.label }}</span>
                  <span
                    v-if="child.path === '/orders/review' && ordersMenuPendingReviewTotal > 0"
                    class="admin-cs-menu-badge"
                  >{{ ordersMenuPendingReviewTotal > 99 ? '99+' : ordersMenuPendingReviewTotal }}</span>
                  <span
                    v-if="child.path === '/orders' && ordersMenuReviewedListTotal > 0"
                    class="admin-cs-menu-badge"
                  >{{ ordersMenuReviewedListTotal > 99 ? '99+' : ordersMenuReviewedListTotal }}</span>
                </span>
              </el-menu-item>
            </el-sub-menu>
            <el-menu-item
              v-else
              :index="item.path"
            >
              <el-icon class="admin-menu-icon">
                <component :is="item.icon" />
              </el-icon>
              <span
                class="admin-menu-top-label"
                :class="{ 'admin-menu-top-label--cs': item.path === '/cs-messages' }"
              >
                <span class="admin-menu-top-label-text">{{ item.label }}</span>
                <span
                  v-if="item.path === '/cs-messages' && csMenuUnreadTotal > 0"
                  class="admin-cs-menu-badge"
                >{{ csMenuUnreadTotal > 99 ? '99+' : csMenuUnreadTotal }}</span>
              </span>
            </el-menu-item>
          </template>
        </el-menu>
      </div>
    </aside>

    <main class="admin-main">
      <header class="admin-header">
        <h1>{{ pageTitle }}</h1>
        <div
          v-if="session"
          class="admin-header-right"
        >
          <button
            v-if="isPlatformManagingTenant"
            class="admin-back-hq-btn"
            type="button"
            @click="backToPlatformHeadquarters"
          >
            返回总部
          </button>
          <span
            v-if="isPlatformManagingTenant"
            class="admin-tenant-scope-pill"
            :title="`数据与操作均指向子系统「${managedTenantHeadline}」`"
          >
            当前子系统 · {{ managedTenantHeadline }}
          </span>
          <AdminRoleAvatar
            :role="session.role"
            :size="36"
          />
          <span class="admin-role">
            <template v-if="isPlatformManagingTenant">平台代管（{{ roleText(session.role) }}）</template>
            <template v-else>{{ roleText(session.role) }}</template>
          </span>
          <span class="admin-user">{{ session.username }}</span>
          <el-popconfirm
            width="240"
            title="确定退出登录吗？"
            confirm-button-text="确定"
            cancel-button-text="取消"
            @confirm="logout"
          >
            <template #reference>
              <button
                class="admin-logout-btn"
                type="button"
              >
                退出登录
              </button>
            </template>
          </el-popconfirm>
        </div>
      </header>
      <section class="admin-content">
        <div class="admin-page-root">
          <RouterView />
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.admin-side-menu {
  border-right: none;
  background-color: transparent !important;
}

.admin-side-menu :deep(.el-menu-item) {
  border-radius: 8px;
  margin-bottom: 4px;
}

.admin-side-menu :deep(.el-sub-menu__title) {
  border-radius: 8px;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
}

.admin-side-menu :deep(.el-menu-item:hover),
.admin-side-menu :deep(.el-sub-menu__title:hover) {
  background-color: rgba(255, 255, 255, 0.12) !important;
}

.admin-side-menu :deep(.el-sub-menu__icon-arrow) {
  color: rgba(255, 255, 255, 0.55);
}

.admin-side-menu :deep(.el-menu-item.is-active) {
  background: linear-gradient(
    120deg,
    rgba(37, 99, 235, 0.55) 0%,
    rgba(234, 88, 12, 0.48) 100%
  ) !important;
  box-shadow: 0 4px 18px rgba(37, 99, 235, 0.2);
  color: #fffaf5 !important;
}

.admin-side-menu :deep(.el-sub-menu .el-menu-item) {
  min-width: auto;
  padding-left: 40px !important;
}

.admin-side-menu :deep(.el-sub-menu .el-menu-item.is-active) {
  background: linear-gradient(
    120deg,
    rgba(37, 99, 235, 0.38) 0%,
    rgba(234, 88, 12, 0.32) 100%
  ) !important;
}

.admin-menu-icon {
  margin-right: 10px;
  font-size: 18px;
  vertical-align: middle;
}

.admin-menu-icon--child {
  font-size: 16px;
}

.admin-menu-title {
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.admin-sub-menu-title-row {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.admin-menu-top-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.admin-menu-top-label--cs {
  flex: 1;
  justify-content: space-between;
}

.admin-menu-top-label-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.admin-menu-child-label-row {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.admin-menu-child-label-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.admin-cs-menu-badge {
  flex-shrink: 0;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: #ef4444;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}

</style>

<style>
/* 侧栏动态背景与顶栏头像（全局类名，与 style.css 中的 .admin-sidebar 配合） */
.admin-sidebar.admin-sidebar--dynamic {
  position: relative;
  overflow: hidden;
  background: linear-gradient(155deg, #1a1530 0%, #0f172a 44%, #1c1917 100%);
  box-shadow:
    inset -1px 0 0 rgba(255, 255, 255, 0.07),
    6px 0 28px rgba(15, 23, 42, 0.18);
}

.admin-sidebar--dynamic .admin-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px 14px;
}

.admin-logo-titles {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  flex: 1;
  line-height: 1.2;
}

.admin-logo-mark {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  filter: drop-shadow(0 0 10px rgba(56, 189, 248, 0.32));
}

.admin-sidebar--dynamic .admin-logo-text {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #faf6f2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow:
    0 0 20px rgba(96, 165, 250, 0.35),
    0 1px 8px rgba(0, 0, 0, 0.4);
}

.admin-logo-sub {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  color: rgba(232, 238, 247, 0.72);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.admin-sidebar-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.admin-sidebar-bg::before,
.admin-sidebar-bg::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  filter: blur(56px);
  opacity: 0.92;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
  animation-direction: alternate;
}

.admin-sidebar-bg::before {
  width: 150%;
  height: 95%;
  left: -40%;
  top: -28%;
  background:
    radial-gradient(ellipse 80% 70% at 28% 38%, rgba(251, 146, 60, 0.48) 0%, transparent 58%),
    radial-gradient(ellipse 70% 60% at 72% 28%, rgba(59, 130, 246, 0.52) 0%, transparent 55%);
  animation: admin-sidebar-aurora-a 16s infinite;
}

.admin-sidebar-bg::after {
  width: 130%;
  height: 110%;
  right: -45%;
  bottom: -38%;
  background:
    radial-gradient(ellipse 75% 65% at 55% 62%, rgba(139, 92, 246, 0.38) 0%, transparent 58%),
    radial-gradient(ellipse 60% 50% at 35% 72%, rgba(234, 88, 12, 0.3) 0%, transparent 48%);
  animation: admin-sidebar-aurora-b 20s infinite;
  opacity: 0.8;
}

@keyframes admin-sidebar-aurora-a {
  0% {
    transform: translate(0, 0) scale(1);
  }
  100% {
    transform: translate(9%, 7%) scale(1.06);
  }
}

@keyframes admin-sidebar-aurora-b {
  0% {
    transform: translate(0, 0) scale(1.04);
  }
  100% {
    transform: translate(-7%, -6%) scale(1);
  }
}

.admin-sidebar-content {
  position: relative;
  z-index: 1;
}

@media (prefers-reduced-motion: reduce) {
  .admin-sidebar-bg::before,
  .admin-sidebar-bg::after {
    animation: none;
  }
}
</style>
