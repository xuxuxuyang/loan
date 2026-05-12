<script setup lang="ts">
import { computed } from 'vue'
import { getTrafficChannelTagStyle } from '../utils/trafficChannelTagStyle'

const props = withDefaults(
  defineProps<{
    /** 已与业务侧对齐的展示用渠道文案（label / name / code 择一传入即可） */
    displayKey: string
    size?: 'small' | 'default'
  }>(),
  { size: 'small' },
)

const key = computed(() => props.displayKey.trim())
const tagStyle = computed(() => getTrafficChannelTagStyle(key.value))
</script>

<template>
  <el-tag
    v-if="key"
    effect="light"
    round
    :size="size"
    class="traffic-channel-name-tag"
    :style="tagStyle"
  >
    {{ key }}
  </el-tag>
  <span
    v-else
    class="traffic-channel-name-tag--empty"
  >—</span>
</template>

<style scoped>
.traffic-channel-name-tag {
  border-width: 1px;
  border-style: solid;
  max-width: 100%;
}

.traffic-channel-name-tag--empty {
  color: var(--el-text-color-placeholder);
}
</style>
