import { when } from '../lib/format.ts'
import type { AppStatus, Event } from '../types.ts'
import Widget from './Widget.tsx'

/** What has happened: restarts, deploys, alerts opening and closing. */
export function EventStream({ events }: { events: Event[] }) {
  return (
    <Widget title="Event stream" note={`${events.length}`} span={6} className="stream-widget">
      {events.length === 0 ? <p className="dim">Nothing has happened yet.</p> : (
        <ul className="stream">
          {events.map((e) => (
            <li key={e.id} className={`ev ev-${e.severity} ev-${e.kind}`}>
              <span className="ev-kind">{e.kind}</span>
              <span className="ev-text">{e.text}</span>
              <time className="ev-when" dateTime={e.ts}>{when(e.ts)}</time>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  )
}

/** The latest error lines from each app's own log, newest first. */
export function RecentErrors({ apps }: { apps: AppStatus[] }) {
  const lines = apps.flatMap((a) => a.errors.recent.map((l) => ({ ...l, app: a.name }))).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 40)
  return (
    <Widget title="Recent errors" note={`${lines.length}`} span={6} className="stream-widget">
      {lines.length === 0 ? <p className="dim">No error lines in the apps' logs.</p> : (
        <ul className="stream errors">
          {lines.map((l, i) => (
            <li key={`${l.app}-${l.ts}-${i}`} className="ev ev-warn">
              <span className="ev-kind">{l.app}</span>
              <span className="ev-text mono">{l.text}</span>
              <time className="ev-when" dateTime={l.ts}>{when(l.ts)}</time>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  )
}
