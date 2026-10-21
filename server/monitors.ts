import type { Monitor, MonitorStatus, Severity, Snapshot } from '../src/types.ts'
import type { ServerSettings } from './store.ts'

/** How many rounds in a row something must be down before it is said: one lost request is not an outage. */
export const CONFIRM_TICKS = 2

/** An alert that should be open right now: a monitor that is not ok. */
export interface Wanted {
  rule: string
  target: string
  severity: Severity
  text: string
}

const pct = (part: number | null, whole: number | null): number | null => (part !== null && whole ? Math.round((part / whole) * 1000) / 10 : null)
const gb = (n: number | null): string => (n ? ` (${(n / 1e9).toFixed(0)} GB wired)` : '')

type Judged = Omit<Monitor, 'since'>

/**
 * Every monitor, judged, as a pure function of one round and the settings.
 * A dashboard shows them all; the collector opens an alert for each that is
 * `warn` or `alert`, closes the ones that are `ok` again, and says so.
 * `downTicks` counts the rounds each app or service has been down in a row.
 */
export function monitors(s: Snapshot, settings: ServerSettings, downTicks: Record<string, number> = {}): Judged[] {
  const out: Judged[] = []
  const add = (id: string, name: string, group: Monitor['group'], target: string, status: MonitorStatus, text: string): void => { out.push({ id, name, group, target, status, text }) }

  for (const app of s.apps) {
    const ticks = downTicks[app.id] ?? 0
    if (app.state === 'down') {
      add(`${app.id}-up`, `${app.name} up`, 'apps', app.id, ticks >= CONFIRM_TICKS ? 'alert' : 'warn', `${app.name} is not answering on :${app.port}${app.error ? ` (${app.error})` : ''}`)
    } else if (app.state === 'unknown') {
      add(`${app.id}-up`, `${app.name} up`, 'apps', app.id, 'nodata', 'Not looked at yet')
    } else {
      add(`${app.id}-up`, `${app.name} up`, 'apps', app.id, 'ok', `Answering in ${app.latencyMs ?? 0} ms${app.health ? `, up since ${app.health.startedAt}` : ''}`)
    }
    const deps = Object.entries(app.health?.deps ?? {})
    const down = deps.filter(([, state]) => state === 'down')
    const why = down.map(([dep]) => { const e = app.health?.errors.find((x) => x.startsWith(`${dep}:`))?.slice(dep.length + 1).trim(); return e ? `${dep}: ${e}` : dep }).join('; ')
    add(`${app.id}-deps`, `${app.name} dependencies`, 'apps', app.id, app.health ? (down.length ? 'warn' : 'ok') : 'nodata', down.length ? `${app.name} cannot reach ${why}` : app.health ? (deps.length ? `${deps.map(([d]) => d).join(', ')} answer` : 'None to ask') : 'Not asked: the app is not answering')
    const n = app.errors.last15m
    add(`${app.id}-errors`, `${app.name} errors`, 'apps', app.id, n >= settings.errorsMax ? 'warn' : 'ok', n ? `${n} error line${n === 1 ? '' : 's'} in the last 15 minutes${app.errors.recent.at(-1) ? `: ${app.errors.recent.at(-1)!.text}` : ''}` : 'No errors in the last 15 minutes')
  }

  for (const svc of s.services) {
    const ticks = downTicks[svc.id] ?? 0
    const status: MonitorStatus = svc.state === 'down' ? (ticks >= CONFIRM_TICKS ? 'alert' : 'warn') : svc.state === 'unknown' ? 'nodata' : 'ok'
    add(`${svc.id}-up`, `${svc.name} up`, 'services', svc.id, status, svc.state === 'down' ? `${svc.name} is not answering${svc.error ? ` (${svc.error})` : ''}` : `Answering in ${svc.latencyMs ?? 0} ms${svc.detail ? ` · ${svc.detail}` : ''}`)
  }

  const m = s.model
  add('model-server', 'LM Studio up', 'model', 'model', m.state === 'down' ? 'alert' : m.state === 'unknown' ? 'nodata' : 'ok', m.state === 'down' ? (m.error ?? 'Cannot reach LM Studio') : `Answering at ${m.url}`)
  add('model-loaded', 'Model loaded', 'model', 'model', m.state === 'down' ? 'nodata' : m.state === 'warn' ? 'warn' : 'ok', m.state === 'down' ? 'LM Studio is not answering' : m.state === 'warn' ? (m.error ?? 'No model is loaded') : `${m.loaded.map((l) => l.id).join(', ')} loaded`)
  if (m.probe) {
    const p = m.probe
    const slow = p.ttftMs > settings.ttftMaxMs ? `${p.model} took ${(p.ttftMs / 1000).toFixed(1)} s to its first token` : p.tokensPerSecond < settings.tpsMin ? `${p.model} wrote ${p.tokensPerSecond} tokens a second` : null
    add('model-speed', 'Model speed', 'model', 'model', slow ? 'warn' : 'ok', slow ?? `${p.model}: ${p.ttftMs} ms to the first token, ${p.tokensPerSecond} tokens a second`)
  } else {
    add('model-speed', 'Model speed', 'model', 'model', 'nodata', 'Not timed yet')
  }

  const h = s.host
  add('memory', 'Memory pressure', 'mac', 'host', h.pressure === 'critical' ? 'alert' : h.pressure === 'warning' ? 'warn' : h.pressure === 'unknown' ? 'nodata' : 'ok',
    h.pressure === 'critical' ? `Memory pressure is critical${gb(h.wiredBytes)}. Unload a model.` : h.pressure === 'warning' ? `Memory pressure is high${gb(h.wiredBytes)}` : `Normal${gb(h.wiredBytes)}`)
  const free = pct(h.diskFreeBytes, h.diskTotalBytes)
  add('disk', 'Disk space', 'mac', 'host', free === null ? 'nodata' : free < settings.diskFreePct ? 'warn' : 'ok', free === null ? 'Not known' : `The disk has ${free}% free`)
  add('thermal', 'CPU thermal', 'mac', 'host', h.thermal === 'warning' ? 'warn' : h.thermal === 'ok' ? 'ok' : 'nodata', h.thermal === 'warning' ? 'The Mac is running hot and has slowed its CPU' : h.thermal === 'ok' ? 'Running cool' : 'Not known')
  add('tailscale', 'Tailscale', 'mac', 'host', h.tailscale.state === 'down' ? 'alert' : h.tailscale.state === 'warn' ? 'warn' : h.tailscale.state === 'unknown' ? 'nodata' : 'ok',
    h.tailscale.state === 'down' ? `Tailscale is ${h.tailscale.backend ?? 'not running'}: the phone cannot reach the apps` : h.tailscale.state === 'warn' ? 'Tailscale is running but the Mac is offline on the tailnet' : `${h.tailscale.peersOnline} of ${h.tailscale.peers} devices online`)

  for (const f of s.data.files) {
    add(`${f.id}-backup`, `${f.name} backup`, 'data', f.id, f.backup.state === 'ok' ? 'ok' : f.backup.state === 'unknown' ? 'nodata' : 'warn',
      f.backup.state === 'warn' ? `${f.name}'s newest backup is from ${f.backup.newest} (${Math.round(f.backup.ageHours ?? 0)} h ago)` : f.backup.state === 'down' ? `${f.name} has no backup at all` : f.backup.state === 'unknown' ? (f.error ?? 'Could not look') : `Newest copy ${f.backup.newest}`)
    add(`${f.id}-integrity`, `${f.name} integrity`, 'data', f.id, f.check === 'bad' ? 'alert' : f.check === 'ok' ? 'ok' : 'nodata', f.check === 'bad' ? `${f.file} did not pass SQLite's quick check` : f.check === 'ok' ? `${f.file} passes its quick check` : 'Not checked yet')
  }
  const log = s.data.backupLog
  add('backup-job', 'Backup job', 'data', 'backups', log.state === 'warn' ? 'warn' : log.state === 'ok' ? 'ok' : 'nodata',
    log.state === 'warn' ? `Last night's backup finished with ${log.failures} failure${log.failures === 1 ? '' : 's'}; see ~/Library/Logs/backup-data.log` : log.state === 'ok' ? `Last ran ${log.lastRun}` : 'No run seen yet')

  return out
}

/** The alerts the monitors want open: each that is `warn` or `alert`. A monitor still confirming (`warn` for a thing down one round) is not yet one. */
export function evaluate(s: Snapshot, settings: ServerSettings, downTicks: Record<string, number> = {}): Wanted[] {
  const out: Wanted[] = []
  for (const m of monitors(s, settings, downTicks)) {
    if (m.status !== 'warn' && m.status !== 'alert') continue
    if (m.id.endsWith('-up') && m.status === 'warn') continue
    out.push({ rule: m.id, target: m.target, severity: m.status === 'alert' ? 'critical' : 'warn', text: m.text })
  }
  return out
}
