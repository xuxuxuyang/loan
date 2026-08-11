<script setup lang="ts">
import type { IosAccountDeletionEligibility } from '~/api/modules/iosMall'
import { deleteIosAccount, getIosAccountDeletionEligibility } from '~/api/modules/iosMall'
import { notifyError, notifySuccess, notifyWarning } from '~/utils/epFeedback'

const props = defineProps<{ phone: string }>()
const emit = defineEmits<{ close: [], deleted: [] }>()
const eligibility = ref<IosAccountDeletionEligibility | null>(null)
const loading = ref(true)
const submitting = ref(false)
const finalConfirm = ref(false)
const currentPassword = ref('')

async function loadEligibility() {
  loading.value = true
  try {
    eligibility.value = await getIosAccountDeletionEligibility(props.phone)
  }
  catch (error) {
    notifyError((error as Error).message)
  }
  finally {
    loading.value = false
  }
}

onMounted(loadEligibility)

async function submitDeletion() {
  if (!eligibility.value?.canDelete) {
    notifyWarning('当前账号存在进行中业务，暂不能注销')
    return
  }
  if (!currentPassword.value) {
    notifyWarning('请输入当前密码')
    return
  }
  if (!finalConfirm.value) {
    finalConfirm.value = true
    return
  }
  submitting.value = true
  try {
    await deleteIosAccount(props.phone, currentPassword.value)
    notifySuccess('账号已注销')
    emit('deleted')
  }
  catch (error) {
    notifyError((error as Error).message)
    await loadEligibility()
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[6500] overflow-y-auto bg-[#f3f4f8] px-4 pb-10 pt-[max(1rem,var(--app-safe-area-top))] text-black/85">
    <section class="mx-auto max-w-md">
      <header class="rounded-2xl border border-black/5 bg-white p-3 shadow-sm">
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-xl text-left active:bg-black/[0.02]"
          aria-label="返回我的"
          @click="$emit('close')"
        >
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fff2f4] text-[var(--theme-color)]">
            <Icon name="tabler:chevron-left" size="1.3rem" />
          </span>
          <span class="min-w-0">
            <span class="block text-base font-semibold text-black/85">账号与安全</span>
            <span class="mt-0.5 block text-xs text-black/45">返回我的</span>
          </span>
        </button>
      </header>

      <div class="mt-4 rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
        <h2 class="text-xl font-semibold text-black/85">注销账号</h2>
        <p class="mt-2 text-sm leading-6 text-black/55">如您不再使用当前账号，可以申请注销。</p>

        <p v-if="loading" class="mt-5 text-sm text-black/55">正在检查注销条件…</p>
        <div v-else-if="eligibility && !eligibility.canDelete" class="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p class="font-medium text-amber-900">当前账号暂时无法注销</p>
          <p v-for="item in eligibility.blockers" :key="`${item.code}-${item.orderId || ''}`" class="mt-2 text-sm leading-5 text-amber-800">{{ item.msg }}<span v-if="item.orderId">（订单 {{ item.orderId }}）</span></p>
        </div>
        <div v-else class="mt-5">
          <label class="text-sm font-medium">当前密码
            <el-input v-model="currentPassword" class="mt-2" type="password" show-password autocomplete="current-password" placeholder="请输入当前密码" size="large" />
          </label>
          <div v-if="finalConfirm" class="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900">请再次确认是否注销当前账号。</div>
          <button type="button" class="mt-5 w-full rounded-xl bg-[var(--theme-color)] px-4 py-3 font-semibold text-white disabled:opacity-55" :disabled="submitting" @click="submitDeletion">{{ submitting ? '正在注销…' : (finalConfirm ? '确认注销账号' : '申请注销账号') }}</button>
          <button v-if="finalConfirm" type="button" class="mt-3 w-full px-4 py-2 text-sm text-black/55" @click="finalConfirm = false">取消</button>
        </div>
      </div>
    </section>
  </div>
</template>
