<script setup lang="ts">
import { useId } from 'vue'

const uid = useId()
const frameId = `${uid}-frame`
const amberId = `${uid}-amber`
const shineId = `${uid}-shine`
</script>

<template>
  <svg
    class="mall-brand-logo"
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <defs>
      <linearGradient
        :id="frameId"
        x1="4"
        y1="6"
        x2="42"
        y2="44"
        gradientUnits="userSpaceOnUse"
      >
        <stop stop-color="#22d3ee" />
        <stop
          offset="0.55"
          stop-color="#38bdf8"
        />
        <stop
          offset="1"
          stop-color="#7dd3fc"
        />
      </linearGradient>
      <linearGradient
        :id="amberId"
        x1="14"
        y1="36"
        x2="34"
        y2="10"
        gradientUnits="userSpaceOnUse"
      >
        <stop stop-color="#b45309" />
        <stop
          offset="0.35"
          stop-color="#ea580c"
        />
        <stop
          offset="0.7"
          stop-color="#fbbf24"
        />
        <stop
          offset="1"
          stop-color="#fde68a"
        />
      </linearGradient>
      <linearGradient
        :id="shineId"
        x1="16"
        y1="12"
        x2="28"
        y2="26"
        gradientUnits="userSpaceOnUse"
      >
        <stop
          stop-color="#fff"
          stop-opacity="0.55"
        />
        <stop
          offset="0.45"
          stop-color="#fff"
          stop-opacity="0.12"
        />
      
        <stop
          offset="1"
          stop-color="#fff"
          stop-opacity="0"
        />
      </linearGradient>
    </defs>
    <rect
      x="3.2"
      y="3.2"
      width="41.6"
      height="41.6"
      rx="12.5"
      :stroke="`url(#${frameId})`"
      stroke-width="1.5"
      fill="rgba(15, 23, 42, 0.72)"
    />
    <path
      d="M24 10.5 35.2 20.4l-2.9 16.1H15.7L12.8 20.4 24 10.5Z"
      :fill="`url(#${amberId})`"
    />
    <path
      d="M24 10.5v13L12.8 20.4l11.2-9.9Z"
      :fill="`url(#${shineId})`"
    />
    <path
      d="M24 23.5 33.5 19.8"
      stroke="rgba(255,255,255,0.22)"
      stroke-width="0.9"
      stroke-linecap="round"
    />
  </svg>
</template>

<style scoped>
.mall-brand-logo {
  display: block;
}
</style>
