import type { ErrorLine, ModelProbe } from '../src/types.ts'
import type { Probes } from './collector.ts'
import { app, data, host, model, service } from './fixtures.ts'
import type { Store } from './store.ts'
import { APPS, DATA } from './targets.ts'

/**
 * A bad afternoon, for the README's screenshots: nothing here reads the
 * machine. `npm run dev:demo` runs the board on these probes and a database
 * seeded with six hours of history, so the monitors, the alerts and the
 * graphs all have something to say. Every name and number is made up.
 */

const DNS = 'studio.ts.net'
const MINUTE = 60_000
/** The scene's own model, timed slow. */
export const DEMO_PROBE = (now: number): ModelProbe => ({ at: new Date(now - 4 * MINUTE).toISOString(), model: 'qwen/qwen3.6-27b', ttftMs: 7400, tokensPerSecond: 8.6, tokens: 64 })

/** Whetstone's log: a runner that keeps timing out. */
const whetstoneErrors = (now: number): ErrorLine[] => [14, 12, 11, 9, 8, 6, 5, 3, 1].map((ago, i) => ({
  ts: new Date(now - ago * MINUTE).toISOString(),
  text: i % 3 === 2 ? 'java runner: exited with code 137 (out of memory)' : 'ruby runner: timed out after 10 s on case 3',
}))

export function demoProbes(now: () => number = Date.now): Probes {
  const seen = new Set<string>()
  return {
    app: async (target) => {
      const url = `https://${DNS}${target.tailnetPort === 443 ? '' : `:${target.tailnetPort}`}`
      const base = app(target.id, { name: target.name, url, port: target.port, latencyMs: { 'lm-chat': 4, whetstone: 9, orrery: 6 }[target.id] ?? 5 })
      const health = { ...base.health!, app: target.id, uptimeSeconds: 6 * 86_400 + 4 * 3600, startedAt: new Date(now() - (6 * 86_400 + 4 * 3600) * 1000).toISOString() }
      if (target.id === 'cairn') return { ...base, state: 'down', latencyMs: null, health: null, busyTotal: 0, error: 'connect ECONNREFUSED 127.0.0.1:8210', launchd: { pid: null, runs: 7, lastExit: 1, state: 'not running' } }
      if (target.id === 'orrery') return { ...base, health: { ...health, deps: { model: 'ok', astro: 'down' }, errors: ['astro: astro-mcp exited with code 1 before answering'] } }
      if (target.id === 'lm-chat') return { ...base, busyTotal: 1, health: { ...health, deps: { model: 'ok', memory: 'ok' }, busy: { replies: 1 } } }
      if (target.id === 'whetstone') return { ...base, health: { ...health, deps: { model: 'ok', ruby: 'ok', java: 'ok' } } }
      return { ...base, health }
    },
    service: async (target) => service(target.id, { name: target.name, latencyMs: target.kind === 'speech' ? 6 : 3, detail: target.kind === 'speech' ? 'Kokoro 82M' : '1 of 4 models loaded' }),
    host: async () => host({
      pressure: 'warning', memoryBytes: 128e9, wiredBytes: 96e9, freeBytes: 1.6e9, diskFreeBytes: 141e9, diskTotalBytes: 1000e9, load: [6.4, 5.1, 3.8], uptimeSeconds: 9 * 86_400 + 2 * 3600,
      tailscale: { state: 'ok', backend: 'Running', online: true, hostName: 'Studio', dnsName: DNS, peers: 3, peersOnline: 2 },
    }),
    model: async (_settings, probe) => model({ loaded: [{ id: 'qwen/qwen3.6-27b', contextLength: 65536 }, { id: 'qwen/qwen3.5-9b', contextLength: 32768 }], available: 9, probe }),
    probeModel: async () => DEMO_PROBE(now()),
    data: () => {
      const day = (hoursAgo: number) => new Date(now() - hoursAgo * 3600_000).toISOString().slice(0, 10)
      return data({
        files: DATA.map((t) => ({
          id: t.id, name: t.name, file: t.file.split('/').pop()!, bytes: 4e6, lastWrite: new Date(now() - 20 * MINUTE).toISOString(), counts: {}, check: 'ok' as const, error: null,
          backup: t.id === 'orrery' ? { newest: day(31), ageHours: 31, state: 'warn' as const } : { newest: day(7), ageHours: 7, state: 'ok' as const },
        })),
        backupLog: { lastRun: new Date(now() - 7 * 3600_000).toISOString(), failures: 1, state: 'warn' },
      })
    },
    watchLog: (offset) => ({ lines: [], offset }),
    // Each app's log, read once: Whetstone's errors arrive on the first look, as if from the last quarter hour.
    appErrors: (file, offset) => {
      const id = APPS.find((a) => a.log === file)?.id ?? file
      if (id !== 'whetstone' || seen.has(id)) return { lines: [], offset }
      seen.add(id)
      return { lines: whetstoneErrors(now()), offset: offset + 1 }
    },
  }
}

