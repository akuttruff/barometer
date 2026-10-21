import { useRef, useState } from 'react'
import useWidth from '../lib/useWidth.ts'
import type { Sample } from '../types.ts'

export interface Series {
  name: string
  points: Sample[]
  color: string
}

interface Props {
  series: Series[]
  /** Shown after each value. */
  unit?: string
  /** How a value reads on the axis and in the legend. */
  format?: (v: number) => string
  height?: number
  /** The axis starts at zero unless told otherwise. */
  fromZero?: boolean
  /** The window the graph covers, so an empty stretch still reads as time. */
  hours: number
  label: string
}

/** Datadog's series palette, more or less. */
export const PALETTE = ['#632ca6', '#3b7ddd', '#1aa38d', '#f28c28', '#d6367a', '#7f8c8d']

const PAD = { top: 8, right: 10, bottom: 20, left: 44 }

/** Round ticks: 0, a nice step, up to the top. */
function ticks(lo: number, hi: number, n = 4): number[] {
  if (hi === lo) return [lo]
  const raw = (hi - lo) / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6)
  // One more above the highest value, so a line never runs along the top edge.
  if ((out.at(-1) ?? lo) < hi) out.push(Math.round((out.at(-1)! + step) * 1e6) / 1e6)
  return out
}

const timeLabel = (ms: number, hours: number): string => {
  const d = new Date(ms)
  return hours > 48 ? d.toLocaleDateString([], { month: 'short', day: 'numeric' }) : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** A graph with axes and a legend, like a dashboard's: hover (or touch) reads the values at one moment. */
export default function TimeSeries({ series, unit = '', format, height = 170, fromZero = true, hours, label }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const width = useWidth(box)
  const [hover, setHover] = useState<number | null>(null)
  const fmt = format ?? ((v: number) => (Number.isInteger(v) ? String(v) : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2).replace(/\.?0+$/, '')))

  const now = Date.now()
  const x0 = now - hours * 3600_000
  const all = series.flatMap((s) => s.points)
  const ys = all.map((p) => p.value)
  const lo = fromZero ? 0 : Math.min(...ys, Number.POSITIVE_INFINITY)
  const hiRaw = ys.length ? Math.max(...ys) : 1
  const hi = hiRaw === lo ? lo + 1 : hiRaw
  const yTicks = ticks(lo, hi)
  const top = yTicks.at(-1)! > hi ? yTicks.at(-1)! : hi
  const w = Math.max(width, 120)
  const plotW = w - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom
  const sx = (t: number): number => PAD.left + ((t - x0) / (now - x0)) * plotW
  const sy = (v: number): number => PAD.top + plotH - ((v - lo) / (top - lo)) * plotH
  const path = (points: Sample[]): string => points.filter((p) => p.ts >= x0).map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.ts).toFixed(1)} ${sy(p.value).toFixed(1)}`).join(' ')

  const hoverT = hover === null ? null : x0 + ((hover - PAD.left) / plotW) * (now - x0)
  const at = (points: Sample[]): Sample | null => {
    if (hoverT === null || points.length === 0) return null
    let best = points[0]!
    for (const p of points) if (Math.abs(p.ts - hoverT) < Math.abs(best.ts - hoverT)) best = p
    return best
  }
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - r.left
    setHover(x >= PAD.left && x <= w - PAD.right ? x : null)
  }
  const xTicks = [x0, x0 + (now - x0) / 2, now]

  return (
    <div className="ts" ref={box}>
      <svg width={w} height={height} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {yTicks.map((t) => (
          <g key={t}>
            <line className="ts-grid" x1={PAD.left} x2={w - PAD.right} y1={sy(t)} y2={sy(t)} />
            <text className="ts-tick" x={PAD.left - 6} y={sy(t) + 3} textAnchor="end">{fmt(t)}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={t} className="ts-tick" x={sx(t)} y={height - 5} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>{timeLabel(t, hours)}</text>
        ))}
        {series.map((s) => <path key={s.name} d={path(s.points)} fill="none" stroke={s.color} strokeWidth={1.5} strokeLinejoin="round" />)}
        {hover !== null && <line className="ts-cursor" x1={hover} x2={hover} y1={PAD.top} y2={PAD.top + plotH} />}
        {hover !== null && series.map((s) => { const p = at(s.points); return p ? <circle key={s.name} cx={sx(p.ts)} cy={sy(p.value)} r={3} fill={s.color} /> : null })}
        {all.length === 0 && <text className="ts-empty" x={PAD.left + plotW / 2} y={PAD.top + plotH / 2} textAnchor="middle">No data yet</text>}
      </svg>
      <ul className="ts-legend">
        {hoverT !== null && <li className="ts-legend-time">{new Date(hoverT).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</li>}
        {series.map((s) => {
          const p = hoverT !== null ? at(s.points) : s.points.at(-1) ?? null
          return <li key={s.name}><span className="ts-swatch" style={{ background: s.color }} />{s.name}{p ? <b>{fmt(p.value)}{unit}</b> : null}</li>
        })}
      </ul>
    </div>
  )
}
