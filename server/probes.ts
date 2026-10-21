import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import type { AppHealth, AppStatus, BackupStatus, DataFileStatus, DataStatus, HostStatus, LaunchdStatus, LoadedModel, ModelProbe, ModelStatus, Pressure, ServiceStatus, State, TailscaleStatus } from '../src/types.ts'
import type { ServerSettings } from './store.ts'
import { BACKUPS_DIR, BACKUP_LOG, DATA, TAILSCALE_BIN, WATCH_LOG, appUrl } from './targets.ts'
import type { AppTarget, DataTarget, ServiceTarget } from './targets.ts'

/**
 * How each thing is looked at. Everything that reads the machine is here;
 * the parsers are separate and pure so they can be tested on captured
 * output. A probe never throws: what it could not learn comes back as
 * `unknown` with the reason in `error`.
 */

const exec = promisify(execFile)

/** A command's stdout, or '' if it is missing or takes too long. */
export async function run(cmd: string, args: string[], timeout = 4000): Promise<string> {
  try {
    const { stdout } = await exec(cmd, args, { timeout, maxBuffer: 4_000_000 })
    return stdout
  } catch {
    return ''
  }
}

const ms = () => performance.now()
const authHeaders = (s: ServerSettings): Record<string, string> => (s.apiToken ? { Authorization: `Bearer ${s.apiToken.trim()}` } : {})

/** A GET with a deadline, timed. */
export async function timedGet(url: string, timeoutMs = 5000, headers: Record<string, string> = {}): Promise<{ status: number; ms: number; text: string }> {
  const t0 = ms()
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
  const text = await r.text()
  return { status: r.status, ms: Math.round(ms() - t0), text }
}

// --- launchd ---------------------------------------------------------------

/** `launchctl print gui/<uid>/<label>`: the pid, how many times it has run, and its last exit code. */
export function parseLaunchd(text: string): LaunchdStatus | null {
  if (!text.trim()) return null
  const num = (re: RegExp): number | null => { const m = re.exec(text); return m ? Number(m[1]) : null }
  const state = /^\s*state = (\S+)/m.exec(text)?.[1] ?? null
  return { pid: num(/^\s*pid = (\d+)/m), runs: num(/^\s*runs = (\d+)/m), lastExit: num(/^\s*last exit code = (-?\d+)/m), state }
}

export const launchdStatus = async (label: string): Promise<LaunchdStatus | null> => parseLaunchd(await run('launchctl', ['print', `gui/${os.userInfo().uid}/${label}`]))

// --- the apps ---------------------------------------------------------------

/** What an app's own health route says, and how long it took to say it. */
export async function appStatus(target: AppTarget, dnsName: string | null): Promise<AppStatus> {
  const base = { id: target.id, name: target.name, url: appUrl(target, dnsName), port: target.port }
  const launchd = await launchdStatus(target.label)
  try {
    const r = await timedGet(`http://127.0.0.1:${target.port}/api/health`, 8000)
    if (r.status !== 200) return { ...base, state: 'down', latencyMs: r.ms, health: null, launchd, busyTotal: 0, error: `${r.status} from /api/health` }
    const health = JSON.parse(r.text) as AppHealth
    const busyTotal = Object.values(health.busy ?? {}).reduce((a, b) => a + b, 0)
    const depDown = Object.values(health.deps ?? {}).includes('down')
    const state: State = !health.ok ? 'down' : depDown ? 'warn' : 'ok'
    return { ...base, state, latencyMs: r.ms, health, launchd, busyTotal, error: health.errors?.[0] ?? null }
  } catch (err) {
    return { ...base, state: 'down', latencyMs: null, health: null, launchd, busyTotal: 0, error: (err as Error).message }
  }
}

// --- the other services -----------------------------------------------------

interface OmlxHealth { status?: string; engine_pool?: { model_count?: number; loaded_count?: number; current_model_memory?: number } }

export function describeOmlx(text: string): string | null {
  try {
    const h = JSON.parse(text) as OmlxHealth
    const pool = h.engine_pool
    if (!pool) return h.status ?? null
    const gb = pool.current_model_memory ? ` · ${(pool.current_model_memory / 1e9).toFixed(0)} GB` : ''
    return `${pool.loaded_count ?? 0} of ${pool.model_count ?? 0} models loaded${gb}`
  } catch {
    return null
  }
}

