<template>
  <div v-show="shouldShowAd" class="ads-item" :class="{ 'ads-loading': isLoading }">
    <div v-show="isAdFilled" class="ads-borded ads-content">
      <div class="ads-content-title">
        Advertisement
      </div>
      <ins ref="adsRef" v-bind="adAttrs" @error="handleAdError" />
    </div>
    <div v-show="showDebug" class="ad-msg ads-debug">
      <div>Status: {{ adStatus }}</div>
      <div>Load Time: {{ loadTime }}ms</div>
      <div>{{ adsAttrs }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, useTemplateRef } from 'vue'
import { useAppStore } from '@/stores/app'

const { customEventTrack } = useFirebase()
/** 设备类型 */
const { isMobile } = useCustomDevice()
const AD_STATUS = {
  PENDING: 'pending',
  FILLED: 'filled',
  UNFILLED: 'unfilled',
  ERROR: 'error',
}

interface Props {
  adsAttrs?: object
  showDebug?: boolean
  timeout?: number
  only?: 'pc' | 'mobile'
}

const { adsAttrs = {}, showDebug = false, timeout = 5000, only } = defineProps<Props>()

/** 是否显示广告（如果广告位配置对象不含 data-ad-slot 属性则不显示广告） */
const isShowAd = computed(() => {
  const isOnlyPc = only === 'pc' && !isMobile.value
  const isOnlyMobile = only === 'mobile' && isMobile.value
  return Object.keys(adsAttrs).includes('data-ad-slot') && (isOnlyPc || isOnlyMobile || !only)
})

const emit = defineEmits<{
  adLoaded: [data: { status: string, loadTime: number }]
  adError: [data: { error: string, attempts: number, adSlot?: string }]
}>()

const { webConfig } = useAppStore()

const adsRef = useTemplateRef<HTMLElement>('adsRef')
// 保存 MutationObserver，组件卸载时需要断开
const observerRef = ref<MutationObserver | null>(null)

const isAdFilled = ref(true)
const isLoading = ref(true)
const adStatus = ref(AD_STATUS.PENDING)
const loadTime = ref(0)
const loadStartTime = ref<number | null>(null)
const timeoutTimer = ref<NodeJS.Timeout | null>(null)
const errorCount = ref(0)
const maxErrors = 3
const renderTimeout = ref<NodeJS.Timeout | null>(null)
const shouldShowAd = ref(true)

const adAttrs = computed(() => {
  const defaults = {
    'class': 'adsbygoogle',
    'style': 'display:block',
    'data-ad-format': 'auto',
    'data-full-width-responsive': 'true',
    'data-ad-client': webConfig.adSense?.clientId,
  }

  const effective = adsAttrs
  if (!effective) return defaults
  if (typeof effective !== 'object') return Object.assign({}, defaults)
  return Object.assign({}, defaults, effective)
})

const initAd = () => {
  console.log('initADDDDDDDDDDDD')
  loadStartTime.value = Date.now()
  // 使用外部懒加载/观察器，不在组件内启动超时
  observeAdStatus()
}

const observeAdStatus = () => {
  const ads = adsRef.value
  if (!ads) {
    // 如果 ads 元素还没有准备好，延迟重试
    setTimeout(() => {
      observeAdStatus()
    }, 100)
    return
  }

  // 如果已有 observer，先断开，避免重复监听
  if (observerRef.value) {
    try {
      observerRef.value.disconnect()
    } catch (_e) {
      console.log(_e)
    }
    observerRef.value = null
  }

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === 'data-ad-status') {
        const newStatus = (mutation.target as Element).getAttribute('data-ad-status')
        console.log('[AdComponent] 广告状态变化:', newStatus)
        updateAdStatus(newStatus)
      }
    })
  })

  observer.observe(ads, {
    attributes: true,
    attributeFilter: ['data-ad-status'],
  })

  observerRef.value = observer

  // 初始化时检查当前状态
  const currentStatus = ads.getAttribute('data-ad-status')
  console.log('[AdComponent] 初始广告状态:', currentStatus)
  updateAdStatus(currentStatus)
}

