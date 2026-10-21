import { bytes, duration, ms } from '../lib/format.ts'
import type { Snapshot } from '../types.ts'
import Widget from './Widget.tsx'

interface Value {
  label: string
  value: string
  sub?: string
  tone?: 'ok' | 'warn' | 'alert'
}

/** The numbers worth a glance, each as a query-value tile. */
export default function Values({ snapshot }: { snapshot: Snapshot }) {
  const { model, host, apps } = snapshot
  const p = model.probe
  const free = host.diskFreeBytes !== null && host.diskTotalBytes ? host.diskFreeBytes / host.diskTotalBytes : null
  const values: Value[] = [
    { label: 'Time to first token', value: p ? ms(p.ttftMs) : '—', sub: p ? p.model.replace(/^.*\//, '') : 'not timed yet' },
    { label: 'Tokens a second', value: p ? String(p.tokensPerSecond) : '—', sub: p ? `timed ${new Date(p.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : undefined },
    { label: 'Models loaded', value: String(model.loaded.length), sub: `${model.available} on disk`, tone: model.loaded.length ? 'ok' : 'warn' },
    { label: 'Wired memory', value: bytes(host.wiredBytes), sub: `of ${bytes(host.memoryBytes)}`, tone: host.pressure === 'critical' ? 'alert' : host.pressure === 'warning' ? 'warn' : undefined },
    { label: 'Disk free', value: bytes(host.diskFreeBytes), sub: free !== null ? `${Math.round(free * 100)}%` : undefined, tone: free !== null && free < 0.1 ? 'warn' : undefined },
    { label: 'Devices online', value: String(host.tailscale.peersOnline), sub: `of ${host.tailscale.peers} on the tailnet` },
    { label: 'In flight', value: String(apps.reduce((n, a) => n + a.busyTotal, 0)), sub: 'replies, casts, reviews' },
    { label: 'Mac up', value: duration(host.uptimeSeconds), sub: `load ${host.load[0].toFixed(1)}` },
  ]
  return (
    <Widget title="At a glance" className="values-widget">
      <div className="values">
        {values.map((v) => (
          <div key={v.label} className={`value ${v.tone ? `value-${v.tone}` : ''}`}>
            <span className="value-num">{v.value}</span>
            <span className="value-label">{v.label}</span>
            {v.sub && <span className="value-sub">{v.sub}</span>}
          </div>
        ))}
      </div>
    </Widget>
  )
}
