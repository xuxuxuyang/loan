<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import LoginCard from '../components/auth/LoginCard.vue'
import { setAdminSession, type AdminRole } from '../composables/useAdminAuth'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const error = ref('')
const loginSuccess = ref(false)
const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

/** 背景粒子：固定分布，纯展示用 */
const particles = [
  { t: '12%', l: '8%', d: '0s', s: 2 },
  { t: '22%', l: '88%', d: '-0.8s', s: 1.5 },
  { t: '78%', l: '6%', d: '-1.4s', s: 2.2 },
  { t: '64%', l: '92%', d: '-0.3s', s: 1.2 },
  { t: '38%', l: '14%', d: '-2s', s: 1.8 },
  { t: '18%', l: '42%', d: '-1.1s', s: 1 },
  { t: '86%', l: '38%', d: '-0.5s', s: 2.4 },
  { t: '52%', l: '78%', d: '-1.7s', s: 1.6 },
  { t: '8%', l: '62%', d: '-0.2s', s: 1.3 },
  { t: '44%', l: '28%', d: '-2.2s', s: 2 },
  { t: '92%', l: '72%', d: '-0.9s', s: 1.4 },
  { t: '30%', l: '94%', d: '-1.5s', s: 1.7 },
] as const

async function handleLogin(payload: { username: string, password: string }) {
  if (loading.value) return
  error.value = ''
  loginSuccess.value = false
  loading.value = true
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const rawText = await response.text()
    let result: {
      success?: boolean
      msg?: string
      data?: {
        username: string
        token: string
        adminRole: AdminRole
      }
    } = {}
    try {
      result = JSON.parse(rawText)
    }
    catch {
      result = { msg: rawText || '登录失败，请检查接口地址' }
    }
    if (!response.ok || !result?.data?.token) {
      throw new Error(result?.msg || `登录失败: ${response.status}`)
    }

    setAdminSession({
      username: result.data.username || payload.username,
      token: result.data.token,
      role: result.data.adminRole || 'super_admin',
      loginAt: new Date().toISOString(),
    })

    loginSuccess.value = true
    await new Promise(r => setTimeout(r, 420))

    const redirect = String(route.query.redirect || '/')
    await router.replace(redirect.startsWith('/') ? redirect : '/')
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : '登录失败，请稍后重试'
  }
  finally {
    loading.value = false
    loginSuccess.value = false
  }
}
</script>

<template>
  <div
    class="login-page"
    :class="{ 'login-page--success': loginSuccess }"
  >
    <div class="login-page__mesh" />
    <div class="login-page__grid" />
    <div class="login-page__beams" />

    <div
      v-for="(p, i) in particles"
      :key="i"
      class="login-page__particle"
      :style="{
        top: p.t,
        left: p.l,
        animationDelay: p.d,
        width: `${p.s}px`,
        height: `${p.s}px`,
      }"
    />

    <div class="aurora aurora--one" />
    <div class="aurora aurora--two" />
    <div class="aurora aurora--three" />
    <div class="aurora aurora--four" />

    <header class="login-page__brand" aria-hidden="true">
      <span class="login-page__brand-mark">琥珀商城</span>
      <span class="login-page__brand-divider" />
      <span class="login-page__brand-sub">先享后付 · 管理中台</span>
    </header>

    <LoginCard
      :loading="loading"
      :error="error"
      :success="loginSuccess"
      @submit="handleLogin"
    />

    <div
      v-if="loginSuccess"
      class="login-page__flash"
      aria-hidden="true"
    />
  </div>
</template>

<style scoped>
.login-page {
  --login-cyan: #22d3ee;
  --login-blue: #38bdf8;
  --login-violet: #a78bfa;
  --login-deep: #020617;

  position: relative;
  min-height: 100vh;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: var(--login-deep);
  isolation: isolate;
}

