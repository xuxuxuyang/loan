<script setup lang="ts">
import type { UploadProps } from 'element-plus'
import { captureRegisterChannelFromRoute } from '../../composables/useRegisterChannel'

interface RegisterFormModel {
  name: string
  phone: string
  smsCode: string
  password: string
  passwordConfirm: string
  idNumber: string
  idCardFront: string
  idCardBack: string
  idCardHandheld: string
}

const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const { register, sendRegisterSms } = useMallAuth()

const agree = ref(false)
const submitting = ref(false)
const smsSending = ref(false)
const smsCooldown = ref(0)
let smsTimer: ReturnType<typeof setInterval> | null = null

onUnmounted(() => {
  if (smsTimer) {
    clearInterval(smsTimer)
    smsTimer = null
  }
})

const form = ref<RegisterFormModel>({
  name: '',
  phone: '',
  smsCode: '',
  password: '',
  passwordConfirm: '',
  idNumber: '',
  idCardFront: '',
  idCardBack: '',
  idCardHandheld: '',
})

const uploadTips = '请上传身份证正面、反面及手持身份证照片；将自动压缩后上传，仅用于实名核验'

if (!import.meta.env.SSR && typeof route.query.phone === 'string') {
  form.value.phone = route.query.phone
}

onMounted(() => {
  if (!import.meta.env.SSR) {
    captureRegisterChannelFromRoute(route.query as Record<string, unknown>)
  }
})

/** 证件照：限制长边、转 JPEG，避免 base64 撑爆请求体（413） */
const ID_CARD_IMAGE_MAX_EDGE = 1280
const ID_CARD_JPEG_QUALITY = 0.82

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

function drawToJpegDataUrl(source: CanvasImageSource, sw: number, sh: number, quality: number): string {
  const scale = Math.min(1, ID_CARD_IMAGE_MAX_EDGE / Math.max(sw, sh))
  const cw = Math.max(1, Math.round(sw * scale))
  const ch = Math.max(1, Math.round(sh * scale))
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('canvas')
  }
  ctx.drawImage(source, 0, 0, sw, sh, 0, 0, cw, ch)
  return canvas.toDataURL('image/jpeg', quality)
}

async function compressImageFileToJpegDataUrl(file: File): Promise<string> {
  if (import.meta.env.SSR) {
    return readFileAsDataUrl(file)
  }
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      try {
        return drawToJpegDataUrl(bitmap, bitmap.width, bitmap.height, ID_CARD_JPEG_QUALITY)
      }
      finally {
        bitmap.close()
      }
    }
    catch {
      // HEIC 等可能失败，走 Image 解码
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      try {
        resolve(drawToJpegDataUrl(img, img.naturalWidth, img.naturalHeight, ID_CARD_JPEG_QUALITY))
      }
      catch (e) {
        reject(e)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片无法解析，请换 JPG/PNG 格式重试'))
    }
    img.src = url
  })
}

async function processIdCardUpload(file: File): Promise<string> {
  try {
    return await compressImageFileToJpegDataUrl(file)
  }
  catch (e) {
    console.warn('[RegisterForm] compress failed, use original', e)
    return readFileAsDataUrl(file)
  }
}

const onFrontUpload: UploadProps['onChange'] = async (uploadFile) => {
  const rawFile = uploadFile.raw
  if (!rawFile) {
    return
  }
  try {
    form.value.idCardFront = await processIdCardUpload(rawFile)
  }
  catch {
    ElMessage.error('正面照片处理失败，请重选图片')
  }
}

const onBackUpload: UploadProps['onChange'] = async (uploadFile) => {
  const rawFile = uploadFile.raw
  if (!rawFile) {
    return
  }
  try {
    form.value.idCardBack = await processIdCardUpload(rawFile)
  }
  catch {
    ElMessage.error('反面照片处理失败，请重选图片')
  }
}

const onHandheldUpload: UploadProps['onChange'] = async (uploadFile) => {
  const rawFile = uploadFile.raw
  if (!rawFile) {
    return
  }
  try {
    form.value.idCardHandheld = await processIdCardUpload(rawFile)
  }
  catch {
    ElMessage.error('手持身份证照片处理失败，请重选图片')
  }
}

const phoneReg = /^1\d{10}$/
const idCardReg = /^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/

function validateForm() {
  if (!form.value.name.trim()) {
    ElMessage.warning('请填写姓名')
    return false
  }
  if (!phoneReg.test(form.value.phone.trim())) {
    ElMessage.warning('请输入正确的手机号')
    return false
  }
  if (!/^\d{6}$/.test(form.value.smsCode.trim())) {
    ElMessage.warning('请输入 6 位短信验证码')
    return false
  }
  const pwd = form.value.password.trim()
  if (pwd.length < 6) {
    ElMessage.warning('登录密码至少 6 位')
    return false
  }
  if (pwd !== form.value.passwordConfirm.trim()) {
    ElMessage.warning('两次输入的密码不一致')
    return false
  }
  const idUpper = form.value.idNumber.trim().toUpperCase()
  if (!idUpper) {
    ElMessage.warning('请填写身份证号码')
    return false
  }
  if (!idCardReg.test(idUpper)) {
    ElMessage.warning('身份证号码格式不正确')
    return false
  }
  if (!form.value.idCardFront) {
    ElMessage.warning('请上传身份证正面')
    return false
  }
  if (!form.value.idCardBack) {
    ElMessage.warning('请上传身份证反面')
    return false
  }
  if (!form.value.idCardHandheld) {
    ElMessage.warning('请上传手持身份证照片')
    return false
  }
  return true
}

