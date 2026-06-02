<script setup lang="ts">

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

const props = defineProps<{
  visible: boolean
  editingItem: AddressItem | null
  saving: boolean
}>()

const emit = defineEmits<{
  close: []
  submit: [payload: AddressForm]
}>()

const provinceCode = ref('')
const cityCode = ref('')
const districtCode = ref('')
const regionDataLoading = ref(false)
let regionLoadPromise: Promise<void> | null = null
let regionCodeToText: Record<string, string> = {}

type RegionNode = {
  value: string
  label: string
  children?: RegionNode[]
}
const cascaderOptions = ref<RegionNode[]>([])
const form = reactive<AddressForm>({
  receiver: '',
  phone: '',
  province: '',
  city: '',
  district: '',
  detail: '',
  isDefault: false,
})

const dialogTitle = computed(() => (props.editingItem ? '修改收货地址' : '新增收货地址'))
const submitText = computed(() => (props.editingItem ? '确认修改' : '确认新增'))
const provinceOptions = computed(() => cascaderOptions.value)
const cityOptions = computed(() => {
  const province = cascaderOptions.value.find(item => item.value === provinceCode.value)
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

function findRegionCodes(provinceName: string, cityName: string, districtName: string) {
  const province = cascaderOptions.value.find(item => item.label === provinceName)
  const city = province?.children?.find(item => item.label === cityName)
  const district = city?.children?.find(item => item.label === districtName)
  if (!province || !city || !district) {
    return []
  }
  return [province.value, city.value, district.value]
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

function syncRegionNames() {
  if (!provinceCode.value || !cityCode.value || !districtCode.value) {
    form.province = ''
    form.city = ''
    form.district = ''
    return
  }
  form.province = regionCodeToText[provinceCode.value] ?? ''
  form.city = regionCodeToText[cityCode.value] ?? ''
  form.district = regionCodeToText[districtCode.value] ?? ''
}

function ensureRegionDataLoaded() {
  if (cascaderOptions.value.length > 0) {
    return Promise.resolve()
  }
  if (!regionLoadPromise) {
    regionDataLoading.value = true
    regionLoadPromise = import('element-china-area-data').then((mod) => {
      cascaderOptions.value = (mod.regionData as unknown as RegionNode[]) || []
      regionCodeToText = (mod.codeToText as Record<string, string>) || {}
    }).finally(() => {
      regionDataLoading.value = false
    })
  }
  return regionLoadPromise
}

function handleClose() {
  emit('close')
}

function handleSubmit() {
  emit('submit', {
    receiver: form.receiver,
    phone: form.phone,
    province: form.province,
    city: form.city,
    district: form.district,
    detail: form.detail,
    isDefault: form.isDefault,
  })
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

watch(
  () => props.visible,
  async (visible) => {
    if (!visible) {
      resetForm()
      return
    }
    await ensureRegionDataLoaded()
    if (props.editingItem) {
      fillForm(props.editingItem)
      return
    }
    resetForm()
  },
  { immediate: true },
)
</script>

<template>
  <el-dialog
    :model-value="visible"
    class="address-dialog"
    :title="dialogTitle"
    width="90%"
    destroy-on-close
    align-center
    @close="handleClose"
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
            :loading="regionDataLoading"
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
            :disabled="!provinceCode || regionDataLoading"
            :loading="regionDataLoading"
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
            :disabled="!cityCode || regionDataLoading"
            :loading="regionDataLoading"
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
          @click="handleClose"
        >
          取消
        </button>
        <button
          type="button"
          class="dialog-btn dialog-btn-confirm"
          :disabled="saving"
          @click="handleSubmit"
        >
          {{ saving ? '保存中...' : submitText }}
        </button>
      </div>
    </template>
  </el-dialog>
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
