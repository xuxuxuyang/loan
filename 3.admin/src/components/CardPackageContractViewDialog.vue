<script setup lang="ts">
defineProps<{
  modelValue: boolean
  orderId: string
  embedUrl: string
  loading: boolean
  error: string
  iframeKey: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="查看合同"
    width="min(720px, 96vw)"
    append-to-body
    align-center
    destroy-on-close
    :close-on-click-modal="false"
    class="card-package-contract-sign-frame-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p
      v-if="orderId"
      class="contract-view-hint"
    >
      订单 {{ orderId }} · 以下为合同原文（含签署记录）。
    </p>
    <div
      v-if="loading"
      class="contract-view-loading"
    >
      正在准备合同…
    </div>
    <div
      v-else-if="error"
      class="contract-view-error"
    >
      {{ error }}
    </div>
    <div
      v-else-if="embedUrl && orderId"
      class="contract-view-frame-wrap"
    >
      <iframe
        :key="`${orderId}-${iframeKey}`"
        title="电子合同"
        class="contract-view-iframe"
        :src="embedUrl"
      />
    </div>
    <template #footer>
      <div class="contract-view-footer">
        <el-button
          type="primary"
          plain
          class="contract-view-back-btn"
          @click="emit('update:modelValue', false)"
        >
          返回
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.contract-view-hint {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(0, 0, 0, 0.5);
}

.contract-view-loading {
  padding: 32px 0;
  text-align: center;
  font-size: 14px;
  color: rgba(0, 0, 0, 0.45);
}

.contract-view-error {
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(251, 191, 36, 0.8);
  background: #fffbeb;
  font-size: 14px;
  color: #92400e;
  white-space: pre-wrap;
}

.contract-view-frame-wrap {
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: #fff;
}

.contract-view-iframe {
  display: block;
  width: 100%;
  height: min(72vh, 560px);
  border: 0;
  background: #fff;
}

.contract-view-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.contract-view-back-btn {
  --el-button-text-color: #0b7b6e;
  --el-button-border-color: #0b7b6e;
}

.card-package-contract-sign-frame-dialog:deep(.el-dialog) {
  border-radius: 16px;
}

.card-package-contract-sign-frame-dialog:deep(.el-dialog__body) {
  padding-top: 8px;
}
</style>
