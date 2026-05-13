<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import LoginCard from '../components/auth/LoginCard.vue'
import { setAdminSession, type AdminRole } from '../composables/useAdminAuth'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const error = ref('')
const loginSuccess = ref(false)
const enteringSystem = ref(false)
const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

async function handleLogin(payload: { username: string, password: string }) {
  if (loading.value) return
  error.value = ''
  loginSuccess.value = false
  enteringSystem.value = false
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

    ElMessage.success('登录成功')
    loginSuccess.value = true
    await new Promise(r => setTimeout(r, 480))
    enteringSystem.value = true
    await new Promise(r => setTimeout(r, 1400))

    const redirect = String(route.query.redirect || '/')
    await router.replace(redirect.startsWith('/') ? redirect : '/')
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : '登录失败，请稍后重试'
  }
  finally {
    loading.value = false
    loginSuccess.value = false
    enteringSystem.value = false
  }
}
</script>

<template>
  <div
    class="login-page"
    :class="{ 'login-page--success': loginSuccess }"
  >
    <header class="login-page__brand" aria-hidden="true">
      <span class="login-page__brand-mark">琥珀商城</span>
      <span class="login-page__brand-divider" />
      <span class="login-page__brand-sub">先享后付 · 管理中台</span>
    </header>

    <LoginCard
      :loading="loading"
      :error="error"
      :success="loginSuccess"
      :entering-system="enteringSystem"
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
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  background: #020617;
  isolation: isolate;
}

.login-page__brand {
  position: absolute;
  top: clamp(20px, 4vh, 40px);
  left: clamp(20px, 4vw, 48px);
  z-index: 10;
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
  .login-page__brand {
    animation: none !important;
  }
}
</style>
