<script setup lang="ts">
import type { UploadProps } from 'element-plus'
import type { RegisterPayload } from '~/composables/useMallAuth'

interface RegisterFormModel {
  name: string
  phone: string
  idCardFront: string
  idCardBack: string
  locationText: string
  latitude: number | null
  longitude: number | null
}

const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const { register } = useMallAuth()

const submitting = ref(false)
const locating = ref(false)
const form = ref<RegisterFormModel>({
  name: '',
  phone: '',
  idCardFront: '',
  idCardBack: '',
  locationText: '',
  latitude: null,
  longitude: null,
})

const uploadTips = '请上传清晰证件照片，仅用于实名核验'

if (import.meta.client && typeof route.query.phone === 'string') {
  form.value.phone = route.query.phone
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

const onFrontUpload: UploadProps['onChange'] = async (uploadFile) => {
  const rawFile = uploadFile.raw
  if (!rawFile) {
    return
  }
  form.value.idCardFront = await readFileAsDataUrl(rawFile)
}

const onBackUpload: UploadProps['onChange'] = async (uploadFile) => {
  const rawFile = uploadFile.raw
  if (!rawFile) {
    return
  }
  form.value.idCardBack = await readFileAsDataUrl(rawFile)
}

const phoneReg = /^1\d{10}$/

function validateForm() {
  if (!form.value.name.trim()) {
    ElMessage.warning('请填写姓名')
    return false
  }
  if (!phoneReg.test(form.value.phone.trim())) {
    ElMessage.warning('请输入正确的手机号')
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
  if (!form.value.locationText || form.value.latitude === null || form.value.longitude === null) {
    ElMessage.warning('请先获取当前位置')
    return false
  }
  return true
}

function requestLocation() {
  if (!import.meta.client || !navigator.geolocation) {
    ElMessage.error('当前设备不支持定位')
    return
  }

  locating.value = true
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords
      form.value.latitude = latitude
      form.value.longitude = longitude
      form.value.locationText = `纬度 ${latitude.toFixed(6)}，经度 ${longitude.toFixed(6)}`
      locating.value = false
      ElMessage.success('定位成功')
    },
    () => {
      locating.value = false
      ElMessage.error('定位失败，请确认定位权限已开启')
    },
    { enableHighAccuracy: true, timeout: 12000 },
  )
}

async function handleSubmit() {
  if (!validateForm()) {
    return
  }

  submitting.value = true
  const payload: RegisterPayload = {
    name: form.value.name.trim(),
    phone: form.value.phone.trim(),
    idCardFront: form.value.idCardFront,
    idCardBack: form.value.idCardBack,
    locationText: form.value.locationText,
    latitude: form.value.latitude as number,
    longitude: form.value.longitude as number,
  }

  register(payload)
  ElMessage.success('注册成功')

  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
  await smartNavigate(redirect.startsWith('/') ? redirect : '/')
  submitting.value = false
}

async function goLogin() {
  await smartNavigate({
    path: '/login',
    query: {
      phone: form.value.phone.trim(),
      redirect: typeof route.query.redirect === 'string' ? route.query.redirect : '/',
    },
  })
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
        先完成实名注册，再开启商城购买与分期服务。
      </p>
    </div>

    <div class="-mt-4 px-4 pb-8">
      <div class="space-y-4 rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
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
      </div>

      <div class="mt-4 rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
        <div class="mb-1 flex items-center justify-between">
          <p class="text-sm font-medium text-black/75">
            身份证上传
          </p>
          <span class="text-xs text-black/45">实名核验</span>
        </div>
        <p class="mb-3 text-xs text-black/45">
          {{ uploadTips }}
        </p>

        <div class="grid grid-cols-2 gap-3">
          <el-upload
            class="w-full"
            :show-file-list="false"
            :auto-upload="false"
            accept="image/*"
            @change="onFrontUpload"
          >
            <button
              type="button"
              class="w-full overflow-hidden rounded-xl border border-dashed border-black/20 bg-[#fafafa]"
            >
              <img
                v-if="form.idCardFront"
                :src="form.idCardFront"
                alt="身份证正面"
                class="h-24 w-full object-cover"
              >
              <div
                v-else
                class="flex h-24 items-center justify-center text-xs text-black/60"
              >
                上传身份证正面
              </div>
            </button>
          </el-upload>

          <el-upload
            class="w-full"
            :show-file-list="false"
            :auto-upload="false"
            accept="image/*"
            @change="onBackUpload"
          >
            <button
              type="button"
              class="w-full overflow-hidden rounded-xl border border-dashed border-black/20 bg-[#fafafa]"
            >
              <img
                v-if="form.idCardBack"
                :src="form.idCardBack"
                alt="身份证反面"
                class="h-24 w-full object-cover"
              >
              <div
                v-else
                class="flex h-24 items-center justify-center text-xs text-black/60"
              >
                上传身份证反面
              </div>
            </button>
          </el-upload>
        </div>
      </div>

      <div class="mt-4 rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
        <div class="mb-2 flex items-center justify-between">
          <p class="text-sm font-medium text-black/75">
            当前定位
          </p>
          <span
            class="text-xs"
            :class="form.locationText ? 'text-[var(--theme-color)]' : 'text-black/45'"
          >
            {{ form.locationText ? '已获取定位' : '未获取定位' }}
          </span>
        </div>
        <el-input
          :model-value="form.locationText"
          readonly
          placeholder="请点击下方按钮获取定位"
          size="large"
        />
        <button
          type="button"
          class="mt-3 w-full rounded-xl bg-[#edf2f5] py-2.5 text-sm text-black/70"
          :disabled="locating"
          @click="requestLocation"
        >
          {{ locating ? '定位中...' : '获取定位' }}
        </button>
      </div>

      <button
        type="button"
        class="mt-6 w-full rounded-xl bg-[var(--theme-color)] py-3.5 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(0,113,98,0.25)]"
        :disabled="submitting"
        @click="handleSubmit"
      >
        {{ submitting ? '提交中...' : '完成注册' }}
      </button>
    </div>
  </section>
</template>