export function describeSpeech(text: string): string | null {
  try {
    const d = JSON.parse(text) as { data?: { id?: string }[] }
    const id = d.data?.[0]?.id
    return id ? id.replace(/^mlx-community\//, '') : null
  } catch {
    return null
  }
}

export async function serviceStatus(target: ServiceTarget): Promise<ServiceStatus> {
  const base = { id: target.id, name: target.name }
  const launchd = target.label ? await launchdStatus(target.label) : null
  try {
    const r = await timedGet(target.url, 5000)
    const detail = target.kind === 'omlx' ? describeOmlx(r.text) : describeSpeech(r.text)
    return { ...base, state: r.status < 500 ? 'ok' : 'down', latencyMs: r.ms, detail, launchd, error: r.status >= 500 ? `${r.status} from ${target.url}` : null }
  } catch (err) {
    return { ...base, state: 'down', latencyMs: null, detail: null, launchd, error: (err as Error).message }
  }
}

// --- the host ---------------------------------------------------------------

/** `vm_stat`: the page size, and the free and wired page counts, in bytes. */
export function parseVmStat(text: string): { freeBytes: number | null; wiredBytes: number | null } {
  const page = Number(/page size of (\d+) bytes/.exec(text)?.[1] ?? 16384)
  const pages = (name: string): number | null => { const m = new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(text); return m ? Number(m[1]) * page : null }
  return { freeBytes: pages('Pages free'), wiredBytes: pages('Pages wired down') }
}

/** `df -k /`: the root volume's size and free space in bytes. */
export function parseDf(text: string): { diskTotalBytes: number | null; diskFreeBytes: number | null } {
  const line = text.trim().split('\n').at(-1) ?? ''
  const cols = line.split(/\s+/)
  if (cols.length < 4 || !/^\d+$/.test(cols[1]!)) return { diskTotalBytes: null, diskFreeBytes: null }
  return { diskTotalBytes: Number(cols[1]) * 1024, diskFreeBytes: Number(cols[3]) * 1024 }
}

export function parsePressure(text: string): Pressure {
  const level = Number(text.trim())
  if (level === 1) return 'normal'
  if (level === 2) return 'warning'
  if (level >= 4) return 'critical'
  return 'unknown'
}

/** `pmset -g therm`: fine unless the machine has throttled. */
export function parseTherm(text: string): HostStatus['thermal'] {
  if (!text.trim()) return 'unknown'
  const limit = /CPU_Speed_Limit\s*=\s*(\d+)/.exec(text)
  if (limit && Number(limit[1]) < 100) return 'warning'
  if (/No thermal warning level has been recorded/.test(text) || limit) return 'ok'
  return 'unknown'
}

interface TailscaleJson { BackendState?: string; Self?: { Online?: boolean; HostName?: string; DNSName?: string }; Peer?: Record<string, { Online?: boolean }> }

export function parseTailscale(text: string): TailscaleStatus {
  const none: TailscaleStatus = { state: 'unknown', backend: null, online: false, hostName: null, dnsName: null, peers: 0, peersOnline: 0 }
  if (!text.trim()) return none
  try {
    const d = JSON.parse(text) as TailscaleJson
    const peers = Object.values(d.Peer ?? {})
    const online = Boolean(d.Self?.Online)
    const running = d.BackendState === 'Running'
    return {
      state: running && online ? 'ok' : running ? 'warn' : 'down',
      backend: d.BackendState ?? null, online, hostName: d.Self?.HostName ?? null, dnsName: d.Self?.DNSName?.replace(/\.$/, '') ?? null,
      peers: peers.length, peersOnline: peers.filter((p) => p.Online).length,
    }
  } catch {
    return none
  }
}

export const parseRoute = (text: string): string | null => /^\s*interface: (\S+)/m.exec(text)?.[1] ?? null

export async function hostStatus(): Promise<HostStatus> {
  const [pressure, vm, df, therm, ts, route] = await Promise.all([
    run('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level']),
    run('vm_stat', []),
    run('df', ['-k', '/']),
    run('pmset', ['-g', 'therm']),
    run(TAILSCALE_BIN, ['status', '--json']),
    run('route', ['-n', 'get', 'default']),
  ])
  const load = os.loadavg() as [number, number, number]
  return {
    pressure: parsePressure(pressure), memoryBytes: os.totalmem(), ...parseVmStat(vm), ...parseDf(df),
    load: [load[0], load[1], load[2]], uptimeSeconds: Math.round(os.uptime()), thermal: parseTherm(therm),
    tailscale: parseTailscale(ts), routeInterface: parseRoute(route),
  }
}

// --- the model server --------------------------------------------------------

interface ModelsJson { models?: { key?: string; type?: string; loaded_instances?: { id?: string; config?: { context_length?: number } }[] }[] }

