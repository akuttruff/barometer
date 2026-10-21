import type { Sample } from '../types.ts'

interface Props {
  points: Sample[]
  width?: number
  height?: number
  /** A line at this value, for a threshold. */
  mark?: number
  label: string
  className?: string
}

/** A small line of recent values, no axes: the shape is the point. */
export default function Sparkline({ points, width = 120, height = 28, mark, label, className }: Props) {
  if (points.length < 2) return <svg className={`spark ${className ?? ''}`} width={width} height={height} role="img" aria-label={`${label}: not enough yet`} />
  const xs = points.map((p) => p.ts)
  const ys = points.map((p) => p.value)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const lo = Math.min(...ys, mark ?? Number.POSITIVE_INFINITY)
  const hi = Math.max(...ys, mark ?? Number.NEGATIVE_INFINITY)
  const pad = 2
  const sx = (x: number): number => (x1 === x0 ? width / 2 : pad + ((x - x0) / (x1 - x0)) * (width - 2 * pad))
  const sy = (y: number): number => (hi === lo ? height / 2 : height - pad - ((y - lo) / (hi - lo)) * (height - 2 * pad))
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.ts).toFixed(1)} ${sy(p.value).toFixed(1)}`).join(' ')
  const last = points.at(-1)!
  return (
    <svg className={`spark ${className ?? ''}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: ${last.value}`}>
      {mark !== undefined && <line x1={0} x2={width} y1={sy(mark)} y2={sy(mark)} className="spark-mark" />}
      <path d={d} fill="none" className="spark-line" />
      <circle cx={sx(last.ts)} cy={sy(last.value)} r={2} className="spark-dot" />
    </svg>
  )
}
