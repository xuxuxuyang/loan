<script setup lang="ts">
import { codeToText, regionData } from 'element-china-area-data'

const route = useRoute()
const { smartNavigate } = useCustomRouting(route)

interface AddressItem {
  id: number
  receiver: string
  phone: string
  province: string
  city: string
  district: string
  detail: string
  isDefault: boolean
}

type AddressForm = Omit<AddressItem, 'id'>

const { loginPhone, profile, syncFromStorage } = useMallAuth()
const {
  addresses,
  fetchAddresses,
  createAddress,
  updateAddress,
  setDefaultAddress,
} = useMallMy()

const dialogVisible = ref(false)
const saving = ref(false)
const editingId = ref<number | null>(null)
const regionCodes = ref<string[]>([])
type RegionNode = {
  value: string
  label: string
  children?: RegionNode[]
}
const cascaderOptions = regionData as unknown as RegionNode[]
const cascaderProps = {
  value: 'value',
  label: 'label',
  children: 'children',
  emitPath: true,
}
const form = reactive<AddressForm>({
  receiver: '',
  phone: '',
  province: '',
  city: '',
  district: '',
  detail: '',
  isDefault: false,
})

const dialogTitle = computed(() => (editingId.value ? '修改收货地址' : '新增收货地址'))
const submitText = computed(() => (editingId.value ? '确认修改' : '确认新增'))
const currentUserAccount = computed(() => loginPhone.value || profile.value?.phone || '')

function resetForm() {
  form.receiver = ''
  form.phone = ''
  form.province = ''
  form.city = ''
  form.district = ''
  form.detail = ''
  form.isDefault = false
  regionCodes.value = []
}

function fillForm(item: AddressItem) {
  form.receiver = item.receiver
  form.phone = item.phone
  form.province = item.province
  form.city = item.city
  form.district = item.district
  form.detail = item.detail
  form.isDefault = item.isDefault
  regionCodes.value = findRegionCodes(item.province, item.city, item.district)
}

function fullAddress(item: AddressForm | AddressItem) {
  return `${item.province}${item.city}${item.district}${item.detail}`
}

function findRegionCodes(provinceName: string, cityName: string, districtName: string) {
  const province = cascaderOptions.find(item => item.label === provinceName)
  const city = province?.children?.find(item => item.label === cityName)
  const district = city?.children?.find(item => item.label === districtName)
  if (!province || !city || !district) {
    return []
  }
  return [province.value, city.value, district.value]
}

function syncRegionNames(codes: string[]) {
  if (codes.length !== 3) {
    form.province = ''
    form.city = ''
    form.district = ''
    return
  }
  const [provinceCode = '', cityCode = '', districtCode = ''] = codes
  form.province = codeToText[provinceCode] ?? ''
  form.city = codeToText[cityCode] ?? ''
  form.district = codeToText[districtCode] ?? ''
}

async function goBack() {
  await smartNavigate('/my')
}

function openAddDialog() {
  editingId.value = null
  resetForm()
  dialogVisible.value = true
}

function openEditDialog(item: AddressItem) {
  editingId.value = item.id
  fillForm(item)
  dialogVisible.value = true
}

function closeDialog() {
  dialogVisible.value = false
  saving.value = false
  editingId.value = null
  resetForm()
}

function validateForm() {
  if (!form.receiver.trim()) {
    ElMessage.warning('请输入收货人姓名')
    return false
  }
  if (!/^1\d{10}$/.test(form.phone.trim())) {
    ElMessage.warning('请输入11位手机号')
    return false
  }
  if (regionCodes.value.length !== 3 || !form.province || !form.city || !form.district) {
    ElMessage.warning('请选择省市区')
    return false
  }
  if (!form.detail.trim()) {
    ElMessage.warning('请输入详细地址')
    return false
  }
  return true
}

function saveAddress() {
  if (!validateForm()) {
    return
  }

  saving.value = true
  const payload: AddressForm = {
    receiver: form.receiver.trim(),
    phone: form.phone.trim(),
    province: form.province.trim(),
    city: form.city.trim(),
    district: form.district.trim(),
    detail: form.detail.trim(),
    isDefault: form.isDefault,
  }

  const submit = async () => {
    if (!currentUserAccount.value) {
      ElMessage.warning('请先登录后再管理地址')
      return
    }

    if (editingId.value) {
      await updateAddress(editingId.value, payload)
      if (payload.isDefault) {
        await setDefaultAddress(editingId.value)
      }
      ElMessage.success('收货地址修改成功')
    }
    else {
      await createAddress(currentUserAccount.value, payload)
      ElMessage.success('收货地址添加成功')
    }
    await fetchAddresses(currentUserAccount.value)
    closeDialog()
  }

  submit().catch((error) => {
    console.error('保存收货地址失败', error)
    ElMessage.error('保存失败，请稍后重试')
  }).finally(() => {
    saving.value = false
  })
}

function setAsDefault(id: number) {
  if (!currentUserAccount.value) {
    ElMessage.warning('请先登录后再管理地址')
    return
  }
  setDefaultAddress(id).then(async () => {
    await fetchAddresses(currentUserAccount.value)
    ElMessage.success('已设为默认地址')
  }).catch((error) => {
    console.error('设置默认地址失败', error)
    ElMessage.error('设置失败，请稍后重试')
  })
}

watch(regionCodes, (codes) => {
  syncRegionNames(codes)
})

if (!import.meta.env.SSR) {
  void syncFromStorage().then(async () => {
    if (currentUserAccount.value) {
      await fetchAddresses(currentUserAccount.value)
    }
  })
}

watch(currentUserAccount, async (account) => {
  if (!account) {
    addresses.value = []
    return
  }
  await fetchAddresses(account)
})
</script>

