<script setup lang="ts">
import { computed } from 'vue'
import type { AdminRole } from '../../composables/useAdminAuth'

const props = defineProps<{
  visible: boolean
  role: AdminRole
  displayName: string
}>()

const tagline = computed(() => {
  switch (props.role) {
    case 'boss':
      return '日进斗金 · 财源滚滚'
    case 'super_admin':
      return '全局在握 · 稳操胜券'
    case 'reviewer':
      return '严谨审核 · 明辨真伪'
    case 'collector':
      return '顺收顺达 · 步步为赢'
    default:
      return '欢迎回来'
  }
})

const coinCount = 14
</script>

<template>
  <Teleport to="body">
    <Transition name="lwc-tx">
      <div
        v-if="visible"
        class="lwc"
        :class="[`lwc--${role}`]"
        role="status"
        aria-live="polite"
      >
        <div
          class="lwc__fx"
          aria-hidden="true"
        >
          <template v-if="role === 'boss'">
            <span
              v-for="n in coinCount"
              :key="n"
              class="lwc__ingot"
              :style="{ '--d': `${(n * 0.12).toFixed(2)}s`, '--x': `${(n * 7.3) % 100}%` }"
            />
            <span class="lwc__burst lwc__burst--a" />
            <span class="lwc__burst lwc__burst--b" />
          </template>

          <template v-else-if="role === 'super_admin'">
            <span class="lwc__sun" />
            <div class="lwc__orbit">
              <span
                v-for="n in 8"
                :key="n"
                class="lwc__ray"
                :style="{ transform: `rotate(${n * 45}deg)` }"
              />
            </div>
          </template>

          <template v-else-if="role === 'reviewer'">
            <span
              v-for="n in 3"
              :key="n"
              class="lwc__ripple"
              :style="{ '--rd': `${0.35 + n * 0.45}s` }"
            />
          </template>

          <template v-else-if="role === 'collector'">
            <span
              v-for="n in 6"
              :key="n"
              class="lwc__drop"
              :style="{ '--dd': `${n * 0.18}s`, '--dx': `${10 + n * 14}%` }"
            >↓</span>
          </template>
        </div>

        <div class="lwc__card">
          <div
            class="lwc__badge"
            aria-hidden="true"
          >
            <span
              v-if="role === 'boss'"
              class="lwc__badge-ingot"
              aria-hidden="true"
            />
            <span v-else-if="role === 'super_admin'">管</span>
            <span v-else-if="role === 'reviewer'">审</span>
            <span v-else>收</span>
          </div>
          <p class="lwc__title">
            欢迎 <em>{{ displayName }}</em> 登录
          </p>
          <p class="lwc__sub">
            {{ tagline }}
          </p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.lwc {
  position: fixed;
  z-index: 10050;
  top: clamp(16px, 4vh, 40px);
  left: 50%;
  transform: translateX(-50%);
  width: min(420px, calc(100vw - 32px));
  pointer-events: none;
}

.lwc-tx-enter-active,
.lwc-tx-leave-active {
  transition:
    opacity 0.45s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.55s cubic-bezier(0.22, 1, 0.36, 1);
}

.lwc-tx-enter-from,
.lwc-tx-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-18px) scale(0.94);
}

.lwc__fx {
  position: absolute;
  inset: -28px -20px -36px -20px;
  overflow: visible;
  pointer-events: none;
}

.lwc__card {
  position: relative;
  border-radius: 16px;
  padding: 18px 22px 20px;
  text-align: center;
  box-shadow:
    0 18px 50px rgba(15, 23, 42, 0.45),
    0 0 0 1px rgba(255, 255, 255, 0.08) inset;
  backdrop-filter: blur(10px);
}

