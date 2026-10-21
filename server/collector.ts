import type { AppStatus, DataStatus, ErrorLine, Event, HostStatus, ModelProbe, ModelStatus, ServiceStatus, Snapshot } from '../src/types.ts'
import { evaluate, monitors } from './monitors.ts'
import type { Notifier } from './notify.ts'
import * as live from './probes.ts'
import type { WatchLine } from './probes.ts'
import type { ServerSettings, Store } from './store.ts'
import { APPS, SERVICES } from './targets.ts'
import type { AppTarget, ServiceTarget } from './targets.ts'

/** How each thing is looked at; the real ones read the machine, tests pass their own. */
export interface Probes {
  app: (target: AppTarget, dnsName: string | null) => Promise<AppStatus>
  service: (target: ServiceTarget) => Promise<ServiceStatus>
  host: () => Promise<HostStatus>
  model: (settings: ServerSettings, probe: ModelProbe | null) => Promise<ModelStatus>
  probeModel: (settings: ServerSettings, model: string) => Promise<ModelProbe>
  data: (options: { check: boolean; maxHours: number }) => DataStatus
  watchLog: (offset: number) => { lines: WatchLine[]; offset: number }
  /** The error lines an app's own log has gained since the last look. */
  appErrors: (file: string, offset: number) => { lines: ErrorLine[]; offset: number }
}

export const realProbes: Probes = {
  app: live.appStatus, service: live.serviceStatus, host: live.hostStatus, model: live.modelStatus, probeModel: live.probeModel, data: live.dataStatus, watchLog: live.watchLog, appErrors: live.appErrors,
}

export interface CollectorOptions {
  probes?: Probes
  notifier?: Notifier | null
  intervalMs?: number
  /** Time the model at all (off for a dev instance, which would double the probes). */
  modelProbe?: boolean
  apps?: AppTarget[]
  services?: ServiceTarget[]
  now?: () => number
}

export const DEFAULT_INTERVAL_MS = 15_000
/** The databases get their quick check this often, in rounds. */
const CHECK_EVERY = 60
/** Old samples go this often, in rounds. */
const PRUNE_EVERY = 240
/** An app's error monitor counts this far back. */
const ERRORS_WINDOW_MS = 15 * 60_000
/** How many of an app's latest error lines are kept to show. */
const ERRORS_KEPT = 20

/** What is remembered about an app between rounds, and across restarts, to tell a deploy from a restart. */
interface Seen { version: string; startedAt: string }

type Listener = (what: { snapshot?: Snapshot; event?: Event }) => void

/**
 * The loop: every round looks at everything at once, keeps the numbers,
 * notices what changed (a restart, a deploy), opens and closes alerts, and
 * tells the pages listening.
 */
export class Collector {
  latest: Snapshot | null = null
  private readonly probes: Probes
  private readonly notifier: Notifier | null
  private readonly intervalMs: number
  private readonly modelProbe: boolean
  private readonly apps: AppTarget[]
  private readonly services: ServiceTarget[]
  private readonly now: () => number
  private readonly listeners = new Set<Listener>()
  private readonly downTicks: Record<string, number> = {}
  private rounds = 0
  private timer: NodeJS.Timeout | null = null
  private running: Promise<Snapshot> | null = null
  private lastProbe: ModelProbe | null
  private lastProbeAt = 0
  private probing = false
  /** The watch log's lines seen this round, by service, for the reason behind a restart. */
  private reasons = new Map<string, WatchLine>()
  /** Each database's last quick check, kept between the rounds that run one. */
  private checks = new Map<string, 'ok' | 'bad'>()

