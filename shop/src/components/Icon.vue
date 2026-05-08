<script setup lang="ts">
/**
 * 兼容原 Nuxt `<Icon name="local:menu" size="1rem" />` 与 Iconify 图标名
 */
import { Icon } from '@iconify/vue'
import { computed } from 'vue'

import arrowRightUrl from '~/assets/icons/arrow-right.svg?url'
import closeUrl from '~/assets/icons/close.svg?url'
import menuUrl from '~/assets/icons/menu.svg?url'
import socialFacebookUrl from '~/assets/icons/social-facebook.svg?url'
import socialInsUrl from '~/assets/icons/social-ins.svg?url'
import socialTiktokUrl from '~/assets/icons/social-tiktok.svg?url'
import socialXUrl from '~/assets/icons/social-x.svg?url'

const localUrlMap: Record<string, string> = {
  menu: menuUrl,
  close: closeUrl,
  'arrow-right': arrowRightUrl,
  'social-facebook': socialFacebookUrl,
  'social-ins': socialInsUrl,
  'social-tiktok': socialTiktokUrl,
  'social-x': socialXUrl,
}

const props = withDefaults(
  defineProps<{
    name: string
    size?: string | number
  }>(),
  { size: '1em' },
)

const localKey = computed(() => (props.name.startsWith('local:') ? props.name.slice(6) : ''))
const logoKey = computed(() => (props.name.startsWith('logo:') ? props.name.slice(5) : ''))
const iconifyName = computed(() => {
  if (props.name.startsWith('local:') || props.name.startsWith('logo:'))
    return ''
  return props.name
})

const logoSrc = computed(() => {
  if (!logoKey.value)
    return ''
  const base = import.meta.env.BASE_URL || '/'
  const prefix = base.endsWith('/') ? base : `${base}/`
  return `${prefix}logos/${logoKey.value}.svg`
})

const sizePx = computed(() => {
  const s = props.size
  if (s == null || s === '') return undefined
  return typeof s === 'number' ? `${s}px` : s
})
</script>

<template>
  <img
    v-if="localKey && localUrlMap[localKey]"
    alt=""
    role="presentation"
    class="inline-block shrink-0 [vertical-align:-0.125em]"
    :src="localUrlMap[localKey]"
    :style="sizePx ? { width: sizePx, height: sizePx } : undefined"
  >
  <img
    v-else-if="logoSrc"
    alt=""
    role="presentation"
    class="inline-block shrink-0 [vertical-align:-0.125em]"
    :src="logoSrc"
    :style="sizePx ? { width: sizePx, height: sizePx } : undefined"
  >
  <Icon
    v-else-if="iconifyName"
    :icon="iconifyName"
    class="inline-block shrink-0 [vertical-align:-0.125em]"
    :width="sizePx || '1em'"
    :height="sizePx || '1em'"
  />
</template>
