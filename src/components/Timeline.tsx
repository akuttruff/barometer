import { when } from '../lib/format.ts'
import type { Alert, Event } from '../types.ts'

const GLYPH: Record<Event['kind'], string> = { restart: '↻', deploy: '⇡', down: '✕', up: '✓', alert: '!', resolved: '✓', note: '·' }

/** What is wrong right now, then what has happened. */
export function Alerts({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null
  return (
    <section className="card alerts">
      <h2 className="section-title">Needs a look</h2>
      <ul className="plain">
        {alerts.map((a) => (
          <li key={a.id} className={`alert alert-${a.severity}`}>
            <span className="alert-text">{a.text}</span>
            <span className="alert-when">since {when(a.openedAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function Timeline({ events }: { events: Event[] }) {
  return (
    <section className="card">
      <h2 className="section-title">Timeline</h2>
      {events.length === 0 ? <p className="dim">Nothing has happened yet.</p> : (
        <ul className="plain timeline">
          {events.map((e) => (
            <li key={e.id} className={`event event-${e.kind} sev-${e.severity}`}>
              <span className="event-glyph" aria-hidden="true">{GLYPH[e.kind]}</span>
              <span className="event-text">{e.text}</span>
              <time className="event-when" dateTime={e.ts}>{when(e.ts)}</time>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
