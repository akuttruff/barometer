/** Numbers and moments as the board shows them. */

export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never'
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s} s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

export function duration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} h ${m % 60} min`
  const d = Math.floor(h / 24)
  return `${d} d ${h % 24} h`
}

export function bytes(n: number | null): string {
  if (n === null) return '—'
  if (n < 1e3) return `${n} B`
  if (n < 1e6) return `${(n / 1e3).toFixed(0)} kB`
  if (n < 1e9) return `${(n / 1e6).toFixed(1)} MB`
  return `${(n / 1e9).toFixed(1)} GB`
}

export const pct = (part: number | null, whole: number | null): string => (part === null || !whole ? '—' : `${Math.round((part / whole) * 100)}%`)

export const ms = (n: number | null): string => (n === null ? '—' : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`)

/** 131072 as 128k. */
export const context = (n: number | null): string => (n === null ? '' : n >= 1024 ? `${Math.round(n / 1024)}k` : String(n))

/** The time of day for today's events, the date for older ones. */
export function when(iso: string, now = Date.now()): string {
  const d = new Date(iso)
  const today = new Date(now)
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return sameDay ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}
