<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const pageTitle = computed(() => String(route.meta.title || '后台管理'))

const menus = [
  { label: '用户管理', path: '/users' },
  {
    label: '订单管理',
    path: '/orders',
    children: [
      { label: '订单管理', path: '/orders' },
      { label: '审核订单', path: '/orders/review' },
    ],
  },
  { label: '数据大盘', path: '/' },
]
</script>

<template>
  <div class="admin-layout">
    <aside class="admin-sidebar">
      <div class="admin-logo">
        琥珀商城
      </div>
      <nav class="admin-nav">
        <template
          v-for="item in menus"
          :key="item.path"
        >
          <RouterLink
            :to="item.path"
            class="admin-nav-item"
          >
            {{ item.label }}
          </RouterLink>
          <div
            v-if="item.children?.length"
            class="admin-sub-nav"
          >
            <RouterLink
              v-for="child in item.children"
              :key="child.path"
              :to="child.path"
              class="admin-sub-nav-item"
            >
              {{ child.label }}
            </RouterLink>
          </div>
        </template>
      </nav>
    </aside>

    <main class="admin-main">
      <header class="admin-header">
        <h1>{{ pageTitle }}</h1>
      </header>
      <section class="admin-content">
        <RouterView />
      </section>
    </main>
  </div>
</template>
