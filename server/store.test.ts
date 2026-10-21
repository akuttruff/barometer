import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BUCKET_MS, RAW_KEEP_MS, ROLLUP_KEEP_MS, Store } from './store.ts'

let dir: string
let store: Store
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'barometer-store-'))
  store = new Store(dir)
})
afterEach(() => {
  store.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('samples', () => {
  it('keeps each sample raw and folds it into its five-minute bucket', () => {
    const t0 = 1_700_000_000_000 - (1_700_000_000_000 % BUCKET_MS)
    store.sample('lm-chat', 'latency', 10, t0)
    store.sample('lm-chat', 'latency', 30, t0 + 1000)
    store.sample('lm-chat', 'latency', 50, t0 + BUCKET_MS)
    expect(store.history('lm-chat', 'latency', t0, t0 + 2 * BUCKET_MS)).toEqual([{ ts: t0, value: 10 }, { ts: t0 + 1000, value: 30 }, { ts: t0 + BUCKET_MS, value: 50 }])
    const rolled = store.db.prepare('SELECT bucket, avg, min, max, n FROM rollups ORDER BY bucket').all()
    expect(rolled).toEqual([{ bucket: t0, avg: 20, min: 10, max: 30, n: 2 }, { bucket: t0 + BUCKET_MS, avg: 50, min: 50, max: 50, n: 1 }])
    expect(store.last('lm-chat', 'latency')).toEqual({ ts: t0 + BUCKET_MS, value: 50 })
    expect(store.last('lm-chat', 'nothing')).toBeNull()
  })

  it('answers a long range from the rollups, then the raw samples, and prunes both in time', () => {
    const now = 1_700_000_000_000
    const old = now - RAW_KEEP_MS - 3 * BUCKET_MS
    store.sample('host', 'free', 1, old)
    store.sample('host', 'free', 3, old + 1000)
    store.sample('host', 'free', 7, now - 1000)
    const week = store.history('host', 'free', now - 7 * 86_400_000, now)
    expect(week).toEqual([{ ts: old - (old % BUCKET_MS), value: 2 }, { ts: now - 1000, value: 7 }])
    store.prune(now)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM samples').get()).toEqual({ n: 1 })
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM rollups').get()).toEqual({ n: 2 })
    store.prune(now + ROLLUP_KEEP_MS + BUCKET_MS)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM rollups').get()).toEqual({ n: 0 })
  })

  it('ignores a sample that is not a number', () => {
    store.sample('host', 'free', Number.NaN)
    expect(store.history('host', 'free', 0)).toEqual([])
  })
})

describe('events and alerts', () => {
  it('lists events newest first, and after an id', () => {
    const a = store.addEvent('restart', 'orrery', 'orrery restarted', 'warn', 1000)
    const b = store.addEvent('deploy', 'cairn', 'cairn deployed c31ab25', 'info', 2000)
    expect(store.events()).toEqual([b, a])
    expect(store.events(10, a.id)).toEqual([b])
    expect(a.ts).toBe('1970-01-01T00:00:01.000Z')
  })

  it('opens an alert once per rule and target, updates its text, and closes it', () => {
    const first = store.openAlert('app-down', 'cairn', 'critical', 'Cairn is not answering', 1000)
    expect(first.opened).toBe(true)
    const again = store.openAlert('app-down', 'cairn', 'critical', 'Cairn is not answering (2 minutes)', 2000)
    expect(again.opened).toBe(false)
    expect(again.alert.id).toBe(first.alert.id)
    expect(store.openAlerts()).toMatchObject([{ rule: 'app-down', target: 'cairn', text: 'Cairn is not answering (2 minutes)', closedAt: null }])
    expect(store.closeAlert('app-down', 'cairn', 3000)).toMatchObject({ id: first.alert.id, closedAt: '1970-01-01T00:00:03.000Z' })
    expect(store.closeAlert('app-down', 'cairn')).toBeNull()
    expect(store.openAlerts()).toEqual([])
  })
})

describe('settings and subscriptions', () => {
  it('starts from the defaults, checks a patch, and never shows the token', () => {
    expect(store.getPublicSettings()).toMatchObject({ lmStudioUrl: 'http://127.0.0.1:1234', hasToken: false, probeEveryMinutes: 10 })
    const next = store.setSettings({ apiToken: 'secret', lmStudioUrl: 'http://localhost:1234/', probeEveryMinutes: 0, notifyMac: false, nonsense: 1 })
    expect(next).toMatchObject({ lmStudioUrl: 'http://localhost:1234', hasToken: true, probeEveryMinutes: 0, notifyMac: false })
    expect('apiToken' in next).toBe(false)
    expect(store.getSettings().apiToken).toBe('secret')
    expect(() => store.setSettings({ probeEveryMinutes: -1 })).toThrow(/number of zero or more/)
    expect(() => store.setSettings({ lmStudioUrl: 'nope' })).toThrow(/URL/)
    expect(() => store.setSettings({ notifyMac: 'yes' })).toThrow(/true or false/)
  })

  it('keeps the phones to push to, by endpoint', () => {
    const sub = { endpoint: 'https://push.example/a', keys: { p256dh: 'k', auth: 'a' } }
    store.addSubscription(sub)
    store.addSubscription(sub)
    expect(store.subscriptions()).toEqual([sub])
    expect(store.removeSubscription(sub.endpoint)).toBe(true)
    expect(store.removeSubscription(sub.endpoint)).toBe(false)
  })

  it('remembers odds and ends by key', () => {
    expect(store.getState('watch-offset')).toBeNull()
    store.setState('watch-offset', '120')
    expect(store.getState('watch-offset')).toBe('120')
  })
})
