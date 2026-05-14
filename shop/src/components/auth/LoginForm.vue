<script setup lang="ts">
import { normalizeMallAccount } from '~/composables/useMallAuth'

const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const { syncFromStorage, loginByPhone, loginByPassword, sendLoginSms } = useMallAuth()

type LoginMode = 'sms' | 'password'
const loginMode = ref<LoginMode>('sms')

const phone = ref('')
const verifyCode = ref('')
const password = ref('')
const showPassword = ref(false)
const agree = ref(true)
const countdown = ref(0)
const smsSending = ref(false)
let smsTimer: ReturnType<typeof setInterval> | null = null

onUnmounted(() => {
  if (smsTimer) {
    clearInterval(smsTimer)
    smsTimer = null
  }
})

const phoneReg = /^1\d{10}$/
const submitting = ref(false)

const codeButtonText = computed(() => {
  if (smsSending.value) {
    return '发送中…'
  }
  return countdown.value > 0 ? `${countdown.value}s` : '获取验证码'
})

const canSubmit = computed(() => {
  const p = phone.value.trim()
  if (!p || !agree.value) {
    return false
  }
  if (loginMode.value === 'sms') {
    return /^\d{6}$/.test(verifyCode.value.trim())
  }
  return password.value.trim().length >= 6
})

if (!import.meta.env.SSR) {
  syncFromStorage()
  if (typeof route.query.phone === 'string') {
    phone.value = route.query.phone
  }
}

function validatePhone() {
  const account = normalizeMallAccount(phone.value)
  if (!phoneReg.test(account)) {
    ElMessage.warning('请输入正确的手机号')
    return false
  }
  return true
}

async function handleSendLoginSms() {
  if (!validatePhone() || countdown.value > 0 || smsSending.value) {
    return
  }
  smsSending.value = true
  try {
    await sendLoginSms(normalizeMallAccount(phone.value))
    ElMessage.success('验证码已发送')
    countdown.value = 60
    if (smsTimer) {
      clearInterval(smsTimer)
    }
    smsTimer = setInterval(() => {
      countdown.value -= 1
      if (countdown.value <= 0 && smsTimer) {
        clearInterval(smsTimer)
        smsTimer = null
      }
    }, 1000)
  }
  catch (e) {
    const text = (e as Error).message || '发送失败，请稍后重试'
    if (text.includes('未注册')) {
      ElMessage.warning(text)
    }
    else {
      ElMessage.error(text)
    }
  }
  finally {
    smsSending.value = false
  }
}

async function goRegister() {
  await smartNavigate({
    path: '/register',
    query: {
      redirect: typeof route.query.redirect === 'string' ? route.query.redirect : '/my',
      phone: phone.value.trim(),
    },
  })
}

async function openUserAgreement() {
  await smartNavigate('/user-agreement')
}

async function openPrivacyPolicy() {
  await smartNavigate('/privacy-policy')
}

function resolveSubmitError(error: unknown): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: { msg?: string, message?: string } }).data
    const m = data?.msg || data?.message
    if (m) {
      return String(m)
    }
  }
  return (error as Error)?.message || '登录失败'
}

