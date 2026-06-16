<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

onMounted(() => {
  void router.replace({
    path: '/login',
    query: {
      ...route.query,
      trafficLogin: '1',
    },
  })
})
</script>

<template>
  <div />
</template>
