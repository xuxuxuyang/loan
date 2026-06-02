<script setup lang="ts">
import { computed } from 'vue'

export type FortuneRainItem = {
  id: number
  type: 'coin' | 'ingot'
  left: number
  delay: number
  duration: number
  scale: number
  drift: number
  spin: number
}

const props = withDefaults(defineProps<{
  /** 侧栏用低密度半透明，登录页用满屏密度 */
  variant?: 'login' | 'sidebar'
}>(), {
  variant: 'login',
})

function buildRainItems(count: number, compact: boolean): FortuneRainItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    type: i % 3 === 1 ? 'ingot' : 'coin',
    left: (i * 13.7 + 5) % 92 + 4,
    delay: -((i * 0.72) % 16),
    duration: (compact ? 7 : 5.5) + (i % 6) * (compact ? 1.4 : 1.15),
    scale: (compact ? 0.42 : 0.55) + (i % 5) * (compact ? 0.12 : 0.18),
    drift: ((i % 9) - 4) * (compact ? 8 : 14),
    spin: (i % 2 === 0 ? 1 : -1) * (180 + (i % 4) * 90),
  }))
}

const rainItems = computed(() =>
  buildRainItems(props.variant === 'sidebar' ? 20 : 42, props.variant === 'sidebar'),
)
</script>

<template>
  <div
    class="fortune-rain"
    :class="`fortune-rain--${variant}`"
    aria-hidden="true"
  >
    <span
      v-for="item in rainItems"
      :key="item.id"
      class="fortune-rain__item"
      :class="`fortune-rain__item--${item.type}`"
      :style="{
        '--left': `${item.left}%`,
        '--delay': `${item.delay}s`,
        '--dur': `${item.duration}s`,
        '--scale': item.scale,
        '--drift': `${item.drift}px`,
        '--spin': `${item.spin}deg`,
      }"
    >
      <span
        v-if="item.type === 'coin'"
        class="fortune-rain__coin"
      >¥</span>
      <span
        v-else
        class="fortune-rain__ingot"
      />
    </span>
  </div>
</template>

<style scoped>
.fortune-rain {
  position: absolute;
  inset: 0;
  z-index: 2;
  overflow: hidden;
  pointer-events: none;
}

.fortune-rain__item {
  position: absolute;
  top: -12vh;
  left: var(--left);
  transform: scale(var(--scale));
  opacity: 0;
  animation: fortune-fall var(--dur) linear infinite;
  animation-delay: var(--delay);
  will-change: transform, opacity;
}

.fortune-rain__coin {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-size: 14px;
  font-weight: 800;
  color: #78350f;
  background: radial-gradient(circle at 32% 28%, #fff7c2 0%, #fde047 38%, #f59e0b 72%, #b45309 100%);
  border: 1.5px solid rgba(253, 224, 71, 0.85);
  box-shadow:
    0 2px 10px rgba(251, 191, 36, 0.55),
    inset 0 -2px 4px rgba(120, 53, 15, 0.35);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.45);
}

.fortune-rain__ingot {
  position: relative;
  display: block;
  width: 36px;
  height: 20px;
  border-radius: 50% 50% 42% 42%;
  background: linear-gradient(180deg, #fff7c2 0%, #fde047 32%, #f59e0b 68%, #b45309 100%);
  border: 1px solid rgba(253, 224, 71, 0.75);
  box-shadow:
    0 2px 10px rgba(251, 191, 36, 0.5),
    inset 0 2px 4px rgba(255, 255, 255, 0.45);
}

.fortune-rain__ingot::after {
  content: '';
  position: absolute;
  left: 18%;
  right: 18%;
  top: 18%;
  height: 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.55);
}

@keyframes fortune-fall {
  0% {
    transform: translate3d(0, -12vh, 0) rotate(0deg) scale(var(--scale));
    opacity: 0;
  }
  6% {
    opacity: 0.92;
  }
  88% {
    opacity: 0.75;
  }
  100% {
    transform: translate3d(var(--drift), 112vh, 0) rotate(var(--spin)) scale(var(--scale));
    opacity: 0;
  }
}

/* 侧栏：同款财宝雨，降低透明度与尺寸，避免喧宾夺主 */
.fortune-rain--sidebar {
  z-index: 2;
  opacity: 0.55;
}

.fortune-rain--sidebar .fortune-rain__coin {
  width: 20px;
  height: 20px;
  font-size: 10px;
}

.fortune-rain--sidebar .fortune-rain__ingot {
  width: 26px;
  height: 14px;
}

.fortune-rain--sidebar .fortune-rain__item {
  animation-name: fortune-fall-sidebar;
}

@keyframes fortune-fall-sidebar {
  0% {
    transform: translate3d(0, -8%, 0) rotate(0deg) scale(var(--scale));
    opacity: 0;
  }
  8% {
    opacity: 0.55;
  }
  92% {
    opacity: 0.4;
  }
  100% {
    transform: translate3d(var(--drift), 108%, 0) rotate(var(--spin)) scale(var(--scale));
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .fortune-rain__item {
    animation: none;
    opacity: 0.35;
    top: auto;
    bottom: 12%;
  }

  .fortune-rain__item:nth-child(odd) {
    top: 18%;
    bottom: auto;
  }

  .fortune-rain--sidebar {
    opacity: 0.28;
  }
}
</style>