async function submitLogin() {
  if (submitting.value) {
    return
  }
  if (!validatePhone()) {
    return
  }
  if (loginMode.value === 'sms') {
    if (!/^\d{6}$/.test(verifyCode.value.trim())) {
      ElMessage.warning('请输入 6 位短信验证码')
      return
    }
  }
  else {
    if (password.value.trim().length < 6) {
      ElMessage.warning('密码至少 6 位')
      return
    }
  }
  if (!agree.value) {
    ElMessage.warning('请先同意用户协议和隐私政策')
    return
  }

  const normalizedPhone = normalizeMallAccount(phone.value)
  const rawRedirect = typeof route.query.redirect === 'string' ? route.query.redirect.trim() : ''
  const redirect = rawRedirect.startsWith('/') ? rawRedirect : '/my'

  submitting.value = true
  try {
    if (loginMode.value === 'sms') {
      await loginByPhone(normalizedPhone, verifyCode.value.trim())
    }
    else {
      await loginByPassword(normalizedPhone, password.value.trim())
    }
    ElMessage.success('登录成功')
    await smartNavigate(redirect)
  }
  catch (error) {
    const message = resolveSubmitError(error)
    ElMessage.warning(message)
    if (message.includes('未注册')) {
      await goRegister()
    }
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="min-h-screen bg-gradient-to-b from-[#f3f1f8] to-[#eef1f7] px-5 py-10">
    <div class="relative mx-auto w-full max-w-[390px] p-5">
      <div class="mb-6 flex items-center gap-3">
        <div class="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#ffdba0] to-[#f8bb54] shadow-[0_6px_14px_rgba(221,146,25,0.24)]">
          <Icon
            name="tabler:diamond-filled"
            size="0.95rem"
            class="text-[#7c4d08]"
          />
        </div>
        <div>
          <p class="text-xs tracking-[0.22em] text-black/45">
            AMBER MALL
          </p>
          <h1 class="text-[1.85rem] font-semibold leading-tight text-[#1f2430]">
            欢迎来到琥珀商城
          </h1>
        </div>
      </div>

      <div class="mb-4 flex rounded-full border border-black/[0.06] bg-white/90 p-1 shadow-sm">
        <button
          type="button"
          class="flex-1 rounded-full py-2 text-sm font-semibold transition"
          :class="loginMode === 'sms' ? 'bg-gradient-to-r from-[#ff8594] to-[#f56a7d] text-white shadow-[0_4px_12px_rgba(235,112,137,0.35)]' : 'text-black/50'"
          @click="loginMode = 'sms'"
        >
          验证码登录
        </button>
        <button
          type="button"
          class="flex-1 rounded-full py-2 text-sm font-semibold transition"
          :class="loginMode === 'password' ? 'bg-gradient-to-r from-[#ff8594] to-[#f56a7d] text-white shadow-[0_4px_12px_rgba(235,112,137,0.35)]' : 'text-black/50'"
          @click="loginMode = 'password'"
        >
          密码登录
        </button>
      </div>

      <div class="space-y-3">
        <div class="input-shell group">
          <Icon
            name="tabler:device-mobile"
            size="1.05rem"
            class="input-icon"
          />
          <el-input
            v-model="phone"
            class="login-input"
            placeholder="请输入手机号"
            maxlength="11"
            clearable
            size="large"
          />
        </div>

        <template v-if="loginMode === 'sms'">
          <div class="flex items-center gap-2.5">
            <div class="input-shell flex-1 group">
              <Icon
                name="tabler:shield-lock"
                size="0.95rem"
                class="input-icon"
              />
              <el-input
                v-model="verifyCode"
                class="login-input"
                placeholder="请输入验证码"
                maxlength="6"
                size="large"
              />
            </div>
            <button
              type="button"
              class="h-[52px] shrink-0 rounded-full bg-gradient-to-r from-[#ff8594] to-[#f56a7d] px-4 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-70"
              :disabled="countdown > 0 || smsSending"
              @click="handleSendLoginSms"
            >
              {{ codeButtonText }}
            </button>
          </div>
        </template>

        <template v-else>
          <div class="input-shell group">
            <Icon
              name="tabler:lock"
              size="1rem"
              class="input-icon"
            />
            <el-input
              v-model="password"
              class="login-input"
              placeholder="请输入登录密码（至少 6 位）"
              size="large"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              clearable
            />
            <button
              type="button"
              class="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#f08092] transition hover:bg-black/[0.04]"
              aria-label="切换密码可见"
              @click="showPassword = !showPassword"
            >
              <Icon :name="showPassword ? 'tabler:eye-off' : 'tabler:eye'" size="1.15rem" />
            </button>
          </div>
        </template>
      </div>

      <div class="mt-6 flex items-start gap-2 text-sm text-black/55">
        <input
          id="agree"
          v-model="agree"
          type="checkbox"
          class="mt-1 h-4 w-4 shrink-0 accent-[#38a169]"
        >
        <div class="min-w-0 leading-6">
          <label
            for="agree"
            class="cursor-pointer select-none"
          >我已阅读并同意</label>
          <button
            type="button"
            class="font-medium text-[#e87b8f] underline decoration-[#e87b8f]/35 underline-offset-2 transition hover:text-[#d45f78]"
            @click="openUserAgreement"
          >
            《用户注册协议》
          </button>
          <span>和</span>
          <button
            type="button"
            class="font-medium text-[#e87b8f] underline decoration-[#e87b8f]/35 underline-offset-2 transition hover:text-[#d45f78]"
            @click="openPrivacyPolicy"
          >
            《用户隐私政策》
          </button>
        </div>
      </div>

      <button
        type="button"
        class="mt-7 w-full rounded-full bg-gradient-to-r from-[#ff8292] to-[#f06b81] py-3 text-[1.5rem] font-semibold text-white shadow-[0_10px_20px_rgba(235,112,137,0.22)] transition hover:brightness-105 disabled:opacity-60"
        :disabled="!canSubmit || submitting"
        @click="submitLogin"
      >
        {{ submitting ? '登录中...' : '注册/登录' }}
      </button>

      <button
        type="button"
        class="mt-4 w-full text-center text-[15px] font-semibold text-[#e84d7a] underline decoration-2 underline-offset-[6px] decoration-[#f5a3b5] transition hover:text-[#d43d6a] hover:decoration-[#e84d7a] active:opacity-90"
        @click="goRegister"
      >
        没有账号？去完成注册
      </button>
    </div>
  </section>
</template>

<style scoped>
.input-shell {
  display: flex;
  align-items: center;
  height: 52px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(0, 0, 0, 0.06);
  padding: 0 14px;
  transition: all 0.25s ease;
}

.input-shell:focus-within {
  border-color: rgba(239, 116, 139, 0.45);
  box-shadow: 0 0 0 3px rgba(239, 116, 139, 0.12);
}

.input-icon {
  margin-right: 8px;
  color: #f08092;
}

.login-input:deep(.el-input__wrapper) {
  padding: 0;
  background: transparent;
  box-shadow: none;
  flex: 1;
}

.login-input:deep(.el-input__inner) {
  height: 1.95rem;
  /* ≥16px：防止移动端聚焦时系统强制缩放（见全局 main.scss H5 规则） */
  font-size: max(16px, 0.98rem);
  color: rgba(20, 20, 20, 0.82);
}

.login-input:deep(.el-input__inner::placeholder) {
  color: rgba(20, 20, 20, 0.38);
}
</style>