.login-page__mesh {
  position: absolute;
  inset: -40%;
  z-index: 0;
  background:
    radial-gradient(ellipse 80% 50% at 20% 40%, rgba(56, 189, 248, 0.22), transparent 50%),
    radial-gradient(ellipse 60% 45% at 80% 60%, rgba(167, 139, 250, 0.18), transparent 45%),
    radial-gradient(ellipse 50% 40% at 50% 100%, rgba(34, 211, 238, 0.12), transparent 40%),
    linear-gradient(180deg, #0f172a 0%, var(--login-deep) 45%, #0c1222 100%);
  animation: meshDrift 18s ease-in-out infinite alternate;
}

.login-page__grid {
  position: absolute;
  inset: 0;
  z-index: 1;
  opacity: 0.35;
  background-image:
    linear-gradient(rgba(148, 163, 184, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.06) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(ellipse 75% 65% at 50% 50%, black 20%, transparent 72%);
  animation: gridPulse 10s ease-in-out infinite;
}

.login-page__beams {
  position: absolute;
  inset: -50%;
  z-index: 1;
  background: conic-gradient(
    from 0deg at 50% 50%,
    transparent 0deg,
    rgba(56, 189, 248, 0.03) 60deg,
    transparent 120deg,
    rgba(167, 139, 250, 0.04) 200deg,
    transparent 280deg
  );
  animation: beamSpin 32s linear infinite;
  pointer-events: none;
}

.login-page__particle {
  position: absolute;
  z-index: 2;
  border-radius: 50%;
  background: rgba(224, 242, 254, 0.95);
  box-shadow: 0 0 12px rgba(125, 211, 252, 0.55), 0 0 28px rgba(56, 189, 248, 0.25);
  animation: particleFloat 5.5s ease-in-out infinite;
  pointer-events: none;
}

.login-page__brand {
  position: absolute;
  top: clamp(20px, 4vh, 40px);
  left: clamp(20px, 4vw, 48px);
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 13px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(226, 232, 240, 0.55);
  animation: brandFade 1.2s ease-out 0.15s both;
}

.login-page__brand-mark {
  font-weight: 700;
  color: rgba(248, 250, 252, 0.88);
  letter-spacing: 0.18em;
}

.login-page__brand-divider {
  width: 1px;
  height: 14px;
  background: linear-gradient(transparent, rgba(148, 163, 184, 0.45), transparent);
}

.login-page__brand-sub {
  font-weight: 500;
  color: rgba(125, 211, 252, 0.75);
}

.login-page__flash {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: radial-gradient(circle at 50% 45%, rgba(34, 211, 238, 0.35), transparent 55%);
  animation: successFlash 0.55s ease-out forwards;
  pointer-events: none;
}

.login-page--success .aurora {
  animation-duration: 3s;
}

.aurora {
  position: absolute;
  z-index: 2;
  border-radius: 50%;
  filter: blur(36px);
  opacity: 0.55;
  animation: floatWide 14s ease-in-out infinite;
  pointer-events: none;
}

.aurora--one {
  width: min(520px, 55vw);
  height: min(520px, 55vw);
  background: rgba(59, 130, 246, 0.38);
  left: -14%;
  top: -8%;
}

.aurora--two {
  width: min(480px, 50vw);
  height: min(480px, 50vw);
  background: rgba(14, 165, 233, 0.28);
  right: -12%;
  bottom: -18%;
  animation-delay: -5s;
}

.aurora--three {
  width: min(360px, 38vw);
  height: min(360px, 38vw);
  background: rgba(129, 140, 248, 0.3);
  right: 18%;
  top: 6%;
  animation-delay: -2.5s;
}

.aurora--four {
  width: min(280px, 30vw);
  height: min(280px, 30vw);
  background: rgba(34, 211, 238, 0.22);
  left: 28%;
  bottom: 12%;
  animation-delay: -7s;
}

@keyframes meshDrift {
  0% { transform: translate(0, 0) scale(1); }
  100% { transform: translate(-2%, 1.5%) scale(1.03); }
}

@keyframes gridPulse {
  0%, 100% { opacity: 0.28; }
  50% { opacity: 0.42; }
}

@keyframes beamSpin {
  to { transform: rotate(360deg); }
}

@keyframes particleFloat {
  0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.45; }
  50% { transform: translate(6px, -10px) scale(1.15); opacity: 1; }
}

@keyframes floatWide {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(28px, -22px) scale(1.05); }
  66% { transform: translate(-18px, 14px) scale(0.98); }
}

@keyframes brandFade {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes successFlash {
  0% { opacity: 0; }
  35% { opacity: 1; }
  100% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .login-page__mesh,
  .login-page__grid,
  .login-page__beams,
  .login-page__particle,
  .aurora,
  .login-page__brand {
    animation: none !important;
  }

  .login-page__beams {
    opacity: 0.5;
  }
}
</style>
