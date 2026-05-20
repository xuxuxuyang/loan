<script setup lang="ts">
import { useId } from 'vue'

const uid = useId()
const frameId = `${uid}-frame`
const goldId = `${uid}-gold`
const shineId = `${uid}-shine`
const depthId = `${uid}-depth`
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
        x2="44"
        y2="44"
        gradientUnits="userSpaceOnUse"
      >
        <stop stop-color="#fde047" />
        <stop
          offset="0.45"
          stop-color="#f59e0b"
        />
        <stop
          offset="1"
          stop-color="#b45309"
        />
      </linearGradient>
      <linearGradient
        :id="goldId"
        x1="6"
        y1="34"
        x2="42"
        y2="12"
        gradientUnits="userSpaceOnUse"
      >
        <stop stop-color="#92400e" />
        <stop
          offset="0.28"
          stop-color="#d97706"
        />
        <stop
          offset="0.55"
          stop-color="#fbbf24"
        />
        <stop
          offset="0.82"
          stop-color="#fde68a"
        />
        <stop
          offset="1"
          stop-color="#fff7c2"
        />
      </linearGradient>
      <linearGradient
        :id="shineId"
        x1="14"
        y1="13"
        x2="34"
        y2="22"
        gradientUnits="userSpaceOnUse"
      >
        <stop
          stop-color="#fff"
          stop-opacity="0.8"
        />
        <stop
          offset="0.5"
          stop-color="#fff"
          stop-opacity="0.15"
        />
        <stop
          offset="1"
          stop-color="#fff"
          stop-opacity="0"
        />
      </linearGradient>
      <linearGradient
        :id="depthId"
        x1="24"
        y1="28"
        x2="24"
        y2="38"
        gradientUnits="userSpaceOnUse"
      >
        <stop stop-color="#78350f" stop-opacity="0.45" />
        <stop
          offset="1"
          stop-color="#78350f"
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
      fill="rgba(69, 10, 10, 0.82)"
    />
    <!-- 船型金元宝：宽扁船身 + 底部双翘角 -->
    <path
      d="M6.8 24.6c0-7.2 7.2-12.8 17.2-13.4 10 .6 17.2 6.2 17.2 13.4 0 2.6-2 4.6-5.2 5.6l-1.2 1.2c-1.4 1.8-3.6 2.8-6 2.8h-6.8c-2.4 0-4.6-1-6-2.8l-1.2-1.2c-3.2-1-5.2-3-5.2-5.6Z"
      :fill="`url(#${goldId})`"
    />
    <path
      d="M13.2 33.2c2.6 1.4 5.4 2.1 8.8 2.1h4c3.4 0 6.2-.7 8.8-2.1"
      stroke="rgba(120, 53, 15, 0.4)"
      stroke-width="0.9"
      stroke-linecap="round"
      fill="none"
    />
    <path
      d="M10.5 31.8 7.8 35.2M37.5 31.8 40.2 35.2"
      stroke="rgba(180, 83, 9, 0.6)"
      stroke-width="1.2"
      stroke-linecap="round"
    />
    <path
      d="M10.5 24.6c0-5.8 5.4-10.2 13.5-10.8 8.1.6 13.5 5 13.5 10.8 0 1.8-1.2 3.2-3.2 4l-1.4 1.4h-15.8l-1.4-1.4c-2-0.8-3.2-2.2-3.2-4Z"
      :fill="`url(#${shineId})`"
    />
    <ellipse
      cx="24"
      cy="16.8"
      rx="11.5"
      ry="3.6"
      :fill="`url(#${shineId})`"
      opacity="0.88"
    />
    <ellipse
      cx="24"
      cy="30"
      rx="12"
      ry="4"
      :fill="`url(#${depthId})`"
    />
  </svg>
</template>

<style scoped>
.mall-brand-logo {
  display: block;
}
</style>