async function handleSubmit() {
  if (!validateForm()) {
    return
  }
  if (!agree.value) {
    ElMessage.warning('请先阅读并同意用户注册协议和隐私政策')
    return
  }

  submitting.value = true
  const pwdSubmit = form.value.password.trim()
  const payload = {
    name: form.value.name.trim(),
    phone: form.value.phone.trim(),
    smsCode: form.value.smsCode.trim(),
    password: pwdSubmit,
    idNumber: form.value.idNumber.trim().toUpperCase(),
    idCardFront: form.value.idCardFront,
    idCardBack: form.value.idCardBack,
    idCardHandheld: form.value.idCardHandheld,
  }

  try {
    await register(payload)
    ElMessage.success('注册成功')

    const raw = typeof route.query.redirect === 'string' ? route.query.redirect.trim() : ''
    const redirect = raw.startsWith('/') ? raw : '/my'
    await smartNavigate(redirect)
  }
  catch (error) {
    const text = (error as Error).message || '注册失败，请稍后重试'
    if (text.includes('已注册')) {
      ElMessage.warning(text)
    }
    else if (text.includes('413') || text.toLowerCase().includes('entity too large')) {
      ElMessage.error('提交数据过大，请重新选择较小的照片或稍后重试（若仍失败请联系管理员放宽网关限制）')
    }
    else {
      ElMessage.error(text)
    }
  }
  finally {
    submitting.value = false
  }
}

