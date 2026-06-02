/**
 * 商品主图加载失败（外网图床超时、403、国内不可达等）时，替换为可离线渲染的 SVG。
 */
export function onMallProductImageError(ev: Event, productName: string) {
  const img = ev.target as HTMLImageElement | null
  if (!img || img.dataset.mallFallbackApplied === '1') {
    return
  }
  img.dataset.mallFallbackApplied = '1'
  const label = String(productName || '商品')
    .slice(0, 18)
    .replace(/&/g, '&amp;')
    .replace(/</g, '')
    .replace(/>/g, '')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#64748b"/><stop offset="1" stop-color="#334155"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><text x="400" y="320" text-anchor="middle" fill="rgba(255,255,255,0.93)" font-size="30" font-family="PingFang SC,Microsoft YaHei,sans-serif">${label}</text></svg>`
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