  constructor(private readonly store: Store, options: CollectorOptions = {}) {
    this.probes = options.probes ?? realProbes
    this.notifier = options.notifier ?? null
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
    this.modelProbe = options.modelProbe ?? true
    this.apps = options.apps ?? APPS
    this.services = options.services ?? SERVICES
    this.now = options.now ?? (() => Date.now())
    const kept = store.getState('model-probe')
    this.lastProbe = kept ? (JSON.parse(kept) as ModelProbe) : null
    this.lastProbeAt = this.lastProbe ? Date.parse(this.lastProbe.at) : 0
    const snapshot = store.getState('snapshot')
    if (snapshot) this.latest = JSON.parse(snapshot) as Snapshot
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private tell(what: Parameters<Listener>[0]): void {
    for (const fn of this.listeners) fn(what)
  }

  start(): void {
    if (this.timer) return
    void this.tick()
    this.timer = setInterval(() => { void this.tick() }, this.intervalMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** One round; a round already under way is shared rather than doubled. */
  tick(): Promise<Snapshot> {
    if (!this.running) this.running = this.round().finally(() => { this.running = null })
    return this.running
  }

  private async round(): Promise<Snapshot> {
    this.rounds++
    const settings = this.store.getSettings()
    const now = this.now()
    const check = this.rounds === 1 || this.rounds % CHECK_EVERY === 0
    const watched = this.probes.watchLog(Number(this.store.getState('watch-offset') ?? 0))
    this.store.setState('watch-offset', String(watched.offset))
    for (const line of watched.lines) this.reasons.set(line.target, line)

    // The Mac's name on the tailnet is what the apps are opened by; Tailscale is asked first, then everything else at once.
    const host = await this.probes.host()
    const dnsName = host.tailscale.dnsName ?? this.store.getState('dns-name')
    if (host.tailscale.dnsName) this.store.setState('dns-name', host.tailscale.dnsName)
    const [apps, services, model, data] = await Promise.all([
      Promise.all(this.apps.map((t) => this.probes.app(t, dnsName))),
      Promise.all(this.services.map((t) => this.probes.service(t))),
      this.probes.model(settings, this.lastProbe),
      Promise.resolve().then(() => this.probes.data({ check, maxHours: settings.backupMaxHours })),
    ])
    // A database's check runs now and then; between runs the last answer stands.
    for (const f of data.files) {
      if (f.check === 'unknown') f.check = (this.checks.get(f.id) ?? 'unknown')
      else this.checks.set(f.id, f.check)
    }
    // Each app's own log: the error lines since last round, counted over the last quarter hour.
    for (const app of apps) {
      const target = this.apps.find((t) => t.id === app.id)
      if (!target) continue
      const got = this.probes.appErrors(target.log, Number(this.store.getState(`log-offset:${app.id}`) ?? 0))
      this.store.setState(`log-offset:${app.id}`, String(got.offset))
      const kept = JSON.parse(this.store.getState(`errors:${app.id}`) ?? '[]') as ErrorLine[]
      const recent = [...kept, ...got.lines].slice(-ERRORS_KEPT)
      this.store.setState(`errors:${app.id}`, JSON.stringify(recent))
      this.store.sample(app.id, 'errors', got.lines.length, now)
      const last15m = this.store.history(app.id, 'errors', now - ERRORS_WINDOW_MS, now).reduce((sum, p) => sum + p.value, 0)
      app.errors = { last15m, recent }
    }

    // The watch log says why a service restarted; said once, on the restart it belongs to.
    for (const line of watched.lines) {
      if (line.what === 'stopped') this.event('down', line.target, `${this.nameOf(line.target)} stopped${line.reason ? `: ${line.reason}` : ''}`, 'critical', Date.parse(line.ts))
    }
    this.noticeRestarts(apps, now)

    for (const a of apps) this.downTicks[a.id] = a.state === 'down' ? (this.downTicks[a.id] ?? 0) + 1 : 0
    for (const s of services) this.downTicks[s.id] = s.state === 'down' ? (this.downTicks[s.id] ?? 0) + 1 : 0

    this.keep(apps, services, host, model, data, now)
    const snapshot: Snapshot = { ts: new Date(now).toISOString(), apps, services, model, host, data, monitors: [], alerts: [] }
    await this.reconcile(snapshot, settings, now)
    snapshot.alerts = this.store.openAlerts()
    snapshot.monitors = monitors(snapshot, settings, this.downTicks).map((m) => ({ ...m, since: snapshot.alerts.find((a) => a.rule === m.id && a.target === m.target)?.openedAt ?? null }))
    this.latest = snapshot
    this.store.setState('snapshot', JSON.stringify(snapshot))
    this.tell({ snapshot })

    if (this.rounds % PRUNE_EVERY === 0) this.store.prune(now)
    this.maybeProbe(settings, snapshot, now)
    return snapshot
  }

  private nameOf(id: string): string {
    return this.apps.find((a) => a.id === id)?.name ?? this.services.find((s) => s.id === id)?.name ?? id
  }

  private event(kind: Event['kind'], target: string, text: string, severity: Event['severity'] = 'info', ts = this.now()): Event {
    const event = this.store.addEvent(kind, target, text, severity, ts)
    this.tell({ event })
    return event
  }

  /** An app whose start time moved has restarted: a deploy when its commit changed, otherwise something to look at. */
  private noticeRestarts(apps: AppStatus[], now: number): void {
    for (const app of apps) {
      if (!app.health) continue
      const key = `seen:${app.id}`
      const was = this.store.getState(key)
      const seen: Seen = { version: app.health.version, startedAt: app.health.startedAt }
      this.store.setState(key, JSON.stringify(seen))
      if (!was) continue
      const before = JSON.parse(was) as Seen
      if (before.startedAt === seen.startedAt) continue
      const reason = this.reasons.get(app.id)
      const why = reason && now - Date.parse(reason.ts) < 10 * 60_000 && reason.reason ? ` (${reason.reason})` : ''
      this.reasons.delete(app.id)
      if (before.version !== seen.version) {
        this.event('deploy', app.id, `${app.name} deployed ${seen.version}${why}`, 'info', now)
      } else {
        this.event('restart', app.id, `${app.name} restarted${why}`, 'warn', now)
        void this.notifier?.send({ title: `${app.name} restarted`, body: why ? why.slice(2, -1) : 'Not by a deploy: the commit is the same.', severity: 'warn' })
      }
    }
  }

  /** The numbers behind the sparklines. */
  private keep(apps: AppStatus[], services: ServiceStatus[], host: HostStatus, model: ModelStatus, data: DataStatus, now: number): void {
    for (const a of apps) {
      this.store.sample(a.id, 'up', a.state === 'down' ? 0 : 1, now)
      if (a.latencyMs !== null) this.store.sample(a.id, 'latency', a.latencyMs, now)
      this.store.sample(a.id, 'busy', a.busyTotal, now)
    }
    for (const s of services) {
      this.store.sample(s.id, 'up', s.state === 'down' ? 0 : 1, now)
      if (s.latencyMs !== null) this.store.sample(s.id, 'latency', s.latencyMs, now)
    }
    const pressure = { normal: 1, warning: 2, critical: 4, unknown: 0 }[host.pressure]
    this.store.sample('host', 'pressure', pressure, now)
    if (host.freeBytes !== null) this.store.sample('host', 'free', host.freeBytes, now)
    if (host.wiredBytes !== null) this.store.sample('host', 'wired', host.wiredBytes, now)
    if (host.diskFreeBytes !== null) this.store.sample('host', 'diskFree', host.diskFreeBytes, now)
    this.store.sample('host', 'load', host.load[0], now)
    this.store.sample('host', 'tailscalePeers', host.tailscale.peersOnline, now)
    this.store.sample('model', 'loaded', model.loaded.length, now)
    this.store.sample('model', 'up', model.state === 'down' ? 0 : 1, now)
    for (const f of data.files) if (f.bytes !== null) this.store.sample(f.id, 'bytes', f.bytes, now)
  }

  /** Open what the rules want and is not open, close what is open and no longer wanted, and say so either way. */
  private async reconcile(snapshot: Snapshot, settings: ServerSettings, now: number): Promise<void> {
    const wanted = evaluate(snapshot, settings, this.downTicks)
    const keyOf = (w: { rule: string; target: string }) => `${w.rule}@${w.target}`
    const wantedKeys = new Set(wanted.map(keyOf))
    const notices: Promise<void>[] = []
    for (const w of wanted) {
      const { opened } = this.store.openAlert(w.rule, w.target, w.severity, w.text, now)
      if (!opened) continue
      this.event('alert', w.target, w.text, w.severity, now)
      if (this.notifier) notices.push(this.notifier.send({ title: w.severity === 'critical' ? 'Barometer: something is down' : 'Barometer', body: w.text, severity: w.severity }))
    }
    for (const open of this.store.openAlerts()) {
      if (wantedKeys.has(keyOf(open))) continue
      this.store.closeAlert(open.rule, open.target, now)
      this.event('resolved', open.target, `Resolved: ${open.text}`, 'info', now)
      if (this.notifier && open.severity === 'critical') notices.push(this.notifier.send({ title: 'Barometer: back', body: `Resolved: ${open.text}`, severity: 'info' }))
    }
    await Promise.all(notices)
  }

  /** Time the model now and then, only when nothing is being written, and never twice at once. */
  private maybeProbe(settings: ServerSettings, snapshot: Snapshot, now: number): void {
    if (!this.modelProbe || this.probing || settings.probeEveryMinutes <= 0) return
    if (now - this.lastProbeAt < settings.probeEveryMinutes * 60_000) return
    if (snapshot.apps.some((a) => a.busyTotal > 0)) return
    const model = live.pickProbeModel(snapshot.model.loaded, settings.probeModel)
    if (!model) return
    this.probing = true
    this.lastProbeAt = now
    void this.probes.probeModel(settings, model).then((probe) => {
      this.lastProbe = probe
      this.store.setState('model-probe', JSON.stringify(probe))
      this.store.sample('model', 'ttft', probe.ttftMs, this.now())
      this.store.sample('model', 'tps', probe.tokensPerSecond, this.now())
      if (this.latest) {
        this.latest = { ...this.latest, model: { ...this.latest.model, probe } }
        this.tell({ snapshot: this.latest })
      }
    }).catch((err: Error) => {
      this.event('note', 'model', `Timing ${model} failed: ${err.message}`, 'warn')
    }).finally(() => { this.probing = false })
  }
}
