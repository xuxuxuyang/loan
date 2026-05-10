<script setup lang="ts">
import type { Component } from 'vue'
import { computed, ref, watch } from 'vue'
import {
  Avatar,
  CircleCheck,
  DataAnalysis,
  Goods,
  List,
  Tickets,
  User,
} from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import { clearAdminSession, getAdminSession, type AdminSession } from './composables/useAdminAuth'

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
  icon: Component
  children?: MenuChild[]
}

const route = useRoute()
const router = useRouter()
const pageTitle = computed(() => String(route.meta.title || '后台管理'))
const session = ref<AdminSession | null>(getAdminSession())
const isLoginPage = computed(() => route.name === 'login')

const allMenus: MenuEntry[] = [
  { label: '用户管理', path: '/users', icon: User, roles: ['super_admin', 'reviewer', 'customer_service'] },
  { label: '账号管理', path: '/accounts', icon: Avatar, roles: ['super_admin'] },
  {
    label: '产品管理',
    path: '/products/mall',
    icon: Goods,
    roles: ['super_admin'],
    children: [
      { label: '商城产品', path: '/products/mall', icon: Goods },
      { label: '分期产品', path: '/products/installment', icon: Goods },
    ],
  },
  {
    label: '订单管理',
    path: '/orders',
    icon: Tickets,
    roles: ['super_admin', 'reviewer', 'customer_service'],
    children: [
      {
        label: '已审核订单',
        path: '/orders',
        icon: List,
        roles: ['super_admin', 'reviewer', 'customer_service'],
      },
      { label: '未审核订单', path: '/orders/review', icon: CircleCheck, roles: ['super_admin', 'reviewer'] },
    ],
  },
  { label: '数据大盘', path: '/', icon: DataAnalysis, roles: ['super_admin', 'reviewer', 'customer_service'] },
]

const menus = computed(() => {
  const role = session.value?.role
  return allMenus
    .filter(item => !item.roles || (role && item.roles.includes(role)))
    .map((item) => {
      if (!item.children) return item
      return {
        ...item,
        children: item.children.filter(child => !child.roles || (role && child.roles.includes(role))),
      }
    })
})

/** 进入订单相关路由时展开子菜单；离开订单模块时重建菜单避免 default-openeds 不响应的问题 */
const sideMenuKey = computed(() =>
  route.path.startsWith('/orders')
    ? 'admin-nav-orders'
    : route.path.startsWith('/products')
      ? 'admin-nav-products'
      : 'admin-nav-default',
)

const defaultOpenedSubmenus = computed(() => {
  if (route.path.startsWith('/orders')) {
    return ['sub-/orders']
  }
  if (route.path.startsWith('/products')) {
    return ['sub-/products/mall']
  }
  return []
})

function submenuIndex(item: MenuEntry) {
  return `sub-${item.path}`
}

function roleText(role?: AdminSession['role']) {
  if (role === 'super_admin') return '超级管理员'
  if (role === 'reviewer') return '审核员'
  if (role === 'customer_service') return '客服'
  return '访客'
}

function logout() {
  clearAdminSession()
  session.value = null
  void router.replace('/login')
}

watch(
  () => route.fullPath,
  () => {
    session.value = getAdminSession()
  },
  { immediate: true },
)
</script>

<template>
  <RouterView v-if="isLoginPage" />

  <div
    v-else
    class="admin-layout"
  >
    <aside class="admin-sidebar">
      <div class="admin-logo">
        琥珀商城
      </div>
      <el-menu
        :key="sideMenuKey"
        class="admin-side-menu"
        :default-active="route.path"
        :default-openeds="defaultOpenedSubmenus"
        router
        background-color="transparent"
        text-color="#ebe4dc"
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
              <el-icon class="admin-menu-icon">
                <component :is="item.icon" />
              </el-icon>
              <span class="admin-menu-title">{{ item.label }}</span>
            </template>
            <el-menu-item
              v-for="child in item.children"
              :key="child.path"
              :index="child.path"
            >
              <el-icon class="admin-menu-icon admin-menu-icon--child">
                <component :is="child.icon" />
              </el-icon>
              <span>{{ child.label }}</span>
            </el-menu-item>
          </el-sub-menu>
          <el-menu-item
            v-else
            :index="item.path"
          >
            <el-icon class="admin-menu-icon">
              <component :is="item.icon" />
            </el-icon>
            <span>{{ item.label }}</span>
          </el-menu-item>
        </template>
      </el-menu>
    </aside>

    <main class="admin-main">
      <header class="admin-header">
        <h1>{{ pageTitle }}</h1>
        <div
          v-if="session"
          class="admin-header-right"
        >
          <span class="admin-role">{{ roleText(session.role) }}</span>
          <span class="admin-user">{{ session.username }}</span>
          <button
            class="admin-logout-btn"
            type="button"
            @click="logout"
          >
            退出登录
          </button>
        </div>
      </header>
      <section class="admin-content">
        <RouterView />
      </section>
    </main>
  </div>
</template>

<style scoped>
.admin-side-menu {
  border-right: none;
  background-color: transparent !important;
}

.admin-side-menu :deep(.el-menu-item),
.admin-side-menu :deep(.el-sub-menu__title) {
  border-radius: 8px;
  margin-bottom: 4px;
}

.admin-side-menu :deep(.el-menu-item:hover),
.admin-side-menu :deep(.el-sub-menu__title:hover) {
  background-color: rgba(255, 248, 240, 0.1) !important;
}

.admin-side-menu :deep(.el-sub-menu__icon-arrow) {
  color: #cfc4b8;
}

.admin-side-menu :deep(.el-menu-item.is-active) {
  background-color: rgba(158, 118, 88, 0.92) !important;
  color: #fffaf5 !important;
}

.admin-side-menu :deep(.el-sub-menu .el-menu-item) {
  min-width: auto;
  padding-left: 40px !important;
}

.admin-side-menu :deep(.el-sub-menu .el-menu-item.is-active) {
  background-color: rgba(212, 181, 152, 0.42) !important;
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
}
</style>
