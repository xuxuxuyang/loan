<script setup lang="ts">
import type { IosInstallmentProfileStatus } from '~/api/modules/iosMall'

defineProps<{ status: IosInstallmentProfileStatus }>()
defineEmits<{ reuse: [], rewrite: [], cancel: [] }>()
</script>

<template>
  <section class="rounded-[24px] border border-[#173f35]/12 bg-white p-5 shadow-sm">
    <p class="text-xs font-semibold tracking-[.16em] text-[#8a5b3d] uppercase">已保存资料</p>
    <h2 class="mt-2 text-xl font-semibold text-[#1f2925]">确认先享后付申请资料</h2>
    <dl class="mt-5 grid grid-cols-[6rem_1fr] gap-y-3 text-sm">
      <dt class="text-[#6b7771]">姓名</dt><dd>{{ status.nameMasked }}</dd>
      <dt class="text-[#6b7771]">身份证号</dt><dd>{{ status.idNumberMasked }}</dd>
      <dt class="text-[#6b7771]">证件照片</dt><dd>{{ status.hasIdCardFront && status.hasIdCardBack && status.hasIdCardHandheld ? '三张已保存' : '资料不完整' }}</dd>
      <dt class="text-[#6b7771]">紧急联系人</dt>
      <dd class="space-y-1"><p v-for="item in status.emergencyContactsMasked" :key="`${item.nameMasked}-${item.phoneMasked}`">{{ item.nameMasked }} {{ item.phoneMasked }}</p></dd>
    </dl>
    <p class="mt-5 rounded-2xl bg-[#f5f3ed] p-3 text-xs leading-5 text-[#59645f]">这些资料仅用于您本次主动申请的先享后付服务；普通购物不需要提供。</p>
    <div class="mt-5 grid gap-3">
      <button type="button" class="rounded-2xl bg-[#c66c42] px-4 py-3 font-semibold text-white" @click="$emit('reuse')">使用已有资料</button>
      <button type="button" class="rounded-2xl border border-[#173f35]/20 px-4 py-3 font-medium text-[#173f35]" @click="$emit('rewrite')">重新填写并整体更新</button>
      <button type="button" class="px-4 py-2 text-sm text-[#6b7771]" @click="$emit('cancel')">暂不申请</button>
    </div>
  </section>
</template>