/** LM Studio's model list: what is loaded, with its context length, and how many could be. */
export function parseModels(text: string): { loaded: LoadedModel[]; available: number } {
  const d = JSON.parse(text) as ModelsJson
  const llms = (d.models ?? []).filter((m) => m.type === 'llm' && m.key)
  const loaded: LoadedModel[] = []
  for (const m of llms) for (const i of m.loaded_instances ?? []) loaded.push({ id: i.id ?? m.key!, contextLength: i.config?.context_length ?? null })
  return { loaded, available: llms.length }
}

export async function modelStatus(settings: ServerSettings, probe: ModelProbe | null): Promise<ModelStatus> {
  const url = settings.lmStudioUrl.replace(/\/+$/, '')
  try {
    const r = await timedGet(`${url}/api/v1/models`, 5000, authHeaders(settings))
    if (r.status === 401 || r.status === 403) return { state: 'warn', url, loaded: [], available: 0, probe, error: 'LM Studio rejected the token. Set it in Settings.' }
    if (r.status !== 200) return { state: 'down', url, loaded: [], available: 0, probe, error: `${r.status} from LM Studio` }
    const { loaded, available } = parseModels(r.text)
    const expected = settings.expectModel.trim()
    const missing = expected && !loaded.some((m) => m.id === expected || m.id.startsWith(expected))
    const state: State = loaded.length === 0 ? 'warn' : missing ? 'warn' : 'ok'
    const error = loaded.length === 0 ? 'No model is loaded' : missing ? `${expected} is not loaded` : null
    return { state, url, loaded, available, probe, error }
  } catch (err) {
    return { state: 'down', url, loaded: [], available: 0, probe, error: `Cannot reach LM Studio at ${url} (${(err as Error).message})` }
  }
}

/** The loaded model to time: the one chosen, else the smallest by the size in its name. */
export function pickProbeModel(loaded: LoadedModel[], chosen: string): string | null {
  if (loaded.length === 0) return null
  if (chosen) {
    const hit = loaded.find((m) => m.id === chosen || m.id.startsWith(chosen))
    if (hit) return hit.id
  }
  const size = (id: string): number => Number(/(\d+(?:\.\d+)?)b\b/i.exec(id)?.[1] ?? Number.POSITIVE_INFINITY)
  return [...loaded].sort((a, b) => size(a.id) - size(b.id))[0]!.id
}

/**
 * A short timed completion: how long the first token took, and how many a
 * second followed. Streams so the first token can be timed; every delta,
 * reasoning or text, counts as a token.
 */
export async function probeModel(settings: ServerSettings, model: string): Promise<ModelProbe> {
  const url = settings.lmStudioUrl.replace(/\/+$/, '')
  const t0 = ms()
  const r = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(settings) },
    body: JSON.stringify({ model, stream: true, max_tokens: 48, temperature: 0, messages: [{ role: 'user', content: 'Count from one to twenty, separated by spaces.' }] }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!r.ok || !r.body) throw new Error(`${r.status} from the model server`)
  let first: number | null = null
  let last = t0
  let tokens = 0
  const reader = r.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const delta = (JSON.parse(data) as { choices?: { delta?: { content?: string; reasoning_content?: string; reasoning?: string } }[] }).choices?.[0]?.delta
        if (delta?.content || delta?.reasoning_content || delta?.reasoning) {
          tokens++
          last = ms()
          if (first === null) first = last
        }
      } catch { /* a keep-alive or a partial line */ }
    }
  }
  if (first === null) throw new Error('The model sent nothing back')
  const seconds = (last - first) / 1000
  return { at: new Date().toISOString(), model, ttftMs: Math.round(first - t0), tokensPerSecond: tokens > 1 && seconds > 0 ? Math.round(((tokens - 1) / seconds) * 10) / 10 : 0, tokens }
}

// --- the data ---------------------------------------------------------------

/** The newest dated copy in a backup folder, and how old it is. */
export function backupStatus(files: string[], prefix: string, maxHours: number, now = Date.now()): BackupStatus {
  const dated = files.map((f) => new RegExp(`^${prefix}-(\\d{4}-\\d{2}-\\d{2})\\.sqlite$`).exec(f)?.[1]).filter((d): d is string => Boolean(d)).sort()
  const newest = dated.at(-1) ?? null
  if (!newest) return { newest: null, ageHours: null, state: 'down' }
  // A copy is made just after midnight, local time; its age is counted from that midnight.
  const made = new Date(`${newest}T00:00:00`)
  const ageHours = Math.round(((now - made.getTime()) / 3600_000) * 10) / 10
  return { newest, ageHours, state: ageHours > maxHours ? 'warn' : 'ok' }
}

