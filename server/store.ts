import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DEFAULT_SETTINGS } from '../src/types.ts'
import type { Alert, Event, EventKind, Sample, Settings, Severity } from '../src/types.ts'

/** Raw samples are kept this long; after that only the rollups remain. */
export const RAW_KEEP_MS = 48 * 3600_000
/** Rollups (five-minute buckets) are kept this long. */
export const ROLLUP_KEEP_MS = 90 * 86_400_000
export const BUCKET_MS = 5 * 60_000

const SCHEMA = `
CREATE TABLE IF NOT EXISTS samples (
  target TEXT NOT NULL, metric TEXT NOT NULL, ts INTEGER NOT NULL, value REAL NOT NULL,
  PRIMARY KEY (target, metric, ts)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS rollups (
  target TEXT NOT NULL, metric TEXT NOT NULL, bucket INTEGER NOT NULL,
  avg REAL NOT NULL, min REAL NOT NULL, max REAL NOT NULL, n INTEGER NOT NULL,
  PRIMARY KEY (target, metric, bucket)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL,
  severity TEXT NOT NULL, text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rule TEXT NOT NULL, target TEXT NOT NULL, severity TEXT NOT NULL,
  text TEXT NOT NULL, opened_at INTEGER NOT NULL, closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS alerts_open ON alerts (closed_at);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

export interface PushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** Settings as the server keeps them: the token itself, not just whether there is one. */
export interface ServerSettings extends Omit<Settings, 'hasToken'> {
  apiToken: string
}

const DEFAULT_SERVER_SETTINGS: ServerSettings = (() => {
  const { hasToken: _h, ...rest } = DEFAULT_SETTINGS
  return { ...rest, apiToken: '' }
})()

const iso = (ms: number): string => new Date(ms).toISOString()

/**
 * Everything Barometer keeps, in one SQLite file: the samples behind the
 * sparklines (raw for two days, five-minute rollups for ninety), the
 * timeline of events, the alerts open and closed, the settings, and the
 * phones to push to.
 */
export class Store {
  readonly db: DatabaseSync
  readonly file: string

  constructor(dir = path.resolve('.data')) {
    fs.mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, 'barometer.sqlite')
    this.db = new DatabaseSync(this.file)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA busy_timeout = 2000')
    this.db.exec(SCHEMA)
  }

  close(): void { this.db.close() }

  // --- samples ------------------------------------------------------------

  /** One number about one target, now: kept raw and folded into its five-minute bucket. */
  sample(target: string, metric: string, value: number, ts = Date.now()): void {
    if (!Number.isFinite(value)) return
    this.db.prepare('INSERT OR REPLACE INTO samples (target, metric, ts, value) VALUES (?, ?, ?, ?)').run(target, metric, ts, value)
    const bucket = ts - (ts % BUCKET_MS)
    this.db.prepare(`
      INSERT INTO rollups (target, metric, bucket, avg, min, max, n) VALUES (?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT (target, metric, bucket) DO UPDATE SET
        avg = (avg * n + excluded.avg) / (n + 1), min = MIN(min, excluded.min), max = MAX(max, excluded.max), n = n + 1
    `).run(target, metric, bucket, value, value, value)
  }

  /** The samples since a moment: raw while they exist, the rollups' averages beyond that. */
  history(target: string, metric: string, sinceMs: number, now = Date.now()): Sample[] {
    const rawFrom = Math.max(sinceMs, now - RAW_KEEP_MS)
    const raw = this.db.prepare('SELECT ts, value FROM samples WHERE target = ? AND metric = ? AND ts >= ? ORDER BY ts')
      .all(target, metric, rawFrom) as { ts: number; value: number }[]
    if (sinceMs >= now - RAW_KEEP_MS) return raw
    const rolled = this.db.prepare('SELECT bucket AS ts, avg AS value FROM rollups WHERE target = ? AND metric = ? AND bucket >= ? AND bucket < ? ORDER BY bucket')
      .all(target, metric, sinceMs - (sinceMs % BUCKET_MS), rawFrom - (rawFrom % BUCKET_MS)) as { ts: number; value: number }[]
    return [...rolled, ...raw]
  }

  /** The last value of a metric, if any. */
  last(target: string, metric: string): Sample | null {
    const r = this.db.prepare('SELECT ts, value FROM samples WHERE target = ? AND metric = ? ORDER BY ts DESC LIMIT 1').get(target, metric) as { ts: number; value: number } | undefined
    return r ?? null
  }

  /** Raw samples past two days and rollups past ninety go. */
  prune(now = Date.now()): void {
    this.db.prepare('DELETE FROM samples WHERE ts < ?').run(now - RAW_KEEP_MS)
    this.db.prepare('DELETE FROM rollups WHERE bucket < ?').run(now - ROLLUP_KEEP_MS)
    this.db.prepare('DELETE FROM events WHERE ts < ?').run(now - ROLLUP_KEEP_MS)
    this.db.prepare('DELETE FROM alerts WHERE closed_at IS NOT NULL AND closed_at < ?').run(now - ROLLUP_KEEP_MS)
  }

  // --- events -------------------------------------------------------------

  addEvent(kind: EventKind, target: string, text: string, severity: Severity = 'info', ts = Date.now()): Event {
    const r = this.db.prepare('INSERT INTO events (ts, kind, target, severity, text) VALUES (?, ?, ?, ?, ?)').run(ts, kind, target, severity, text)
    return { id: Number(r.lastInsertRowid), ts: iso(ts), kind, target, severity, text }
  }

  events(limit = 100, sinceId = 0): Event[] {
    const rows = this.db.prepare('SELECT id, ts, kind, target, severity, text FROM events WHERE id > ? ORDER BY id DESC LIMIT ?').all(sinceId, limit) as (Omit<Event, 'ts'> & { ts: number })[]
    return rows.map((r) => ({ ...r, ts: iso(r.ts) }))
  }

  // --- alerts -------------------------------------------------------------

  private alertRow(r: { id: number; rule: string; target: string; severity: Severity; text: string; opened_at: number; closed_at: number | null }): Alert {
    return { id: r.id, rule: r.rule, target: r.target, severity: r.severity, text: r.text, openedAt: iso(r.opened_at), closedAt: r.closed_at === null ? null : iso(r.closed_at) }
  }

  openAlerts(): Alert[] {
    const rows = this.db.prepare('SELECT * FROM alerts WHERE closed_at IS NULL ORDER BY opened_at').all() as Parameters<Store['alertRow']>[0][]
    return rows.map((r) => this.alertRow(r))
  }

  /** Open an alert for a rule on a target, unless one already is; says whether it was new. */
  openAlert(rule: string, target: string, severity: Severity, text: string, ts = Date.now()): { alert: Alert; opened: boolean } {
    const existing = this.db.prepare('SELECT * FROM alerts WHERE rule = ? AND target = ? AND closed_at IS NULL').get(rule, target) as Parameters<Store['alertRow']>[0] | undefined
    if (existing) {
      if (existing.text !== text || existing.severity !== severity) {
        this.db.prepare('UPDATE alerts SET text = ?, severity = ? WHERE id = ?').run(text, severity, existing.id)
        existing.text = text
        existing.severity = severity
      }
      return { alert: this.alertRow(existing), opened: false }
    }
    const r = this.db.prepare('INSERT INTO alerts (rule, target, severity, text, opened_at) VALUES (?, ?, ?, ?, ?)').run(rule, target, severity, text, ts)
    return { alert: { id: Number(r.lastInsertRowid), rule, target, severity, text, openedAt: iso(ts), closedAt: null }, opened: true }
  }

  /** Close the open alert for a rule on a target, if there is one. */
  closeAlert(rule: string, target: string, ts = Date.now()): Alert | null {
    const existing = this.db.prepare('SELECT * FROM alerts WHERE rule = ? AND target = ? AND closed_at IS NULL').get(rule, target) as Parameters<Store['alertRow']>[0] | undefined
    if (!existing) return null
    this.db.prepare('UPDATE alerts SET closed_at = ? WHERE id = ?').run(ts, existing.id)
    return this.alertRow({ ...existing, closed_at: ts })
  }

  // --- settings -----------------------------------------------------------

  getSettings(): ServerSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
    const out: Record<string, unknown> = { ...DEFAULT_SERVER_SETTINGS }
    for (const { key, value } of rows) {
      if (!(key in DEFAULT_SERVER_SETTINGS)) continue
      try { out[key] = JSON.parse(value) } catch { /* a value from an older build */ }
    }
    return out as unknown as ServerSettings
  }

  /** What the page may see: everything but the token. */
  getPublicSettings(): Settings {
    const { apiToken, ...rest } = this.getSettings()
    return { ...rest, hasToken: apiToken !== '' }
  }

  /** A patch, checked: numbers are numbers, the URL is one, and unknown keys are dropped. */
  setSettings(patch: Record<string, unknown>): Settings {
    const current = this.getSettings()
    const next: Record<string, unknown> = { ...current }
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULT_SERVER_SETTINGS)) continue
      const was = (DEFAULT_SERVER_SETTINGS as unknown as Record<string, unknown>)[key]
      if (typeof was === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${key} must be a number of zero or more`)
        next[key] = value
      } else if (typeof was === 'boolean') {
        if (typeof value !== 'boolean') throw new Error(`${key} must be true or false`)
        next[key] = value
      } else {
        if (typeof value !== 'string') throw new Error(`${key} must be text`)
        if (key === 'lmStudioUrl' && !/^https?:\/\/\S+$/.test(value.trim())) throw new Error('lmStudioUrl must be an http(s) URL')
        next[key] = value.trim().replace(/\/+$/, '')
      }
    }
    const put = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    for (const [key, value] of Object.entries(next)) put.run(key, JSON.stringify(value))
    return this.getPublicSettings()
  }

  // --- push ---------------------------------------------------------------

  addSubscription(sub: PushSubscription, ts = Date.now()): void {
    this.db.prepare('INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)').run(sub.endpoint, sub.keys.p256dh, sub.keys.auth, ts)
  }

  removeSubscription(endpoint: string): boolean {
    return this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint).changes > 0
  }

  subscriptions(): PushSubscription[] {
    const rows = this.db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all() as { endpoint: string; p256dh: string; auth: string }[]
    return rows.map((r) => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }))
  }

  // --- odds and ends the collector remembers between runs -----------------

  getState(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM state WHERE key = ?').get(key) as { value: string } | undefined
    return r?.value ?? null
  }

  setState(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)').run(key, value)
  }
}
