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

const PALETTE: ReadonlyArray<{ bg: string; fg: string; bd: string }> = [
  { bg: '#dbeafe', fg: '#1e40af', bd: '#93c5fd' },
  { bg: '#dcfce7', fg: '#166534', bd: '#86efac' },
  { bg: '#ffedd5', fg: '#9a3412', bd: '#fdba74' },
  { bg: '#f3e8ff', fg: '#6b21a8', bd: '#d8b4fe' },
  { bg: '#fce7f3', fg: '#9d174d', bd: '#f9a8d4' },
  { bg: '#ccfbf1', fg: '#0f766e', bd: '#5eead4' },
  { bg: '#fef3c7', fg: '#92400e', bd: '#fcd34d' },
  { bg: '#e0e7ff', fg: '#3730a3', bd: '#a5b4fc' },
  { bg: '#fee2e2', fg: '#991b1b', bd: '#fca5a5' },
  { bg: '#ecfccb', fg: '#3f6212', bd: '#bef264' },
  { bg: '#cffafe', fg: '#0e7490', bd: '#67e8f9' },
  { bg: '#ede9fe', fg: '#5b21b6', bd: '#c4b5fd' },
]

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++)
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}

/** 行内渠道名称标签样式（流量管理、注册用户共用） */
export function getTrafficChannelTagStyle(key: string): CSSProperties {
  const k = key.trim()
  if (!k)
    return {}
  const idx = (hashString(k) >>> 0) % PALETTE.length
  const p = PALETTE[idx]!
  return {
    backgroundColor: p.bg,
    color: p.fg,
    borderColor: p.bd,
    fontWeight: 600,
  }
}
