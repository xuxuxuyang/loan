<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useAdSystem } from '@/composables/useAdSystem'
import { useAdTracking } from '@/composables/useAdTracking'

// 获取根元素引用
const rootElement = ref()

// 初始化广告系统
const { initAdSystem, cleanupAdSystem } = useAdSystem(rootElement)
const { initAdTracking, cleanupAdTracking } = useAdTracking()

onMounted(() => {
  // 等待 DOM 渲染完成
  if (rootElement.value) {
    initAdSystem(rootElement.value)
    initAdTracking()
  }
})

onBeforeUnmount(() => {
  cleanupAdSystem()
  cleanupAdTracking()
})
</script>

<template>
  <div ref="rootElement">
    <div class="default-layout">
      <AppHeader />
      <main class="app-main">
        <slot />
      </main>
      <AppFooter />
    </div>
  </div>
</template>

<style lang="scss" scoped>
</style>
