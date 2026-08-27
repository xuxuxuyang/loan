<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import LoginFortuneRain from './LoginFortuneRain.vue'
import MallBrandLogo from '../MallBrandLogo.vue'

const props = defineProps<{
  loading: boolean
  error: string
  step: 'credentials' | 'verification'
  phoneMasked: string
  resendSeconds: number
  resendAvailable: boolean
  verificationCode: string
  resetKey: number
  success?: boolean
  /** 登录成功后、路由跳转前的过渡阶段 */
  enteringSystem?: boolean
  /** 登录成功时在按钮上展示「欢迎某某登录」 */
  welcomeRoleName?: string
}>()

const emit = defineEmits<{
  submit: [payload: { username: string, password: string }]
  verify: [code: string]
  resend: []
  back: []
  'update:verificationCode': [code: string]
}>()

const form = reactive({
  username: '',
  password: '',
})

const shakeCard = ref(false)

watch(
  () => props.error,
  (msg) => {
    if (!msg) return
    shakeCard.value = true
    window.setTimeout(() => {
      shakeCard.value = false
    }, 520)
  },
)

watch(
  () => props.resetKey,
  () => {
    form.username = ''
    form.password = ''
  },
)

function handleSubmit() {
  if (!form.username.trim() || !form.password.trim()) {
    return
  }
  emit('submit', {
    username: form.username.trim(),
    password: form.password.trim(),
  })
}

function handleVerify() {
  const code = props.verificationCode.trim()
  if (!/^\d{6}$/.test(code)) {
    return
  }
  emit('verify', code)
}

function updateVerificationCode(event: Event) {
  const value = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6)
  emit('update:verificationCode', value)
}
</script>