.lwc__badge {
  width: 44px;
  height: 44px;
  margin: 0 auto 10px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0.02em;
  animation: lwc-badge-pop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.lwc__title {
  margin: 0 0 6px;
  font-size: 17px;
  font-weight: 700;
  color: rgba(248, 250, 252, 0.96);
  line-height: 1.35;
}

.lwc__title em {
  font-style: normal;
  font-weight: 800;
}

.lwc__sub {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
  opacity: 0.88;
}

@keyframes lwc-badge-pop {
  from {
    transform: scale(0.2) rotate(-18deg);
    opacity: 0;
  }
  to {
    transform: scale(1) rotate(0);
    opacity: 1;
  }
}

/* —— 老板：金雨 + 光爆（日进斗金） —— */
.lwc--boss .lwc__card {
  background: linear-gradient(145deg, #1c1410 0%, #3d2914 42%, #78350f 100%);
  border: 1px solid rgba(251, 191, 36, 0.55);
  animation: lwc-boss-card-glow 1.8s ease-in-out infinite;
}

.lwc--boss .lwc__badge {
  background: linear-gradient(135deg, #fde047, #f59e0b);
  color: #422006;
  box-shadow: 0 0 24px rgba(251, 191, 36, 0.75);
  animation:
    lwc-badge-pop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) both,
    lwc-boss-badge-pulse 1.2s ease-in-out 0.5s infinite;
}

.lwc--boss .lwc__title em {
  background: linear-gradient(90deg, #fde68a, #fff, #fde68a);
  background-size: 200% auto;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: lwc-shimmer 2.2s linear infinite;
}

.lwc--boss .lwc__sub {
  color: #fcd34d;
  text-shadow: 0 0 18px rgba(251, 191, 36, 0.45);
  animation: lwc-sub-pulse 1.4s ease-in-out infinite;
}

.lwc__badge-ingot {
  display: block;
  width: 22px;
  height: 14px;
  border-radius: 50% 50% 42% 42%;
  background: linear-gradient(180deg, #fff7c2 0%, #fbbf24 48%, #b45309 100%);
  box-shadow: 0 2px 8px rgba(120, 53, 15, 0.45);
}

.lwc__badge-ingot::after {
  content: '';
  display: block;
  width: 70%;
  height: 4px;
  margin: 2px auto 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.55);
}

.lwc--boss .lwc__ingot {
  position: absolute;
  top: -8px;
  left: var(--x);
  width: 16px;
  height: 10px;
  border-radius: 50% 50% 42% 42%;
  background: linear-gradient(180deg, #fef9c3 0%, #fbbf24 52%, #b45309 100%);
  box-shadow: 0 0 10px rgba(251, 191, 36, 0.85);
  animation: lwc-ingot-fall 2.4s linear infinite;
  animation-delay: var(--d);
}

.lwc--boss .lwc__ingot::after {
  content: '';
  position: absolute;
  inset: 2px 3px auto;
  height: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.5);
}

.lwc--boss .lwc__burst {
  position: absolute;
  left: 50%;
  top: 40%;
  width: 120px;
  height: 120px;
  margin: -60px 0 0 -60px;
  border-radius: 50%;
  opacity: 0;
  pointer-events: none;
}

.lwc--boss .lwc__burst--a {
  background: radial-gradient(circle, rgba(254, 243, 199, 0.55), transparent 62%);
  animation: lwc-burst 2s ease-out infinite;
}

.lwc--boss .lwc__burst--b {
  background: radial-gradient(circle, rgba(251, 191, 36, 0.4), transparent 58%);
  animation: lwc-burst 2s ease-out 0.35s infinite;
}

@keyframes lwc-ingot-fall {
  0% {
    transform: translate3d(0, -10px, 0) rotate(-12deg) scale(1);
    opacity: 0;
  }
  10% {
    opacity: 1;
  }
  100% {
    transform: translate3d(8px, 120px, 0) rotate(200deg) scale(0.65);
    opacity: 0;
  }
}

@keyframes lwc-burst {
  0% {
    transform: scale(0.2);
    opacity: 0.85;
  }
  100% {
    transform: scale(2.4);
    opacity: 0;
  }
}

@keyframes lwc-boss-card-glow {
  0%,
  100% {
    box-shadow:
      0 18px 50px rgba(15, 23, 42, 0.45),
      0 0 0 1px rgba(251, 191, 36, 0.35) inset,
      0 0 28px rgba(245, 158, 11, 0.25);
  }
  50% {
    box-shadow:
      0 22px 56px rgba(15, 23, 42, 0.5),
      0 0 0 1px rgba(253, 224, 71, 0.55) inset,
      0 0 42px rgba(252, 211, 77, 0.45);
  }
}

@keyframes lwc-boss-badge-pulse {
  0%,
  100% {
    filter: brightness(1);
    box-shadow: 0 0 24px rgba(251, 191, 36, 0.75);
  }
  50% {
    filter: brightness(1.15);
    box-shadow: 0 0 34px rgba(252, 211, 77, 0.95);
  }
}

@keyframes lwc-shimmer {
  0% {
    background-position: 0% center;
  }
  100% {
    background-position: 200% center;
  }
}

@keyframes lwc-sub-pulse {
  0%,
  100% {
    opacity: 0.88;
    transform: translateY(0);
  }
  50% {
    opacity: 1;
    transform: translateY(-1px);
  }
}

/* —— 超级管理员：光轮 —— */
.lwc--super_admin .lwc__card {
  background: linear-gradient(155deg, #0f172a 0%, #1e293b 55%, #422006 100%);
  border: 1px solid rgba(251, 146, 60, 0.45);
}

.lwc--super_admin .lwc__badge {
  background: linear-gradient(135deg, #fb923c, #ea580c);
  color: #fff7ed;
  box-shadow: 0 0 22px rgba(251, 146, 60, 0.55);
}

.lwc--super_admin .lwc__title em {
  color: #fdba74;
}

.lwc--super_admin .lwc__sub {
  color: rgba(254, 215, 170, 0.9);
}

.lwc--super_admin .lwc__sun {
  position: absolute;
  left: 50%;
  top: 38%;
  width: 56px;
  height: 56px;
  margin: -28px 0 0 -28px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(251, 191, 36, 0.35), transparent 68%);
  animation: lwc-sun-pulse 2s ease-in-out infinite;
}

.lwc--super_admin .lwc__orbit {
  position: absolute;
  left: 50%;
  top: 38%;
  width: 0;
  height: 0;
  animation: lwc-orbit-spin 12s linear infinite;
}

.lwc--super_admin .lwc__ray {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 2px;
  height: 72px;
  margin-left: -1px;
  margin-top: -72px;
  background: linear-gradient(
    to bottom,
    rgba(253, 186, 116, 0.55),
    rgba(253, 186, 116, 0)
  );
  transform-origin: 50% 100%;
  opacity: 0.5;
}

@keyframes lwc-orbit-spin {
  from {
    transform: translate(-50%, -50%) rotate(0deg);
  }
  to {
    transform: translate(-50%, -50%) rotate(360deg);
  }
}

@keyframes lwc-sun-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.65;
  }
  50% {
    transform: scale(1.25);
    opacity: 1;
  }
}

/* —— 审核员：波纹 —— */
.lwc--reviewer .lwc__card {
  background: linear-gradient(150deg, #0c1929 0%, #172554 55%, #1e3a8a 100%);
  border: 1px solid rgba(96, 165, 250, 0.45);
}

.lwc--reviewer .lwc__badge {
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  color: #eff6ff;
  box-shadow: 0 0 22px rgba(59, 130, 246, 0.45);
}

.lwc--reviewer .lwc__title em {
  color: #93c5fd;
}

.lwc--reviewer .lwc__sub {
  color: rgba(191, 219, 254, 0.92);
}

.lwc--reviewer .lwc__ripple {
  position: absolute;
  left: 50%;
  top: 42%;
  width: 40px;
  height: 40px;
  margin: -20px 0 0 -20px;
  border-radius: 50%;
  border: 2px solid rgba(96, 165, 250, 0.55);
  animation: lwc-ripple 1.8s ease-out infinite;
  animation-delay: var(--rd);
}

@keyframes lwc-ripple {
  0% {
    transform: scale(0.35);
    opacity: 0.9;
  }
  100% {
    transform: scale(4.5);
    opacity: 0;
  }
}

/* —— 催收员：下落箭头流 —— */
.lwc--collector .lwc__card {
  background: linear-gradient(150deg, #1a1033 0%, #312e81 50%, #4c1d95 100%);
  border: 1px solid rgba(167, 139, 250, 0.45);
}

.lwc--collector .lwc__badge {
  background: linear-gradient(135deg, #8b5cf6, #6d28d9);
  color: #f5f3ff;
  box-shadow: 0 0 22px rgba(139, 92, 246, 0.45);
}

.lwc--collector .lwc__title em {
  color: #ddd6fe;
}

.lwc--collector .lwc__sub {
  color: rgba(196, 181, 253, 0.92);
}

.lwc--collector .lwc__drop {
  position: absolute;
  top: -6px;
  left: var(--dx);
  font-size: 13px;
  font-weight: 800;
  color: rgba(196, 181, 253, 0.85);
  animation: lwc-drop 1.6s ease-in infinite;
  animation-delay: var(--dd);
}

@keyframes lwc-drop {
  0% {
    transform: translateY(0);
    opacity: 0;
  }
  15% {
    opacity: 1;
  }
  100% {
    transform: translateY(100px);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .lwc__badge,
  .lwc--boss .lwc__card,
  .lwc--boss .lwc__title em,
  .lwc--boss .lwc__sub,
  .lwc--boss .lwc__ingot,
  .lwc--boss .lwc__burst,
  .lwc--super_admin .lwc__orbit,
  .lwc--super_admin .lwc__sun,
  .lwc--reviewer .lwc__ripple,
  .lwc--collector .lwc__drop {
    animation: none !important;
  }

  .lwc--boss .lwc__ingot {
    display: none;
  }

  .lwc--collector .lwc__drop {
    display: none;
  }
}
</style>