<template>
  <section class="app-wrapper bg-[#f3f4f8] py-7">
    <div class="app-content max-w-[920px]">
      <div class="mb-5 flex items-center justify-between">
        <button
          type="button"
          class="flex items-center gap-1 rounded-full bg-white px-4 py-2 text-sm text-black/65"
          @click="goBack"
        >
          <Icon
            name="tabler:chevron-left"
            size="1rem"
          />
          返回我的
        </button>
        <h1 class="text-3xl font-semibold text-black/85">
          收货地址
        </h1>
        <button
          type="button"
          class="rounded-full bg-[var(--theme-color)] px-4 py-2 text-sm text-white"
          @click="openAddDialog"
        >
          + 添加地址
        </button>
      </div>

      <div class="grid gap-4">
        <article
          v-for="item in addresses"
          :key="item.id"
          class="rounded-3xl bg-white p-5 shadow-[0_10px_24px_rgba(18,39,66,0.08)]"
        >
          <div class="mb-3 flex items-start justify-between">
            <div>
              <p class="text-xl font-semibold text-black/85">
                {{ item.receiver }}
                <span class="ml-2 text-base font-normal text-black/55">{{ item.phone }}</span>
              </p>
              <p class="mt-2 text-base text-black/65">
                {{ fullAddress(item) }}
              </p>
            </div>
            <span
              v-if="item.isDefault"
              class="rounded-full bg-[#fff2f4] px-3 py-1 text-sm text-[#f06579]"
            >
              默认
            </span>
          </div>
          <div class="flex items-center justify-end gap-3">
            <button
              v-if="!item.isDefault"
              type="button"
              class="rounded-lg border border-black/12 px-3 py-1.5 text-sm text-black/60"
              @click="setAsDefault(item.id)"
            >
              设为默认
            </button>
            <button
              type="button"
              class="rounded-lg bg-[#eff7ff] px-3 py-1.5 text-sm text-[#2676d1]"
              @click="openEditDialog(item)"
            >
              修改
            </button>
          </div>
        </article>
      </div>

      <el-dialog
        v-model="dialogVisible"
        class="address-dialog"
        :title="dialogTitle"
        width="560px"
        destroy-on-close
        align-center
      >
        <div class="space-y-3.5">
          <div class="form-item">
            <p class="mb-1.5 text-sm text-black/55">
              收货人
            </p>
            <el-input
              v-model="form.receiver"
              placeholder="请输入收货人姓名"
              maxlength="20"
              clearable
              size="large"
            />
          </div>
          <div class="form-item">
            <p class="mb-1.5 text-sm text-black/55">
              手机号
            </p>
            <el-input
              v-model="form.phone"
              placeholder="请输入11位手机号"
              maxlength="11"
              clearable
              size="large"
            />
          </div>
          <div class="form-item">
            <p class="mb-1.5 text-sm text-black/55">
              省市区
            </p>
            <el-cascader
              v-model="regionCodes"
              class="w-full"
              :options="cascaderOptions"
              :props="cascaderProps"
              placeholder="请选择省/市/区"
              clearable
              filterable
            />
          </div>
          <div class="grid grid-cols-1 gap-3">
            <div class="form-item">
              <p class="mb-1.5 text-sm text-black/55">
                详细地址
              </p>
              <el-input
                v-model="form.detail"
                type="textarea"
                :rows="3"
                placeholder="请输入街道、门牌号等详细信息"
                maxlength="80"
                show-word-limit
              />
            </div>
          </div>
          <div class="flex items-center justify-between rounded-xl bg-[#f7f9fc] px-3 py-2">
            <p class="text-sm text-black/65">
              设为默认地址
            </p>
            <el-switch
              v-model="form.isDefault"
            />
          </div>
        </div>

        <template #footer>
          <div class="flex items-center justify-end gap-2">
            <button
              type="button"
              class="dialog-btn dialog-btn-cancel"
              @click="closeDialog"
            >
              取消
            </button>
            <button
              type="button"
              class="dialog-btn dialog-btn-confirm"
              :disabled="saving"
              @click="saveAddress"
            >
              {{ saving ? '保存中...' : submitText }}
            </button>
          </div>
        </template>
      </el-dialog>
    </div>
  </section>
</template>

<style scoped>
.address-dialog:deep(.el-dialog) {
  border-radius: 18px;
  overflow: hidden;
}

.address-dialog:deep(.el-dialog__header) {
  margin-right: 0;
  padding: 16px 18px 10px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.address-dialog:deep(.el-dialog__title) {
  font-size: 22px;
  font-weight: 600;
  color: rgba(20, 20, 20, 0.85);
}

.address-dialog:deep(.el-dialog__body) {
  padding: 14px 18px 8px;
  background: #fbfcff;
}

.address-dialog:deep(.el-dialog__footer) {
  padding: 12px 18px 16px;
  background: #fbfcff;
}

.form-item:deep(.el-input__wrapper),
.form-item:deep(.el-textarea__inner) {
  border-radius: 12px;
  box-shadow: 0 0 0 1px rgba(239, 116, 139, 0.16) inset;
}

.dialog-btn {
  height: 38px;
  min-width: 86px;
  padding: 0 14px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
}

.dialog-btn-cancel {
  border: 1px solid rgba(0, 0, 0, 0.12);
  color: rgba(20, 20, 20, 0.65);
  background: #fff;
}

.dialog-btn-confirm {
  border: none;
  color: #fff;
  background: linear-gradient(90deg, #0b7b6e, #18a08f);
}

.dialog-btn-confirm:disabled {
  opacity: 0.7;
}
</style>
