<script setup lang="ts">
import type { MallCardPackageDTO } from '~/api/modules/mall'

defineProps<{
  compact?: boolean
  activeItem: MallCardPackageDTO | null
  contractDialogVisible: boolean
  contractSignFrameVisible: boolean
  contractShowsSigned: boolean
  contractData: Record<string, unknown> | null
  contractLoading: boolean
  contractError: string
  showContractUpstreamHint: boolean
  contractBinaryStatusLabel: string
  contractFrameMode: 'sign' | 'view'
  contractEmbedUrl: string
  contractIframeKey: number
}>()

const emit = defineEmits<{
  'update:contractDialogVisible': [value: boolean]
  'update:contractSignFrameVisible': [value: boolean]
  contractDialogClosed: []
  openContractViewDialog: []
  openClaimKefuFromContract: []
  closeContractSignDialog: []
}>()
</script>

<template>
  <el-dialog
    :model-value="contractDialogVisible"
    :title="contractShowsSigned ? '电子合同' : '合同信息'"
    :width="compact ? '94%' : '440px'"
    destroy-on-close
    align-center
    class="card-package-contract-dialog"
    :close-on-click-modal="true"
    @update:model-value="emit('update:contractDialogVisible', $event)"
    @closed="emit('contractDialogClosed')"
  >
    <div
      v-if="activeItem"
      class="space-y-3 text-black/80"
    >
      <p
        v-if="contractShowsSigned && contractData && !contractLoading && !contractError"
        class="text-sm text-black/55"
      >
        订单 <span class="font-medium text-black/85">{{ activeItem.title }}</span>
        （{{ activeItem.orderId }}）电子合同已签署。可查看合同；领取现金礼请联系客服。
      </p>
      <p
        v-else-if="contractError"
        class="text-sm text-black/55"
      >
        订单 <span class="font-medium text-black/85">{{ activeItem.title }}</span>
        （{{ activeItem.orderId }}）合同信息获取异常，请稍后重试或联系客服。
      </p>

      <div
        v-if="contractLoading"
        class="py-8 text-center text-sm text-black/45"
      >
        正在准备合同…
      </div>
      <div
        v-else-if="contractError"
        class="rounded-xl border border-amber-200/80 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
      >
        <p class="whitespace-pre-wrap">
          {{ contractError }}
        </p>
        <p
          v-if="showContractUpstreamHint"
          class="mt-2 border-t border-amber-200/60 pt-2 text-xs leading-relaxed text-amber-950/75"
        >
          常见处理：在签约开放平台完成「添加个人用户」(addPersonalUser)，将人脸/实名认证返回的 serialNo 通过管理端写入该用户的 signAuthSerialNo；联调可临时配置 API 环境变量 MALL_CARD_PACKAGE_SIGN_AUTH_SERIAL。
        </p>
      </div>
      <div
        v-else-if="contractData && contractShowsSigned"
        class="card-contract-card space-y-3 rounded-2xl border border-black/[0.08] bg-gradient-to-b from-white to-[#f8fafc] p-4 shadow-sm"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="text-xs text-black/45">
              合同名称
            </p>
            <p class="mt-0.5 text-sm font-semibold leading-snug text-black/85">
              {{ String(contractData.contractName || contractData.contract_name || activeItem.title) }}
            </p>
          </div>
          <span class="shrink-0 rounded-full bg-[#ecfdf5] px-2.5 py-1 text-xs font-medium text-[#047857]">
            {{ contractBinaryStatusLabel }}
          </span>
        </div>
      </div>
    </div>
    <template #footer>
      <div
        v-if="contractShowsSigned && contractData && !contractLoading && !contractError"
        class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end"
      >
        <el-button
          type="primary"
          plain
          class="!border-[#0b7b6e] !text-[#0b7b6e]"
          @click="emit('openContractViewDialog')"
        >
          查看合同
        </el-button>
        <el-button
          type="primary"
          class="!bg-gradient-to-r !from-[#0b7b6e] !to-[#18a08f] !border-0"
          @click="emit('openClaimKefuFromContract')"
        >
          领取
        </el-button>
      </div>
      <div
        v-else
        class="flex flex-wrap justify-end gap-2"
      >
        <el-button @click="emit('update:contractDialogVisible', false)">
          关闭
        </el-button>
      </div>
    </template>
  </el-dialog>

  <el-dialog
    :model-value="contractSignFrameVisible"
    :title="contractFrameMode === 'view' ? '查看合同' : '阅读并签署合同'"
    :width="compact ? '96vw' : 'min(720px, 96vw)'"
    append-to-body
    align-center
    :close-on-click-modal="false"
    class="card-package-contract-sign-frame-dialog"
    @update:model-value="emit('update:contractSignFrameVisible', $event)"
  >
    <p
      v-if="activeItem"
      class="mb-2 text-xs leading-relaxed text-black/50"
    >
      <template v-if="contractFrameMode === 'view'">
        订单 {{ activeItem.orderId }} · 以下为合同原文（含签署记录）。
      </template>
      <template v-else>
        订单 {{ activeItem.orderId }} · 请在内嵌合同页阅读条款，在签名区按<strong>浅色姓名笔画</strong>描摹书写后点击「提交签署」。若打开的是第三方签约页，请按其页面完成签署。
      </template>
    </p>
    <div
      v-if="contractEmbedUrl && activeItem"
      class="overflow-hidden rounded-lg border border-black/[0.08] bg-white"
    >
      <iframe
        :key="`${activeItem.orderId}-${contractIframeKey}`"
        title="电子合同"
        class="h-[min(72vh,560px)] w-full border-0 bg-white"
        :src="contractEmbedUrl"
      />
    </div>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <el-button
          type="primary"
          plain
          class="!border-[#0b7b6e] !text-[#0b7b6e]"
          @click="emit('closeContractSignDialog')"
        >
          返回
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.card-package-contract-dialog:deep(.el-dialog),
.card-package-contract-sign-frame-dialog:deep(.el-dialog) {
  border-radius: 16px;
}

.card-package-contract-sign-frame-dialog:deep(.el-dialog__body) {
  padding-top: 8px;
}
</style>
