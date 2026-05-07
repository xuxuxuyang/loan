<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import LoginCard from '../components/auth/LoginCard.vue'
import { setAdminSession, type AdminRole } from '../composables/useAdminAuth'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const error = ref('')
const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

async function handleLogin(payload: { username: string, password: string }) {
  if (loading.value) return
  error.value = ''
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

    const redirect = String(route.query.redirect || '/')
    await router.replace(redirect.startsWith('/') ? redirect : '/')
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : '登录失败，请稍后重试'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="aurora aurora--one" />
    <div class="aurora aurora--two" />
    <div class="aurora aurora--three" />
    <div class="star star--one" />
    <div class="star star--two" />
    <div class="star star--three" />
    <LoginCard
      :loading="loading"
      :error="error"
      @submit="handleLogin"
    />
  </div>
</template>

<style scoped>
.login-page {
  position: relative;
  min-height: 100vh;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: radial-gradient(circle at 20% 15%, #1e293b, #020617 55%);
}

.aurora {
  position: absolute;
  border-radius: 50%;
  filter: blur(14px);
  opacity: 0.6;
  animation: float 11s ease-in-out infinite;
}

.aurora--one {
  width: 420px;
  height: 420px;
  background: rgba(59, 130, 246, 0.42);
  left: -120px;
  top: -70px;
}

.aurora--two {
  width: 380px;
  height: 380px;
  background: rgba(14, 165, 233, 0.35);
  right: -80px;
  bottom: -130px;
  animation-delay: -4s;
}

.aurora--three {
  width: 270px;
  height: 270px;
  background: rgba(129, 140, 248, 0.32);
  right: 22%;
  top: 8%;
  animation-delay: -2s;
}

.star {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(224, 242, 254, 0.9);
  box-shadow: 0 0 20px rgba(125, 211, 252, 0.7);
  animation: twinkle 2.7s ease-in-out infinite;
}

.star--one {
  top: 14%;
  right: 22%;
}

.star--two {
  top: 72%;
  left: 19%;
  animation-delay: -1s;
}

.star--three {
  top: 40%;
  left: 13%;
  animation-delay: -0.6s;
}

@keyframes float {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(20px, -16px); }
}

@keyframes twinkle {
  0%, 100% { transform: scale(1); opacity: 0.5; }
  50% { transform: scale(1.65); opacity: 1; }
}
</style>