/** Six hours of samples, events and closed alerts behind the scene, so the graphs and the feed show how it came to this. */
export function seedDemo(store: Store, now = Date.now()): void {
  const from = now - 6 * 3600_000
  const wave = (t: number, period: number) => Math.sin((t / period) * Math.PI * 2)
  for (let t = from; t <= now - MINUTE; t += MINUTE) {
    const left = (now - t) / MINUTE
    for (const a of APPS) {
      const base = { 'lm-chat': 4, cairn: 5, whetstone: 9, orrery: 6 }[a.id] ?? 5
      // Cairn slows for twenty minutes, then stops answering for the last twelve.
      const cairnDown = a.id === 'cairn' && left <= 12
      const cairnSlow = a.id === 'cairn' && left <= 32 && left > 12
      store.sample(a.id, 'up', cairnDown ? 0 : 1, t)
      if (!cairnDown) store.sample(a.id, 'latency', Math.round(base + Math.abs(wave(t, 47 * MINUTE)) * 3 + (cairnSlow ? 120 + (32 - left) * 22 : 0) + (a.id === 'orrery' && left > 150 && left < 158 ? 85 : 0)), t)
      store.sample(a.id, 'busy', a.id === 'lm-chat' && Math.floor(left / 9) % 4 === 0 ? 1 : 0, t)
      // Errors: a burst from Orrery two hours ago, and Whetstone's runners failing now.
      const errors = a.id === 'whetstone' ? (left <= 15 ? (left % 2 < 1 ? 1 : 0) : left > 200 && left < 206 ? 2 : 0) : a.id === 'orrery' && left > 120 && left < 131 ? (left % 3 < 1 ? 3 : 1) : a.id === 'cairn' && left <= 32 && left > 12 ? 1 : 0
      store.sample(a.id, 'errors', errors, t)
    }
    for (const s of ['speech', 'omlx']) { store.sample(s, 'up', 1, t); store.sample(s, 'latency', s === 'speech' ? 6 : 3, t) }
    // Memory fills as the 27B loads beside the 9B, ninety minutes ago, and stays up.
    const loaded = left < 90
    store.sample('host', 'wired', (loaded ? 92e9 + Math.abs(wave(t, 20 * MINUTE)) * 5e9 : 61e9 + Math.abs(wave(t, 33 * MINUTE)) * 3e9), t)
    store.sample('host', 'free', (loaded ? 1.5e9 + Math.abs(wave(t, 13 * MINUTE)) * 1e9 : 9e9 + Math.abs(wave(t, 29 * MINUTE)) * 2e9), t)
    store.sample('host', 'pressure', loaded ? (left < 40 ? 2 : 1) : 1, t)
    store.sample('host', 'load', 1.6 + Math.abs(wave(t, 40 * MINUTE)) * 1.5 + (loaded ? 2.8 : 0), t)
    store.sample('host', 'diskFree', 141e9 + (left / 360) * 3e9, t)
    store.sample('host', 'tailscalePeers', 2, t)
    store.sample('model', 'loaded', loaded ? 2 : 1, t)
    store.sample('model', 'up', 1, t)
    // The model is timed every ten minutes, and slows once memory is tight.
    if (Math.round(left) % 10 === 0) {
      store.sample('model', 'ttft', loaded ? 2600 + (90 - left) * 55 + Math.abs(wave(t, 25 * MINUTE)) * 400 : 380 + Math.abs(wave(t, 31 * MINUTE)) * 160, t)
      store.sample('model', 'tps', loaded ? 14 - (90 - left) * 0.06 : 41 + wave(t, 37 * MINUTE) * 3, t)
    }
  }
  const at = (minutesAgo: number) => now - minutesAgo * MINUTE
  const closed = (rule: string, target: string, severity: 'warn' | 'critical', text: string, opened: number, resolved: number) => {
    store.openAlert(rule, target, severity, text, at(opened))
    store.addEvent('alert', target, text, severity, at(opened))
    store.closeAlert(rule, target, at(resolved))
    store.addEvent('resolved', target, `Resolved: ${text}`, 'info', at(resolved))
  }
  store.addEvent('deploy', 'whetstone', 'Whetstone deployed 4c1e9a2', 'info', at(310))
  closed('whetstone-errors', 'whetstone', 'warn', '6 error lines in the last 15 minutes: ruby runner: timed out after 10 s on case 3', 205, 190)
  store.addEvent('deploy', 'orrery', 'Orrery deployed 8b07d51', 'info', at(160))
  closed('orrery-errors', 'orrery', 'warn', '11 error lines in the last 15 minutes: astro: astro-mcp exited with code 1 before answering', 128, 112)
  store.addEvent('note', 'model', 'qwen/qwen3.6-27b loaded beside qwen/qwen3.5-9b', 'info', at(90))
  store.addEvent('restart', 'cairn', 'Cairn restarted (exited with code 1)', 'warn', at(30))
  store.addEvent('restart', 'cairn', 'Cairn restarted (exited with code 1)', 'warn', at(19))
  store.addEvent('down', 'cairn', 'Cairn stopped: exited with code 1', 'critical', at(12))
  store.setState('model-probe', JSON.stringify(DEMO_PROBE(now)))
}