<template>
  <div class="login-scene">
    <div class="login-scene__base" aria-hidden="true" />
    <div class="login-scene__glow login-scene__glow--a" aria-hidden="true" />
    <div class="login-scene__glow login-scene__glow--b" aria-hidden="true" />
    <LoginFortuneRain />
    <div class="login-scene__tint" aria-hidden="true" />

    <div
      class="login-shell"
      :class="{
        'login-shell--success': props.success,
        'login-shell--entering': props.enteringSystem,
      }"
    >
      <div class="login-shell__ring" aria-hidden="true" />
      <div
        class="login-card"
        :class="{ 'login-card--shake': shakeCard }"
      >
        <div class="login-card__shine" aria-hidden="true" />
        <div class="login-card__glow login-card__glow--a" />
        <div class="login-card__glow login-card__glow--b" />

        <div class="login-card__header">
          <div class="login-card__brand">
            <MallBrandLogo class="login-card__logo" />
            <h1>文硕商城后台管理系统</h1>
          </div>
        </div>

        <template v-if="props.step === 'credentials'">
          <label class="login-field">
            <span>账号</span>
            <div class="login-field__input-wrap">
              <span class="login-field__icon login-field__icon--user" aria-hidden="true">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="7.8" r="3.4" fill="#7c2d12" />
                  <path
                    d="M6.2 19.8c.7-3.1 2.75-4.8 5.8-4.8s5.1 1.7 5.8 4.8H6.2Z"
                    fill="#7c2d12"
                  />
                </svg>
              </span>
              <input
                v-model="form.username"
                type="text"
                autocomplete="username"
                placeholder="请输入账号"
              >
            </div>
          </label>

          <label class="login-field">
            <span>密码</span>
            <div class="login-field__input-wrap">
              <span class="login-field__icon login-field__icon--lock" aria-hidden="true">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M7.2 10.6V8.6a4.8 4.8 0 0 1 9.6 0v2h.9a2.6 2.6 0 0 1 2.6 2.6v7.2a2.6 2.6 0 0 1-2.6 2.6H6.7a2.6 2.6 0 0 1-2.6-2.6v-7.2a2.6 2.6 0 0 1 2.6-2.6h.9Z"
                    fill="#991b1b"
                  />
                  <circle cx="12" cy="15.8" r="1.35" fill="#ffffff" />
                </svg>
              </span>
              <input
                v-model="form.password"
                type="password"
                autocomplete="current-password"
                placeholder="请输入密码"
                @keyup.enter="handleSubmit"
              >
            </div>
          </label>
        </template>

        <template v-else>
          <div class="login-verification-copy">
            <span>验证码</span>
            <p>验证码已发送至 {{ props.phoneMasked }}</p>
          </div>
          <label class="login-field">
            <span>六位验证码</span>
            <div class="login-field__input-wrap">
              <input
                :value="props.verificationCode"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="6"
                placeholder="请输入六位验证码"
                @input="updateVerificationCode"
                @keyup.enter="handleVerify"
              >
            </div>
          </label>
          <div class="login-verification-actions">
            <span v-if="props.resendSeconds > 0">{{ props.resendSeconds }} 秒后可重新发送</span>
            <button
              type="button"
              :disabled="props.loading || !props.resendAvailable"
              @click="emit('resend')"
            >重新发送</button>
          </div>
          <button class="login-back-btn" type="button" :disabled="props.loading" @click="emit('back')">
            返回修改账号
          </button>
        </template>

        <div class="login-error-slot" aria-live="polite">
          <p
            v-show="props.error"
            class="login-error"
            role="alert"
          >
            {{ props.error }}
          </p>
        </div>

        <button
          v-if="props.step === 'credentials'"
          class="login-btn"
          type="button"
          :disabled="props.loading"
          :class="{
            'login-btn--loading': props.loading && !props.success,
            'login-btn--ok': props.success,
            'login-btn--entering': props.enteringSystem,
          }"
          @click="handleSubmit"
        >
          <span class="login-btn__spinner" aria-hidden="true" />
          <span class="login-btn__label">{{
            props.enteringSystem
              ? '进入中…'
              : props.success
                ? (props.welcomeRoleName ? `欢迎${props.welcomeRoleName}登录` : '登录成功')
                : props.loading
                  ? '登录中…'
                  : '立即登录'
          }}</span>
        </button>

        <button
          v-else
          class="login-btn"
          type="button"
          :disabled="props.loading || !/^\d{6}$/.test(props.verificationCode.trim())"
          :class="{ 'login-btn--loading': props.loading }"
          @click="handleVerify"
        >
          <span class="login-btn__spinner" aria-hidden="true" />
          <span class="login-btn__label">{{ props.loading ? '验证中…' : '确认登录' }}</span>
        </button>

        <Transition name="login-enter-mask">
          <div
            v-if="props.enteringSystem"
            class="login-card__enter-mask"
            role="status"
            aria-live="polite"
          >
            <div class="login-card__enter-backdrop" aria-hidden="true" />
            <div class="login-card__enter-panel">
              <div class="login-card__enter-orbit" aria-hidden="true">
                <span class="login-card__enter-dot" />
              </div>
              <p class="login-card__enter-title">
                正在进入系统
              </p>
              <p class="login-card__enter-hint">
                正在为您跳转后台，请稍候
              </p>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-verification-copy {
  margin: 2px 0 14px;
  color: rgba(120, 53, 15, 0.8);
  font-size: 13px;
}

.login-verification-copy > span {
  display: block;
  margin-bottom: 5px;
  color: #7c2d12;
  font-weight: 700;
}

.login-verification-copy p {
  margin: 0;
}

.login-verification-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 28px;
  margin: -6px 0 12px;
  color: rgba(120, 53, 15, 0.72);
  font-size: 12px;
}

