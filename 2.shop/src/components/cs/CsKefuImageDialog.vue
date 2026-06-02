<script setup lang="ts">
import { computed } from 'vue'
import { MALL_KEFU_QR_URL } from '~/constants/mallKefuQr'

defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const isWeChatBrowser = computed(() => {
  if (typeof navigator === 'undefined') {
    return false
  }
  return /MicroMessenger/i.test(navigator.userAgent)
})

/** 与领取卡包弹窗 CardPackageClaimDialog 相同的扫码提示 */
const tipText = computed(() => (
  isWeChatBrowser.value
    ? '您正在微信内打开，长按下方二维码识别，即可添加企业微信客服。'
    : '当前为浏览器打开，请先截图保存下方二维码，再打开微信「扫一扫」，从相册选择该截图添加客服。'
))

function close() {
  emit('update:visible', false)
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="联系客服"
    width="min(92vw, 360px)"
    destroy-on-close
    align-center
    append-to-body
    class="cs-kefu-image-dialog"
    @update:model-value="emit('update:visible', $event)"
    @closed="close"
  >
    <div class="space-y-3 text-black/75">
      <p class="text-sm leading-relaxed">
        请使用微信扫描下方二维码，添加企业微信客服为您办理咨询。
      </p>
      <div
        class="rounded-lg border border-amber-200/90 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-950"
        role="note"
      >
        <span class="font-medium">温馨提示：</span>{{ tipText }}
      </div>
      <!-- 与领取卡包 CardPackageClaimDialog 同款二维码图 -->
      <div class="card-package-claim-qr-wrap overflow-hidden rounded-xl bg-[#0b7bff] shadow-inner ring-1 ring-black/[0.06]">
        <img
          :src="MALL_KEFU_QR_URL"
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
          @click="close"
        >
          我知道了
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>
