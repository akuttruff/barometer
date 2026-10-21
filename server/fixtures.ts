import type { AppStatus, DataStatus, HostStatus, ModelStatus, ServiceStatus, Snapshot } from '../src/types.ts'
import type { ServerSettings } from './store.ts'

/** A round where everything is fine, for the tests to bend. */

export const settings = (over: Partial<ServerSettings> = {}): ServerSettings => ({
  lmStudioUrl: 'http://127.0.0.1:1234', apiToken: '', probeEveryMinutes: 10, probeModel: '', expectModel: '', notifyMac: false,
  diskFreePct: 10, backupMaxHours: 26, ttftMaxMs: 5000, tpsMin: 10, ...over,
})

export const app = (id: string, over: Partial<AppStatus> = {}): AppStatus => ({
  id, name: id[0]!.toUpperCase() + id.slice(1), url: `https://studio.ts.net/${id}`, port: 8010, state: 'ok', latencyMs: 12,
  health: { ok: true, app: id, version: 'abc1234', startedAt: '2026-10-20T00:00:00.000Z', uptimeSeconds: 100, busy: {}, deps: { model: 'ok' }, data: { file: `${id}.sqlite`, bytes: 1000, lastWrite: '2026-10-20T00:00:00.000Z' }, errors: [] },
  launchd: { pid: 100, runs: 1, lastExit: 0, state: 'running' }, busyTotal: 0, error: null, ...over,
})

export const service = (id: string, over: Partial<ServiceStatus> = {}): ServiceStatus => ({ id, name: id, state: 'ok', latencyMs: 5, detail: null, launchd: null, error: null, ...over })

export const host = (over: Partial<HostStatus> = {}): HostStatus => ({
  pressure: 'normal', memoryBytes: 128e9, wiredBytes: 60e9, freeBytes: 4e9, diskFreeBytes: 500e9, diskTotalBytes: 1000e9, load: [1, 1, 1], uptimeSeconds: 1000, thermal: 'ok',
  tailscale: { state: 'ok', backend: 'Running', online: true, hostName: 'Studio', dnsName: 'studio.ts.net', peers: 2, peersOnline: 1 }, routeInterface: 'en0', ...over,
})

export const model = (over: Partial<ModelStatus> = {}): ModelStatus => ({ state: 'ok', url: 'http://127.0.0.1:1234', loaded: [{ id: 'qwen/qwen3.5-9b', contextLength: 65536 }], available: 8, probe: null, error: null, ...over })

export const data = (over: Partial<DataStatus> = {}): DataStatus => ({
  files: [{ id: 'cairn', name: 'Cairn', file: 'macros.sqlite', bytes: 1000, lastWrite: '2026-10-20T00:00:00.000Z', counts: { entries: 10 }, check: 'ok', backup: { newest: '2026-10-20', ageHours: 9, state: 'ok' }, error: null }],
  backupLog: { lastRun: '2026-10-20T00:00:06.000Z', failures: 0, state: 'ok' }, ...over,
})

export const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({ ts: '2026-10-20T09:00:00.000Z', apps: [app('cairn')], services: [service('speech')], model: model(), host: host(), data: data(), alerts: [], ...over })