.login-verification-actions button,
.login-back-btn {
  border: 0;
  background: transparent;
  color: #b45309;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.login-verification-actions button:disabled,
.login-back-btn:disabled {
  color: rgba(120, 53, 15, 0.4);
  cursor: not-allowed;
}

.login-back-btn {
  display: block;
  margin: -2px auto 14px;
  font-size: 13px;
}

@property --login-spin {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}

.login-scene {
  position: relative;
  z-index: 0;
  min-height: 100vh;
  width: 100%;
  display: grid;
  place-items: center;
  padding: clamp(20px, 5vw, 48px);
  box-sizing: border-box;
  overflow: hidden;
  isolation: isolate;
}

.login-scene__base {
  position: absolute;
  inset: 0;
  z-index: 0;
  background:
    radial-gradient(ellipse 70% 55% at 50% -8%, rgba(253, 224, 71, 0.22), transparent 62%),
    radial-gradient(ellipse 90% 70% at 50% 100%, rgba(69, 10, 10, 0.85), transparent 58%),
    linear-gradient(180deg, #3f0a0a 0%, #7f1d1d 38%, #991b1b 62%, #450a0a 100%);
}

.login-scene__glow {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  filter: blur(48px);
  z-index: 1;
}

.login-scene__glow--a {
  width: min(520px, 70vw);
  height: min(520px, 70vw);
  left: -8%;
  top: 8%;
  background: radial-gradient(circle, rgba(253, 224, 71, 0.35), transparent 68%);
  animation: glowDrift 9s ease-in-out infinite alternate;
}

.login-scene__glow--b {
  width: min(420px, 55vw);
  height: min(420px, 55vw);
  right: -6%;
  bottom: 6%;
  background: radial-gradient(circle, rgba(245, 158, 11, 0.28), transparent 70%);
  animation: glowDrift 11s ease-in-out infinite alternate-reverse;
}

.login-scene__tint {
  position: absolute;
  inset: 0;
  z-index: 3;
  background:
    radial-gradient(ellipse 100% 80% at 50% 0%, rgba(254, 243, 199, 0.06), transparent 55%),
    radial-gradient(ellipse 90% 70% at 50% 100%, rgba(69, 10, 10, 0.5) 0%, transparent 58%),
    linear-gradient(180deg, rgba(69, 10, 10, 0.12) 0%, transparent 40%, rgba(24, 6, 6, 0.35) 100%);
  pointer-events: none;
}

.login-shell {
  position: relative;
  z-index: 5;
  padding: 2px;
  border-radius: 26px;
  background: linear-gradient(
    var(--login-spin),
    rgba(251, 191, 36, 0.7),
    rgba(234, 88, 12, 0.45),
    rgba(253, 224, 71, 0.65),
    rgba(245, 158, 11, 0.75)
  );
  animation:
    shellEnter 0.85s cubic-bezier(0.22, 1, 0.36, 1) both,
    spinBorder 7s linear infinite;
  box-shadow:
    0 0 0 1px rgba(69, 10, 10, 0.65),
    0 28px 90px rgba(24, 6, 6, 0.8),
    0 0 120px rgba(251, 191, 36, 0.18);
}

.login-shell--success {
  animation: shellGlow 0.6s ease-out;
}

.login-shell--entering {
  animation: shellEnterPulse 1.25s ease-in-out infinite alternate;
}

.login-card__enter-mask {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: grid;
  place-items: center;
  padding: 24px;
  border-radius: inherit;
  overflow: hidden;
}

.login-card__enter-backdrop {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    160deg,
    rgba(69, 10, 10, 0.78) 0%,
    rgba(127, 29, 29, 0.85) 45%,
    rgba(120, 53, 15, 0.65) 100%
  );
  backdrop-filter: blur(10px);
}

.login-card__enter-panel {
  position: relative;
  z-index: 1;
  text-align: center;
  max-width: 280px;
  animation: enterPanelIn 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.login-card__enter-orbit {
  position: relative;
  width: 56px;
  height: 56px;
  margin: 0 auto 18px;
  border-radius: 50%;
  border: 2px solid rgba(251, 191, 36, 0.35);
  border-top-color: rgba(253, 224, 71, 0.95);
  animation: enterOrbitSpin 0.95s linear infinite;
}

.login-card__enter-dot {
  position: absolute;
  left: 50%;
  top: -5px;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  border-radius: 50%;
  background: #fde047;
  box-shadow: 0 0 14px rgba(251, 191, 36, 0.85);
}

.login-card__enter-title {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #fef9c3;
  text-shadow: 0 0 24px rgba(251, 191, 36, 0.4);
}

.login-card__enter-hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: rgba(253, 230, 138, 0.9);
}

.login-enter-mask-enter-active,
.login-enter-mask-leave-active {
  transition: opacity 0.38s ease;
}

.login-enter-mask-enter-active .login-card__enter-panel,
.login-enter-mask-leave-active .login-card__enter-panel {
  transition: transform 0.38s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.38s ease;
}

.login-enter-mask-enter-from,
.login-enter-mask-leave-to {
  opacity: 0;
}

.login-enter-mask-enter-from .login-card__enter-panel,
.login-enter-mask-leave-to .login-card__enter-panel {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}

.login-btn--entering {
  background: linear-gradient(125deg, #f59e0b, #fde047, #ea580c);
  background-size: 200% 200%;
  color: #451a03;
  animation: btnGradient 2.8s ease infinite, btnEnterPulse 1.1s ease-in-out infinite alternate;
}

.login-btn--entering.login-btn--loading .login-btn__spinner {
  opacity: 0;
}

@keyframes shellEnterPulse {
  from {
    filter: brightness(1);
    box-shadow:
      0 0 0 1px rgba(69, 10, 10, 0.65),
      0 28px 90px rgba(24, 6, 6, 0.8),
      0 0 120px rgba(251, 191, 36, 0.18);
  }
  to {
    filter: brightness(1.06);
    box-shadow:
      0 0 0 1px rgba(253, 224, 71, 0.4),
      0 28px 100px rgba(127, 29, 29, 0.55),
      0 0 140px rgba(251, 191, 36, 0.32);
  }
}

@keyframes enterPanelIn {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.94);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes enterOrbitSpin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes btnEnterPulse {
  from {
    box-shadow: 0 10px 28px rgba(245, 158, 11, 0.28);
  }
  to {
    box-shadow: 0 14px 36px rgba(251, 191, 36, 0.42);
  }
}

.login-shell__ring {
  position: absolute;
  inset: -30%;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(251, 191, 36, 0.14), transparent 62%);
  pointer-events: none;
  animation: ringPulse 4s ease-in-out infinite;
}

.login-card {
  position: relative;
  width: min(600px, 94vw);
  padding: 44px 42px 42px;
  border-radius: 26px;
  background: linear-gradient(165deg, rgba(69, 10, 10, 0.94) 0%, rgba(24, 6, 6, 0.97) 100%);
  border: 1px solid rgba(251, 191, 36, 0.22);
  color: #fef3c7;
  overflow: hidden;
  backdrop-filter: blur(14px);
}

.login-card--shake {
  animation: cardShake 0.45s ease;
}

.login-card__shine {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    115deg,
    transparent 35%,
    rgba(255, 255, 255, 0.04) 48%,
    transparent 62%
  );
  transform: translateX(-100%);
  animation: shineSweep 6s ease-in-out infinite;
  pointer-events: none;
}

