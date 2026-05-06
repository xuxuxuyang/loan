<script setup lang="ts">
const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const { isRegistered, profile, syncFromStorage, loginByPhone } = useMallAuth()

const phone = ref('')
const verifyCode = ref('')
const agree = ref(true)
const countdown = ref(0)

const phoneReg = /^1\d{10}$/
const TEST_ACCOUNT = 'admin'
const TEST_CODE = '1234'
const submitting = ref(false)

const codeButtonText = computed(() => {
  return countdown.value > 0 ? `${countdown.value}s` : '获取验证码'
})

const canSubmit = computed(() => {
  return !!phone.value.trim() && !!verifyCode.value.trim() && agree.value
})

if (import.meta.client) {
  syncFromStorage()
  if (typeof route.query.phone === 'string') {
    phone.value = route.query.phone
  }
}

function validatePhone() {
  const account = phone.value.trim()
  if (account === TEST_ACCOUNT) {
    return true
  }
  if (!phoneReg.test(account)) {
    ElMessage.warning('请输入正确的手机号')
    return false
  }
  return true
}

function isTestLogin() {
  return phone.value.trim() === TEST_ACCOUNT
}

function sendCode() {
  if (!validatePhone() || countdown.value > 0) {
    return
  }

  if (isTestLogin()) {
    ElMessage.info('测试账号验证码固定为 1234')
    return
  }

  ElMessage.success('验证码已发送（演示）')
  countdown.value = 60
  const timer = window.setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0) {
      window.clearInterval(timer)
    }
  }, 1000)
}

async function goRegister() {
  await smartNavigate({
    path: '/register',
    query: {
      redirect: typeof route.query.redirect === 'string' ? route.query.redirect : '/',
      phone: phone.value.trim(),
    },
  })
}

async function submitLogin() {
  if (submitting.value) {
    return
  }
  if (!validatePhone()) {
    return
  }
  if (!verifyCode.value.trim()) {
    ElMessage.warning('请输入验证码')
    return
  }
  if (!agree.value) {
    ElMessage.warning('请先同意用户协议和隐私政策')
    return
  }

  if (isTestLogin()) {
    if (verifyCode.value.trim() !== TEST_CODE) {
      ElMessage.warning('测试账号验证码错误，请输入 1234')
      return
    }
    submitting.value = true
    loginByPhone(TEST_ACCOUNT)
    ElMessage.success('测试账号登录成功')
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await smartNavigate(redirect.startsWith('/') ? redirect : '/')
    submitting.value = false
    return
  }

  if (!isRegistered.value || !profile.value) {
    ElMessage.warning('该手机号未注册，请先完成注册')
    await goRegister()
    return
  }

  if (profile.value.phone !== phone.value.trim()) {
    ElMessage.warning('手机号与已注册信息不一致')
    return
  }

  submitting.value = true
  loginByPhone(phone.value.trim())
  ElMessage.success('登录成功')
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
  await smartNavigate(redirect.startsWith('/') ? redirect : '/')
  submitting.value = false
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
            :disabled="countdown > 0"
            @click="sendCode"
          >
            {{ codeButtonText }}
          </button>
        </div>
      </div>

      <div class="mt-6 flex items-start text-sm text-black/55">
        <input
          id="agree"
          v-model="agree"
          type="checkbox"
          class="mr-2 mt-1 h-4 w-4 accent-[#38a169]"
        >
        <label
          for="agree"
          class="leading-6"
        >
          我已阅读并同意
          <span class="text-[#e87b8f]">《用户注册协议》</span>
          和
          <span class="text-[#e87b8f]">《用户隐私政策》</span>
        </label>
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
        class="mt-4 w-full text-center text-[15px] text-black/45"
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
}

.login-input:deep(.el-input__inner) {
  height: 1.95rem;
  font-size: 0.98rem;
  color: rgba(20, 20, 20, 0.82);
}

.login-input:deep(.el-input__inner::placeholder) {
  color: rgba(20, 20, 20, 0.38);
}
</style>
