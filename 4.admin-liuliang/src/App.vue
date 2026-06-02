<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const isLogin = computed(() => route.name === 'login')
</script>

<template>
  <div
    class="app-root"
    :class="{ 'app-root--login': isLogin }"
  >
    <router-view />
  </div>
</template>

<style scoped>
.app-root {
  min-height: 100vh;
}

.app-root--login {
  min-height: 100vh;
}
</style>
