<script setup lang="ts">
import type { IosIdCardScene, IosInstallmentProfileStatus, IosInstallmentProfileUpdate } from '~/api/modules/iosMall'
import { saveIosInstallmentProfile, uploadIosIdCard } from '~/api/modules/iosMall'
import { notifyError, notifySuccess, notifyWarning } from '~/utils/epFeedback'

const props = defineProps<{ phone: string }>()
const emit = defineEmits<{ saved: [status: IosInstallmentProfileStatus], cancel: [] }>()

const form = reactive<IosInstallmentProfileUpdate>({
  name: '',
  idNumber: '',
  idCardFront: '',
  idCardBack: '',
  idCardHandheld: '',
  emergencyContacts: [{ name: '', phone: '' }, { name: '', phone: '' }],
})
const uploading = reactive<Record<IosIdCardScene, boolean>>({ front: false, back: false, handheld: false })
const submitting = ref(false)
const IOS_IDENTITY_MAX_EDGE = 1280
const IOS_IDENTITY_JPEG_QUALITY = 0.82

interface DecodedIosIdentityImage {
  source: CanvasImageSource
  width: number
  height: number
  dispose: () => void
}

async function decodeIosIdentityImage(file: File): Promise<DecodedIosIdentityImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      if (bitmap.width > 0 && bitmap.height > 0) {
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          dispose: () => bitmap.close(),
        }
      }
      bitmap.close()
    }
    catch {
      // Older WebKit versions fall back to an image element below.
    }
  }

  return await new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        URL.revokeObjectURL(objectUrl)
        reject(new Error('INVALID_IMAGE_DIMENSIONS'))
        return
      }
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        dispose: () => URL.revokeObjectURL(objectUrl),
      })
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('IMAGE_DECODE_FAILED'))
    }
    image.src = objectUrl
  })
}

async function compressIosIdentityImage(file: File): Promise<File> {
  let decoded: DecodedIosIdentityImage | null = null
  try {
    decoded = await decodeIosIdentityImage(file)
    const scale = Math.min(1, IOS_IDENTITY_MAX_EDGE / Math.max(decoded.width, decoded.height))
    const width = Math.max(1, Math.round(decoded.width * scale))
    const height = Math.max(1, Math.round(decoded.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('CANVAS_UNAVAILABLE')
    context.drawImage(decoded.source, 0, 0, width, height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('IMAGE_ENCODE_FAILED')), 'image/jpeg', IOS_IDENTITY_JPEG_QUALITY)
    })
    const baseName = file.name.replace(/\.[^.]+$/, '').trim() || 'identity'
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
  }
  catch {
    throw new Error('无法读取该图片，请重新拍摄或选择 JPG/PNG 图片')
  }
  finally {
    decoded?.dispose()
  }
}

function imageField(scene: IosIdCardScene): 'idCardFront' | 'idCardBack' | 'idCardHandheld' {
  if (scene === 'front') return 'idCardFront'
  if (scene === 'back') return 'idCardBack'
  return 'idCardHandheld'
}

async function onImageChange(uploadFile: { raw?: File }, scene: IosIdCardScene) {
  if (!uploadFile.raw) return
  uploading[scene] = true
  try {
    const compressed = await compressIosIdentityImage(uploadFile.raw)
    const url = await uploadIosIdCard(props.phone, compressed, scene)
    form[imageField(scene)] = url
    notifySuccess('图片上传成功')
  }
  catch (error) {
    notifyError((error as Error).message)
  }
  finally {
    uploading[scene] = false
  }
}

