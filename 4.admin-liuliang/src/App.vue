<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import zhCn from 'element-plus/es/locale/lang/zh-cn'

const route = useRoute()
const isLogin = computed(() => route.name === 'login')
</script>

<template>
  <el-config-provider :locale="zhCn">
    <div
      class="app-root"
      :class="{ 'app-root--login': isLogin }"
    >
      <router-view />
    </div>
  </el-config-provider>
</template>

<style scoped>
.app-root {
  min-height: 100vh;
}

.app-root--login {
  min-height: 100vh;
}
</style>
