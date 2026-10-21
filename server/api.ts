import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { Plugin } from 'vite'
import { Collector } from './collector.ts'
import type { CollectorOptions } from './collector.ts'
import { HealthCheck } from './health.ts'
import { Notifier } from './notify.ts'
import type { NotifierOptions } from './notify.ts'
import { Store } from './store.ts'
import type { PushSubscription } from './store.ts'

export interface ApiOptions {
  dir?: string
  /** A dev instance: watches the same services but never times the model or notifies anyone. */
  quiet?: boolean
  collector?: CollectorOptions
  notifier?: NotifierOptions
  /** Start the loop at once (the servers do; tests tick by hand). */
  start?: boolean
}

export interface ApiState {
  store: Store
  collector: Collector
  notifier: Notifier
  health: HealthCheck
}

type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return {}
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object')
  return parsed as Record<string, unknown>
}

/**
 * A state-changing request must come from this app's own page: it is
 * reachable from any tab on a device on the tailnet, and a page you
 * happened to visit must not be able to change the settings.
 */
function sameOrigin(req: IncomingMessage): boolean {
  const method = (req.method ?? 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') return true
  const origin = req.headers.origin
  if (!origin) return true // curl and scripts send none
  try { return new URL(origin).host === req.headers.host } catch { return false }
}

const num = (v: string | null, fallback: number): number => { const n = Number(v); return v !== null && Number.isFinite(n) ? n : fallback }

export function createApiState(options: ApiOptions = {}): ApiState {
  const store = new Store(options.dir)
  const notifier = new Notifier(store, options.notifier)
  const collector = new Collector(store, { notifier: options.quiet ? null : notifier, modelProbe: !options.quiet, ...options.collector })
  const health = new HealthCheck({ app: 'barometer', dataFile: path.resolve(options.dir ?? '.data', 'barometer.sqlite'), busy: () => ({}) })
  if (options.start !== false) collector.start()
  return { store, collector, notifier, health }
}

export function createMiddleware(state: ApiState): Handler {
  const { store, collector, notifier } = state

  return (req, res, next) => {
    const [rawUrl = ''] = (req.url ?? '').split('?')
    if (!rawUrl.startsWith('/api/')) return next()
    if (!sameOrigin(req)) return json(res, 403, { error: 'cross-origin write refused' })
    const url = rawUrl.replace(/\/+$/, '')
    const query = new URL(req.url ?? '/', 'http://x').searchParams
    const method = req.method ?? 'GET'
    const fail = (err: unknown): void => { json(res, 400, { error: (err as Error).message || String(err) }) }

    if (url === '/api/health' && method === 'GET') { void state.health.report().then((h) => json(res, 200, h)); return undefined }

    // --- the board --------------------------------------------------------
    if (url === '/api/status' && method === 'GET') {
      if (collector.latest) return json(res, 200, collector.latest)
      void collector.tick().then((s) => json(res, 200, s), fail)
      return undefined
    }
    if (url === '/api/tick' && method === 'POST') { void collector.tick().then((s) => json(res, 200, s), fail); return undefined }
    if (url === '/api/history' && method === 'GET') {
      const target = query.get('target') ?? ''
      const metric = query.get('metric') ?? ''
      if (!target || !metric) return json(res, 400, { error: 'target and metric are needed' })
      const hours = Math.min(Math.max(num(query.get('hours'), 3), 0.1), 24 * 90)
      return json(res, 200, store.history(target, metric, Date.now() - hours * 3600_000))
    }
    if (url === '/api/events' && method === 'GET') return json(res, 200, store.events(Math.min(num(query.get('limit'), 100), 500), num(query.get('since'), 0)))
    if (url === '/api/alerts' && method === 'GET') return json(res, 200, store.openAlerts())

    // Live: the snapshot after every round, and each event as it happens.
    if (url === '/api/stream' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' })
      res.write(': hello\n\n')
      const send = (name: string, data: unknown): void => { try { res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`) } catch { /* gone */ } }
      if (collector.latest) send('snapshot', collector.latest)
      const off = collector.subscribe(({ snapshot, event }) => {
        if (snapshot) send('snapshot', snapshot)
        if (event) send('event', event)
      })
      const ping = setInterval(() => { try { res.write(': ping\n\n') } catch { /* gone */ } }, 25_000)
      req.on('close', () => { off(); clearInterval(ping) })
      return undefined
    }

    // --- settings -----------------------------------------------------------
    if (url === '/api/settings' && method === 'GET') return json(res, 200, store.getPublicSettings())
    if (url === '/api/settings' && method === 'PUT') {
      void readBody(req).then((body) => json(res, 200, store.setSettings(body))).catch(fail)
      return undefined
    }

    // --- push ---------------------------------------------------------------
    if (url === '/api/push/key' && method === 'GET') return json(res, 200, { key: notifier.vapid().publicKey })
    if (url === '/api/push' && method === 'POST') {
      void readBody(req).then((body) => {
        const sub = body as unknown as PushSubscription
        if (typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://') || typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string') throw new Error('Expected a push subscription')
        store.addSubscription({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } })
        json(res, 201, { ok: true, subscriptions: store.subscriptions().length })
      }).catch(fail)
      return undefined
    }
    if (url === '/api/push' && method === 'DELETE') {
      void readBody(req).then((body) => {
        if (typeof body.endpoint !== 'string') throw new Error('endpoint is needed')
        json(res, 200, { ok: store.removeSubscription(body.endpoint) })
      }).catch(fail)
      return undefined
    }
    if (url === '/api/push/test' && method === 'POST') {
      void notifier.send({ title: 'Barometer', body: 'Notifications reach this device.', severity: 'info' }).then(() => json(res, 200, { ok: true, subscriptions: store.subscriptions().length }), fail)
      return undefined
    }

    return json(res, 404, { error: `No such route: ${method} ${url}` })
  }
}

const shared = globalThis as { __barometerApi?: Map<string, ApiState> }

/** The API as a Vite plugin, for `vite dev` and `vite preview` alike; one state per data dir survives a config reload. */
export default function api(options: ApiOptions = {}): Plugin {
  const states = (shared.__barometerApi ??= new Map())
  const key = path.resolve(options.dir ?? '.data')
  let state = states.get(key)
  if (!state) {
    state = createApiState(options)
    states.set(key, state)
  }
  const middleware = createMiddleware(state)
  return {
    name: 'barometer-api',
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
  }
}
