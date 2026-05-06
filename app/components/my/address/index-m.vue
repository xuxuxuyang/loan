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

const addresses = ref<AddressItem[]>([
  {
    id: 1,
    receiver: '张三',
    phone: '13800138000',
    province: '广东省',
    city: '深圳市',
    district: '南山区',
    detail: '科技园科兴科学园A1栋1203',
    isDefault: true,
  },
  {
    id: 2,
    receiver: '李四',
    phone: '13900139000',
    province: '广东省',
    city: '广州市',
    district: '天河区',
    detail: '珠江新城花城大道88号',
    isDefault: false,
  },
])

const dialogVisible = ref(false)
const saving = ref(false)
const editingId = ref<number | null>(null)
const provinceCode = ref('')
const cityCode = ref('')
const districtCode = ref('')
type RegionNode = {
  value: string
  label: string
  children?: RegionNode[]
}
const cascaderOptions = regionData as unknown as RegionNode[]
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
const provinceOptions = computed(() => cascaderOptions)
const cityOptions = computed(() => {
  const province = cascaderOptions.find(item => item.value === provinceCode.value)
  return province?.children ?? []
})
const districtOptions = computed(() => {
  const city = cityOptions.value.find(item => item.value === cityCode.value)
  return city?.children ?? []
})

function resetForm() {
  form.receiver = ''
  form.phone = ''
  form.province = ''
  form.city = ''
  form.district = ''
  form.detail = ''
  form.isDefault = false
  provinceCode.value = ''
  cityCode.value = ''
  districtCode.value = ''
}

