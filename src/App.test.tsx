import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import App from './App'
import type { Snapshot } from './types.ts'

const snapshot: Snapshot = {
  ts: new Date().toISOString(),
  apps: [
    { id: 'cairn', name: 'Cairn', url: 'https://studio.ts.net', port: 8210, state: 'ok', latencyMs: 12, busyTotal: 0, error: null, launchd: { pid: 1, runs: 1, lastExit: 0, state: 'running' },
      health: { ok: true, app: 'cairn', version: 'c31ab25', startedAt: new Date().toISOString(), uptimeSeconds: 3600, busy: { notes: 0 }, deps: { model: 'ok' }, data: null, errors: [] } },
    { id: 'orrery', name: 'Orrery', url: 'https://studio.ts.net:8445', port: 8410, state: 'down', latencyMs: null, busyTotal: 0, error: 'fetch failed', launchd: null, health: null },
  ],
  services: [{ id: 'speech', name: 'Speech (Kokoro)', state: 'ok', latencyMs: 4, detail: 'Kokoro-82M-bf16', launchd: null, error: null }],
  model: { state: 'ok', url: 'http://127.0.0.1:1234', loaded: [{ id: 'qwen/qwen3.8-27b', contextLength: 131072 }], available: 8, probe: { at: new Date().toISOString(), model: 'qwen/qwen3.5-9b', ttftMs: 420, tokensPerSecond: 61.5, tokens: 20 }, error: null },
  host: { pressure: 'normal', memoryBytes: 137e9, wiredBytes: 60e9, freeBytes: 4e9, diskFreeBytes: 117e9, diskTotalBytes: 994e9, load: [3.4, 2.6, 2.4], uptimeSeconds: 8 * 86400, thermal: 'ok', tailscale: { state: 'ok', backend: 'Running', online: true, hostName: 'Studio', dnsName: 'studio.ts.net', peers: 2, peersOnline: 2 }, routeInterface: 'en1' },
  data: { files: [{ id: 'cairn', name: 'Cairn', file: 'macros.sqlite', bytes: 610304, lastWrite: new Date().toISOString(), counts: { entries: 1200, today: 3 }, check: 'ok', backup: { newest: '2026-10-20', ageHours: 9, state: 'ok' }, error: null }], backupLog: { lastRun: new Date().toISOString(), failures: 1, state: 'warn' } },
  alerts: [{ id: 1, rule: 'app-down', target: 'orrery', severity: 'critical', text: 'Orrery is not answering on :8410', openedAt: new Date().toISOString(), closedAt: null }],
}

const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

describe('App', () => {
  it('shows the board: what needs a look, each app, the model, the Mac, the data and the timeline', async () => {
    vi.stubGlobal('EventSource', undefined)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/status') return reply(snapshot)
      if (url.startsWith('/api/events')) return reply([{ id: 1, ts: new Date().toISOString(), kind: 'deploy', target: 'cairn', severity: 'info', text: 'Cairn deployed c31ab25' }])
      if (url.startsWith('/api/history')) return reply([{ ts: 1, value: 10 }, { ts: 2, value: 12 }])
      if (url === '/api/settings') return reply({ lmStudioUrl: 'http://127.0.0.1:1234', hasToken: true, probeEveryMinutes: 10, probeModel: '', expectModel: '', notifyMac: true, diskFreePct: 10, backupMaxHours: 26, ttftMaxMs: 5000, tpsMin: 10 })
      return reply({})
    }))
    render(<App />)
    expect(await screen.findByText('Orrery is not answering on :8410')).toBeInTheDocument()
    expect(screen.getByText('Something is down', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cairn' })).toHaveAttribute('href', 'https://studio.ts.net')
    expect(screen.getByText('c31ab25')).toBeInTheDocument()
    expect(screen.getByText('fetch failed', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('qwen/qwen3.8-27b')).toBeInTheDocument()
    expect(screen.getByText('128k context')).toBeInTheDocument()
    expect(screen.getByText('420 ms')).toBeInTheDocument()
    expect(screen.getByTitle('Memory pressure')).toHaveTextContent('normal')
    expect(screen.getByText('2 of 2 devices online')).toBeInTheDocument()
    expect(screen.getByText('via Wi-Fi')).toBeInTheDocument()
    expect(screen.getByText('1,200 entries')).toBeInTheDocument()
    expect(screen.getByText(/1 failed/)).toBeInTheDocument()
    expect(screen.getByText('Cairn deployed c31ab25')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('img', { name: /Cairn latency, last 3 hours: 12/ })).toBeInTheDocument())
  })

  it('says so when the server gives an error', async () => {
    vi.stubGlobal('EventSource', undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'broken' }), { status: 500 })))
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('broken')
  })
})
