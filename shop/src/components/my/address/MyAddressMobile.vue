<script setup lang="ts">
import { consumeAddressPageReturnNavigation, isAddressPickForOrderRoute, orderCreateProductIdFromAddressRoute, useMallMy } from '~/composables/useMallMy'
import { notifyError, notifySuccess, notifyWarning } from '~/utils/epFeedback'

const AddressEditorDialog = defineAsyncComponent(() => import('~/components/my/address/AddressEditorDialog.vue'))

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
const editingAddress = ref<AddressItem | null>(null)

const isPickForOrder = computed(() => isAddressPickForOrderRoute(route))
const currentUserAccount = computed(() => loginPhone.value || profile.value?.phone || '')

function fullAddress(item: AddressForm | AddressItem) {
  return `${item.province}${item.city}${item.district}${item.detail}`
}

async function goBack() {
  if (isPickForOrder.value) {
    const pid = orderCreateProductIdFromAddressRoute(route)
    await smartNavigate({
      path: '/order-create',
      query: pid ? { productId: pid } : {},
    })
    return
  }
  await smartNavigate('/my')
}

async function selectAddressForOrder(item: AddressItem) {
  if (!isPickForOrder.value) {
    return
  }
  const pid = orderCreateProductIdFromAddressRoute(route)
  await smartNavigate({
    path: '/order-create',
    query: {
      ...(pid ? { productId: pid } : {}),
      addressId: String(item.id),
    },
  })
}

function handleAddressArticleClick(item: AddressItem) {
  if (isPickForOrder.value) {
    void selectAddressForOrder(item)
  }
}

function handleAddressArticleEnter(item: AddressItem) {
  if (isPickForOrder.value) {
    void selectAddressForOrder(item)
  }
}

function openAddDialog() {
  editingId.value = null
  editingAddress.value = null
  dialogVisible.value = true
}

function openEditDialog(item: AddressItem) {
  editingId.value = item.id
  editingAddress.value = item
  dialogVisible.value = true
}

function closeDialog() {
  dialogVisible.value = false
  saving.value = false
  editingId.value = null
  editingAddress.value = null
}

function validatePayload(payload: AddressForm) {
  if (!payload.receiver.trim()) {
    notifyWarning('请输入收货人姓名')
    return false
  }
  if (!/^1\d{10}$/.test(payload.phone.trim())) {
    notifyWarning('请输入11位手机号')
    return false
  }
  if (!payload.province.trim() || !payload.city.trim() || !payload.district.trim()) {
    notifyWarning('请选择省市区')
    return false
  }
  if (!payload.detail.trim()) {
    notifyWarning('请输入详细地址')
    return false
  }
  return true
}

function saveAddress(payload: AddressForm) {
  if (!validatePayload(payload)) {
    return
  }

  saving.value = true
  const normalizedPayload: AddressForm = {
    receiver: payload.receiver.trim(),
    phone: payload.phone.trim(),
    province: payload.province.trim(),
    city: payload.city.trim(),
    district: payload.district.trim(),
    detail: payload.detail.trim(),
    isDefault: payload.isDefault,
  }

  const submit = async () => {
    if (!currentUserAccount.value) {
      notifyWarning('请先登录后再管理地址')
      return
    }
    if (editingId.value) {
      await updateAddress(editingId.value, normalizedPayload)
      if (normalizedPayload.isDefault) {
        await setDefaultAddress(editingId.value)
      }
      notifySuccess('收货地址修改成功')
    }
    else {
      await createAddress(currentUserAccount.value, normalizedPayload)
      notifySuccess('收货地址添加成功')
    }
    await fetchAddresses(currentUserAccount.value)
    const back = consumeAddressPageReturnNavigation(route)
    closeDialog()
    if (back) {
      await smartNavigate(back)
    }
  }

  submit().catch((error) => {
    console.error('保存收货地址失败', error)
    notifyError('保存失败，请稍后重试')
  }).finally(() => {
    saving.value = false
  })
}

function setAsDefault(id: number) {
  if (!currentUserAccount.value) {
    notifyWarning('请先登录后再管理地址')
    return
  }
  setDefaultAddress(id).then(async () => {
    await fetchAddresses(currentUserAccount.value)
    notifySuccess('已设为默认地址')
  }).catch((error) => {
    console.error('设置默认地址失败', error)
    notifyError('设置失败，请稍后重试')
  })
}

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
        {{ isPickForOrder ? '选择收货地址' : '收货地址' }}
      </h1>
      <div class="w-9" />
    </div>
    <p
      v-if="isPickForOrder"
      class="mb-3 rounded-xl bg-[#eefcf8] px-3 py-2 text-center text-xs text-black/60"
    >
      请点击一条地址用于当前订单；「修改」「设为默认」不会切换订单地址
    </p>

    <article
      v-for="item in addresses"
      :key="item.id"
      class="mb-3 rounded-2xl bg-white p-4 shadow-[0_10px_24px_rgba(26,55,99,0.08)]"
      :class="isPickForOrder ? 'cursor-pointer active:scale-[0.99]' : ''"
      :role="isPickForOrder ? 'button' : undefined"
      :tabindex="isPickForOrder ? 0 : undefined"
      @click="handleAddressArticleClick(item)"
      @keydown.enter.prevent="handleAddressArticleEnter(item)"
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
      <div
        class="flex items-center justify-end gap-2.5"
        @click.stop
      >
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
      @click.stop="openAddDialog"
    >
      <Icon
        name="tabler:plus"
        size="1rem"
      />
      新增收货地址
    </button>

    <AddressEditorDialog
      v-if="dialogVisible"
      :visible="dialogVisible"
      :editing-item="editingAddress"
      :saving="saving"
      @close="closeDialog"
      @submit="saveAddress"
    />
  </section>
</template>
