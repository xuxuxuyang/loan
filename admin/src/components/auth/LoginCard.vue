<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import MallBrandLogo from '../MallBrandLogo.vue'

const loginBgUrl = `${import.meta.env.BASE_URL}login-mall-bg.jpg`

const props = defineProps<{
  loading: boolean
  error: string
  success?: boolean
  /** 登录成功后、路由跳转前的过渡阶段 */
  enteringSystem?: boolean
  /** 登录成功时在按钮上展示「欢迎某某登录」 */
  welcomeRoleName?: string
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
  <div class="login-scene">
    <div
      class="login-scene__photo"
      :style="{ backgroundImage: `url(${loginBgUrl})` }"
      aria-hidden="true"
    />
    <div class="login-scene__tint" aria-hidden="true" />
    <div class="login-scene__grid" aria-hidden="true" />
    <div class="login-scene__scan" aria-hidden="true" />

    <div
      class="login-shell"
      :class="{
        'login-shell--shake': shakeCard,
        'login-shell--success': props.success,
        'login-shell--entering': props.enteringSystem,
      }"
    >
      <div class="login-shell__ring" aria-hidden="true" />
      <div class="login-card">
        <div class="login-card__shine" aria-hidden="true" />
        <div class="login-card__glow login-card__glow--a" />
        <div class="login-card__glow login-card__glow--b" />

        <div class="login-card__header">
          <div class="login-card__brand">
            <MallBrandLogo class="login-card__logo" />
            <h1>文硕商城后台管理系统</h1>
          </div>
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

.login-scene__photo {
  position: absolute;
  inset: -4%;
  z-index: 0;
  background-position: 50% 42%;
  background-size: cover;
  background-repeat: no-repeat;
  transform: scale(1.06);
  animation: heroKen 28s ease-in-out infinite alternate;
  filter: saturate(1.12) contrast(1.05);
}

.login-scene__tint {
  position: absolute;
  inset: 0;
  z-index: 1;
  background:
    radial-gradient(ellipse 120% 85% at 50% 100%, rgba(2, 6, 23, 0.92) 0%, transparent 58%),
    radial-gradient(ellipse 90% 70% at 80% 20%, rgba(14, 116, 144, 0.22), transparent 52%),
    radial-gradient(ellipse 70% 60% at 12% 35%, rgba(79, 70, 229, 0.18), transparent 48%),
    linear-gradient(165deg, rgba(2, 6, 23, 0.55) 0%, rgba(15, 23, 42, 0.72) 45%, rgba(2, 6, 23, 0.88) 100%);
  pointer-events: none;
}

.login-scene__grid {
  position: absolute;
  inset: 0;
  z-index: 2;
  opacity: 0.22;
  background-image:
    linear-gradient(rgba(56, 189, 248, 0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(56, 189, 248, 0.06) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse 85% 75% at 50% 50%, black 18%, transparent 70%);
  pointer-events: none;
  animation: sceneGridDrift 14s ease-in-out infinite alternate;
}

.login-scene__scan {
  position: absolute;
  inset: -40% -20%;
  z-index: 2;
  background: linear-gradient(
    105deg,
    transparent 44%,
    rgba(34, 211, 238, 0.04) 49.5%,
    rgba(255, 255, 255, 0.06) 50%,
    rgba(34, 211, 238, 0.04) 50.5%,
    transparent 56%
  );
  mix-blend-mode: screen;
  animation: sceneScan 11s ease-in-out infinite;
  pointer-events: none;
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
    rgba(2, 6, 23, 0.72) 0%,
    rgba(15, 23, 42, 0.82) 45%,
    rgba(6, 78, 59, 0.55) 100%
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
  border: 2px solid rgba(52, 211, 153, 0.35);
  border-top-color: rgba(45, 212, 191, 0.95);
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
  background: #5eead4;
  box-shadow: 0 0 14px rgba(45, 212, 191, 0.85);
}

.login-card__enter-title {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #ecfdf5;
  text-shadow: 0 0 24px rgba(45, 212, 191, 0.35);
}

.login-card__enter-hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: rgba(167, 243, 208, 0.88);
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
  background: linear-gradient(125deg, #14b8a6, #22c55e, #0ea5e9);
  background-size: 200% 200%;
  color: #042f2e;
  animation: btnGradient 2.8s ease infinite, btnEnterPulse 1.1s ease-in-out infinite alternate;
}

.login-btn--entering.login-btn--loading .login-btn__spinner {
  opacity: 0;
}

@keyframes shellEnterPulse {
  from {
    filter: brightness(1);
    box-shadow:
      0 0 0 1px rgba(15, 23, 42, 0.6),
      0 28px 90px rgba(2, 6, 23, 0.75),
      0 0 120px rgba(56, 189, 248, 0.12);
  }
  to {
    filter: brightness(1.06);
    box-shadow:
      0 0 0 1px rgba(45, 212, 191, 0.35),
      0 28px 100px rgba(6, 95, 70, 0.45),
      0 0 140px rgba(45, 212, 191, 0.22);
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
    box-shadow: 0 10px 28px rgba(20, 184, 166, 0.28);
  }
  to {
    box-shadow: 0 14px 36px rgba(34, 197, 94, 0.38);
  }
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

.login-card__brand {
  display: flex;
  align-items: center;
  gap: 14px;
}

.login-card__logo {
  flex-shrink: 0;
  width: clamp(44px, 9vw, 56px);
  height: clamp(44px, 9vw, 56px);
  filter: drop-shadow(0 0 14px rgba(56, 189, 248, 0.38));
}

.login-card__header h1 {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: clamp(28px, 4.5vw, 36px);
  font-weight: 800;
  letter-spacing: 0.04em;
  line-height: 1.2;
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

@keyframes heroKen {
  0% { transform: scale(1.06) translate(0, 0); }
  100% { transform: scale(1.12) translate(-1.2%, 0.8%); }
}

@keyframes sceneGridDrift {
  0% { opacity: 0.18; transform: translate(0, 0); }
  100% { opacity: 0.26; transform: translate(-10px, 6px); }
}

@keyframes sceneScan {
  0%, 18% { transform: translateX(-8%) skewX(-6deg); opacity: 0; }
  32% { opacity: 1; }
  52%, 100% { transform: translateX(8%) skewX(-6deg); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .login-scene__photo,
  .login-scene__grid,
  .login-scene__scan {
    animation: none !important;
  }

  .login-scene__photo {
    transform: scale(1.04);
  }

  .login-shell {
    animation: none;
    background: linear-gradient(
      135deg,
      rgba(56, 189, 248, 0.45),
      rgba(129, 140, 248, 0.35),
      rgba(34, 211, 238, 0.4)
    );
  }

  .login-shell--entering {
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
