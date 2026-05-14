<script setup lang="ts">
import type { MallCardPackageDTO } from '~/api/modules/mall'

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
      <div class="card-package-claim-qr-wrap overflow-hidden rounded-xl bg-[#0b7bff] shadow-inner ring-1 ring-black/[0.06]">
        <img
          :src="kefuQrUrl"
          alt="请使用微信扫描图中二维码，添加荷花客服企业微信，联系办理现金礼领取"
          class="card-package-claim-qr-img mx-auto block w-full max-w-[min(100%,280px)] object-contain"
          loading="lazy"
          decoding="async"
        >
      </div>
      <p class="text-center text-xs text-black/45">
        荷花客服 · 海曙文硕贸易
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
