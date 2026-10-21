import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Collector } from './collector.ts'
import type { Probes } from './collector.ts'
import { Notifier } from './notify.ts'
import type { Notice } from './notify.ts'
import { Store } from './store.ts'
import { app, data, host, model, service } from './fixtures.ts'
import type { WatchLine } from './probes.ts'
import type { ErrorLine } from '../src/types.ts'

let dir: string
let store: Store
let notices: Notice[]
let notifier: Notifier
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'barometer-collector-'))
  store = new Store(dir)
  store.setSettings({ notifyMac: true, probeEveryMinutes: 0 })
  notices = []
  notifier = new Notifier(store, { mac: async (n) => { notices.push(n) }, push: async () => {} })
})
afterEach(() => {
  store.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

/** Probes whose answers the test sets before each round. */
function fakeProbes() {
  const state = {
    app: app('cairn'),
    service: service('speech'),
    host: host(),
    model: model(),
    data: data(),
    watch: [] as WatchLine[],
    errors: [] as ErrorLine[],
    probe: { at: '2026-10-20T09:00:00.000Z', model: 'qwen/qwen3.5-9b', ttftMs: 300, tokensPerSecond: 60, tokens: 20 },
    probed: 0,
    checks: [] as boolean[],
  }
  const probes: Probes = {
    app: async () => state.app,
    service: async () => state.service,
    host: async () => state.host,
    model: async (_s, probe) => ({ ...state.model, probe }),
    probeModel: async () => { state.probed++; return state.probe },
    data: ({ check }) => { state.checks.push(check); return state.data },
    watchLog: (offset) => { const lines = state.watch; state.watch = []; return { lines, offset: offset + lines.length } },
    appErrors: (_file, offset) => { const lines = state.errors; state.errors = []; return { lines, offset: offset + lines.length } },
  }
  return { state, probes }
}

const targets = { apps: [{ id: 'cairn', name: 'Cairn', port: 8210, label: 'com.amie.cairn', tailnetPort: 443, log: 'x.log' }], services: [{ id: 'speech', name: 'Speech', url: 'x', label: null, kind: 'speech' as const }] }

describe('Collector', () => {
  it('looks at everything, keeps the numbers, and checks the databases on the first round only', async () => {
    const { state, probes } = fakeProbes()
    let now = 1_700_000_000_000
    const c = new Collector(store, { probes, notifier, ...targets, now: () => now })
    const s = await c.tick()
    expect(s.apps[0]!.id).toBe('cairn')
    expect(s.alerts).toEqual([])
    expect(s.monitors.map((m) => m.status)).toContain('ok')
    expect(s.monitors.every((m) => m.since === null)).toBe(true)
    expect(c.latest).toBe(s)
    now += 15_000
    state.data = data({ files: [{ ...data().files[0]!, check: 'unknown' }] })
    const again = await c.tick()
    expect(state.checks).toEqual([true, false])
    expect(again.data.files[0]!.check).toBe('ok')
    expect(store.history('cairn', 'latency', 0, now).map((x) => x.value)).toEqual([12, 12])
    expect(store.last('host', 'free')?.value).toBe(4e9)
    expect(store.last('model', 'loaded')?.value).toBe(1)
    expect(store.last('cairn', 'bytes')?.value).toBe(1000)
    // A fresh collector shows the last round straight away.
    expect(new Collector(store, { probes, ...targets }).latest?.ts).toBe(new Date(now).toISOString())
  })

  it('opens an alert once a thing has been down two rounds, says so once, and resolves it', async () => {
    const { state, probes } = fakeProbes()
    const c = new Collector(store, { probes, notifier, ...targets })
    await c.tick()
    state.app = app('cairn', { state: 'down', health: null, error: 'fetch failed' })
    expect((await c.tick()).alerts).toEqual([])
    const down = await c.tick()
    expect(down.alerts).toMatchObject([{ rule: 'cairn-up', target: 'cairn', severity: 'critical' }])
    expect(down.monitors.find((m) => m.id === 'cairn-up')).toMatchObject({ status: 'alert', since: down.alerts[0]!.openedAt })
    expect(notices).toMatchObject([{ title: 'Barometer: something is down', body: 'Cairn is not answering on :8010 (fetch failed)' }])
    await c.tick()
    expect(notices).toHaveLength(1)
    state.app = app('cairn')
    const back = await c.tick()
    expect(back.alerts).toEqual([])
    expect(notices.at(-1)).toMatchObject({ title: 'Barometer: back', severity: 'info' })
    expect(store.events().map((e) => e.kind)).toEqual(['resolved', 'alert'])
  })

  it('tells a deploy from a restart by the commit, with launchd\'s reason from the watch log', async () => {
    const { state, probes } = fakeProbes()
    let now = Date.parse('2026-10-20T14:53:00.000Z')
    const c = new Collector(store, { probes, notifier, ...targets, now: () => now })
    await c.tick()
    now += 15_000
    state.watch = [{ ts: new Date(now - 5000).toISOString(), target: 'cairn', what: 'restarted', reason: 'signaled service: Terminated: 15' }]
    state.app = app('cairn', { health: { ...app('cairn').health!, version: 'def5678', startedAt: '2026-10-20T14:53:10.000Z' } })
    await c.tick()
    expect(store.events()[0]).toMatchObject({ kind: 'deploy', target: 'cairn', text: 'Cairn deployed def5678 (signaled service: Terminated: 15)', severity: 'info' })
    expect(notices).toEqual([])
    now += 15_000
    state.app = app('cairn', { health: { ...app('cairn').health!, version: 'def5678', startedAt: '2026-10-20T14:53:40.000Z' } })
    await c.tick()
    expect(store.events()[0]).toMatchObject({ kind: 'restart', target: 'cairn', text: 'Cairn restarted', severity: 'warn' })
    expect(notices).toMatchObject([{ title: 'Cairn restarted', severity: 'warn' }])
    now += 15_000
    state.watch = [{ ts: new Date(now).toISOString(), target: 'cairn', what: 'stopped', reason: null }]
    await c.tick()
    expect(store.events()[0]).toMatchObject({ kind: 'down', text: 'Cairn stopped', severity: 'critical' })
  })

  it('times the model on its own cadence, only when nothing is being written, and keeps the result', async () => {
    const { state, probes } = fakeProbes()
    store.setSettings({ probeEveryMinutes: 10 })
    let now = 1_700_000_000_000
    const c = new Collector(store, { probes, notifier, ...targets, now: () => now })
    state.app = app('cairn', { busyTotal: 1 })
    await c.tick()
    expect(state.probed).toBe(0)
    state.app = app('cairn')
    await c.tick()
    await vi.waitFor(() => expect(state.probed).toBe(1))
    await vi.waitFor(() => expect(c.latest?.model.probe?.ttftMs).toBe(300))
    expect(store.last('model', 'ttft')?.value).toBe(300)
    now += 5 * 60_000
    await c.tick()
    expect(state.probed).toBe(1)
    now += 6 * 60_000
    await c.tick()
    await vi.waitFor(() => expect(state.probed).toBe(2))
    // A dev instance never times the model.
    const quiet = new Collector(store, { probes, modelProbe: false, ...targets, now: () => now + 3600_000 })
    await quiet.tick()
    expect(state.probed).toBe(2)
    // The last timing survives a restart.
    expect(new Collector(store, { probes, ...targets }).latest?.model.probe?.model).toBe('qwen/qwen3.5-9b')
  })

  it('tells the pages listening about each round and event', async () => {
    const { state, probes } = fakeProbes()
    const c = new Collector(store, { probes, notifier, ...targets })
    const heard: string[] = []
    const off = c.subscribe(({ snapshot, event }) => { heard.push(snapshot ? 'snapshot' : `event:${event!.kind}`) })
    await c.tick()
    state.app = app('cairn', { state: 'down', health: null })
    await c.tick()
    await c.tick()
    off()
    await c.tick()
    expect(heard).toEqual(['snapshot', 'snapshot', 'event:alert', 'snapshot'])
  })
})

describe('an app\'s own errors', () => {
  it('counts the error lines its log gains, keeps the latest few, and warns past the threshold', async () => {
    const { state, probes } = fakeProbes()
    let now = 1_700_000_000_000
    const c = new Collector(store, { probes, notifier, ...targets, now: () => now })
    await c.tick()
    state.errors = [{ ts: 'x', text: '[cairn] lookup failed: timeout' }, { ts: 'x', text: '[cairn] label: could not parse' }]
    now += 15_000
    let s = await c.tick()
    expect(s.apps[0]!.errors).toEqual({ last15m: 2, recent: state.errors.length ? state.errors : [{ ts: 'x', text: '[cairn] lookup failed: timeout' }, { ts: 'x', text: '[cairn] label: could not parse' }] })
    expect(s.monitors.find((m) => m.id === 'cairn-errors')).toMatchObject({ status: 'ok', text: '2 error lines in the last 15 minutes: [cairn] label: could not parse' })
    state.errors = Array.from({ length: 3 }, (_, i) => ({ ts: 'x', text: `error ${i}` }))
    now += 15_000
    s = await c.tick()
    expect(s.apps[0]!.errors.last15m).toBe(5)
    expect(s.alerts).toMatchObject([{ rule: 'cairn-errors', severity: 'warn' }])
    // A quarter of an hour later the window has moved on and the monitor is ok again.
    now += 16 * 60_000
    s = await c.tick()
    expect(s.apps[0]!.errors.last15m).toBe(0)
    expect(s.apps[0]!.errors.recent).toHaveLength(5)
    expect(s.alerts).toEqual([])
  })
})