.login-card__glow {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  filter: blur(40px);
}

.login-card__glow--a {
  width: 320px;
  height: 320px;
  right: -120px;
  top: -140px;
  background: radial-gradient(circle, rgba(251, 191, 36, 0.32), transparent 68%);
  animation: glowDrift 8s ease-in-out infinite alternate;
}

.login-card__glow--b {
  width: 220px;
  height: 220px;
  left: -80px;
  bottom: -60px;
  background: radial-gradient(circle, rgba(234, 88, 12, 0.22), transparent 70%);
  animation: glowDrift 9s ease-in-out infinite alternate-reverse;
}

.login-card__header {
  position: relative;
  margin-bottom: 28px;
  padding-bottom: 22px;
  border-bottom: 1px solid rgba(251, 191, 36, 0.18);
}

.login-card__brand {
  display: flex;
  align-items: center;
  gap: 14px;
}

.login-card__logo {
  flex-shrink: 0;
  width: clamp(44px, 9vw, 56px);
  height: clamp(44px, 9vw, 56px);
  filter: drop-shadow(0 0 16px rgba(251, 191, 36, 0.55));
}

.login-card__header h1 {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: clamp(28px, 4.5vw, 36px);
  font-weight: 800;
  letter-spacing: 0.04em;
  line-height: 1.2;
  background: linear-gradient(120deg, #fffbeb 0%, #fde68a 42%, #fcd34d 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.login-card__header p {
  margin: 12px 0 0;
  color: #fcd34d;
  font-size: 15px;
  line-height: 1.55;
}

.login-field {
  display: grid;
  gap: 10px;
  margin-bottom: 20px;
  position: relative;
}

.login-field__input-wrap {
  position: relative;
  display: block;
}

.login-field__icon {
  position: absolute;
  left: 11px;
  top: 50%;
  z-index: 2;
  transform: translateY(-50%);
  width: 32px;
  height: 32px;
  border-radius: 9px;
  pointer-events: none;
  display: grid;
  place-items: center;
  transition:
    color 0.25s,
    background 0.25s,
    box-shadow 0.25s,
    border-color 0.25s,
    transform 0.25s;
}

.login-field__icon svg {
  width: 20px;
  height: 20px;
  display: block;
}

/* 白底 + 深色实心图形，避免黄底黄标看不清 */
.login-field__icon--user {
  background: #ffffff;
  border: 1px solid rgba(180, 83, 9, 0.45);
  box-shadow: 0 2px 8px rgba(69, 10, 10, 0.14);
}

.login-field__icon--lock {
  background: #ffffff;
  border: 1px solid rgba(190, 18, 60, 0.4);
  box-shadow: 0 2px 8px rgba(69, 10, 10, 0.14);
}

.login-field:focus-within .login-field__icon--user {
  border-color: rgba(194, 65, 12, 0.65);
  box-shadow: 0 2px 10px rgba(124, 45, 18, 0.22);
}

.login-field:focus-within .login-field__icon--lock {
  border-color: rgba(153, 27, 27, 0.65);
  box-shadow: 0 2px 10px rgba(127, 29, 29, 0.22);
}

.login-field:focus-within .login-field__icon--user,
.login-field:focus-within .login-field__icon--lock {
  transform: translateY(-50%) scale(1.05);
}

.login-field span {
  font-size: 13px;
  font-weight: 500;
  color: #fde68a;
}

.login-field input {
  width: 100%;
  height: 52px;
  border-radius: 14px;
  border: 1px solid rgba(254, 215, 170, 0.55);
  background: rgba(255, 251, 245, 0.96);
  color: #431407;
  padding: 0 16px 0 52px;
  font-size: 16px;
  outline: none;
  transition:
    border-color 0.25s,
    box-shadow 0.25s,
    background 0.25s,
    transform 0.2s;
}

.login-field input::placeholder {
  color: rgba(120, 53, 15, 0.45);
}

.login-field input:hover {
  border-color: rgba(251, 191, 36, 0.55);
  background: #fffdf8;
}

.login-field input:focus {
  border-color: #f59e0b;
  box-shadow:
    0 0 0 3px rgba(251, 191, 36, 0.2),
    0 8px 22px rgba(69, 10, 10, 0.22);
  background: #fffefb;
}

.login-error-slot {
  min-height: calc(1.45em + 22px);
  margin-bottom: 14px;
}

.login-error {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.14);
  border: 1px solid rgba(248, 113, 113, 0.38);
  color: #fecaca;
  font-size: 13px;
  line-height: 1.45;
}