async function handleSendSms() {
  const p = form.value.phone.trim()
  if (!phoneReg.test(p)) {
    ElMessage.warning('请先填写正确的手机号')
    return
  }
  if (smsCooldown.value > 0 || smsSending.value) {
    return
  }
  smsSending.value = true
  try {
    await sendRegisterSms(p)
    ElMessage.success('验证码已发送')
    smsCooldown.value = 60
    if (smsTimer) {
      clearInterval(smsTimer)
    }
    smsTimer = setInterval(() => {
      smsCooldown.value -= 1
      if (smsCooldown.value <= 0 && smsTimer) {
        clearInterval(smsTimer)
        smsTimer = null
      }
    }, 1000)
  }
  catch (e) {
    const text = (e as Error).message || '发送失败，请稍后重试'
    if (text.includes('已注册')) {
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

async function goLogin() {
  await smartNavigate({
    path: '/login',
    query: {
      phone: form.value.phone.trim(),
      redirect: typeof route.query.redirect === 'string' ? route.query.redirect : '/my',
    },
  })
}

async function openUserAgreement() {
  await smartNavigate('/user-agreement')
}

async function openPrivacyPolicy() {
  await smartNavigate('/privacy-policy')
}
</script>

<template>
  <section class="min-h-screen bg-[#f4f6f8]">
    <div class="rounded-b-[28px] bg-gradient-to-r from-[#0b7b6e] to-[#18a08f] px-5 pb-8 pt-10 text-white shadow-sm">
      <div class="mb-2 flex items-center justify-between">
        <p class="text-xs tracking-[0.18em] uppercase text-emerald-100">
          Tea Mall
        </p>
        <button
          type="button"
          class="text-xs text-white/85"
          @click="goLogin"
        >
          返回登录
        </button>
      </div>
      <h1 class="mb-2 text-[26px] font-semibold leading-tight">
        用户注册
      </h1>
      <p class="text-sm text-white/85">
        先完成实名注册，再开启商城购买与先享后付服务。
      </p>
    </div>

    <div class="-mt-4 px-4 pb-8">
      <div class="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
        <div class="space-y-4">
          <div>
            <p class="mb-2 text-sm font-medium text-black/75">
              姓名
            </p>
            <el-input
              v-model="form.name"
              placeholder="请输入真实姓名"
              clearable
              size="large"
            />
          </div>

          <div>
            <p class="mb-2 text-sm font-medium text-black/75">
              手机号码
            </p>
            <el-input
              v-model="form.phone"
              placeholder="请输入11位手机号"
              maxlength="11"
              clearable
              size="large"
            />
          </div>

          <div>
            <p class="mb-2 text-sm font-medium text-black/75">
              短信验证码
            </p>
            <div class="flex gap-2">
              <el-input
                v-model="form.smsCode"
                class="min-w-0 flex-1"
                placeholder="6 位验证码"
                maxlength="6"
                clearable
                size="large"
              />
              <el-button
                type="primary"
                size="large"
                class="shrink-0"
                :disabled="smsSending || smsCooldown > 0"
                @click="handleSendSms"
              >
                {{ smsCooldown > 0 ? `${smsCooldown}s` : (smsSending ? '发送中…' : '获取验证码') }}
              </el-button>
            </div>
          </div>

          <div>
            <p class="mb-2 text-sm font-medium text-black/75">
              登录密码
            </p>
            <el-input
              v-model="form.password"
              type="password"
              show-password
              placeholder="至少 6 位，用于商城密码登录"
              autocomplete="new-password"
              clearable
              size="large"
            />
          </div>

          <div>
            <p class="mb-2 text-sm font-medium text-black/75">
              确认密码
            </p>
            <el-input
              v-model="form.passwordConfirm"
              type="password"
              show-password
              placeholder="请再次输入登录密码"
              autocomplete="new-password"
              clearable
              size="large"
            />
          </div>

          <div>
            <p class="mb-2 text-sm font-medium text-black/75">
              身份证号码
            </p>
            <el-input
              v-model="form.idNumber"
              placeholder="18位二代身份证号"
              maxlength="18"
              clearable
              size="large"
            />
          </div>
        </div>

        <div class="my-4 h-px bg-black/8" />

        <div>
          <div class="mb-1 flex items-center justify-center gap-2">
            <p class="text-sm font-medium text-black/75">
              身份证上传
            </p>
            <span class="text-xs text-black/45">实名核验</span>
          </div>
          <p class="mb-3 text-center text-xs text-black/45">
            {{ uploadTips }}
          </p>

          <div class="mx-auto grid w-full max-w-[340px] grid-cols-2 gap-3">
            <el-upload
              class="id-upload-slot w-full"
              :show-file-list="false"
              :auto-upload="false"
              accept="image/*"
              @change="onFrontUpload"
            >
              <button
                type="button"
                class="relative block h-24 w-full overflow-hidden rounded-xl border border-dashed border-black/20 bg-[#fafafa] text-left"
              >
                <img
                  v-if="form.idCardFront"
                  :src="form.idCardFront"
                  alt="身份证正面"
                  class="absolute inset-0 h-full w-full object-cover"
                >
                <div
                  v-else
                  class="relative flex h-24 w-full items-center justify-center px-2 text-xs text-black/60"
                >
                  上传身份证正面
                </div>
              </button>
            </el-upload>

            <el-upload
              class="id-upload-slot w-full"
              :show-file-list="false"
              :auto-upload="false"
              accept="image/*"
              @change="onBackUpload"
            >
              <button
                type="button"
                class="relative block h-24 w-full overflow-hidden rounded-xl border border-dashed border-black/20 bg-[#fafafa] text-left"
              >
                <img
                  v-if="form.idCardBack"
                  :src="form.idCardBack"
                  alt="身份证反面"
                  class="absolute inset-0 h-full w-full object-cover"
                >
                <div
                  v-else
                  class="relative flex h-24 w-full items-center justify-center px-2 text-xs text-black/60"
                >
                  上传身份证反面
                </div>
              </button>
            </el-upload>

            <el-upload
              class="id-upload-slot col-span-2 w-full"
              :show-file-list="false"
              :auto-upload="false"
              accept="image/*"
              @change="onHandheldUpload"
            >
              <button
                type="button"
                class="relative block h-28 w-full overflow-hidden rounded-xl border border-dashed border-black/20 bg-[#fafafa] text-left"
              >
                <img
                  v-if="form.idCardHandheld"
                  :src="form.idCardHandheld"
                  alt="手持身份证"
                  class="absolute inset-0 h-full w-full object-cover"
                >
                <div
                  v-else
                  class="relative flex h-28 w-full items-center justify-center px-3 py-3 text-center text-xs leading-snug text-black/60"
                >
                  上传手持身份证照片（人像与证件清晰可辨）
                </div>
              </button>
            </el-upload>
          </div>
        </div>
      </div>

      <div class="mt-5 flex items-start gap-2 text-sm text-black/55">
        <input
          id="register-agree"
          v-model="agree"
          type="checkbox"
          class="mt-1 h-4 w-4 shrink-0 accent-[#38a169]"
        >
        <div class="min-w-0 leading-6">
          <label
            for="register-agree"
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
        class="mt-5 w-full rounded-full bg-gradient-to-r from-[#ff8292] to-[#f06b81] py-3.5 text-base font-semibold text-white shadow-[0_10px_22px_rgba(235,112,137,0.28)] transition hover:brightness-105 disabled:opacity-60"
        :disabled="submitting"
        @click="handleSubmit"
      >
        {{ submitting ? '提交中...' : '完成注册' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
/* el-upload 默认 inline，占不满格宽；拉满与占位同宽 */
.id-upload-slot :deep(.el-upload) {
  display: block;
  width: 100%;
}
</style>
