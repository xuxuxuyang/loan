// 负责广告脚本加载和初始化
// 处理广告元素的可视区域检测(Intersection Observer)
// 管理广告加载重试机制
import { ref, computed, nextTick } from 'vue'
import type { Ref } from 'vue'
import { useAppStore } from '@/stores/app'

export const useAdSystem = (rootElement?: Ref<HTMLElement | undefined>) => {
  const appStore = useAppStore()
  const { customEventTrack } = useFirebase()
  const webConfig = computed(() => appStore.webConfig)
  const adObserver = ref<IntersectionObserver | null>(null)
  const domObserver = ref<MutationObserver | null>(null)
  const observedAds = ref<Set<Element>>(new Set())
  const maxRetries = 3
  const preloadDistance = 300 // 300px的预加载距离

  const loadScript = (url: string) => {
    return new Promise((resolve, reject) => {
      // 检查是否已经加载过
      if (document.querySelector(`script[src="${url}"]`)) {
        resolve(true)
        return
      }
      const script = document.createElement('script')
      script.src = url
      script.async = true
      script.crossOrigin = 'anonymous'
      script.onload = resolve
      script.onerror = reject
      document.head.appendChild(script)
    })
  }

  const loadAdSenseScript = async () => {
    if (typeof window === 'undefined') return

    try {
      const adSense = webConfig.value?.adSense
      const client = adSense?.clientId

      if (window.adsbygoogle?.loaded) {
        customEventTrack.value('adscript_loaded', 'expose')
        console.log('adscript_loaded')
        return
      }

      if (client) {
        const fallback = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`
        await loadScript(fallback)
        customEventTrack.value('adscript_add_success_fallback', 'expose')
        console.log('adscript_add_success_fallback')
        return
      }

      console.log('no_adscript_config')
      customEventTrack.value('no_adscript_config', 'expose')
      return
    } catch (error) {
      console.error('Failed to load AdSense script:', error)
      customEventTrack.value('adscript_load_error', 'error')
    }
  }

  const loadAd = async (adElement: Element, retryCount = 0) => {
    if (adElement.getAttribute('data-ad-status')) {
      return
    }

    if (!window.adsbygoogle) {
      if (retryCount < maxRetries) {
        console.log(`[AdSystem] 🔄 重试广告加载 (${retryCount + 1}/${maxRetries})...`)
        setTimeout(() => {
          loadAd(adElement, retryCount + 1)
        }, 1000)
        return
      }
      console.warn('[AdSystem] ❌ AdSense 脚本未加载，广告加载失败')
      return
    }

    try {
      if (adElement && document.body.contains(adElement)) {
        await nextTick()
        const htmlElement = adElement as HTMLElement
        if (htmlElement.offsetWidth > 0) {
          const adSlot = adElement.getAttribute('data-ad-slot')
          console.log(
            `[AdSystem] 📣 Push | Slot: ${adSlot} | Size: ${htmlElement.offsetWidth}x${htmlElement.offsetHeight}`,
          )
          // 在推送前标记
          try {
            adElement.setAttribute('data-ad-status', 'pushing')
          } catch (_e) {
            // ignore
          }
          console.log('[AdSystem] adsbygoogle present?', !!window.adsbygoogle, 'type:', typeof window.adsbygoogle)
          ;(window.adsbygoogle = window.adsbygoogle || []).push({})
          // 标记已推送，真实渲染状态可能稍后由 iframe / publisher 更新
          try {
            adElement.setAttribute('data-ad-status', 'pushed')
          } catch (_e) {
            // ignore
          }
          // 如果广告容器高度仍然为 0，稍后重试确认是否渲染
          setTimeout(() => {
            const h = htmlElement.offsetHeight
            if (h > 0) {
              try {
                adElement.setAttribute('data-ad-status', 'loaded')
              } catch (_e) {
                // ignore
              }
            } else {
              console.log(`[AdSystem] 广告推送后高度仍为0，Slot: ${adSlot} Height:${h}`)
            }
          }, 800)
        }
        else {
          console.log(`[AdSystem] ⏳ 等待渲染 | Slot: ${adElement.getAttribute('data-ad-slot')}`)
          if (retryCount < maxRetries) {
            setTimeout(() => {
              loadAd(adElement, retryCount + 1)
            }, 500)
          }
        }
      }
    } catch (error) {
      console.error(`[AdSystem] ❌ 广告推送错误:`, error)
      if (retryCount < maxRetries) {
        console.log(`[AdSystem] 🔄 错误后重试 (${retryCount + 1}/${maxRetries})`)
        setTimeout(() => {
          loadAd(adElement, retryCount + 1)
        }, 1000)
      }
    }
  }

  const handleAdIntersection = (entry: IntersectionObserverEntry) => {
    if (!entry || !observedAds.value) return

    const adElement = entry.target
    const adid = adElement.getAttribute('data-ad-slot')
    if (entry.isIntersecting && adElement && !adElement.getAttribute('data-ad-status')) {
      console.log(`[AdSystem] ✅ 命中预加载 | Slot: ${adid}`)

      adObserver.value?.unobserve(adElement)
      observedAds.value.delete(adElement)
      loadAd(adElement)
    }
  }

  const observeAds = (element?: HTMLElement) => {
    const rootEl = element || rootElement?.value || (typeof document !== 'undefined' ? document.body : null)
    if (!rootEl) return

    // 改为通过 DOM 查询来查找所有广告元素，而不是依赖 this.$refs
    // 这样可以找到所有子组件中的广告
    const adElements = rootEl.querySelectorAll('ins.adsbygoogle')
    const newAdsCount = Array.from(adElements).filter((el) => !observedAds.value.has(el)).length

    if (newAdsCount > 0) {
      console.log(`[AdSystem] 🔍 发现 ${newAdsCount} 个新广告元素 (总数: ${adElements.length})`)
    }

    if (adElements.length > 0) {
      adElements.forEach((adElement) => {
        // 检查它是否已经被观察或已经有状态
        if (!adElement.getAttribute('data-ad-status') && !observedAds.value.has(adElement)) {
          const slot = adElement.getAttribute('data-ad-slot')
          console.log(`[AdSystem] ➕ 添加监听 | Slot: ${slot}`)

          observedAds.value.add(adElement)
          adObserver.value?.observe(adElement)
        }
      })
    }
  }

  const setupAdObserver = (element?: HTMLElement) => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      return
    }

    const rootEl = element || rootElement?.value || (typeof document !== 'undefined' ? document.body : null)
    if (!rootEl) return

    if (adObserver.value) {
      adObserver.value.disconnect()
    }

    observedAds.value = new Set()

    console.log(`[AdSystem] 👀 启动监听 | 预加载: ${preloadDistance}px`)

    adObserver.value = new IntersectionObserver(
      (entries) => {
        entries.forEach(handleAdIntersection)
      },
      {
        // rootMargin 格式: top right bottom left
        // 同时扩展上下，支持双向滚动的预加载
        rootMargin: `${preloadDistance}px 0px ${preloadDistance}px 0px`,
        threshold: 0,
      },
    )

    const debounce = (func: () => void, delay: number) => {
      let timeout: NodeJS.Timeout | null = null
      return () => {
        if (timeout) {
          clearTimeout(timeout)
        }
        timeout = setTimeout(() => {
          func()
        }, delay)
      }
    }
    const debouncedObserveAds = debounce(() => observeAds(rootEl), 300)

    nextTick(() => {
      setTimeout(() => {
        observeAds(rootEl)
      }, 200)

      if (typeof MutationObserver !== 'undefined' && !domObserver.value) {
        domObserver.value = new MutationObserver(() => {
          debouncedObserveAds()
        })

        domObserver.value.observe(rootEl, {
          childList: true,
          subtree: true,
        })
      }
    })
  }

  const initAdSystem = async (element?: HTMLElement) => {
    console.log(`[AdSystem] 🚀 初始化广告系统`)
    if (typeof window !== 'undefined') {
      await loadAdSenseScript()
      nextTick(() => {
        setTimeout(() => {
          setupAdObserver(element)
        }, 100)
      })
    }
  }

  const cleanupAdSystem = () => {
    if (adObserver.value) {
      adObserver.value.disconnect()
      adObserver.value = null
    }
    if (domObserver.value) {
      domObserver.value.disconnect()
      domObserver.value = null
    }
    observedAds.value.clear()
  }

  // 暴露给组件使用
  return {
    initAdSystem,
    cleanupAdSystem,
    observeAds,
  }
}