.login-btn {
  --btn-h: 54px;
  position: relative;
  width: 100%;
  height: var(--btn-h);
  margin-top: 4px;
  border: none;
  border-radius: 14px;
  cursor: pointer;
  font-size: 16px;
  font-weight: 700;
  color: #451a03;
  overflow: hidden;
  background: linear-gradient(125deg, #f59e0b, #fde047, #ea580c);
  background-size: 200% 200%;
  animation: btnGradient 4.5s ease infinite;
  transition: transform 0.22s, box-shadow 0.22s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.login-btn__label {
  position: relative;
  z-index: 1;
}

.login-btn__spinner {
  position: absolute;
  left: 50%;
  margin-left: -58px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid rgba(8, 47, 73, 0.25);
  border-top-color: rgba(8, 47, 73, 0.95);
  opacity: 0;
  transform: scale(0.6);
  transition: opacity 0.2s, transform 0.2s;
}

.login-btn--loading .login-btn__spinner {
  opacity: 1;
  transform: scale(1);
  animation: spin 0.65s linear infinite;
}

.login-btn--loading .login-btn__label {
  margin-left: 22px;
}

.login-btn::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.22), transparent);
  transform: translateX(-120%);
  transition: transform 0.5s;
}

.login-btn:hover:not(:disabled)::after {
  transform: translateX(120%);
}