const updateAdStatus = (status: string | null) => {
  adStatus.value = status || AD_STATUS.PENDING
  isAdFilled.value = status !== AD_STATUS.UNFILLED && status !== AD_STATUS.ERROR
  isLoading.value = status !== AD_STATUS.FILLED && status !== AD_STATUS.ERROR

  // 当广告未填充或出错时，隐藏整个广告模块（外层容器）
  if (status === AD_STATUS.UNFILLED || status === AD_STATUS.ERROR) {
    shouldShowAd.value = false
  }
  else {
    shouldShowAd.value = true
  }

  if (status === AD_STATUS.FILLED) {
    loadTime.value = Date.now() - (loadStartTime.value || 0)
    // 清除组件内部的超时标记
    clearAdTimeout()
    emit('adLoaded', {
      status,
      loadTime: loadTime.value,
    })
  }
}

const handleAdError = (error: Error) => {
  errorCount.value++

  if (process.env.NODE_ENV === 'development') {
    console.warn(`Ad load attempt ${errorCount.value}/${maxErrors}: ${error.message}`)
  }

  // 兼容旧 prop 名和新 prop 名
  const adsObj = adsAttrs as Record<string, any> | null
  customEventTrack.value('ad_load_error', 'error', {
    errorType: error.message,
    attempt: errorCount.value,
    adSlot: adsObj?.['data-ad-slot'],
  })

  if (errorCount.value < maxErrors) {
    retryAd()
  }
  else {
    adStatus.value = AD_STATUS.ERROR
    isAdFilled.value = false
    isLoading.value = false
    shouldShowAd.value = false
    const adsObj2 = adsAttrs as Record<string, any> | null
    emit('adError', {
      error: error.message,
      attempts: errorCount.value,
      adSlot: adsObj2?.['data-ad-slot'],
    })
  }
}

const retryAd = () => {
  clearTimers()
  renderTimeout.value = setTimeout(() => {
    initAd()
  }, 1000 * errorCount.value)
}

// 避免与全局 clearTimeout 命名冲突，组件内部使用此方法
const clearAdTimeout = () => {
  if (timeoutTimer.value) {
    try {
      (globalThis as any).clearTimeout(timeoutTimer.value)
    }
    catch (e) {
      void e
    }
    timeoutTimer.value = null
  }
}

const resetState = () => {
  isAdFilled.value = true
  isLoading.value = true
  adStatus.value = AD_STATUS.PENDING
  loadTime.value = 0
  errorCount.value = 0
  shouldShowAd.value = true
  clearTimers()
}

const clearTimers = () => {
  if (timeoutTimer.value) {
    try {
      (globalThis as any).clearTimeout(timeoutTimer.value)
    }
    catch (e) {
      void e
    }
    timeoutTimer.value = null
  }
  if (renderTimeout.value) {
    try {
      (globalThis as any).clearTimeout(renderTimeout.value)
    }
    catch (e) {
      void e
    }
    renderTimeout.value = null
  }
}

// 监听 adsAttrs 的变化，任一存在时初始化广告观察
watch(
  () => [adsAttrs],
  (newVals) => {
    const [adsAttrs] = newVals
    if (adsAttrs) {
      resetState()
      initAd()
    }
  },
  { immediate: true },
)

onMounted(() => {
  if (adsAttrs) {
    initAd()
  }
})

onBeforeUnmount(() => {
  // 断开组件内的 MutationObserver（如存在）
  if (observerRef.value) {
    try {
      observerRef.value.disconnect()
    }
    catch (e) {
      void e
    }
    observerRef.value = null
  }
  clearTimers()
})
</script>

<style lang="scss" scoped>
.ads-item {
  margin: 1rem 0;
  display: flex;
  flex-direction: column;
  width: 100%;
  font-weight: 400;
  font-size: 16px;
}

.ads-content {
  border-bottom: 1px solid #c6c6c6;
  height: fit-content;

  .ads-content-title {
    display: flex;
    place-items: center;
    font-size: 10px;
    color: #999;
    line-height: normal;

    &::before,
    &::after {
      content: '';
      flex: 1;
      border-bottom: 1px solid #c6c6c6;
    }

    &::before {
      margin-right: 15px;
    }

    &::after {
      margin-left: 15px;
    }
  }

  .adsbygoogle {
    text-align: center;
  }
}

.ads-debug {
  border: 2px solid red;
  margin-bottom: 2px;
  background-color: #ffe786;
  color: #000;
}

.ads-loading {
  min-height: 100px;
}

.ads-item {
  position: relative;
  transition: opacity 0.3s;

  &.ads-loading {
    opacity: 0.6;
  }
}

.ad-msg {
  position: absolute;
  bottom: 0;
  right: 0;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 4px;
}
</style>
