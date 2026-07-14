<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import LoginForm from '~/components/auth/LoginForm.vue'
import { useMallAuth } from '~/composables/useMallAuth'
import { sanitizeTrafficLoginErrorMessage } from '~/utils/duodiandianLogin'

const route = useRoute()
const router = useRouter()
const { consumeDuodiandianLoginToken } = useMallAuth()

const trafficLogin = computed(() => String(route.query.trafficLogin || '') === '1')
const message = ref('登录中，请稍候...')
const failed = ref(false)
const attempts = ref(0)
let timer: ReturnType<typeof setTimeout> | null = null

function clearTimer() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

function readStatus(error: unknown) {
  if (!error || typeof error !== 'object') return 0
  const candidate = error as { status?: number, statusCode?: number, response?: { status?: number } }
  return Number(candidate.status || candidate.statusCode || candidate.response?.status || 0)
}

function readMessage(error: unknown) {
  if (error && typeof error === 'object') {
    const dataMsg = (error as { data?: { msg?: string } }).data?.msg
    if (typeof dataMsg === 'string' && dataMsg.trim()) return sanitizeTrafficLoginErrorMessage(dataMsg)
    const msg = (error as { message?: string }).message
    if (typeof msg === 'string' && msg.trim()) return sanitizeTrafficLoginErrorMessage(msg)
  }
  return sanitizeTrafficLoginErrorMessage('')
}

async function consumeTrafficLogin() {
  clearTimer()
  const channel = String(route.query.channel || '').trim()
  const applyNo = String(route.query.applyNo || '').trim()
  const token = String(route.query.token || '').trim()
  const consumePath = String(route.query.consumePath || '').trim()
  if (!channel || !applyNo || !token) {
    failed.value = true
    message.value = '登录状态确认中，请稍候重试'
    return
  }

  attempts.value += 1
  try {
    await consumeDuodiandianLoginToken({ channel, applyNo, token, consumePath })
    message.value = '登录成功，正在进入商城...'
    await router.replace('/')
  }
  catch (error) {
    const status = readStatus(error)
    const msg = readMessage(error)
    if ((status === 409 || /审核中|稍候|409/.test(msg)) && attempts.value < 20) {
      message.value = '登录中，请稍候...'
      timer = setTimeout(() => {
        void consumeTrafficLogin()
      }, 1500)
      return
    }
    failed.value = true
    message.value = msg
  }
}

onMounted(() => {
  if (trafficLogin.value) {
    void consumeTrafficLogin()
  }
})

onBeforeUnmount(clearTimer)
</script>

<template>
  <section
    v-if="trafficLogin"
    class="wv-bg-login-page min-h-screen px-5 pb-10"
    style="padding-top: max(2.5rem, var(--app-safe-area-top));"
  >
    <div class="relative mx-auto flex min-h-[72vh] w-full max-w-[390px] items-center p-5">
      <div class="w-full rounded-[28px] border border-black/[0.05] bg-white/90 p-7 text-center shadow-[0_18px_50px_rgba(31,36,48,0.10)]">
        <div class="wv-gradient-amber-icon mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl shadow-[0_8px_18px_rgba(221,146,25,0.22)]">
          <Icon name="tabler:diamond-filled" size="1.2rem" class="text-[#7c4d08]" />
        </div>
        <p class="mb-2 text-xs tracking-[0.22em] text-black/45">
          AMBER MALL
        </p>
        <h1 class="text-[1.8rem] font-semibold leading-tight text-[#1f2430]">
          {{ failed ? '登录状态确认中' : '登录中' }}
        </h1>
        <p class="mt-3 text-[15px] leading-7 text-black/55">
          {{ message }}
        </p>
        <button
          v-if="failed"
          type="button"
          class="wv-gradient-primary mt-6 w-full rounded-full py-3 text-[1.15rem] font-semibold transition hover:brightness-105"
          @click="router.replace('/login')"
        >
          重新进入商城
        </button>
      </div>
    </div>
  </section>
  <div
    v-else
    class="min-h-screen"
    style="padding-top: var(--app-safe-area-top);"
  >
    <LoginForm />
  </div>
</template>
