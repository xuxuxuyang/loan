<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import LoginCard from '../components/auth/LoginCard.vue'
import LoginWelcomeCelebration from '../components/auth/LoginWelcomeCelebration.vue'
import { syncAdminSessionProfile } from '../composables/useAdminApi'
import {
  createAdminLoginChallenge,
  verifyAdminLoginChallenge,
  type AdminLoginChallenge,
  type VerifiedAdminLogin,
} from '../api/adminLogin'
import {
  adminCanAccessMenuPath,
  resolveAdminHomeRoute,
} from '../composables/useAdminPermissions'
import {
  adminRoleDisplayLabel,
  getAdminSession,
  isPlatformBootstrapUser,
  setAdminSession,
  type AdminRole,
} from '../composables/useAdminAuth'
import { clearAdminVisitedTags } from '../composables/useAdminVisitedTags'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const error = ref('')
const loginSuccess = ref(false)
const enteringSystem = ref(false)
const credentials = ref<{ username: string, password: string } | null>(null)
const challenge = ref<AdminLoginChallenge | null>(null)
const verificationCode = ref('')
const loginCardResetKey = ref(0)
const now = ref(Date.now())
let challengeTimer: ReturnType<typeof setInterval> | undefined

const loginStep = computed(() => challenge.value ? 'verification' : 'credentials')
const challengeExpiresAtMs = computed(() => Date.parse(challenge.value?.expiresAt || ''))
const resendSeconds = computed(() => {
  if (!challenge.value) return 0
  const resendAtMs = Date.parse(challenge.value.resendAt)
  if (!Number.isFinite(resendAtMs)) return 0
  return Math.max(0, Math.ceil((resendAtMs - now.value) / 1000))
})
const canResend = computed(() => Boolean(challenge.value) && resendSeconds.value === 0)

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

function clearChallengeTimer() {
  if (challengeTimer) {
    clearInterval(challengeTimer)
    challengeTimer = undefined
  }
}

function clearLoginFlow() {
  credentials.value = null
  challenge.value = null
  verificationCode.value = ''
  loginCardResetKey.value += 1
  clearChallengeTimer()
}

function expireChallenge() {
  clearLoginFlow()
  error.value = '验证码已过期，请重新登录'
}

function isChallengeExpired() {
  return !Number.isFinite(challengeExpiresAtMs.value) || challengeExpiresAtMs.value <= Date.now()
}

watch(challenge, (next) => {
  clearChallengeTimer()
  if (!next) return
  now.value = Date.now()
  challengeTimer = setInterval(() => {
    now.value = Date.now()
    if (isChallengeExpired()) {
      expireChallenge()
    }
  }, 1000)
})

onUnmounted(() => {
  clearLoginWelcomeTimer()
  clearLoginFlow()
})

async function handleCredentialsSubmit(payload: { username: string, password: string }) {
  if (loading.value) return
  error.value = ''
  loginSuccess.value = false
  enteringSystem.value = false
  welcomeRoleName.value = ''
  clearLoginWelcomeTimer()
  loginWelcomeOpen.value = false
  loading.value = true
  try {
    credentials.value = { ...payload }
    challenge.value = await createAdminLoginChallenge(credentials.value)
    verificationCode.value = ''
  }
  catch (err) {
    clearLoginFlow()
    error.value = err instanceof Error ? err.message : '登录失败，请稍后重试'
  }
  finally {
    loading.value = false
  }
}

function sessionWorkspaceType(data: VerifiedAdminLogin, username: string, role: AdminRole): 'core' | 'self' | 'tenant' {
  return inferSessionScopeType(username, role, data.scopeType) === 'platform' ? 'core' : 'tenant'
}

async function completeLogin(data: VerifiedAdminLogin) {
  const sourceCredentials = credentials.value
  if (!sourceCredentials || !data.token || !Number.isFinite(Date.parse(data.expiresAt))) {
    clearLoginFlow()
    throw new Error('登录会话无效，请重新登录')
  }

  const role = (data.adminRole || 'super_admin') as AdminRole
  const roleName = String(data.roleLabel || '').trim() || adminRoleDisplayLabel(role)
  const username = data.username || sourceCredentials.username
  const displayName = String(data.name || '').trim()

  setAdminSession({
    username,
    ...(displayName ? { name: displayName } : {}),
    token: data.token,
    expiresAt: data.expiresAt,
    role,
    loginAt: new Date().toISOString(),
    scopeType: inferSessionScopeType(username, role, data.scopeType),
    workspaceType: sessionWorkspaceType(data, username, role),
    tenantId: String(data.tenantId || 'default'),
    scopeTenantIds: Array.isArray(data.scopeTenantIds)
      ? data.scopeTenantIds.map(item => String(item || '').trim()).filter(Boolean)
      : undefined,
    ...(data.permissions ? { permissions: data.permissions } : {}),
  })
  clearLoginFlow()

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

  if (!data.permissions) {
    await syncAdminSessionProfile()
  }

  clearAdminVisitedTags()

  const session = getAdminSession()
  const homeTarget = resolveAdminHomeRoute(session)
  const rawRedirect = String(route.query.redirect || '').trim()
  let target: ReturnType<typeof resolveAdminHomeRoute> | string = homeTarget

  if (rawRedirect && rawRedirect !== '/' && rawRedirect.startsWith('/')) {
    const resolved = router.resolve(rawRedirect)
    const allowRoles = Array.isArray(resolved.meta?.roles) ? resolved.meta.roles : undefined
    if (
      resolved.matched.length
      && resolved.name !== 'login'
      && adminCanAccessMenuPath(session, resolved.path, allowRoles)
    ) {
      target = resolved.fullPath
    }
  }

  await router.replace(target)
}

async function handleVerificationSubmit(code: string) {
  if (loading.value || !challenge.value) return
  if (isChallengeExpired()) {
    expireChallenge()
    return
  }
  error.value = ''
  loading.value = true
  try {
    const data = await verifyAdminLoginChallenge(challenge.value.challengeId, code)
    await completeLogin(data)
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

async function handleResend() {
  if (loading.value || !canResend.value || !credentials.value) return
  if (isChallengeExpired()) {
    expireChallenge()
    return
  }
  error.value = ''
  loading.value = true
  try {
    challenge.value = await createAdminLoginChallenge(credentials.value)
    verificationCode.value = ''
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : '重新发送失败，请稍后重试'
  }
  finally {
    loading.value = false
  }
}

function handleReturnToCredentials() {
  error.value = ''
  clearLoginFlow()
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
      :step="loginStep"
      :phone-masked="challenge?.phoneMasked || ''"
      :resend-seconds="resendSeconds"
      :resend-available="canResend"
      :verification-code="verificationCode"
      :reset-key="loginCardResetKey"
      :success="loginSuccess"
      :entering-system="enteringSystem"
      :welcome-role-name="welcomeRoleName"
      @submit="handleCredentialsSubmit"
      @verify="handleVerificationSubmit"
      @resend="handleResend"
      @back="handleReturnToCredentials"
      @update:verification-code="verificationCode = $event"
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
