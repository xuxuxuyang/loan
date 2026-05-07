<script setup lang="ts">
import type { MallCardPackageDTO } from '~/api/modules/mall'

defineProps<{
  /** 为 true 时使用更紧凑的移动端字号与间距 */
  compact?: boolean
  /** 独立页面已展示标题时隐藏内部标题 */
  hideHeading?: boolean
}>()

const SERVICE_PHONE = '18968327662'

const { loginPhone, profile, syncFromStorage } = useMallAuth()
const { cardPackages, fetchCardPackages } = useMallMy()

const account = computed(() => loginPhone.value || profile.value?.phone || '')
const isValidAccount = computed(() => /^1\d{10}$/.test(account.value))
const loading = ref(false)
const dialogVisible = ref(false)
const activeItem = ref<MallCardPackageDTO | null>(null)

async function refreshList() {
  const phone = account.value
  if (!/^1\d{10}$/.test(phone)) {
    cardPackages.value = []
    return
  }
  loading.value = true
  try {
    await fetchCardPackages(phone)
  }
  finally {
    loading.value = false
  }
}

if (import.meta.client) {
  void syncFromStorage().then(refreshList)
}

watch(account, () => {
  void refreshList()
})

function formatTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return iso
  }
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

function openClaim(item: MallCardPackageDTO) {
  activeItem.value = item
  dialogVisible.value = true
}

function closeDialog() {
  dialogVisible.value = false
  activeItem.value = null
}

async function copyPhone() {
  try {
    await navigator.clipboard.writeText(SERVICE_PHONE)
    ElMessage.success('客服电话已复制')
  }
  catch {
    ElMessage.info(`请手动拨打：${SERVICE_PHONE}`)
  }
}
</script>

<template>
  <div
    class="rounded-2xl bg-white p-4"
    :class="compact ? '' : 'md:rounded-3xl md:p-5'"
  >
    <h3
      v-if="!hideHeading"
      class="mb-3 flex items-center font-semibold text-black/85"
      :class="compact ? 'text-[1.1rem]' : 'text-xl md:text-2xl'"
    >
      <span class="mr-2 h-3 w-1 rounded bg-[#ff9ea9]" />
      卡包
    </h3>

    <div
      v-if="loading"
      class="py-6 text-center text-black/45"
      :class="compact ? 'text-sm' : 'text-base'"
    >
      加载中...
    </div>
    <div
      v-else-if="!isValidAccount"
      class="py-6 text-center text-black/45"
      :class="compact ? 'text-sm' : 'text-base'"
    >
      登录后查看卡包
    </div>
    <ul
      v-else-if="cardPackages.length === 0"
      class="py-4 text-center text-black/45"
      :class="compact ? 'text-sm' : 'text-base'"
    >
      暂无卡包；审核通过后，每笔订单会在这里单独展示一个卡包
    </ul>
    <ul
      v-else
      class="space-y-2.5"
    >
      <li
        v-for="item in cardPackages"
        :key="item.orderId"
        class="flex items-center justify-between gap-2 rounded-xl border border-black/[0.06] bg-[#fbfcff] px-3 py-2.5"
        :class="compact ? '' : 'md:px-4 md:py-3'"
      >
        <div class="min-w-0 flex-1">
          <p
            class="line-clamp-1 font-medium text-black/80"
            :class="compact ? 'text-sm' : 'text-base'"
          >
            {{ item.title }}
          </p>
          <p
            class="mt-0.5 text-black/45"
            :class="compact ? 'text-[11px]' : 'text-xs'"
          >
            单号 {{ item.orderId }} · {{ formatTime(item.createdAt) }}
            <span class="mx-1">·</span>
            <span :class="item.cardPackageIssued ? 'text-[#0f766e]' : 'text-[#b45309]'">
              {{ item.cardPackageIssued ? '平台已登记发放' : '待您联系客服领取' }}
            </span>
          </p>
          <p
            class="mt-1 font-semibold text-[#dd667d]"
            :class="compact ? 'text-sm' : 'text-base'"
          >
            ¥{{ item.packageAmount }} 现金礼
          </p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg bg-gradient-to-r from-[#0b7b6e] to-[#18a08f] px-3 py-1.5 text-white"
          :class="compact ? 'text-xs' : 'text-sm px-4 py-2'"
          @click="openClaim(item)"
        >
          领取
        </button>
      </li>
    </ul>

    <el-dialog
      v-model="dialogVisible"
      title="联系客服领取卡包"
      :width="compact ? '90%' : '420px'"
      destroy-on-close
      align-center
      class="card-package-claim-dialog"
      @closed="closeDialog"
    >
      <div
        v-if="activeItem"
        class="space-y-3 text-black/75"
      >
        <p class="text-sm">
          订单 <span class="font-medium text-black/85">{{ activeItem.title }}</span>
          （{{ activeItem.orderId }}）对应的现金礼 ¥{{ activeItem.packageAmount }}，请拨打客服热线或复制号码联系客服为您办理领取。
        </p>
        <div class="rounded-xl bg-[#fff6f6] px-4 py-3 text-center">
          <p class="text-xs text-black/50">
            客服电话
          </p>
          <p class="mt-1 text-xl font-semibold tracking-wide text-[#c06b37]">
            {{ SERVICE_PHONE }}
          </p>
          <p class="mt-1 text-xs text-black/45">
            服务时间 9:00-18:00
          </p>
        </div>
      </div>
      <template #footer>
        <div class="flex flex-wrap justify-end gap-2">
          <el-button @click="copyPhone">
            复制号码
          </el-button>
          <el-button
            type="primary"
            @click="closeDialog"
          >
            我知道了
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.card-package-claim-dialog:deep(.el-dialog) {
  border-radius: 16px;
}
</style>
