import type { Severity, Snapshot } from '../src/types.ts'
import type { ServerSettings } from './store.ts'

/** An alert that should be open right now. */
export interface Wanted {
  rule: string
  target: string
  severity: Severity
  text: string
}

/** How many rounds in a row something must be down before it is said: one lost request is not an outage. */
export const CONFIRM_TICKS = 2

const pct = (part: number | null, whole: number | null): number | null => (part !== null && whole ? Math.round((part / whole) * 1000) / 10 : null)

/**
 * The rules, as a pure function of one round and the settings: what should
 * be open now. The collector opens what is new, closes what is no longer
 * wanted, and says so. `downTicks` counts the rounds each app or service has
 * been down in a row.
 */
export function evaluate(s: Snapshot, settings: ServerSettings, downTicks: Record<string, number> = {}): Wanted[] {
  const out: Wanted[] = []

  for (const app of s.apps) {
    if (app.state === 'down' && (downTicks[app.id] ?? 0) >= CONFIRM_TICKS) {
      out.push({ rule: 'app-down', target: app.id, severity: 'critical', text: `${app.name} is not answering on :${app.port}${app.error ? ` (${app.error})` : ''}` })
    }
    for (const [dep, state] of Object.entries(app.health?.deps ?? {})) {
      if (state !== 'down') continue
      const why = app.health?.errors.find((e) => e.startsWith(`${dep}:`))?.slice(dep.length + 1).trim()
      out.push({ rule: `dep-${dep}`, target: app.id, severity: 'warn', text: `${app.name} cannot reach ${dep}${why ? `: ${why}` : ''}` })
    }
  }

  for (const svc of s.services) {
    if (svc.state === 'down' && (downTicks[svc.id] ?? 0) >= CONFIRM_TICKS) {
      out.push({ rule: 'service-down', target: svc.id, severity: 'warn', text: `${svc.name} is not answering${svc.error ? ` (${svc.error})` : ''}` })
    }
  }

  if (s.model.state === 'down') out.push({ rule: 'model-server', target: 'model', severity: 'critical', text: s.model.error ?? 'Cannot reach LM Studio' })
  else if (s.model.state === 'warn') out.push({ rule: 'model-loaded', target: 'model', severity: 'warn', text: s.model.error ?? 'No model is loaded' })
  if (s.model.probe) {
    const p = s.model.probe
    if (p.ttftMs > settings.ttftMaxMs) out.push({ rule: 'probe-slow', target: 'model', severity: 'warn', text: `${p.model} took ${(p.ttftMs / 1000).toFixed(1)} s to its first token` })
    else if (p.tokensPerSecond < settings.tpsMin) out.push({ rule: 'probe-slow', target: 'model', severity: 'warn', text: `${p.model} wrote ${p.tokensPerSecond} tokens a second` })
  }

  const h = s.host
  if (h.pressure === 'critical') out.push({ rule: 'memory', target: 'host', severity: 'critical', text: `Memory pressure is critical${h.wiredBytes ? ` (${(h.wiredBytes / 1e9).toFixed(0)} GB wired)` : ''}. Unload a model.` })
  else if (h.pressure === 'warning') out.push({ rule: 'memory', target: 'host', severity: 'warn', text: `Memory pressure is high${h.wiredBytes ? ` (${(h.wiredBytes / 1e9).toFixed(0)} GB wired)` : ''}` })
  const free = pct(h.diskFreeBytes, h.diskTotalBytes)
  if (free !== null && free < settings.diskFreePct) out.push({ rule: 'disk', target: 'host', severity: 'warn', text: `The disk has ${free}% free` })
  if (h.thermal === 'warning') out.push({ rule: 'thermal', target: 'host', severity: 'warn', text: 'The Mac is running hot and has slowed its CPU' })
  if (h.tailscale.state === 'down') out.push({ rule: 'tailscale', target: 'host', severity: 'critical', text: `Tailscale is ${h.tailscale.backend ?? 'not running'}: the phone cannot reach the apps` })
  else if (h.tailscale.state === 'warn') out.push({ rule: 'tailscale', target: 'host', severity: 'warn', text: 'Tailscale is running but the Mac is offline on the tailnet' })

  for (const f of s.data.files) {
    if (f.backup.state === 'warn') out.push({ rule: 'backup-stale', target: f.id, severity: 'warn', text: `${f.name}'s newest backup is from ${f.backup.newest} (${Math.round(f.backup.ageHours ?? 0)} h ago)` })
    else if (f.backup.state === 'down') out.push({ rule: 'backup-stale', target: f.id, severity: 'warn', text: `${f.name} has no backup at all` })
    if (f.check === 'bad') out.push({ rule: 'integrity', target: f.id, severity: 'critical', text: `${f.file} did not pass SQLite's quick check` })
  }
  if (s.data.backupLog.state === 'warn') out.push({ rule: 'backup-failed', target: 'backups', severity: 'warn', text: `Last night's backup finished with ${s.data.backupLog.failures} failure${s.data.backupLog.failures === 1 ? '' : 's'}; see ~/Library/Logs/backup-data.log` })

  return out
}
