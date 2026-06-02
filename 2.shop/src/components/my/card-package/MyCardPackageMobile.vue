<script setup lang="ts">
import CardPackageSection from '~/components/my/CardPackageSection.vue'

const route = useRoute()
const { smartNavigate } = useCustomRouting(route)

async function goBack() {
  await smartNavigate('/my')
}
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
        卡包
      </h1>
      <div class="w-9" />
    </div>
    <CardPackageSection
      compact
      hide-heading
    />
  </section>
</template>
