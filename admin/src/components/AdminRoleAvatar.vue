<script setup lang="ts">
import { computed, useId } from 'vue'
import type { AdminRole } from '../composables/useAdminAuth'
import { isSuperAdminRole } from '../composables/useAdminAuth'

const props = withDefaults(
  defineProps<{
    role: AdminRole
    size?: number
  }>(),
  { size: 36 },
)

const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')

const isBoss = computed(() => isSuperAdminRole(props.role))

const ariaLabel = computed(() =>
  isBoss.value ? '超级管理员（老板）动画头像' : '员工动画头像',
)
</script>

<template>
  <div
    class="admin-role-avatar"
    :class="isBoss ? 'admin-role-avatar--boss' : 'admin-role-avatar--staff'"
    :style="{ width: `${size}px`, height: `${size}px` }"
    role="img"
    :aria-label="ariaLabel"
  >
    <svg
      class="admin-role-avatar__svg"
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          :id="`${uid}-boss-bg`"
          x1="4"
          y1="4"
          x2="44"
          y2="44"
          gradientUnits="userSpaceOnUse"
        >
          <stop stop-color="#312e81" />
          <stop
            offset="0.5"
            stop-color="#581c87"
          />
          <stop
            offset="1"
            stop-color="#9a3412"
          />
        </linearGradient>
        <linearGradient
          :id="`${uid}-staff-bg`"
          x1="2"
          y1="6"
          x2="46"
          y2="42"
          gradientUnits="userSpaceOnUse"
        >
          <stop stop-color="#1d4ed8" />
          <stop
            offset="0.55"
            stop-color="#0e7490"
          />
          <stop
            offset="1"
            stop-color="#047857"
          />
        </linearGradient>
        <linearGradient
          :id="`${uid}-gold`"
          x1="14"
          y1="2"
          x2="34"
          y2="14"
          gradientUnits="userSpaceOnUse"
        >
          <stop stop-color="#fef08a" />
          <stop
            offset="0.5"
            stop-color="#fbbf24"
          />
          <stop
            offset="1"
            stop-color="#d97706"
          />
        </linearGradient>
        <clipPath :id="`${uid}-disc`">
          <circle
            cx="24"
            cy="24"
            r="22"
          />
        </clipPath>
      </defs>

      <circle
        cx="24"
        cy="24"
        r="22"
        :fill="isBoss ? `url(#${uid}-boss-bg)` : `url(#${uid}-staff-bg)`"
      />
      <circle
        cx="24"
        cy="24"
        r="22"
        stroke="rgba(255,255,255,0.16)"
        stroke-width="1"
      />

      <g :clip-path="`url(#${uid}-disc)`">
        <!-- 老板：Q 版人物 + 皇冠西装 -->
        <g
          v-if="isBoss"
          class="av-mascot av-mascot--boss"
        >
          <!-- 身体 -->
          <path
            d="M9 47V33.5c0-2.2 1.6-4 3.6-4.4l2.1 3.4 9.3-6.8 9.3 6.8 2.1-3.4c2 .4 3.6 2.2 3.6 4.4V47H9Z"
            fill="#0f172a"
          />
          <path
            d="M17 33.5 24 28l7 5.5"
            stroke="rgba(255,255,255,0.12)"
            stroke-width="0.8"
          />
          <path
            d="M24 28.5 21.2 46.8h5.6L24 28.5Z"
            fill="#7f1d1d"
          />
          <path
            d="M24 28.5 22.2 40.2h3.6L24 28.5Z"
            fill="#fecaca"
            opacity="0.45"
          />
          <!-- 脖子 -->
          <rect
            x="21"
            y="25.5"
            width="6"
            height="4.5"
            rx="1"
            fill="#ffc9a8"
          />
          <!-- 脸 -->
          <ellipse
            cx="24"
            cy="19.5"
            rx="8"
            ry="8.5"
            fill="#ffd7bc"
          />
          <!-- 腮红 -->
          <ellipse
            cx="17.5"
            cy="21.5"
            rx="2.2"
            ry="1.4"
            fill="#fb7185"
            opacity="0.35"
          />
          <ellipse
            cx="30.5"
            cy="21.5"
            rx="2.2"
            ry="1.4"
            fill="#fb7185"
            opacity="0.35"
          />
          <!-- 头发 -->
          <path
            d="M15.2 18.2c.8-6.5 4.2-9.8 8.8-9.8s8 3.3 8.8 9.8c-2.2-1.6-4.8-2.4-8.8-2.4s-6.6.8-8.8 2.4Z"
            fill="#292524"
          />
          <path
            d="M16 17.5c1.2-5 4-7.8 8-7.8s6.8 2.8 8 7.8"
            stroke="#44403c"
            stroke-width="1.2"
            stroke-linecap="round"
          />
          <!-- 皇冠 -->
          <g class="av-crown">
            <path
              d="M24 4.2 26.4 9.2h5.2l-4 2.9 1.5 4.9-4.1-3-4.1 3 1.5-4.9-4-2.9h5.2L24 4.2Z"
              :fill="`url(#${uid}-gold)`"
              stroke="rgba(120,53,15,0.4)"
              stroke-width="0.35"
            />
            <circle
              cx="24"
              cy="6.5"
              r="1.1"
              fill="#fef9c3"
            />
          </g>
          <!-- 眼睛（眨眼） -->
          <g class="av-eyes av-eyes--boss">
            <ellipse
              cx="20.5"
              cy="19"
              rx="1.35"
              ry="1.65"
              fill="#1c1917"
            />
            <ellipse
              cx="27.5"
              cy="19"
              rx="1.35"
              ry="1.65"
              fill="#1c1917"
            />
            <ellipse
              cx="20.9"
              cy="18.3"
              rx="0.45"
              ry="0.55"
              fill="#fff"
              opacity="0.85"
            />
            <ellipse
              cx="27.9"
              cy="18.3"
              rx="0.45"
              ry="0.55"
              fill="#fff"
              opacity="0.85"
            />
          </g>
          <!-- 嘴 -->
          <path
            d="M20.5 23.5q3.5 2.8 7 0"
            stroke="#b45309"
            stroke-width="1.1"
            stroke-linecap="round"
          />
          <!-- 小胡子点缀 -->
          <path
            d="M22 24.2h4"
            stroke="rgba(28,25,23,0.25)"
            stroke-width="0.6"
            stroke-linecap="round"
          />
        </g>

        <!-- 员工：Q 版人物 + 耳机工牌 -->
        <g
          v-else
          class="av-mascot av-mascot--staff"
        >
          <!-- 身体（工装） -->
          <path
            d="M10 47V34.2c0-2 1.4-3.7 3.3-4.1l1.8 2.8 9-5.6 9 5.6 1.8-2.8c1.9.4 3.3 2.1 3.3 4.1V47H10Z"
            fill="#1e40af"
          />
          <path
            d="M14.5 35.5h19"
            stroke="rgba(255,255,255,0.2)"
            stroke-width="0.75"
          />
          <!-- 工牌绳 +牌 -->
          <path
            d="M24 27v11"
            stroke="#e2e8f0"
            stroke-width="1.2"
            stroke-linecap="round"
          />
          <rect
            x="20.5"
            y="35.5"
            width="7"
            height="5"
            rx="1"
            fill="#f8fafc"
            stroke="#94a3b8"
            stroke-width="0.5"
          />
          <rect
            x="22"
            y="37"
            width="4"
            height="2"
            rx="0.35"
            fill="#38bdf8"
          />
          <!-- 脖子 -->
          <rect
            x="21.2"
            y="25.8"
            width="5.6"
            height="4"
            rx="1"
            fill="#ffcfaa"
          />
          <!-- 脸 -->
          <ellipse
            cx="24"
            cy="19.8"
            rx="8"
            ry="8.6"
            fill="#ffe4d0"
          />
          <ellipse
            cx="17.2"
            cy="21.6"
            rx="2"
            ry="1.3"
            fill="#fda4af"
            opacity="0.4"
          />
          <ellipse
            cx="30.8"
            cy="21.6"
            rx="2"
            ry="1.3"
            fill="#fda4af"
            opacity="0.4"
          />
          <!-- 头发 -->
          <path
            d="M15.5 18.5c1-5.8 4.5-8.8 8.5-8.8s7.5 3 8.5 8.8c-2-1.4-4.5-2.1-8.5-2.1s-6.5.7-8.5 2.1Z"
            fill="#57534e"
          />
          <!-- 耳机 -->
          <path
            d="M14.5 19.5c0-5.5 4.3-9.5 9.5-9.5s9.5 4 9.5 9.5"
            stroke="#64748b"
            stroke-width="1.4"
            fill="none"
            stroke-linecap="round"
          />
          <rect
            x="11.5"
            y="17"
            width="4.2"
            height="7"
            rx="1.6"
            fill="#475569"
            stroke="#334155"
            stroke-width="0.4"
          />
          <rect
            x="32.3"
            y="17"
            width="4.2"
            height="7"
            rx="1.6"
            fill="#475569"
            stroke="#334155"
            stroke-width="0.4"
          />
          <!-- 眼睛 -->
          <g class="av-eyes av-eyes--staff">
            <ellipse
              cx="20.3"
              cy="19.2"
              rx="1.45"
              ry="1.75"
              fill="#0f172a"
            />
            <ellipse
              cx="27.7"
              cy="19.2"
              rx="1.45"
              ry="1.75"
              fill="#0f172a"
            />
            <ellipse
              cx="20.8"
              cy="18.5"
              rx="0.5"
              ry="0.6"
              fill="#fff"
              opacity="0.9"
            />
            <ellipse
              cx="28.2"
              cy="18.5"
              rx="0.5"
              ry="0.6"
              fill="#fff"
              opacity="0.9"
            />
          </g>
          <!-- 嘴（微笑） -->
          <path
            d="M20 23.8q4 2.5 8 0"
            stroke="#c2410c"
            stroke-width="1"
            stroke-linecap="round"
          />
          <!-- 挥手 -->
          <g class="av-wave-hand">
            <path
              d="M33.5 30.5c2.2-1.8 4-1.2 4.8.6"
              stroke="#ffcfaa"
              stroke-width="2.2"
              stroke-linecap="round"
            />
            <circle
              cx="38.8"
              cy="31.8"
              r="2.1"
              fill="#ffcfaa"
              stroke="#fdba74"
              stroke-width="0.4"
            />
          </g>
        </g>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.admin-role-avatar {
  flex-shrink: 0;
  border-radius: 50%;
  overflow: hidden;
  box-shadow:
    0 2px 12px rgba(15, 23, 42, 0.22),
    0 0 0 1px rgba(255, 255, 255, 0.12) inset;
}