.login-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 16px 40px rgba(251, 191, 36, 0.38);
}

.login-btn:active:not(:disabled) {
  transform: translateY(0);
}

.login-btn:disabled {
  cursor: not-allowed;
  transform: none;
  opacity: 0.88;
}

.login-btn--ok:disabled {
  opacity: 1;
}

.login-btn--ok {
  background: linear-gradient(125deg, #fde047, #fbbf24, #f59e0b);
  color: #451a03;
}

.login-btn--loading.login-btn--ok .login-btn__spinner {
  border-top-color: rgba(69, 26, 3, 0.95);
  border-color: rgba(69, 26, 3, 0.2);
}

@keyframes spinBorder {
  to { --login-spin: 360deg; }
}

@keyframes shellEnter {
  from {
    opacity: 0;
    transform: translateY(28px) scale(0.94);
    filter: blur(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
    filter: blur(0);
  }
}

@keyframes cardShake {
  0%, 100% { transform: translateX(0); }
  18% { transform: translateX(-10px); }
  36% { transform: translateX(10px); }
  54% { transform: translateX(-6px); }
  72% { transform: translateX(6px); }
}

@keyframes shellGlow {
  0% { filter: brightness(1); box-shadow: 0 28px 90px rgba(24, 6, 6, 0.8); }
  50% { filter: brightness(1.12); box-shadow: 0 28px 100px rgba(251, 191, 36, 0.38); }
  100% { filter: brightness(1); box-shadow: 0 28px 90px rgba(24, 6, 6, 0.8); }
}

@keyframes ringPulse {
  0%, 100% { opacity: 0.45; transform: scale(1); }
  50% { opacity: 0.75; transform: scale(1.04); }
}

@keyframes shineSweep {
  0%, 12% { transform: translateX(-100%); }
  38%, 100% { transform: translateX(100%); }
}

@keyframes glowDrift {
  from { opacity: 0.85; transform: translate(0, 0); }
  to { opacity: 1; transform: translate(-12px, 10px); }
}

@keyframes btnGradient {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .login-scene__glow--a,
  .login-scene__glow--b {
    animation: none !important;
  }

  .login-shell {
    animation: none;
    background: linear-gradient(
      135deg,
      rgba(251, 191, 36, 0.55),
      rgba(234, 88, 12, 0.4),
      rgba(253, 224, 71, 0.5)
    );
  }

  .login-shell--entering {
    animation: none !important;
  }

  .login-card--shake {
    animation: none !important;
  }

  .login-card__enter-orbit {
    animation: none !important;
  }

  .login-card__enter-panel {
    animation: none !important;
  }

  .login-btn--entering {
    animation: none !important;
  }

  .login-card__shine,
  .login-shell__ring,
  .login-card__glow--a,
  .login-card__glow--b,
  .login-btn,
  .login-btn__spinner {
    animation: none !important;
  }

  .login-btn__spinner {
    opacity: 0 !important;
  }

  .login-btn--loading .login-btn__label {
    margin-left: 0;
  }
}
</style>
