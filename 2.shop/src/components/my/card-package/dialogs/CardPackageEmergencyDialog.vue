<script setup lang="ts">
defineProps<{
  visible: boolean
  compact?: boolean
  submitting: boolean
  c1Name: string
  c1Phone: string
  c2Name: string
  c2Phone: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'update:c1Name': [value: string]
  'update:c1Phone': [value: string]
  'update:c2Name': [value: string]
  'update:c2Phone': [value: string]
  submit: []
}>()
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="填写紧急联系人"
    :width="compact ? 'min(94vw, 400px)' : '420px'"
    destroy-on-close
    align-center
    :close-on-click-modal="false"
    append-to-body
    class="card-package-emergency-dialog"
    @update:model-value="emit('update:visible', $event)"
  >
    <p class="mb-3 text-sm leading-relaxed text-black/70">
      您已有商城订单，领取前需登记 <strong class="text-black/85">两位紧急联系人</strong>（姓名与手机号，用于必要时的联络）。信息将加密保存，仅用于服务与风控相关用途。
    </p>
    <p class="mb-3 text-xs leading-relaxed text-black/45">
      姓名仅可为<strong>汉字或英文字母</strong>，可含间隔符「·」与空格；<strong>不可含数字、标点及其它符号</strong>。手机号为大陆 11 位号码（以 1 开头）。
    </p>
    <div class="space-y-3">
      <div class="rounded-xl border border-black/[0.08] bg-[#f8fafc] p-3">
        <p class="mb-2 text-xs font-semibold text-black/55">
          紧急联系人 1
        </p>
        <div class="flex flex-col gap-2 sm:flex-row">
          <el-input
            :model-value="c1Name"
            maxlength="32"
            show-word-limit
            placeholder="姓名"
            class="flex-1"
            @update:model-value="emit('update:c1Name', String($event ?? ''))"
          />
          <el-input
            :model-value="c1Phone"
            maxlength="11"
            inputmode="numeric"
            placeholder="11 位手机号"
            class="flex-1"
            @update:model-value="emit('update:c1Phone', String($event ?? ''))"
          />
        </div>
      </div>
      <div class="rounded-xl border border-black/[0.08] bg-[#f8fafc] p-3">
        <p class="mb-2 text-xs font-semibold text-black/55">
          紧急联系人 2
        </p>
        <div class="flex flex-col gap-2 sm:flex-row">
          <el-input
            :model-value="c2Name"
            maxlength="32"
            show-word-limit
            placeholder="姓名"
            class="flex-1"
            @update:model-value="emit('update:c2Name', String($event ?? ''))"
          />
          <el-input
            :model-value="c2Phone"
            maxlength="11"
            inputmode="numeric"
            placeholder="11 位手机号"
            class="flex-1"
            @update:model-value="emit('update:c2Phone', String($event ?? ''))"
          />
        </div>
      </div>
    </div>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <el-button
          :disabled="submitting"
          @click="emit('update:visible', false)"
        >
          稍后
        </el-button>
        <el-button
          type="primary"
          class="wv-gradient-teal-el !border-0"
          :loading="submitting"
          @click="emit('submit')"
        >
          保存并继续
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>