.admin-role-avatar--boss {
  box-shadow:
    0 2px 14px rgba(76, 29, 149, 0.35),
    0 0 0 1px rgba(251, 191, 36, 0.25) inset;
}

.admin-role-avatar--staff {
  box-shadow:
    0 2px 12px rgba(30, 64, 175, 0.28),
    0 0 0 1px rgba(255, 255, 255, 0.1) inset;
}

.admin-role-avatar__svg {
  display: block;
  width: 100%;
  height: 100%;
}

/* Q 版整体轻微浮动 */
.av-mascot {
  transform-origin: 24px 32px;
  transform-box: fill-box;
  animation: avMascotFloat 2.6s ease-in-out infinite;
}

.av-mascot--boss {
  animation-duration: 2.9s;
}

.av-mascot--staff {
  animation-duration: 2.5s;
}

@keyframes avMascotFloat {
  0%,
  100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-1.4px) rotate(0.6deg);
  }
}

/* 眨眼 */
.av-eyes {
  transform-origin: 24px 19px;
  transform-box: fill-box;
  animation: avCharBlink 3.5s ease-in-out infinite;
}

.av-eyes--staff {
  transform-origin: 24px 19.2px;
  animation-delay: 0.35s;
}

@keyframes avCharBlink {
  0%,
  44%,
  48%,
  100% {
    transform: scaleY(1);
  }
  46% {
    transform: scaleY(0.09);
  }
}

/* 老板皇冠微闪 */
.av-crown {
  transform-origin: 24px 8px;
  transform-box: fill-box;
  animation: avCrownTwinkle 2.2s ease-in-out infinite;
}

@keyframes avCrownTwinkle {
  0%,
  100% {
    transform: translateY(0) scale(1);
    filter: drop-shadow(0 0 0 transparent);
  }
  50% {
    transform: translateY(-0.5px) scale(1.04);
    filter: drop-shadow(0 0 3px rgba(251, 191, 36, 0.65));
  }
}

/* 员工挥手 */
.av-wave-hand {
  transform-origin: 33px 31px;
  transform-box: fill-box;
  animation: avStaffWave 1.8s ease-in-out infinite;
}

@keyframes avStaffWave {
  0%,
  100% {
    transform: rotate(0deg);
  }
  30% {
    transform: rotate(-10deg);
  }
  60% {
    transform: rotate(8deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .av-mascot,
  .av-eyes,
  .av-crown,
  .av-wave-hand {
    animation: none !important;
  }
}
</style>
