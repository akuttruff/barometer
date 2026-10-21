import { ago } from '../lib/format.ts'
import type { Monitor, MonitorGroup, MonitorStatus } from '../types.ts'
import Widget from './Widget.tsx'

export const STATUS_WORD: Record<MonitorStatus, string> = { ok: 'OK', warn: 'Warn', alert: 'Alert', nodata: 'No data' }
const GROUP_WORD: Record<MonitorGroup, string> = { apps: 'Apps', services: 'Services', model: 'Model', mac: 'Mac', data: 'Data' }
const ORDER: MonitorStatus[] = ['alert', 'warn', 'nodata', 'ok']

export function StatusPill({ status }: { status: MonitorStatus }) {
  return <span className={`pill pill-${status}`}>{STATUS_WORD[status]}</span>
}

/** How many monitors stand at each status, the way a monitor summary widget counts them. */
export function MonitorSummary({ monitors }: { monitors: Monitor[] }) {
  const counts = Object.fromEntries(ORDER.map((s) => [s, monitors.filter((m) => m.status === s).length])) as Record<MonitorStatus, number>
  return (
    <Widget title="Monitor summary" note={`${monitors.length} monitors`} className="summary">
      <div className="counts">
        {ORDER.map((s) => (
          <div key={s} className={`count count-${s} ${counts[s] ? '' : 'count-none'}`}>
            <span className="count-num">{counts[s]}</span>
            <span className="count-word">{STATUS_WORD[s]}</span>
          </div>
        ))}
      </div>
    </Widget>
  )
}

/** The monitors that are not ok, newest first, as a triggered-monitors list. */
export function Triggered({ monitors }: { monitors: Monitor[] }) {
  const open = monitors.filter((m) => m.status === 'alert' || m.status === 'warn').sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || (b.since ?? '').localeCompare(a.since ?? ''))
  if (open.length === 0) return null
  return (
    <Widget title="Triggered monitors" note={`${open.length}`} className="triggered">
      <ul className="trig">
        {open.map((m) => (
          <li key={m.id} className={`trig-row trig-${m.status}`}>
            <StatusPill status={m.status} />
            <span className="trig-name">{m.name}</span>
            <span className="trig-text">{m.text}</span>
            <span className="trig-since">{m.since ? `triggered ${ago(m.since)}` : 'confirming'}</span>
          </li>
        ))}
      </ul>
    </Widget>
  )
}

/** Every monitor as a tile coloured by its status, grouped, like check-status widgets. */
export function MonitorGrid({ monitors }: { monitors: Monitor[] }) {
  const groups = (Object.keys(GROUP_WORD) as MonitorGroup[]).filter((g) => monitors.some((m) => m.group === g))
  return (
    <Widget title="Monitors" className="grid-widget">
      {groups.map((g) => (
        <div key={g} className="mgroup">
          <h3 className="mgroup-title">{GROUP_WORD[g]}</h3>
          <div className="tiles">
            {monitors.filter((m) => m.group === g).map((m) => (
              <div key={m.id} className={`tile tile-${m.status}`} title={m.text} role="status" aria-label={`${m.name}: ${STATUS_WORD[m.status]}. ${m.text}`}>
                <span className="tile-name">{m.name}</span>
                <span className="tile-status">{STATUS_WORD[m.status]}</span>
                <span className="tile-text">{m.text}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Widget>
  )
}
