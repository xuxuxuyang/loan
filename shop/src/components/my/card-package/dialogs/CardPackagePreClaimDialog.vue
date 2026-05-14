<script setup lang="ts">
import type { MallCardPackageDTO } from '~/api/modules/mall'

defineProps<{
  visible: boolean
  compact?: boolean
  activeItem: MallCardPackageDTO | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  cancel: []
  goSign: []
  closed: []
}>()
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="领取现金礼"
    :width="compact ? 'min(92vw, 320px)' : '360px'"
    align-center
    append-to-body
    :close-on-click-modal="false"
    class="card-package-pre-claim-dialog"
    @update:model-value="emit('update:visible', $event)"
    @closed="emit('closed')"
  >
    <div
      v-if="activeItem"
      class="space-y-2 text-sm leading-relaxed text-black/80"
    >
      <p>
        领取现金礼前需先签署电子合同。
      </p>
      <p class="text-xs text-black/50">
        订单：<span class="font-medium text-black/75">{{ activeItem.title }}</span>
        （{{ activeItem.orderId }}）
      </p>
    </div>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <el-button @click="emit('cancel')">
          取消
        </el-button>
        <el-button
          type="primary"
          class="!bg-gradient-to-r !from-[#0b7b6e] !to-[#18a08f] !border-0"
          @click="emit('goSign')"
        >
          去签署
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>
