<script setup lang="ts">
const route = useRoute()
const { getHref } = useCustomRouting()

const tabItems = [
  { label: '首页', path: '/', routeName: 'index', icon: '🏠' },
  { label: '商品', path: '/list', routeName: 'list', icon: '🛍️' },
  { label: '我的', path: '/my', routeName: 'my', icon: '👤' },
]
</script>

<template>
  <nav class="fixed bottom-0 left-0 right-0 z-[1200] border-t border-black/10 bg-white/95 backdrop-blur">
    <div class="mx-auto flex h-16 w-full max-w-[520px] items-center justify-around px-4">
      <NuxtLink
        v-for="item in tabItems"
        :key="item.path"
        :to="getHref(item.path)"
        class="flex min-w-20 flex-col items-center justify-center gap-1 text-xs transition"
        :class="route.name === item.routeName ? 'text-[var(--theme-color)] font-semibold' : 'text-black/60 hover:text-black/85'"
      >
        <span class="text-base leading-none">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
      </NuxtLink>
    </div>
  </nav>
</template>
