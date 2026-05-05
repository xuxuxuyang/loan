// 负责广告点击追踪
// iframe 相关的事件监听
// 页面可见性变化追踪
import { ref, onBeforeUnmount } from 'vue'

export const useAdTracking = () => {
  const activeIframe = ref<HTMLIFrameElement | null>(null)
  const iframes = ref<Map<HTMLIFrameElement, { hasTracked: boolean; adSlot?: string }>>(new Map())
  const visibilityChangeHandler = ref<(() => void) | null>(null)
  const blurHandler = ref<(() => void) | null>(null)
  const { customEventTrack } = useFirebase()

  const watchForIframeInsertion = () => {
    // console.log('[AdTracking] 监听iframe插入')
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) {
            return
          }
          const element = node as Element
          if (element.tagName === 'IFRAME' && element.closest('ins.adsbygoogle')) {
            // console.log('[AdTracking] ifame 广告已经检测:', node)
            setupIframeTracking(element as HTMLIFrameElement)
          } else {
            const iframesInNode = element.querySelectorAll('iframe')
            iframesInNode.forEach((iframe) => {
              if (iframe.closest('ins.adsbygoogle')) {
                // console.log('[AdTracking] ifame 广告已经检测 子集:', iframe)
                setupIframeTracking(iframe)
              }
            })
          }
        })
      })
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    })
  }

  const setupIframeTracking = (iframe: HTMLIFrameElement) => {
    if (iframes.value.has(iframe)) return

    const adSlot = iframe.closest('ins.adsbygoogle')?.getAttribute('data-ad-slot')
    console.log(`[AdTracking] 👁️ 追踪 Iframe | Slot: ${adSlot}`)
    iframes.value.set(iframe, {
      hasTracked: false,
      adSlot: adSlot || undefined,
    })
  }

  const setupBlurTracking = () => {
    // console.log('[AdTracking] 焦点丢失监听')
    blurHandler.value = () => {
      if (
        document.activeElement
        && document.activeElement.tagName === 'IFRAME'
        && iframes.value.has(document.activeElement as HTMLIFrameElement)
      ) {
        // console.log('[AdTracking] 焦点丢失:', document.activeElement)
        handleIframeFocus(document.activeElement as HTMLIFrameElement)
      }
    }
    window.addEventListener('blur', blurHandler.value)
  }

  const handleIframeFocus = (iframe: HTMLIFrameElement) => {
    // console.log('[AdTracking] 焦点获取:', iframe)
    const data = iframes.value.get(iframe)
    if (data && !data.hasTracked) {
      console.log(`[AdTracking] 🖱️ 广告被点击 忽略事件 其他事件记录 | Slot: ${data.adSlot}`)
      // trackAdClick(iframe)
      data.hasTracked = true
      activeIframe.value = iframe
    }
  }

  const trackAdClick = (iframe: HTMLIFrameElement) => {
    const container = iframe.closest('ins.adsbygoogle') as HTMLElement
    if (!container) return

    const rect = container.getBoundingClientRect()
    const clickData = {
      insX: rect.left,
      insY: rect.top,
      insHeight: rect.height,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      adSlot: container.dataset.adSlot,
    }
    // console.log('[AdTracking] 广告点击数据:', clickData)

    // 调用 $adClick（如果存在）
    customEventTrack.value('ad_iframe_click', 'click', {
      'data-ad-slot': clickData.adSlot,
    })
  }

  const setupVisibilityTracking = () => {
    // console.log('[AdTracking] 页面可见性变化监听?>>')
    visibilityChangeHandler.value = () => {
      // console.log(`[AdTracking] 页面可见性变化改变到: ${document.visibilityState}`)
      if (document.visibilityState === 'visible') {
        activeIframe.value = null
      } else if (activeIframe.value) {
        const data = iframes.value.get(activeIframe.value)
        console.log(`[AdTracking] 👋👋 页面离开 (点击后) | Slot: ${data?.adSlot}`)
        // customEventTrack.value('ad_iframe_click_leave', 'click', {
        //   'data-ad-slot': data?.adSlot,
        // })
      }
    }

    document.addEventListener('visibilitychange', visibilityChangeHandler.value)
  }

  const initAdTracking = () => {
    if (typeof window === 'undefined') return
    console.log(`[AdTracking] 🚀 初始化点击追踪`)

    watchForIframeInsertion()
    setupVisibilityTracking()
    setupBlurTracking()
  }

  const cleanupAdTracking = () => {
    console.log('[AdTracking] 🧹 清理资源')
    if (visibilityChangeHandler.value) {
      document.removeEventListener('visibilitychange', visibilityChangeHandler.value)
    }
    if (blurHandler.value) {
      window.removeEventListener('blur', blurHandler.value)
    }
    iframes.value.clear()
    activeIframe.value = null
  }

  onBeforeUnmount(() => {
    cleanupAdTracking()
  })

  return {
    initAdTracking,
    cleanupAdTracking,
  }
}
