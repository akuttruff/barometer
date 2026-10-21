import { describe, expect, it } from 'vitest'
import { evaluate, monitors } from './monitors.ts'
import { app, data, host, model, service, settings, snapshot } from './fixtures.ts'

const keys = (s: Parameters<typeof evaluate>[0], ticks?: Record<string, number>) => evaluate(s, settings(), ticks).map((w) => `${w.rule}@${w.target}`)
const status = (s: Parameters<typeof monitors>[0], id: string, ticks?: Record<string, number>) => monitors(s, settings(), ticks).find((m) => m.id === id)?.status

describe('monitors', () => {
  it('lists every monitor, all ok when everything is fine, and wants no alert', () => {
    const all = monitors(snapshot(), settings())
    expect(all.map((m) => m.id)).toEqual(['cairn-up', 'cairn-deps', 'cairn-errors', 'speech-up', 'model-server', 'model-loaded', 'model-speed', 'memory', 'disk', 'thermal', 'tailscale', 'cairn-backup', 'cairn-integrity', 'backup-job'])
    expect(all.filter((m) => m.status !== 'ok').map((m) => m.id)).toEqual(['model-speed'])
    expect(all.find((m) => m.id === 'model-speed')).toMatchObject({ status: 'nodata', text: 'Not timed yet' })
    expect(evaluate(snapshot(), settings())).toEqual([])
  })

  it('says an app is down only once it has been down two rounds running, and names a dependency it cannot reach', () => {
    const s = snapshot({ apps: [app('cairn', { state: 'down', health: null, error: 'fetch failed' }), app('orrery', { state: 'warn', health: { ...app('orrery').health!, deps: { model: 'ok', astro: 'down' }, errors: ['astro: no answer in 4000ms'] } })] })
    expect(status(s, 'cairn-up', { cairn: 1 })).toBe('warn')
    expect(keys(s, { cairn: 1 })).toEqual(['orrery-deps@orrery'])
    const wanted = evaluate(s, settings(), { cairn: 2 })
    expect(wanted).toMatchObject([
      { rule: 'cairn-up', target: 'cairn', severity: 'critical', text: 'Cairn is not answering on :8010 (fetch failed)' },
      { rule: 'orrery-deps', target: 'orrery', severity: 'warn', text: 'Orrery cannot reach astro: no answer in 4000ms' },
    ])
    expect(status(s, 'cairn-deps')).toBe('nodata')
  })

  it('counts an app\'s own errors against the threshold', () => {
    const s = snapshot({ apps: [app('cairn', { errors: { last15m: 5, recent: [{ ts: 'x', text: '[cairn] lookup failed: timeout' }] } })] })
    expect(evaluate(s, settings())).toMatchObject([{ rule: 'cairn-errors', text: '5 error lines in the last 15 minutes: [cairn] lookup failed: timeout' }])
    expect(status(snapshot({ apps: [app('cairn', { errors: { last15m: 4, recent: [] } })] }), 'cairn-errors')).toBe('ok')
  })

  it('watches the other services the same way', () => {
    const s = snapshot({ services: [service('speech', { state: 'down', error: 'ECONNREFUSED' })] })
    expect(keys(s, { speech: 1 })).toEqual([])
    expect(keys(s, { speech: 2 })).toEqual(['speech-up@speech'])
  })

  it('wants the model server up, a model loaded, and the timed probe within bounds', () => {
    const down = snapshot({ model: model({ state: 'down', error: 'Cannot reach LM Studio' }) })
    expect(keys(down)).toEqual(['model-server@model'])
    expect(status(down, 'model-loaded')).toBe('nodata')
    expect(keys(snapshot({ model: model({ state: 'warn', loaded: [], error: 'No model is loaded' }) }))).toEqual(['model-loaded@model'])
    const slow = { at: 'x', model: 'qwen/qwen3.5-9b', ttftMs: 9000, tokensPerSecond: 40, tokens: 20 }
    expect(evaluate(snapshot({ model: model({ probe: slow }) }), settings())).toMatchObject([{ rule: 'model-speed', text: 'qwen/qwen3.5-9b took 9.0 s to its first token' }])
    expect(evaluate(snapshot({ model: model({ probe: { ...slow, ttftMs: 500, tokensPerSecond: 3 } }) }), settings())).toMatchObject([{ rule: 'model-speed', text: 'qwen/qwen3.5-9b wrote 3 tokens a second' }])
    expect(keys(snapshot({ model: model({ probe: { ...slow, ttftMs: 500 } }) }))).toEqual([])
  })

  it('watches the machine: memory, disk, heat and Tailscale', () => {
    expect(evaluate(snapshot({ host: host({ pressure: 'critical', wiredBytes: 100e9 }) }), settings())).toMatchObject([{ rule: 'memory', severity: 'critical', text: 'Memory pressure is critical (100 GB wired). Unload a model.' }])
    expect(evaluate(snapshot({ host: host({ pressure: 'warning' }) }), settings())).toMatchObject([{ rule: 'memory', severity: 'warn' }])
    expect(evaluate(snapshot({ host: host({ diskFreeBytes: 50e9 }) }), settings())).toMatchObject([{ rule: 'disk', text: 'The disk has 5% free' }])
    expect(keys(snapshot({ host: host({ thermal: 'warning' }) }))).toEqual(['thermal@host'])
    expect(evaluate(snapshot({ host: host({ tailscale: { ...host().tailscale, state: 'down', backend: 'Stopped' } }) }), settings())).toMatchObject([{ rule: 'tailscale', severity: 'critical' }])
    expect(evaluate(snapshot({ host: host({ tailscale: { ...host().tailscale, state: 'warn' } }) }), settings())).toMatchObject([{ rule: 'tailscale', severity: 'warn' }])
  })

  it('watches the backups and the databases', () => {
    const f = data().files[0]!
    const s = snapshot({ data: data({
      files: [{ ...f, backup: { newest: '2026-10-18', ageHours: 57, state: 'warn' } }, { ...f, id: 'orrery', name: 'Orrery', file: 'orrery.sqlite', backup: { newest: null, ageHours: null, state: 'down' }, check: 'bad' }],
      backupLog: { lastRun: 'x', failures: 1, state: 'warn' },
    }) })
    expect(evaluate(s, settings())).toMatchObject([
      { rule: 'cairn-backup', target: 'cairn', text: "Cairn's newest backup is from 2026-10-18 (57 h ago)" },
      { rule: 'orrery-backup', target: 'orrery', text: 'Orrery has no backup at all' },
      { rule: 'orrery-integrity', target: 'orrery', severity: 'critical' },
      { rule: 'backup-job', target: 'backups', text: "Last night's backup finished with 1 failure; see ~/Library/Logs/backup-data.log" },
    ])
    expect(status(snapshot({ data: data({ files: [{ ...f, check: 'unknown' }] }) }), 'cairn-integrity')).toBe('nodata')
  })
})
