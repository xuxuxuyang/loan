<script setup lang="ts">
import { useId } from 'vue'

withDefaults(
  defineProps<{
    size?: number
  }>(),
  { size: 56 },
)

const uid = useId()
const bg = `${uid}-bg`
const accent = `${uid}-accent`
const glow = `${uid}-glow`
</script>

<template>
  <svg
    class="traffic-partner-logo"
    :width="size"
    :height="size"
    viewBox="0 0 56 56"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="流量商数据平台"
  >
    <defs>
      <linearGradient
        :id="bg"
        x1="8"
        y1="6"
        x2="48"
        y2="50"
        gradientUnits="userSpaceOnUse"
      >
        <stop stop-color="#1e3a8a" />
        <stop offset="0.55" stop-color="#2563eb" />
        <stop offset="1" stop-color="#0ea5e9" />
      </linearGradient>
      <linearGradient
        :id="accent"
        x1="14"
        y1="32"
        x2="42"
        y2="18"
        gradientUnits="userSpaceOnUse"
      >
        <stop stop-color="#fbbf24" />
        <stop offset="1" stop-color="#fde68a" />
      </linearGradient>
      <radialGradient
        :id="glow"
        cx="0"
        cy="0"
        r="1"
        gradientUnits="userSpaceOnUse"
        gradientTransform="translate(28 20) rotate(90) scale(22)"
      >
        <stop stop-color="#fff" stop-opacity="0.35" />
        <stop offset="1" stop-color="#fff" stop-opacity="0" />
      </radialGradient>
    </defs>
    <rect
      x="4"
      y="4"
      width="48"
      height="48"
      rx="14"
      :fill="`url(#${bg})`"
    />
    <circle
      cx="28"
      cy="22"
      r="18"
      :fill="`url(#${glow})`"
    />
    <!-- 引流节点 -->
    <circle cx="16" cy="22" r="2.5" fill="#93c5fd" />
    <circle cx="40" cy="18" r="2.5" fill="#93c5fd" />
    <circle cx="36" cy="34" r="2.5" fill="#bfdbfe" />
    <path
      d="M18 22h8M30 20l6-2M32 32l4-10"
      stroke="#dbeafe"
      stroke-width="1.2"
      stroke-linecap="round"
      opacity="0.9"
    />
    <!-- 增长柱 -->
    <rect x="17" y="30" width="5" height="10" rx="1.5" fill="rgba(255,255,255,0.35)" />
    <rect x="25" y="26" width="5" height="14" rx="1.5" fill="rgba(255,255,255,0.55)" />
    <rect x="33" y="22" width="5" height="18" rx="1.5" :fill="`url(#${accent})`" />
    <path
      d="M15 40h26"
      stroke="rgba(255,255,255,0.25)"
      stroke-width="1"
      stroke-linecap="round"
    />
  </svg>
</template>

<style scoped>
.traffic-partner-logo {
  display: block;
  flex-shrink: 0;
}
</style>
