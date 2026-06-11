<script setup lang="ts">
import { MALL_RUNTIME_CONFIG } from '~/config/mallRuntime'

const icpText = MALL_RUNTIME_CONFIG.icpText
const icpLink = MALL_RUNTIME_CONFIG.icpLink
</script>

<template>
  <footer
    v-if="icpText"
    class="px-4 py-4 text-center text-xs text-black/45"
  >
    <a
      :href="icpLink"
      target="_blank"
      rel="noopener noreferrer"
      class="inline-block transition hover:text-black/65"
    >
      {{ icpText }}
    </a>
  </footer>
</template>
