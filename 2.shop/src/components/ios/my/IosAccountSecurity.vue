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
    const result = await deleteIosAccount(props.phone, currentPassword.value)
    notifySuccess(result.mode === 'hard_deleted' ? '账号已永久注销' : '账号已注销，依法保留的历史记录已去标识化')
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
  <div class="fixed inset-0 z-[6500] overflow-y-auto bg-[#f5f3ed] px-4 pb-10 pt-[max(1.25rem,var(--app-safe-area-top))] text-[#1f2925]">
    <section class="mx-auto max-w-md">
      <button type="button" class="text-sm text-[#65716b]" @click="$emit('close')">← 返回我的</button>
      <p class="mt-8 text-xs font-semibold tracking-[.16em] text-[#9a5b39] uppercase">Account Security</p>
      <h1 class="mt-2 text-3xl font-semibold">账号与安全</h1>

      <div class="mt-6 rounded-[24px] bg-white p-5 shadow-sm">
        <h2 class="text-xl font-semibold text-[#9b342b]">永久注销账号</h2>
        <p class="mt-3 text-sm leading-6 text-[#65716b]">注销后将立即停止登录，并删除联系方式、地址、银行卡、联系人上传记录和身份证图片。依法必须保留的已结清交易、账务和合同记录会去标识化保存至法定期限。</p>

        <p v-if="loading" class="mt-5 text-sm text-[#65716b]">正在检查注销条件…</p>
        <div v-else-if="eligibility && !eligibility.canDelete" class="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p class="font-medium text-amber-900">当前暂不能注销</p>
          <p v-for="item in eligibility.blockers" :key="`${item.code}-${item.orderId || ''}`" class="mt-2 text-sm leading-5 text-amber-800">{{ item.msg }}<span v-if="item.orderId">（订单 {{ item.orderId }}）</span></p>
        </div>
        <div v-else class="mt-5">
          <label class="text-sm font-medium">当前密码
            <el-input v-model="currentPassword" class="mt-2" type="password" show-password autocomplete="current-password" placeholder="用于确认是您本人操作" size="large" />
          </label>
          <div v-if="finalConfirm" class="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900">这是最后确认。继续后账号无法恢复，您将立即退出登录。</div>
          <button type="button" class="mt-5 w-full rounded-2xl bg-[#a83f35] px-4 py-3 font-semibold text-white disabled:opacity-55" :disabled="submitting" @click="submitDeletion">{{ submitting ? '正在注销…' : (finalConfirm ? '确认永久注销账号' : '继续注销') }}</button>
          <button v-if="finalConfirm" type="button" class="mt-3 w-full px-4 py-2 text-sm text-[#65716b]" @click="finalConfirm = false">取消最终确认</button>
        </div>
      </div>
    </section>
  </div>
</template>
