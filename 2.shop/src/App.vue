<script setup lang="ts">
import TrafficCreditLeadDialog from '~/components/traffic/TrafficCreditLeadDialog.vue'
import { isIosBnplReviewHidden } from '~/utils/iosBnplReviewVisibility'

const hideIosBnplForReview = isIosBnplReviewHidden()
</script>

<template>
  <RouterView />
  <!-- App Store 审核期仅在原生 iOS 隐藏；原弹窗继续服务 H5/Android。 -->
  <TrafficCreditLeadDialog v-if="!hideIosBnplForReview" />
</template>
