<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import LoginCard from '../components/auth/LoginCard.vue'
import LoginWelcomeCelebration from '../components/auth/LoginWelcomeCelebration.vue'
import { adminRoleDisplayLabel, isPlatformBootstrapUser, setAdminSession, type AdminRole } from '../composables/useAdminAuth'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const error = ref('')
const loginSuccess = ref(false)
const enteringSystem = ref(false)
const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

const welcomeRoleName = ref('')
const loginWelcomeOpen = ref(false)
const loginWelcomeRole = ref<AdminRole>('super_admin')
const loginWelcomeName = ref('')

let loginWelcomeTimer: ReturnType<typeof setTimeout> | undefined

function inferSessionScopeType(
  username: string,
  role: AdminRole,
  scopeType?: 'platform' | 'tenant',
): 'platform' | 'tenant' {
  if (scopeType === 'platform')
    return 'platform'
  if (scopeType === 'tenant')
    return 'tenant'
  if (role === 'super_admin' && isPlatformBootstrapUser(username)) {
    return 'platform'
  }
  return 'tenant'
}

function clearLoginWelcomeTimer() {
  if (loginWelcomeTimer) {
    clearTimeout(loginWelcomeTimer)
    loginWelcomeTimer = undefined
  }
}

onUnmounted(() => {
  clearLoginWelcomeTimer()
})

async function handleLogin(payload: { username: string, password: string }) {
  if (loading.value) return
  error.value = ''
  loginSuccess.value = false
  enteringSystem.value = false
  welcomeRoleName.value = ''
  clearLoginWelcomeTimer()
  loginWelcomeOpen.value = false
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
        roleLabel?: string
        scopeType?: 'platform' | 'tenant'
        workspaceType?: 'core' | 'self' | 'tenant'
        tenantId?: string
        scopeTenantIds?: string[]
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

    const role = (result.data.adminRole || 'super_admin') as AdminRole
    const roleName = String(result.data.roleLabel || '').trim() || adminRoleDisplayLabel(role)

    setAdminSession({
      username: result.data.username || payload.username,
      token: result.data.token,
      role,
      loginAt: new Date().toISOString(),
      scopeType: inferSessionScopeType(
        result.data.username || payload.username,
        role,
        result.data.scopeType,
      ),
      workspaceType: ((): 'core' | 'self' | 'tenant' => {
        const raw = String(result.data.workspaceType || '').trim().toLowerCase()
        if (raw === 'core' || raw === 'self' || raw === 'tenant') {
          return raw
        }
        return inferSessionScopeType(
          result.data.username || payload.username,
          role,
          result.data.scopeType,
        ) === 'platform' ? 'core' : 'tenant'
      })(),
      tenantId: String(result.data.tenantId || 'default'),
      scopeTenantIds: Array.isArray(result.data.scopeTenantIds)
        ? result.data.scopeTenantIds.map(item => String(item || '').trim()).filter(Boolean)
        : undefined,
    })

    loginWelcomeRole.value = role
    loginWelcomeName.value = roleName
    loginWelcomeOpen.value = true
    clearLoginWelcomeTimer()
    loginWelcomeTimer = setTimeout(() => {
      loginWelcomeOpen.value = false
    }, 3200)

    welcomeRoleName.value = roleName
    loginSuccess.value = true
    await new Promise(r => setTimeout(r, 1000))
    enteringSystem.value = true
    await new Promise(r => setTimeout(r, 1400))

    const redirect = String(route.query.redirect || '/')
    await router.replace(redirect.startsWith('/') ? redirect : '/')
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : '登录失败，请稍后重试'
    clearLoginWelcomeTimer()
    loginWelcomeOpen.value = false
  }
  finally {
    loading.value = false
    loginSuccess.value = false
    enteringSystem.value = false
    welcomeRoleName.value = ''
  }
}
</script>

<template>
  <div
    class="login-page"
    :class="{ 'login-page--success': loginSuccess }"
  >
    <header class="login-page__brand" aria-hidden="true">
      <span class="login-page__brand-mark">文硕商城</span>
      <span class="login-page__brand-divider" />
      <span class="login-page__brand-sub">日进斗金 · 管理中台</span>
    </header>

    <LoginWelcomeCelebration
      :visible="loginWelcomeOpen"
      :role="loginWelcomeRole"
      :display-name="loginWelcomeName"
    />

    <LoginCard
      :loading="loading"
      :error="error"
      :success="loginSuccess"
      :entering-system="enteringSystem"
      :welcome-role-name="welcomeRoleName"
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
  background: #450a0a;
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
  color: rgba(254, 243, 199, 0.55);
  animation: brandFade 1.2s ease-out 0.15s both;
}

.login-page__brand-mark {
  font-weight: 700;
  color: rgba(254, 243, 199, 0.92);
  letter-spacing: 0.18em;
}

.login-page__brand-divider {
  width: 1px;
  height: 14px;
  background: linear-gradient(transparent, rgba(148, 163, 184, 0.45), transparent);
}

.login-page__brand-sub {
  font-weight: 500;
  color: rgba(253, 224, 71, 0.82);
}

.login-page__flash {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: radial-gradient(circle at 50% 45%, rgba(251, 191, 36, 0.42), transparent 55%);
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
