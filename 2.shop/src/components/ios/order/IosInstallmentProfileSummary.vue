<script setup lang="ts">
import type { IosInstallmentProfileStatus } from '~/api/modules/iosMall'

defineProps<{ status: IosInstallmentProfileStatus }>()
defineEmits<{ reuse: [], rewrite: [], cancel: [] }>()
</script>

<template>
  <section class="rounded-2xl bg-white p-5">
    <p class="text-xs font-semibold tracking-[.16em] text-[var(--theme-color)]">已保存资料</p>
    <h2 class="mt-2 text-xl font-semibold text-black/85">确认申请资料</h2>
    <dl class="mt-5 grid grid-cols-[6rem_1fr] gap-y-3 text-sm">
      <dt class="text-black/55">姓名</dt><dd>{{ status.nameMasked }}</dd>
      <dt class="text-black/55">身份证号</dt><dd>{{ status.idNumberMasked }}</dd>
      <dt class="text-black/55">证件照片</dt><dd>{{ status.hasIdCardFront && status.hasIdCardBack && status.hasIdCardHandheld ? '三张已保存' : '资料不完整' }}</dd>
      <dt class="text-black/55">紧急联系人</dt>
      <dd class="space-y-1"><p v-for="item in status.emergencyContactsMasked" :key="`${item.nameMasked}-${item.phoneMasked}`">{{ item.nameMasked }} {{ item.phoneMasked }}</p></dd>
    </dl>
    <p class="mt-5 rounded-xl bg-[#fafafa] p-3 text-xs leading-5 text-black/60">请核对以下资料，确认真实有效后继续。</p>
    <div class="mt-5 grid gap-3">
      <button type="button" class="rounded-xl bg-[var(--theme-color)] px-4 py-3 font-semibold text-white" @click="$emit('reuse')">使用已有资料</button>
      <button type="button" class="rounded-xl border border-black/12 bg-white px-4 py-3 font-medium text-black/75" @click="$emit('rewrite')">重新填写</button>
      <button type="button" class="px-4 py-2 text-sm text-black/55" @click="$emit('cancel')">返回</button>
    </div>
  </section>
</template>
