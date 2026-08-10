<script setup lang="ts">
defineEmits<{ continue: [], cancel: [] }>()
</script>

<template>
  <div class="fixed inset-0 z-[7000] flex items-end bg-black/45 p-4 pb-[max(1rem,var(--app-safe-area-bottom))]" role="dialog" aria-modal="true">
    <section class="mx-auto w-full max-w-md rounded-[28px] bg-[#f8f6ef] p-6 text-[#1f2925] shadow-2xl">
      <p class="text-xs font-semibold tracking-[.16em] text-[#9a5b39] uppercase">合同签署前</p>
      <h2 class="mt-2 text-2xl font-semibold">选择并授权联系人</h2>
      <p class="mt-3 text-sm leading-6 text-[#5f6b65]">您的先享后付订单已审核通过。为进入合同签署，系统将在下一步请求通讯录权限，只读取并上传系统实际授权返回、且包含有效手机号的联系人。</p>
      <p class="mt-3 rounded-2xl border border-[#173f35]/10 bg-white p-3 text-xs leading-5 text-[#65716b]">在 iOS 18 及以上，您可以只选择希望授权的联系人。取消或拒绝时不会上传任何数据，您可稍后重试或退出本流程。</p>
      <div class="mt-6 grid gap-3">
        <button type="button" class="rounded-2xl bg-[#c66c42] px-4 py-3 font-semibold text-white" @click="$emit('continue')">继续选择联系人</button>
        <button type="button" class="rounded-2xl border border-[#173f35]/15 bg-white px-4 py-3 font-medium text-[#173f35]" @click="$emit('cancel')">暂不继续</button>
      </div>
    </section>
  </div>
</template>
