import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApiState, createMiddleware } from './api.ts'
import type { ApiState } from './api.ts'
import type { Probes } from './collector.ts'
import { app, data, host, model, service } from './fixtures.ts'
import type { Notice } from './notify.ts'

let dir: string
let server: http.Server
let base: string
let state: ApiState
let notices: Notice[]
let realFetch: typeof fetch

const probes: Probes = {
  app: async () => app('cairn'), service: async () => service('speech'), host: async () => host(), model: async (_s, probe) => model({ probe }),
  probeModel: async () => ({ at: 'x', model: 'm', ttftMs: 1, tokensPerSecond: 1, tokens: 1 }), data: () => data(), watchLog: (offset) => ({ lines: [], offset }),
}

beforeEach(async () => {
  // The shared setup stubs fetch for page tests; these talk to a real socket.
  vi.unstubAllGlobals()
  realFetch = globalThis.fetch.bind(globalThis)
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'barometer-api-'))
  notices = []
  state = createApiState({ dir, start: false, collector: { probes, apps: [{ id: 'cairn', name: 'Cairn', port: 8210, label: 'x', tailnetPort: 443 }], services: [] }, notifier: { mac: async (n) => { notices.push(n) }, push: async (_s, payload) => { notices.push(JSON.parse(payload) as Notice) } } })
  state.store.setSettings({ notifyMac: true, probeEveryMinutes: 0 })
  const middleware = createMiddleware(state)
  server = http.createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end('not api') }))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterEach(async () => {
  state.collector.stop()
  server.closeAllConnections()
  await new Promise<void>((r) => server.close(() => r()))
  state.store.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const get = (p: string) => realFetch(`${base}${p}`)
const send = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) => realFetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })

describe('api', () => {
  it('reports its own health and the board, taking a first round when there is none yet', async () => {
    expect(await (await get('/api/health')).json()).toMatchObject({ ok: true, app: 'barometer', busy: {} })
    const s = await (await get('/api/status')).json() as { apps: { id: string }[] }
    expect(s.apps.map((a) => a.id)).toEqual(['cairn'])
    expect(await (await send('POST', '/api/tick')).json()).toMatchObject({ apps: [{ id: 'cairn' }] })
    const history = await (await get('/api/history?target=cairn&metric=latency&hours=1')).json() as { value: number }[]
    expect(history.map((h) => h.value)).toEqual([12, 12])
    expect((await get('/api/history?target=cairn')).status).toBe(400)
    expect(await (await get('/api/events')).json()).toEqual([])
    expect(await (await get('/api/alerts')).json()).toEqual([])
  })

  it('keeps settings, never showing the token, and refuses a cross-origin write', async () => {
    expect(await (await get('/api/settings')).json()).toMatchObject({ hasToken: false, probeEveryMinutes: 0 })
    const r = await send('PUT', '/api/settings', { apiToken: 'secret', probeEveryMinutes: 5 })
    expect(await r.json()).toMatchObject({ hasToken: true, probeEveryMinutes: 5 })
    expect((await send('PUT', '/api/settings', { probeEveryMinutes: 'lots' })).status).toBe(400)
    expect((await send('PUT', '/api/settings', { probeEveryMinutes: 1 }, { Origin: 'https://elsewhere.example' })).status).toBe(403)
  })

  it('registers a phone for push, sends it a test, and forgets it', async () => {
    const { key } = await (await get('/api/push/key')).json() as { key: string }
    expect(key.length).toBeGreaterThan(40)
    expect((await send('POST', '/api/push', { endpoint: 'http://not-https' })).status).toBe(400)
    const sub = { endpoint: 'https://push.example/one', keys: { p256dh: 'p', auth: 'a' } }
    expect(await (await send('POST', '/api/push', sub)).json()).toEqual({ ok: true, subscriptions: 1 })
    expect(await (await send('POST', '/api/push/test')).json()).toEqual({ ok: true, subscriptions: 1 })
    expect(notices).toMatchObject([{ title: 'Barometer', body: 'Notifications reach this device.' }, { title: 'Barometer', body: 'Notifications reach this device.' }])
    expect(await (await send('DELETE', '/api/push', { endpoint: sub.endpoint })).json()).toEqual({ ok: true })
    expect(await (await send('DELETE', '/api/push', { endpoint: sub.endpoint })).json()).toEqual({ ok: false })
  })

  it('streams each round and event to a page listening', async () => {
    const res = await get('/api/stream')
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read()
        if (done) break
        text += decoder.decode(value)
      }
    }
    await state.collector.tick()
    await readUntil('event: snapshot')
    expect(text).toMatch(/event: snapshot\ndata: \{"ts"/)
    await reader.cancel()
  })

  it('says what it does not have', async () => {
    expect((await get('/api/nothing')).status).toBe(404)
  })
})
