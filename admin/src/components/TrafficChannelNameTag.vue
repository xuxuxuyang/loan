<script setup lang="ts">
import { computed } from 'vue'
import {
  getTrafficChannelTagStyle,
  MALL_SELF_REGISTER_CHANNEL_LABEL,
} from '../utils/trafficChannelTagStyle'

const props = withDefaults(
  defineProps<{
    /** 已与业务侧对齐的展示用渠道文案（label / name / code 择一传入即可） */
    displayKey: string
    /**
     * 与流量商标识（code）等稳定字段对齐，用于从固定 10 色中取值；不传则按展示文案着色（可能与改名不同步）
     */
    colorSeed?: string | null
    size?: 'small' | 'default'
    /**
     * 为 true 且无渠道文案时，展示「商城注册」普通文本（注册用户等场景）；
     * 为 false 时仍显示「—」（流量管理等列表）。
     */
    mallPlainWhenEmpty?: boolean
  }>(),
  { size: 'small', mallPlainWhenEmpty: false, colorSeed: undefined },
)

const key = computed(() => props.displayKey.trim())
const tagStyle = computed(() => getTrafficChannelTagStyle(key.value, props.colorSeed))
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
    v-else-if="mallPlainWhenEmpty"
    class="traffic-channel-name-tag--mall-plain"
  >{{ MALL_SELF_REGISTER_CHANNEL_LABEL }}</span>
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

.traffic-channel-name-tag--mall-plain {
  color:#a8a1a1;
  font-weight: 400;
  font-size: 12px;
}

.traffic-channel-name-tag--empty {
  color: var(--el-text-color-placeholder);
}
</style>
