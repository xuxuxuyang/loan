<script setup lang="ts">
import { computed } from 'vue'
import type { MallCardPackageDTO } from '~/api/modules/mall'
import { MALL_KEFU_DISPLAY_NAME } from '~/constants/mallKefuQr'

defineProps<{
  visible: boolean
  compact?: boolean
  activeItem: MallCardPackageDTO | null
  kefuQrUrl: string
  amountText: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  close: []
}>()

const isWeChatBrowser = computed(() => {
  if (typeof navigator === 'undefined') {
    return false
  }
  return /MicroMessenger/i.test(navigator.userAgent)
})

const claimTipText = computed(() => (
  isWeChatBrowser.value
    ? '您正在微信内打开，长按下方二维码识别，即可添加企业微信客服。'
    : '当前为浏览器打开，请先截图保存下方二维码，再打开微信「扫一扫」，从相册选择该截图添加客服。'
))
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="联系客服领取卡包"
    :width="compact ? 'min(92vw, 360px)' : '360px'"
    destroy-on-close
    align-center
    class="card-package-claim-dialog"
    @update:model-value="emit('update:visible', $event)"
    @closed="emit('close')"
  >
    <div
      v-if="activeItem"
      class="space-y-3 text-black/75"
    >
      <p class="text-sm leading-relaxed">
        订单 <span class="font-medium text-black/85">{{ activeItem.title }}</span>
        （{{ activeItem.orderId }}）现金礼 ¥{{ amountText }}，请使用微信扫描下方二维码，添加企业微信客服为您办理领取。
      </p>
      <div
        class="rounded-lg border border-amber-200/90 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-950"
        role="note"
      >
        <span class="font-medium">温馨提示：</span>{{ claimTipText }}
      </div>
      <div class="card-package-claim-qr-wrap overflow-hidden rounded-xl bg-[#0b7bff] shadow-inner ring-1 ring-black/[0.06]">
        <img
          :src="kefuQrUrl"
          alt="Customer service QR code"
          class="card-package-claim-qr-img mx-auto block w-full max-w-[min(100%,280px)] object-contain"
          loading="lazy"
          decoding="async"
        >
      </div>
      <p class="text-center text-xs text-black/45">
        {{ MALL_KEFU_DISPLAY_NAME }}
      </p>
    </div>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <el-button
          type="primary"
          @click="emit('close')"
        >
          我知道了
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>
