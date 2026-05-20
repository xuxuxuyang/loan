<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  urls: string[]
  altBase: string
}>()

const scrollerRef = ref<HTMLElement | null>(null)
const active = ref(0)

const slides = computed(() => (props.urls || []).filter(Boolean))

let scrollRaf = 0
function onScroll() {
  if (scrollRaf) {
    cancelAnimationFrame(scrollRaf)
  }
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    const el = scrollerRef.value
    if (!el || slides.value.length === 0) {
      return
    }
    const w = el.clientWidth || 1
    const i = Math.round(el.scrollLeft / w)
    active.value = Math.min(slides.value.length - 1, Math.max(0, i))
  })
}

watch(
  () => props.urls.join('\n'),
  () => {
    active.value = 0
    if (scrollerRef.value) {
      scrollerRef.value.scrollLeft = 0
    }
  },
)

onBeforeUnmount(() => {
  if (scrollRaf) {
    cancelAnimationFrame(scrollRaf)
  }
})
</script>

<template>
  <div
    v-if="slides.length"
    class="gallery-root relative overflow-hidden bg-white"
  >
    <div
      ref="scrollerRef"
      class="gallery-scroll flex snap-x snap-mandatory overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      @scroll.passive="onScroll"
    >
      <div
        v-for="(url, i) in slides"
        :key="`${i}-${url.slice(0, 48)}`"
        class="min-w-full shrink-0 snap-center"
      >
        <img
          :src="url"
          :alt="`${altBase} ${i + 1}/${slides.length}`"
          class="gallery-img mx-auto block max-h-[min(72vw,22rem)] w-full bg-[#f6f8fb] object-contain py-3"
          loading="lazy"
          decoding="async"
          @error="onMallProductImageError($event, altBase)"
        >
      </div>
    </div>
    <div
      v-if="slides.length > 1"
      class="pointer-events-none absolute bottom-2 left-0 right-0 flex justify-center gap-1.5"
      aria-hidden="true"
    >
      <span
        v-for="(_, i) in slides"
        :key="i"
        class="h-1.5 rounded-full transition-all duration-200"
        :class="i === active ? 'w-4 bg-[var(--theme-color)]' : 'w-1.5 bg-black/20'"
      />
    </div>
  </div>
</template>

