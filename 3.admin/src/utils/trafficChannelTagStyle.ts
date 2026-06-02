import type { CSSProperties } from 'vue'

/** 与「注册用户」列表注册渠道列的取值顺序一致，保证与流量管理名称标签同色 */
export function trafficChannelDisplayKey(
  label?: string | null,
  name?: string | null,
  code?: string | null,
): string {
  const a = (label ?? '').trim()
  if (a)
    return a
  const b = (name ?? '').trim()
  if (b)
    return b
  return (code ?? '').trim()
}

/** 未带流量渠道参数注册时，在「注册用户」等场景展示的固定文案 */
export const MALL_SELF_REGISTER_CHANNEL_LABEL = '商城注册'

/** 固定 10 色：色相拉开（蓝/青/绿/黄绿/黄/橙/红/洋红/紫/棕），浅底深字；同种子稳定映射 */
const TRAFFIC_CHANNEL_PALETTE_SIZE = 10
const PALETTE: ReadonlyArray<{ bg: string; fg: string; bd: string }> = [
  { bg: '#CFE4FF', fg: '#0A4A8C', bd: '#60A5FA' }, // 1 蓝
  { bg: '#C5F6F5', fg: '#0B4F4A', bd: '#2DD4BF' }, // 2 青
  { bg: '#D3F8E6', fg: '#064E3B', bd: '#34D399' }, // 3 绿
  { bg: '#EBFCC7', fg: '#3F6212', bd: '#A3E635' }, // 4 黄绿
  { bg: '#FEF3C7', fg: '#78350F', bd: '#FBBF24' }, // 5 金黄
  { bg: '#FFE8CC', fg: '#7C2D12', bd: '#FB923C' }, // 6 橙
  { bg: '#FEE2E2', fg: '#7F1D1D', bd: '#F87171' }, // 7 正红（仅此一档暖大红）
  { bg: '#FCE7F3', fg: '#831843', bd: '#F472B6' }, // 8 洋红（与红区分：偏紫粉）
  { bg: '#EDE9FE', fg: '#4C1D95', bd: '#A78BFA' }, // 9 紫
  { bg: '#EDE0D4', fg: '#432818', bd: '#BC8A5F' }, // 10 棕褐（与橙区分）
]

/** 分布更均匀，降低短字符串、相似前缀（liuliang2/3）模 10 撞同一色 */
function paletteIndexFromSeed(seed: string): number {
  const s = seed.trim()
  if (!s)
    return 0
  let fnv = 2166136261 >>> 0
  let djb = 5381 >>> 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const pos = (i + 1) * 127
    fnv ^= (c ^ pos) & 0xffffffff
    fnv = Math.imul(fnv, 16777619) >>> 0
    djb = ((djb << 5) + djb + c * (i + 3)) >>> 0
  }
  const last = s.charCodeAt(s.length - 1)
  const first = s.charCodeAt(0)
  const mix = (fnv + djb + s.length * 374761393 + first * 2654435761 + last * 1597334677) >>> 0
  return mix % TRAFFIC_CHANNEL_PALETTE_SIZE
}

/**
 * 行内渠道名称标签样式（流量管理、注册用户共用）
 * @param displayKey 参与展示的文案（可为空）
 * @param colorSeed 着色种子，优先用渠道「标识 code」等与业务唯一对齐；不传则退回 displayKey，保证历史行为
 */
export function getTrafficChannelTagStyle(displayKey: string, colorSeed?: string | null): CSSProperties {
  const shown = displayKey.trim()
  if (!shown)
    return {}
  const seed = String(colorSeed ?? '').trim() || shown
  const idx = paletteIndexFromSeed(seed)
  const p = PALETTE[idx]!
  return {
    backgroundColor: p.bg,
    color: p.fg,
    borderColor: p.bd,
    fontWeight: 600,
  }
}