/** The backup job's log: when it last finished and how many copies failed that night. */
export function parseBackupLog(text: string): DataStatus['backupLog'] {
  const lines = text.trim().split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) finished(?: with (\d+) failure)?/.exec(lines[i]!)
    if (!m) continue
    const failures = Number(m[2] ?? 0)
    return { lastRun: new Date(m[1]!.replace(' ', 'T')).toISOString(), failures, state: failures > 0 ? 'warn' : 'ok' }
  }
  return { lastRun: null, failures: 0, state: 'unknown' }
}

const readTail = (file: string, bytes = 20_000): string => {
  try {
    const size = fs.statSync(file).size
    const fd = fs.openSync(file, 'r')
    try {
      const start = Math.max(0, size - bytes)
      const buf = Buffer.alloc(size - start)
      fs.readSync(fd, buf, 0, buf.length, start)
      return buf.toString('utf8')
    } finally { fs.closeSync(fd) }
  } catch {
    return ''
  }
}

/** One database: its file, a few counts, a quick check when asked, and its newest backup. */
export function dataFileStatus(target: DataTarget, options: { check: boolean; maxHours: number; backupsDir?: string; now?: number }): DataFileStatus {
  const base = { id: target.id, name: target.name, file: path.basename(target.file) }
  let backup: BackupStatus
  let error: string | null = null
  try {
    backup = backupStatus(fs.readdirSync(path.join(options.backupsDir ?? BACKUPS_DIR, target.backupDir)), target.backupPrefix, options.maxHours, options.now)
  } catch (err) {
    backup = { newest: null, ageHours: null, state: 'unknown' }
    error = (err as NodeJS.ErrnoException).code === 'EPERM' ? 'Cannot read iCloud Drive: give node Full Disk Access in System Settings' : `Backups: ${(err as Error).message}`
  }
  let st: fs.Stats
  try { st = fs.statSync(target.file) } catch (err) {
    return { ...base, bytes: null, lastWrite: null, counts: {}, check: 'unknown', backup, error: error ?? (err as Error).message }
  }
  const counts: Record<string, number> = {}
  let check: DataFileStatus['check'] = 'unknown'
  try {
    const db = new DatabaseSync(target.file, { readOnly: true })
    try {
      if (options.check) {
        const row = db.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined
        check = row?.quick_check === 'ok' ? 'ok' : 'bad'
      }
      for (const [name, sql] of Object.entries(target.counts)) {
        try {
          const row = db.prepare(sql).get() as Record<string, unknown> | undefined
          const n = row ? Number(Object.values(row)[0]) : 0
          if (Number.isFinite(n)) counts[name] = n
        } catch (err) {
          error ??= `Could not count ${name} in ${base.file}: ${(err as Error).message}`
        }
      }
    } finally { db.close() }
  } catch (err) {
    error ??= `Could not read ${base.file}: ${(err as Error).message}`
  }
  return { ...base, bytes: st.size, lastWrite: st.mtime.toISOString(), counts, check, backup, error }
}

export function dataStatus(options: { check: boolean; maxHours: number; targets?: DataTarget[]; backupsDir?: string; backupLog?: string; now?: number }): DataStatus {
  return {
    files: (options.targets ?? DATA).map((t) => dataFileStatus(t, options)),
    backupLog: parseBackupLog(readTail(options.backupLog ?? BACKUP_LOG)),
  }
}

// --- the services-watch log -------------------------------------------------

export interface WatchLine { ts: string; target: string; what: 'restarted' | 'stopped'; reason: string | null }

/** `services-watch`'s lines: when a service restarted or stopped, and launchd's reason when it had one. */
export function parseWatchLines(text: string): WatchLine[] {
  const out: WatchLine[] = []
  for (const line of text.split('\n')) {
    const m = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (\S+) (restarted|stopped)(?:: (.*))?$/.exec(line.trim())
    if (m) out.push({ ts: new Date(m[1]!.replace(' ', 'T')).toISOString(), target: m[2]!, what: m[3] as WatchLine['what'], reason: m[4]?.trim() || null })
  }
  return out
}

/** The log's lines past an offset, and the offset to read from next time; a truncated log is read from its start. */
export function watchLog(offset: number, file = WATCH_LOG): { lines: WatchLine[]; offset: number } {
  try {
    const size = fs.statSync(file).size
    const from = offset > size ? 0 : offset
    if (from === size) return { lines: [], offset: size }
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(size - from)
      fs.readSync(fd, buf, 0, buf.length, from)
      return { lines: parseWatchLines(buf.toString('utf8')), offset: size }
    } finally { fs.closeSync(fd) }
  } catch {
    return { lines: [], offset }
  }
}
