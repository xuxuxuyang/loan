<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Lock, Message } from '@element-plus/icons-vue'
import {
  cancelSensitiveOperation,
  confirmSensitiveOperationWithCachedProof,
  sendSensitiveOperationCode,
  sensitiveOperationDialog,
  verifySensitiveOperationCode,
} from '../composables/useSensitiveOperationGuard'

const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  timer = setInterval(() => { now.value = Date.now() }, 1000)
})

onUnmounted(() => {
  if (timer)
    clearInterval(timer)
})

const display = computed(() => sensitiveOperationDialog.request?.display)
const hasCachedProof = computed(() => Boolean(sensitiveOperationDialog.verifiedProofToken))
const resendSeconds = computed(() => Math.max(0, Math.ceil((Date.parse(sensitiveOperationDialog.resendAt) - now.value) / 1000)))
const proofSeconds = computed(() => Math.max(0, Math.ceil((Date.parse(sensitiveOperationDialog.verifiedExpiresAt) - now.value) / 1000)))
const proofCountdown = computed(() => {
  const seconds = proofSeconds.value
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
})

function updateVisible(value: boolean) {
  if (!value)
    cancelSensitiveOperation()
}
</script>

<template>
  <el-dialog
    :model-value="sensitiveOperationDialog.visible"
    width="520px"
    class="security-confirm-dialog"
    :close-on-click-modal="false"
    :close-on-press-escape="!sensitiveOperationDialog.verifying"
    :show-close="!sensitiveOperationDialog.verifying"
    append-to-body
    @update:model-value="updateVisible"
  >
    <template #header>
      <div class="security-confirm-dialog__header" :class="{ 'is-danger': display?.danger }">
        <span class="security-confirm-dialog__icon"><el-icon><Lock /></el-icon></span>
        <div>
          <h3>{{ display?.actionLabel || '确认敏感操作' }}</h3>
          <p>请核对操作对象，验证通过后系统会留下操作记录</p>
        </div>
      </div>
    </template>

    <div class="security-confirm-dialog__body">
      <div class="security-confirm-dialog__target">
        <div v-if="display?.user"><span>用户</span><strong>{{ display.user }}</strong></div>
        <div v-if="display?.orderId"><span>订单</span><strong class="mono">{{ display.orderId }}</strong></div>
        <div v-if="display?.period"><span>期次</span><strong>第 {{ display.period }} 期</strong></div>
      </div>

      <div v-if="display?.changes?.length" class="security-confirm-dialog__changes">
        <div v-for="item in display.changes" :key="item.label" class="security-confirm-dialog__change">
          <span>{{ item.label }}</span>
          <strong>{{ item.before ?? '-' }}</strong>
          <b>→</b>
          <strong class="after">{{ item.after ?? '-' }}</strong>
        </div>
      </div>

      <div v-if="hasCachedProof && proofSeconds > 0" class="security-confirm-dialog__verified">
        <el-icon><Lock /></el-icon>
        <div>
          <strong>身份已验证</strong>
          <p>还款操作验证窗口剩余 {{ proofCountdown }}，本次仍需确认操作内容。</p>
        </div>
      </div>

      <div v-else class="security-confirm-dialog__otp">
        <div class="security-confirm-dialog__phone">
          <el-icon><Message /></el-icon>
          <span>验证码将发送至账号绑定手机</span>
          <strong>{{ sensitiveOperationDialog.phoneMasked || '-' }}</strong>
        </div>
        <div class="security-confirm-dialog__otp-row">
          <el-input
            v-model="sensitiveOperationDialog.code"
            maxlength="6"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="请输入六位验证码"
            :disabled="!sensitiveOperationDialog.challengeId || sensitiveOperationDialog.verifying"
            @keyup.enter="verifySensitiveOperationCode"
          />
          <el-button
            :loading="sensitiveOperationDialog.sending"
            :disabled="resendSeconds > 0"
            @click="sendSensitiveOperationCode"
          >
            {{ resendSeconds > 0 ? `${resendSeconds}s 后重发` : (sensitiveOperationDialog.challengeId ? '重新发送' : '发送验证码') }}
          </el-button>
        </div>
      </div>

      <p v-if="sensitiveOperationDialog.error" class="security-confirm-dialog__error">
        {{ sensitiveOperationDialog.error }}
      </p>
      <p class="security-confirm-dialog__notice">
        操作成功后将记录操作人、时间、IP、目标对象和变更内容。
      </p>
    </div>

    <template #footer>
      <el-button :disabled="sensitiveOperationDialog.verifying" @click="cancelSensitiveOperation">
        取消
      </el-button>
      <el-button
        v-if="hasCachedProof && proofSeconds > 0"
        type="primary"
        :class="{ 'danger-confirm': display?.danger }"
        @click="confirmSensitiveOperationWithCachedProof"
      >
        确认执行
      </el-button>
      <el-button
        v-else
        type="primary"
        :class="{ 'danger-confirm': display?.danger }"
        :loading="sensitiveOperationDialog.verifying"
        :disabled="!sensitiveOperationDialog.challengeId || sensitiveOperationDialog.code.length !== 6"
        @click="verifySensitiveOperationCode"
      >
        验证并执行
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
:global(.security-confirm-dialog) {
  --security-red: #b91c1c;
  border-radius: 16px;
  overflow: hidden;
}