function validate(): boolean {
  if (!form.name.trim()) return notifyWarning('请填写真实姓名'), false
  if (!/^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/.test(form.idNumber.trim())) {
    return notifyWarning('身份证号格式不正确'), false
  }
  if (!form.idCardFront || !form.idCardBack || !form.idCardHandheld) return notifyWarning('请完整上传三张身份证照片'), false
  const phones = form.emergencyContacts.map(item => item.phone.replace(/\D/g, ''))
  if (form.emergencyContacts.some(item => !item.name.trim()) || phones.some(phone => !/^1\d{10}$/.test(phone))) {
    return notifyWarning('请完整填写两位紧急联系人'), false
  }
  if (phones[0] === phones[1] || phones.includes(props.phone.replace(/\D/g, ''))) {
    return notifyWarning('联系人不能重复，也不能填写本人手机号'), false
  }
  return true
}

async function submit() {
  if (!validate()) return
  submitting.value = true
  try {
    const payload: IosInstallmentProfileUpdate = {
      name: form.name.trim(),
      idNumber: form.idNumber.trim().toUpperCase(),
      idCardFront: form.idCardFront,
      idCardBack: form.idCardBack,
      idCardHandheld: form.idCardHandheld,
      emergencyContacts: [
        { name: form.emergencyContacts[0].name.trim(), phone: form.emergencyContacts[0].phone.replace(/\D/g, '') },
        { name: form.emergencyContacts[1].name.trim(), phone: form.emergencyContacts[1].phone.replace(/\D/g, '') },
      ],
    }
    const status = await saveIosInstallmentProfile(props.phone, payload)
    notifySuccess('先享后付资料已保存')
    emit('saved', status)
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
  <section class="rounded-2xl bg-white p-5">
    <p class="text-xs font-semibold tracking-[.16em] text-[var(--theme-color)]">先享后付</p>
    <h2 class="mt-2 text-xl font-semibold text-black/85">完善申请资料</h2>
    <p class="mt-2 text-sm leading-6 text-black/60">为完成本次先享后付服务，请填写并确认以下资料。</p>

    <div class="mt-5 space-y-4">
      <label class="block text-sm font-medium">真实姓名<el-input v-model="form.name" class="mt-2" size="large" /></label>
      <label class="block text-sm font-medium">身份证号<el-input v-model="form.idNumber" class="mt-2" maxlength="18" size="large" /></label>
      <div>
        <p class="text-sm font-medium">身份证照片</p>
        <div class="mt-2 grid grid-cols-2 gap-3">
          <el-upload v-for="scene in (['front', 'back', 'handheld'] as IosIdCardScene[])" :key="scene" :class="scene === 'handheld' ? 'col-span-2' : ''" :auto-upload="false" :show-file-list="false" accept="image/*" @change="file => onImageChange(file, scene)">
            <button type="button" class="min-h-24 w-full rounded-xl border border-dashed border-black/15 bg-[#fafafa] p-3 text-sm text-black/60">
              {{ form[imageField(scene)] ? '已上传，可重新选择' : (scene === 'front' ? '身份证正面' : scene === 'back' ? '身份证反面' : '手持身份证') }}
              <span v-if="uploading[scene]" class="block text-xs">上传中…</span>
            </button>
          </el-upload>
        </div>
      </div>
      <div v-for="(contact, index) in form.emergencyContacts" :key="index" class="rounded-xl border border-black/8 bg-[#fafafa] p-4">
        <p class="text-sm font-medium">紧急联系人 {{ index + 1 }}</p>
        <el-input v-model="contact.name" class="mt-3" placeholder="姓名" size="large" />
        <el-input v-model="contact.phone" class="mt-3" inputmode="numeric" maxlength="11" placeholder="手机号" size="large" />
      </div>
    </div>
    <div class="mt-5 grid gap-3">
      <button type="button" class="rounded-xl bg-[var(--theme-color)] px-4 py-3 font-semibold text-white disabled:opacity-55" :disabled="submitting || Object.values(uploading).some(Boolean)" @click="submit">{{ submitting ? '保存中…' : '保存并继续' }}</button>
      <button type="button" class="px-4 py-2 text-sm text-black/55" @click="$emit('cancel')">返回</button>
    </div>
  </section>
</template>

<style scoped>
:deep(.el-upload) { display: block; width: 100%; }
</style>
