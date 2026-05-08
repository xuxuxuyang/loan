<script setup lang="ts">
import CardPackageSection from '~/components/my/CardPackageSection.vue'

const route = useRoute()
const { smartNavigate } = useCustomRouting(route)

async function goBack() {
  await smartNavigate('/my')
}
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
          卡包
        </h1>
        <div
          class="w-[140px]"
          aria-hidden="true"
        />
      </div>
      <CardPackageSection hide-heading />
    </div>
  </section>
</template>