:global(.security-confirm-dialog .el-dialog__header) {
  margin: 0;
  padding: 22px 24px 16px;
  border-bottom: 1px solid #eef0f4;
}

.security-confirm-dialog__header {
  display: flex;
  gap: 14px;
  align-items: center;
}

.security-confirm-dialog__icon {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 12px;
  color: #9f1239;
  background: #fff1f2;
  font-size: 20px;
}

.security-confirm-dialog__header.is-danger .security-confirm-dialog__icon {
  color: #fff;
  background: var(--security-red);
}

.security-confirm-dialog__header h3 {
  margin: 0;
  color: #172033;
  font-size: 18px;
}

.security-confirm-dialog__header p,
.security-confirm-dialog__verified p {
  margin: 4px 0 0;
  color: #737b8c;
  font-size: 13px;
}

.security-confirm-dialog__body {
  display: grid;
  gap: 14px;
}

.security-confirm-dialog__target,
.security-confirm-dialog__changes {
  padding: 14px 16px;
  border: 1px solid #e7eaf0;
  border-radius: 12px;
  background: #f8fafc;
}

.security-confirm-dialog__target div,
.security-confirm-dialog__change {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  min-height: 28px;
}

.security-confirm-dialog__target span,
.security-confirm-dialog__change > span {
  color: #7c8493;
  font-size: 13px;
}

.security-confirm-dialog__change {
  grid-template-columns: 72px 1fr 18px 1fr;
}

.security-confirm-dialog__change b {
  color: #a4aab5;
  text-align: center;
}

.security-confirm-dialog__change .after {
  color: #b91c1c;
}

.mono {
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
}

.security-confirm-dialog__verified,
.security-confirm-dialog__phone {
  display: flex;
  gap: 10px;
  align-items: center;
}

.security-confirm-dialog__verified {
  padding: 14px;
  border: 1px solid #bbf7d0;
  border-radius: 12px;
  color: #166534;
  background: #f0fdf4;
}

.security-confirm-dialog__otp {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid #fed7aa;
  border-radius: 12px;
  background: #fffaf2;
}

.security-confirm-dialog__phone span {
  color: #697184;
  font-size: 13px;
}

.security-confirm-dialog__phone strong {
  margin-left: auto;
  color: #172033;
}

.security-confirm-dialog__otp-row {
  display: grid;
  grid-template-columns: 1fr 116px;
  gap: 10px;
}

.security-confirm-dialog__error {
  margin: 0;
  color: #b91c1c;
  font-size: 13px;
}

.security-confirm-dialog__notice {
  margin: 0;
  color: #8a91a0;
  font-size: 12px;
}

.danger-confirm {
  border-color: #b91c1c;
  background: #b91c1c;
}

@media (max-width: 640px) {
  :global(.security-confirm-dialog) {
    width: calc(100vw - 24px) !important;
    margin: 12px auto !important;
  }

  .security-confirm-dialog__change {
    grid-template-columns: 68px 1fr 14px 1fr;
  }

  .security-confirm-dialog__otp-row {
    grid-template-columns: 1fr;
  }
}
</style>
