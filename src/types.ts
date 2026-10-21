/**
 * What Barometer knows, as the server reports it and the page shows it.
 * A `State` is the traffic light on every row: `ok`, `warn` (up, but
 * something about it needs a look), `down`, or `unknown` (not asked yet).
 */

export type State = 'ok' | 'warn' | 'down' | 'unknown'

export type DepState = 'ok' | 'down' | 'unknown'

/** What each app's own `GET /api/health` says (the same shape in all four). */
export interface AppHealth {
  ok: boolean
  app: string
  version: string
  startedAt: string
  uptimeSeconds: number
  busy: Record<string, number>
  deps: Record<string, DepState>
  data: { file: string; bytes: number; lastWrite: string | null } | null
  errors: string[]
}

export interface LaunchdStatus {
  pid: number | null
  /** How many times launchd has started it since it was loaded. */
  runs: number | null
  lastExit: number | null
  state: string | null
}

export interface AppStatus {
  id: string
  name: string
  /** Where the app is opened from: its address on the tailnet. */
  url: string
  port: number
  state: State
  latencyMs: number | null
  health: AppHealth | null
  launchd: LaunchdStatus | null
  /** Everything in flight, summed: what a restart would cut off. */
  busyTotal: number
  error: string | null
}

/** A service that is not one of the apps: the speech server, oMLX. */
export interface ServiceStatus {
  id: string
  name: string
  state: State
  latencyMs: number | null
  detail: string | null
  launchd: LaunchdStatus | null
  error: string | null
}

export interface LoadedModel {
  id: string
  contextLength: number | null
}

export interface ModelProbe {
  at: string
  model: string
  ttftMs: number
  tokensPerSecond: number
  tokens: number
}

export interface ModelStatus {
  state: State
  url: string
  loaded: LoadedModel[]
  /** Models on disk LM Studio could load. */
  available: number
  probe: ModelProbe | null
  error: string | null
}

export type Pressure = 'normal' | 'warning' | 'critical' | 'unknown'

export interface TailscaleStatus {
  state: State
  backend: string | null
  online: boolean
  hostName: string | null
  dnsName: string | null
  peers: number
  peersOnline: number
}

export interface HostStatus {
  pressure: Pressure
  memoryBytes: number
  wiredBytes: number | null
  freeBytes: number | null
  diskFreeBytes: number | null
  diskTotalBytes: number | null
  load: [number, number, number]
  uptimeSeconds: number
  thermal: 'ok' | 'warning' | 'unknown'
  tailscale: TailscaleStatus
  /** The interface the default route leaves by: en0 is the Ethernet port, en1 Wi-Fi. */
  routeInterface: string | null
}

export interface BackupStatus {
  newest: string | null
  ageHours: number | null
  state: State
}

export interface DataFileStatus {
  id: string
  name: string
  file: string
  bytes: number | null
  lastWrite: string | null
  /** A few row counts that say how the app is being used. */
  counts: Record<string, number>
  check: 'ok' | 'bad' | 'unknown'
  backup: BackupStatus
  error: string | null
}

export interface DataStatus {
  files: DataFileStatus[]
  /** The nightly backup job's own log: when it last ran and whether anything failed. */
  backupLog: { lastRun: string | null; failures: number; state: State }
}

export type Severity = 'info' | 'warn' | 'critical'

export interface Alert {
  id: number
  rule: string
  target: string
  severity: Severity
  text: string
  openedAt: string
  closedAt: string | null
}

export type EventKind = 'restart' | 'deploy' | 'down' | 'up' | 'alert' | 'resolved' | 'note'

export interface Event {
  id: number
  ts: string
  kind: EventKind
  target: string
  severity: Severity
  text: string
}

/** One round of looking at everything. */
export interface Snapshot {
  ts: string
  apps: AppStatus[]
  services: ServiceStatus[]
  model: ModelStatus
  host: HostStatus
  data: DataStatus
  alerts: Alert[]
}

/** The overall light: the worst of everything open. */
export function overall(s: Snapshot): State {
  const states: State[] = [
    ...s.apps.map((a) => a.state), ...s.services.map((x) => x.state), s.model.state, s.host.tailscale.state,
    ...s.data.files.map((f) => f.backup.state), s.data.backupLog.state,
    s.host.pressure === 'critical' ? 'down' : s.host.pressure === 'warning' ? 'warn' : 'ok',
  ]
  if (states.includes('down')) return 'down'
  if (states.includes('warn')) return 'warn'
  if (states.every((x) => x === 'unknown')) return 'unknown'
  return 'ok'
}

/** One sample of one number about one target, for the sparklines. */
export interface Sample {
  ts: number
  value: number
}

/** What a page may change. The token is write-only. */
export interface Settings {
  lmStudioUrl: string
  hasToken: boolean
  /** How often to time the model; 0 never. */
  probeEveryMinutes: number
  /** Which loaded model to time; blank for the smallest loaded. */
  probeModel: string
  /** A model that should always be loaded; blank for any. */
  expectModel: string
  notifyMac: boolean
  diskFreePct: number
  backupMaxHours: number
  ttftMaxMs: number
  tpsMin: number
}

export const DEFAULT_SETTINGS: Settings = {
  lmStudioUrl: 'http://127.0.0.1:1234',
  hasToken: false,
  probeEveryMinutes: 10,
  probeModel: '',
  expectModel: '',
  notifyMac: true,
  diskFreePct: 10,
  backupMaxHours: 26,
  ttftMaxMs: 5000,
  tpsMin: 10,
}