function fillForm(item: AddressItem) {
  form.receiver = item.receiver
  form.phone = item.phone
  form.province = item.province
  form.city = item.city
  form.district = item.district
  form.detail = item.detail
  form.isDefault = item.isDefault
  const codes = findRegionCodes(item.province, item.city, item.district)
  provinceCode.value = codes[0] ?? ''
  cityCode.value = codes[1] ?? ''
  districtCode.value = codes[2] ?? ''
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

function syncRegionNames() {
  if (!provinceCode.value || !cityCode.value || !districtCode.value) {
    form.province = ''
    form.city = ''
    form.district = ''
    return
  }
  form.province = codeToText[provinceCode.value] ?? ''
  form.city = codeToText[cityCode.value] ?? ''
  form.district = codeToText[districtCode.value] ?? ''
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
  if (!provinceCode.value || !cityCode.value || !districtCode.value) {
    ElMessage.warning('请选择省市区')
    return false
  }
  if (!form.detail.trim()) {
    ElMessage.warning('请输入详细地址')
    return false
  }
  return true
}

function syncDefault(targetId: number) {
  addresses.value = addresses.value.map(item => ({
    ...item,
    isDefault: item.id === targetId,
  }))
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

  if (editingId.value) {
    addresses.value = addresses.value.map(item =>
      item.id === editingId.value
        ? {
            ...item,
            ...payload,
          }
        : item,
    )
    if (payload.isDefault) {
      syncDefault(editingId.value)
    }
    ElMessage.success('收货地址修改成功')
  } else {
    const id = Date.now()
    addresses.value.unshift({
      id,
      ...payload,
    })
    if (payload.isDefault || addresses.value.length === 1) {
      syncDefault(id)
    }
    ElMessage.success('收货地址添加成功')
  }

  saving.value = false
  closeDialog()
}

function setAsDefault(id: number) {
  syncDefault(id)
  ElMessage.success('已设为默认地址')
}

watch(provinceCode, () => {
  if (!cityOptions.value.some(item => item.value === cityCode.value)) {
    cityCode.value = ''
  }
  districtCode.value = ''
  syncRegionNames()
})

watch(cityCode, () => {
  if (!districtOptions.value.some(item => item.value === districtCode.value)) {
    districtCode.value = ''
  }
  syncRegionNames()
})

watch(districtCode, () => {
  syncRegionNames()
})
</script>

<template>
  <section class="px-4 pb-5 pt-4">
    <div class="mb-3 flex items-center justify-between">
      <button
        type="button"
        class="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black/60"
        @click="goBack"
      >
        <Icon
          name="tabler:chevron-left"
          size="1.15rem"
        />
      </button>
      <h1 class="text-xl font-semibold text-black/85">
        收货地址
      </h1>
      <div class="w-9" />
    </div>

    <article
      v-for="item in addresses"
      :key="item.id"
      class="mb-3 rounded-2xl bg-white p-4 shadow-[0_10px_24px_rgba(26,55,99,0.08)]"
    >
      <div class="mb-3 flex items-start justify-between gap-2">
        <div>
          <p class="text-base font-semibold text-black/85">
            {{ item.receiver }}
            <span class="ml-2 text-sm font-normal text-black/55">{{ item.phone }}</span>
          </p>
          <p class="mt-1.5 text-sm leading-5 text-black/65">
            {{ fullAddress(item) }}
          </p>
        </div>
        <span
          v-if="item.isDefault"
          class="shrink-0 rounded-full bg-[#fff2f4] px-2.5 py-1 text-xs text-[#f06579]"
        >
          默认
        </span>
      </div>
      <div class="flex items-center justify-end gap-2.5">
        <button
          v-if="!item.isDefault"
          type="button"
          class="rounded-lg border border-black/12 px-2.5 py-1 text-xs text-black/60"
          @click="setAsDefault(item.id)"
        >
          设为默认
        </button>
        <button
          type="button"
          class="rounded-lg bg-[#eff7ff] px-2.5 py-1 text-xs text-[#2676d1]"
          @click="openEditDialog(item)"
        >
          修改
        </button>
      </div>
    </article>

    <button
      type="button"
      class="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-black/18 bg-white py-3 text-sm text-black/65"
      @click="openAddDialog"
    >
      <Icon
        name="tabler:plus"
        size="1rem"
      />
      新增收货地址
    </button>

    <el-dialog
      v-model="dialogVisible"
      class="address-dialog"
      :title="dialogTitle"
      width="90%"
      destroy-on-close
      align-center
    >
      <div class="space-y-3.5">
        <div class="form-item">
          <p class="mb-1.5 text-xs text-black/50">
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
          <p class="mb-1.5 text-xs text-black/50">
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
        <div class="grid grid-cols-1 gap-2">
          <div class="form-item">
            <p class="mb-1.5 text-xs text-black/50">
              省
            </p>
            <el-select
              v-model="provinceCode"
              class="w-full"
              placeholder="请选择省份"
              clearable
              filterable
            >
              <el-option
                v-for="item in provinceOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
          </div>
          <div class="form-item">
            <p class="mb-1.5 text-xs text-black/50">
              市
            </p>
            <el-select
              v-model="cityCode"
              class="w-full"
              placeholder="请选择城市"
              clearable
              filterable
              :disabled="!provinceCode"
            >
              <el-option
                v-for="item in cityOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
          </div>
          <div class="form-item">
            <p class="mb-1.5 text-xs text-black/50">
              区
            </p>
            <el-select
              v-model="districtCode"
              class="w-full"
              placeholder="请选择区县"
              clearable
              filterable
              :disabled="!cityCode"
            >
              <el-option
                v-for="item in districtOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
          </div>
          <div class="form-item">
            <p class="mb-1.5 text-xs text-black/50">
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
          <p class="text-xs text-black/65">
            设为默认地址
          </p>
          <el-switch
            v-model="form.isDefault"
          />
        </div>
      </div>

      <template #footer>
        <div class="flex items-center justify-end gap-2.5">
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
  font-size: 21px;
  font-weight: 600;
  color: rgba(20, 20, 20, 0.85);
}

.address-dialog:deep(.el-dialog__body) {
  padding: 14px 18px 6px;
  background: #fbfcff;
}

.address-dialog:deep(.el-dialog__footer) {
  padding: 12px 18px 16px;
  background: #fbfcff;
}

.form-item:deep(.el-input__wrapper),
.form-item:deep(.el-select__wrapper),
.form-item:deep(.el-textarea__inner) {
  border-radius: 12px;
  background: #fff;
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
