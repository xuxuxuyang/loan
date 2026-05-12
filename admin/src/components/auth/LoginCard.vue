<script setup lang="ts">
import { reactive, ref, watch } from 'vue'

const props = defineProps<{
  loading: boolean
  error: string
  success?: boolean
}>()

const emit = defineEmits<{
  submit: [payload: { username: string, password: string }]
}>()

const form = reactive({
  username: 'xuyang',
  password: '123456',
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

function handleSubmit() {
  if (!form.username.trim() || !form.password.trim()) {
    return
  }
  emit('submit', {
    username: form.username.trim(),
    password: form.password.trim(),
  })
}
</script>

<template>
  <div
    class="login-shell"
    :class="{ 'login-shell--shake': shakeCard, 'login-shell--success': props.success }"
  >
    <div class="login-shell__ring" aria-hidden="true" />
    <div class="login-card">
      <div class="login-card__shine" aria-hidden="true" />
      <div class="login-card__glow login-card__glow--a" />
      <div class="login-card__glow login-card__glow--b" />

      <div class="login-card__header">
        <h1>后台登录</h1>
        <p>琥珀商城管理中台 · 安全接入</p>
      </div>

      <label class="login-field">
        <span>账号</span>
        <div class="login-field__input-wrap">
          <span class="login-field__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M12 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M5 20.5v-.5a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v.5"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
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
          <span class="login-field__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect
                x="5"
                y="10"
                width="14"
                height="11"
                rx="2"
                stroke="currentColor"
                stroke-width="1.6"
              />
              <path
                d="M8 10V8a4 4 0 0 1 8 0v2"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
              />
              <circle cx="12" cy="15.5" r="1.2" fill="currentColor" />
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

      <p
        v-if="props.error"
        class="login-error"
        role="alert"
      >
        {{ props.error }}
      </p>

      <button
        class="login-btn"
        type="button"
        :disabled="props.loading"
        :class="{ 'login-btn--loading': props.loading && !props.success, 'login-btn--ok': props.success }"
        @click="handleSubmit"
      >
        <span class="login-btn__spinner" aria-hidden="true" />
        <span class="login-btn__label">{{ props.success ? '验证通过' : props.loading ? '登录中…' : '立即登录' }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
@property --login-spin {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}

.login-shell {
  position: relative;
  z-index: 5;
  padding: 2px;
  border-radius: 26px;
  background: linear-gradient(
    var(--login-spin),
    rgba(56, 189, 248, 0.55),
    rgba(129, 140, 248, 0.35),
    rgba(34, 211, 238, 0.45),
    rgba(56, 189, 248, 0.55)
  );
  animation:
    shellEnter 0.85s cubic-bezier(0.22, 1, 0.36, 1) both,
    spinBorder 7s linear infinite;
  box-shadow:
    0 0 0 1px rgba(15, 23, 42, 0.6),
    0 28px 90px rgba(2, 6, 23, 0.75),
    0 0 120px rgba(56, 189, 248, 0.12);
}

.login-shell--shake {
  animation: cardShake 0.45s ease;
}

.login-shell--success {
  animation: shellGlow 0.6s ease-out;
}

.login-shell__ring {
  position: absolute;
  inset: -30%;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(56, 189, 248, 0.12), transparent 62%);
  pointer-events: none;
  animation: ringPulse 4s ease-in-out infinite;
}

.login-card {
  position: relative;
  width: min(600px, 94vw);
  padding: 44px 42px 42px;
  border-radius: 26px;
  background: linear-gradient(165deg, rgba(15, 23, 42, 0.94) 0%, rgba(9, 12, 28, 0.96) 100%);
  border: 1px solid rgba(148, 163, 184, 0.12);
  color: #e2e8f0;
  overflow: hidden;
  backdrop-filter: blur(14px);
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
  background: radial-gradient(circle, rgba(56, 189, 248, 0.38), transparent 68%);
  animation: glowDrift 8s ease-in-out infinite alternate;
}

.login-card__glow--b {
  width: 220px;
  height: 220px;
  left: -80px;
  bottom: -60px;
  background: radial-gradient(circle, rgba(167, 139, 250, 0.22), transparent 70%);
  animation: glowDrift 9s ease-in-out infinite alternate-reverse;
}

.login-card__header {
  position: relative;
  margin-bottom: 28px;
  padding-bottom: 22px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.login-card__header h1 {
  margin: 0;
  font-size: clamp(28px, 4.5vw, 36px);
  font-weight: 800;
  letter-spacing: 0.04em;
  background: linear-gradient(120deg, #f8fafc 0%, #bae6fd 45%, #e0e7ff 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.login-card__header p {
  margin: 12px 0 0;
  color: #94a3b8;
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
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  width: 22px;
  height: 22px;
  color: #64748b;
  pointer-events: none;
  display: grid;
  place-items: center;
  transition: color 0.25s;
}

.login-field__icon svg {
  width: 22px;
  height: 22px;
}

.login-field:focus-within .login-field__icon {
  color: #38bdf8;
}

.login-field span {
  font-size: 13px;
  font-weight: 500;
  color: #cbd5e1;
}

.login-field input {
  width: 100%;
  height: 52px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(15, 23, 42, 0.65);
  color: #f8fafc;
  padding: 0 16px 0 48px;
  font-size: 16px;
  outline: none;
  transition:
    border-color 0.25s,
    box-shadow 0.25s,
    background 0.25s,
    transform 0.2s;
}

.login-field input:hover {
  border-color: rgba(125, 211, 252, 0.35);
}

.login-field input:focus {
  border-color: #38bdf8;
  box-shadow:
    0 0 0 3px rgba(56, 189, 248, 0.22),
    0 12px 28px rgba(2, 6, 23, 0.35);
  background: rgba(15, 23, 42, 0.85);
}

.login-error {
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.14);
  border: 1px solid rgba(248, 113, 113, 0.38);
  color: #fecaca;
  font-size: 13px;
  animation: errorIn 0.35s ease;
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
  color: #082f49;
  overflow: hidden;
  background: linear-gradient(125deg, #38bdf8, #22d3ee, #818cf8);
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
  box-shadow: 0 16px 40px rgba(56, 189, 248, 0.35);
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
  background: linear-gradient(125deg, #22d3ee, #34d399, #38bdf8);
  color: #042f2e;
}

.login-btn--loading.login-btn--ok .login-btn__spinner {
  border-top-color: rgba(4, 47, 46, 0.95);
  border-color: rgba(4, 47, 46, 0.2);
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
  0% { filter: brightness(1); box-shadow: 0 28px 90px rgba(2, 6, 23, 0.75); }
  50% { filter: brightness(1.12); box-shadow: 0 28px 100px rgba(34, 211, 238, 0.35); }
  100% { filter: brightness(1); box-shadow: 0 28px 90px rgba(2, 6, 23, 0.75); }
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

@keyframes errorIn {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .login-shell {
    animation: none;
    background: linear-gradient(
      135deg,
      rgba(56, 189, 248, 0.45),
      rgba(129, 140, 248, 0.35),
      rgba(34, 211, 238, 0.4)
    );
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
