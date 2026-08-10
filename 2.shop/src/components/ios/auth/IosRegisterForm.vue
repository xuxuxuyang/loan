<script setup lang="ts">
import { registerIosMallAccount, sendIosRegisterSms } from '~/api/modules/iosMall'
import {
  captureRegisterChannelFromRoute,
  clearPendingRegisterChannel,
  getPendingRegisterChannel,
  resolveChannelFromRouteQuery,
} from '~/composables/useRegisterChannel'
import { notifyError, notifySuccess, notifyWarning } from '~/utils/epFeedback'

const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const profileState = useState<Record<string, unknown> | null>('mall-register-profile', () => null)
const loginPhoneState = useState<string>('mall-login-phone', () => '')
const registeredCookie = useCookie<string>('mall_registered', { maxAge: 60 * 60 * 24 * 365, default: () => '' })
const loginCookie = useCookie<string>('mall_login_phone', { maxAge: 60 * 60 * 24 * 30, default: () => '' })

const form = reactive({ phone: '', smsCode: '', password: '', passwordConfirm: '' })
const agree = ref(false)
const submitting = ref(false)
const smsSending = ref(false)
const smsCooldown = ref(0)
let smsTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  captureRegisterChannelFromRoute(route.query as Record<string, unknown>)
  if (typeof route.query.phone === 'string') form.phone = route.query.phone
})

onUnmounted(() => {
  if (smsTimer) clearInterval(smsTimer)
})

function normalizedPhone(): string {
  return form.phone.replace(/\D/g, '')
}

async function handleSendSms() {
  if (!/^1\d{10}$/.test(normalizedPhone())) {
    notifyWarning('请输入正确的手机号')
    return
  }
  if (smsSending.value || smsCooldown.value > 0) return
  smsSending.value = true
  try {
    await sendIosRegisterSms(normalizedPhone())
    notifySuccess('验证码已发送')
    smsCooldown.value = 60
    smsTimer = setInterval(() => {
      smsCooldown.value -= 1
      if (smsCooldown.value <= 0 && smsTimer) {
        clearInterval(smsTimer)
        smsTimer = null
      }
    }, 1000)
  }
  catch (error) {
    notifyError((error as Error).message)
  }
  finally {
    smsSending.value = false
  }
}

async function handleSubmit() {
  if (!/^1\d{10}$/.test(normalizedPhone())) {
    notifyWarning('请输入正确的手机号')
    return
  }
  if (!/^\d{6}$/.test(form.smsCode.trim())) {
    notifyWarning('请输入 6 位短信验证码')
    return
  }
  if (form.password.length < 6) {
    notifyWarning('登录密码至少 6 位')
    return
  }
  if (form.password !== form.passwordConfirm) {
    notifyWarning('两次输入的密码不一致')
    return
  }
  if (!agree.value) {
    notifyWarning('请先阅读并同意用户注册协议和隐私政策')
    return
  }

  submitting.value = true
  try {
    const channel = getPendingRegisterChannel()
      || resolveChannelFromRouteQuery(route.query as Record<string, unknown>)
    const user = await registerIosMallAccount({
      phone: normalizedPhone(),
      smsCode: form.smsCode.trim(),
      password: form.password,
      ...(channel ? { channel } : {}),
    })
    profileState.value = user
    loginPhoneState.value = normalizedPhone()
    registeredCookie.value = '1'
    loginCookie.value = normalizedPhone()
    clearPendingRegisterChannel()
    notifySuccess('注册成功')
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
      ? route.query.redirect
      : '/my'
    await smartNavigate(redirect)
  }
  catch (error) {
    notifyError((error as Error).message)
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="mx-auto min-h-screen max-w-md bg-[#f5f3ed] px-5 pb-10 pt-8 text-[#1f2925]">
    <div class="rounded-[28px] bg-[#173f35] px-6 py-7 text-white shadow-[0_18px_44px_rgba(23,63,53,.22)]">
      <p class="text-xs tracking-[.2em] text-[#c9ddc9] uppercase">iOS · Tea Mall</p>
      <h1 class="mt-3 text-3xl font-semibold">创建账号</h1>
      <p class="mt-3 text-sm leading-6 text-white/78">
        只需手机号、验证码和密码。普通购物无需提供身份证、紧急联系人或通讯录。
      </p>
    </div>

    <div class="mt-5 space-y-4 rounded-[24px] border border-[#173f35]/10 bg-white p-5 shadow-sm">
      <label class="block text-sm font-medium">手机号码
        <el-input v-model="form.phone" class="mt-2" inputmode="numeric" maxlength="11" placeholder="请输入 11 位手机号" size="large" />
      </label>
      <label class="block text-sm font-medium">短信验证码
        <div class="mt-2 flex gap-2">
          <el-input v-model="form.smsCode" inputmode="numeric" maxlength="6" placeholder="6 位验证码" size="large" />
          <el-button :disabled="smsSending || smsCooldown > 0" size="large" @click="handleSendSms">
            {{ smsCooldown > 0 ? `${smsCooldown}s` : (smsSending ? '发送中' : '获取验证码') }}
          </el-button>
        </div>
      </label>
      <label class="block text-sm font-medium">登录密码
        <el-input v-model="form.password" class="mt-2" type="password" show-password autocomplete="new-password" placeholder="至少 6 位" size="large" />
      </label>
      <label class="block text-sm font-medium">确认密码
        <el-input v-model="form.passwordConfirm" class="mt-2" type="password" show-password autocomplete="new-password" placeholder="再次输入密码" size="large" />
      </label>
    </div>

    <label class="mt-5 flex items-start gap-2 text-sm leading-6 text-[#55625d]">
      <input v-model="agree" type="checkbox" class="mt-1 h-4 w-4 accent-[#c66c42]">
      <span>我已阅读并同意
        <button class="text-[#a64f2d] underline" type="button" @click.prevent="smartNavigate('/user-agreement')">《用户注册协议》</button>
        和
        <button class="text-[#a64f2d] underline" type="button" @click.prevent="smartNavigate('/privacy-policy')">《用户隐私政策》</button>
      </span>
    </label>

    <button class="mt-6 w-full rounded-2xl bg-[#c66c42] px-5 py-3.5 font-semibold text-white shadow-[0_10px_24px_rgba(198,108,66,.24)] disabled:opacity-55" type="button" :disabled="submitting" @click="handleSubmit">
      {{ submitting ? '创建中…' : '创建账号' }}
    </button>
    <button class="mt-4 w-full text-sm text-[#55625d]" type="button" @click="smartNavigate('/login')">已有账号，返回登录</button>
  </section>
</template>
