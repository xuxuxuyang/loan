<script setup lang="ts">
import type { Component } from 'vue'
import { computed, onMounted, ref, watch } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import {
  Avatar,
  Calendar,
  ChatDotRound,
  CircleCheck,
  Close,
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
import LoginFortuneRain from './components/auth/LoginFortuneRain.vue'
import MallBrandLogo from './components/MallBrandLogo.vue'
import { adminSessionRoleAllowed, clearAdminSession, getAdminSession, isPlatformManagingTenantWorkspace, isSuperAdminRole, type AdminSession } from './composables/useAdminAuth'
import { useTenantScope } from './composables/useTenantScope'
import { csMenuUnreadTotal, useAdminCsUnreadBadge } from './composables/useAdminCsUnreadBadge'
import {
  ordersMenuPendingReviewTotal,
  ordersMenuReviewedListTotal,
  useAdminOrderReviewBadge,
} from './composables/useAdminOrderReviewBadge'
import {
  adminVisitedTags,
  clearAdminVisitedTags,
  removeAdminVisitedTag,
  syncAdminVisitedTag,
} from './composables/useAdminVisitedTags'
import { syncAdminSessionDisplayName } from './composables/useAdminApi'
import { adminHomeRoute } from './router'

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
  /** true：仅超级管理员可见；主系统老板账号不再继承 super_admin 侧栏项 */
  strictSuperAdminOnly?: boolean
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
  /** 与各租户 mall 请求头一致，展示当前工作区订单汇总；非「仅总部」项以便子系统老板可见 */
  { label: '财务报表', path: '/dashboard', icon: DataAnalysis, roles: ['super_admin'] },
  {
    label: '子系统管理',
    path: '/tenants',
    icon: Setting,
    roles: ['super_admin'],
    strictSuperAdminOnly: true,
    platformOnly: true,
    children: [
      { label: '系统与账号', path: '/tenants', icon: Setting },
      { label: '子系统数据', path: '/tenants/mall-users-data', icon: DataBoard },
    ],
  },
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
      return !item.roles || adminSessionRoleAllowed(role, item.roles, {
        inheritBossAsSuperAdmin: !item.strictSuperAdminOnly,
      })
    })
    .map((item) => {
      if (!item.children) return item
      return {
        ...item,
        children: item.children.filter((child) => {
          if (!child.roles) return true
          return adminSessionRoleAllowed(role, child.roles, {
            inheritBossAsSuperAdmin: !item.strictSuperAdminOnly,
          })
        }),
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
        : route.path.startsWith('/tenants')
          ? 'admin-nav-tenants'
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
  if (route.path.startsWith('/tenants')) {
    return ['sub-/tenants']
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
  clearAdminVisitedTags()
  session.value = null
  void router.replace('/login')
}

function onVisitedTagClick(fullPath: string) {
  if (fullPath === route.fullPath) {
    return
  }
  void router.push(fullPath)
}

function onVisitedTagClose(fullPath: string) {
  const next = removeAdminVisitedTag(router, fullPath, route.fullPath)
  if (next) {
    void router.push(next)
  }
}

function backToPlatformHeadquarters() {
  switchWorkspace('core')
  session.value = getAdminSession()
  void router.push(adminHomeRoute(session.value))
}

watch(
  () => route.fullPath,
  () => {
    session.value = getAdminSession()
    if (!isLoginPage.value) {
      syncAdminVisitedTag(router, route)
    }
  },
  { immediate: true },
)

watch(isLoginPage, (login) => {
  if (login) {
    clearAdminVisitedTags()
  }
})

onMounted(() => {
  if (isLoginPage.value || !session.value || String(session.value.name || '').trim()) {
    return
  }
  void syncAdminSessionDisplayName().then((updated) => {
    if (updated) {
      session.value = getAdminSession()
    }
  })
})

const csSidebarBadgeEnabled = computed(() => {
  if (isLoginPage.value) {
    return false
  }
  const r = session.value?.role
  return isSuperAdminRole(r) || r === 'reviewer'
})

/** 订单侧栏角标：登录即可轮询，不按角色开关（与菜单权限分离） */
const ordersSidebarBadgeEnabled = computed(() => {
  if (isLoginPage.value) {
    return false
  }
  return Boolean(session.value?.token)
})

/** 订单管理主菜单角标 = 未审核订单 + 已审核订单（与子项角标口径一致） */
const ordersMenuParentBadgeTotal = computed(
  () => ordersMenuPendingReviewTotal.value + ordersMenuReviewedListTotal.value,
)

useAdminCsUnreadBadge(csSidebarBadgeEnabled)
useAdminOrderReviewBadge(ordersSidebarBadgeEnabled)
</script>

<template>
  <el-config-provider :locale="zhCn">
    <RouterView v-if="isLoginPage" />

    <div
      v-else
      class="admin-layout"
    >
      <aside class="admin-sidebar admin-sidebar--dynamic">
        <div
          class="admin-sidebar-bg"
          aria-hidden="true"
        >
          <div class="admin-sidebar-bg__base" />
          <LoginFortuneRain variant="sidebar" />
          <div class="admin-sidebar-bg__veil" />
        </div>
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
            text-color="#fde68a"
            active-text-color="#fffbeb"
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
              <template v-if="isPlatformManagingTenant">数据总览（{{ roleText(session.role) }}）</template>
              <template v-else>{{ roleText(session.role) }}</template>
            </span>
            <span class="admin-user">{{ session.name?.trim() || session.username }}</span>
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
        <div
          class="admin-visited-tags-bar"
          aria-label="已打开页面"
        >
          <div class="admin-visited-tags-scroll">
            <button
              v-for="tag in adminVisitedTags"
              :key="tag.fullPath"
              type="button"
              class="admin-tag"
              :class="{ 'admin-tag--active': tag.fullPath === route.fullPath }"
              @click="onVisitedTagClick(tag.fullPath)"
            >
              <span
                v-if="tag.fullPath === route.fullPath"
                class="admin-tag-dot"
                aria-hidden="true"
              />
              <span class="admin-tag-title">{{ tag.title }}</span>
              <span
                v-if="!tag.affix"
                class="admin-tag-close"
                role="button"
                tabindex="-1"
                title="关闭"
                aria-label="关闭标签"
                @click.stop="onVisitedTagClose(tag.fullPath)"
              >
                <el-icon class="admin-tag-close-icon"><Close /></el-icon>
              </span>
            </button>
          </div>
        </div>
        <section class="admin-content">
          <div class="admin-page-root">
            <RouterView />
          </div>
        </section>
      </main>
    </div>
  </el-config-provider>
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

.admin-side-menu :deep(.el-menu-item),
.admin-side-menu :deep(.el-sub-menu__title) {
  color: rgba(254, 243, 199, 0.88) !important;
}

.admin-side-menu :deep(.el-menu-item:hover),
.admin-side-menu :deep(.el-sub-menu__title:hover) {
  background: rgba(69, 10, 10, 0.42) !important;
  color: #fffbeb !important;
}

.admin-side-menu :deep(.el-sub-menu__icon-arrow) {
  color: rgba(253, 230, 138, 0.55);
}

.admin-side-menu :deep(.el-menu-item.is-active) {
  background: linear-gradient(
    90deg,
    rgba(127, 29, 29, 0.75) 0%,
    rgba(120, 53, 15, 0.55) 100%
  ) !important;
  box-shadow:
    inset 3px 0 0 #fbbf24,
    0 4px 14px rgba(0, 0, 0, 0.2);
  color: #fffbeb !important;
}

.admin-side-menu :deep(.el-sub-menu .el-menu-item) {
  min-width: auto;
  padding-left: 40px !important;
}

.admin-side-menu :deep(.el-sub-menu .el-menu-item.is-active) {
  background: linear-gradient(
    90deg,
    rgba(127, 29, 29, 0.6) 0%,
    rgba(120, 53, 15, 0.4) 100%
  ) !important;
  box-shadow: inset 3px 0 0 #fbbf24;
}

.admin-menu-icon {
  margin-right: 10px;
  font-size: 18px;
  vertical-align: middle;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: inline-grid;
  place-items: center;
  border-radius: 8px;
  color: #fef3c7;
  background: rgba(69, 10, 10, 0.5);
  box-shadow:
    inset 0 0 0 1px rgba(251, 191, 36, 0.2),
    0 2px 6px rgba(0, 0, 0, 0.15);
}

.admin-side-menu :deep(.el-icon) {
  --el-icon-color: currentColor;
}

.admin-side-menu :deep(.el-menu-item.is-active) .admin-menu-icon,
.admin-side-menu :deep(.el-sub-menu .el-menu-item.is-active) .admin-menu-icon {
  color: #fffbeb;
  background: linear-gradient(145deg, rgba(217, 119, 6, 0.55), rgba(180, 83, 9, 0.45));
  box-shadow:
    inset 0 0 0 1px rgba(253, 224, 71, 0.35),
    0 0 10px rgba(251, 191, 36, 0.2);
}

.admin-side-menu :deep(.el-menu-item:hover) .admin-menu-icon,
.admin-side-menu :deep(.el-sub-menu__title:hover) .admin-menu-icon {
  color: #fde68a;
  background: rgba(127, 29, 29, 0.55);
}

.admin-menu-icon--child {
  width: 24px;
  height: 24px;
  font-size: 15px;
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
  background: #3f0a0a;
  box-shadow:
    inset -1px 0 0 rgba(251, 191, 36, 0.15),
    4px 0 24px rgba(69, 10, 10, 0.28);
}

.admin-sidebar--dynamic .admin-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px 14px;
  margin-bottom: 6px;
  border-bottom: 1px solid rgba(251, 191, 36, 0.14);
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
  filter: drop-shadow(0 0 10px rgba(251, 191, 36, 0.35));
}

.admin-sidebar--dynamic .admin-logo-text {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #fffbeb;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow: 0 1px 8px rgba(69, 10, 10, 0.45);
}

.admin-logo-sub {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  color: rgba(253, 230, 138, 0.72);
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

/* 与登录页一致的深红天光底 */
.admin-sidebar-bg__base {
  position: absolute;
  inset: 0;
  z-index: 0;
  background:
    radial-gradient(ellipse 70% 55% at 50% -8%, rgba(253, 224, 71, 0.18), transparent 62%),
    radial-gradient(ellipse 90% 70% at 50% 100%, rgba(69, 10, 10, 0.75), transparent 58%),
    linear-gradient(180deg, #3f0a0a 0%, #7f1d1d 42%, #991b1b 68%, #450a0a 100%);
}

/* 半透明遮罩：保留财宝雨氛围，又保证菜单可读 */
.admin-sidebar-bg__veil {
  position: absolute;
  inset: 0;
  z-index: 3;
  background:
    linear-gradient(
      180deg,
      rgba(24, 6, 6, 0.35) 0%,
      rgba(69, 10, 10, 0.52) 45%,
      rgba(24, 6, 6, 0.62) 100%
    );
  pointer-events: none;
}

.admin-sidebar-content {
  position: relative;
  z-index: 5;
}

@media (prefers-reduced-motion: reduce) {
  .admin-sidebar-bg__base,
  .admin-sidebar-bg__veil {
    animation: none;
  }
}
</style>
