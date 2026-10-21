import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App, { overallStatus } from './App'
import type { Snapshot } from './types.ts'

const now = new Date().toISOString()
const snapshot: Snapshot = {
  ts: now,
  apps: [
    { id: 'cairn', name: 'Cairn', url: 'https://studio.ts.net', port: 8210, state: 'ok', latencyMs: 12, busyTotal: 0, error: null, launchd: { pid: 1, runs: 15, lastExit: 0, state: 'running' }, errors: { last15m: 0, recent: [] },
      health: { ok: true, app: 'cairn', version: 'c31ab25', startedAt: now, uptimeSeconds: 3600, busy: { notes: 0 }, deps: { model: 'ok' }, data: null, errors: [] } },
    { id: 'orrery', name: 'Orrery', url: 'https://studio.ts.net:8445', port: 8410, state: 'down', latencyMs: null, busyTotal: 0, error: 'fetch failed', launchd: null, health: null, errors: { last15m: 6, recent: [{ ts: now, text: '[orrery] could not reach astro-mcp' }] } },
  ],
  services: [{ id: 'speech', name: 'Speech (Kokoro)', state: 'ok', latencyMs: 4, detail: 'Kokoro-82M-bf16', launchd: null, error: null }],
  model: { state: 'ok', url: 'http://127.0.0.1:1234', loaded: [{ id: 'qwen/qwen3.8-27b', contextLength: 131072 }], available: 8, probe: { at: now, model: 'qwen/qwen3.5-9b', ttftMs: 420, tokensPerSecond: 61.5, tokens: 20 }, error: null },
  host: { pressure: 'normal', memoryBytes: 137e9, wiredBytes: 60e9, freeBytes: 4e9, diskFreeBytes: 117e9, diskTotalBytes: 994e9, load: [3.4, 2.6, 2.4], uptimeSeconds: 8 * 86400, thermal: 'ok', tailscale: { state: 'ok', backend: 'Running', online: true, hostName: 'Studio', dnsName: 'studio.ts.net', peers: 2, peersOnline: 2 }, routeInterface: 'en1' },
  data: { files: [{ id: 'cairn', name: 'Cairn', file: 'macros.sqlite', bytes: 610304, lastWrite: now, counts: { entries: 1200, today: 3 }, check: 'ok', backup: { newest: '2026-10-20', ageHours: 9, state: 'ok' }, error: null }], backupLog: { lastRun: now, failures: 1, state: 'warn' } },
  monitors: [
    { id: 'cairn-up', name: 'Cairn up', group: 'apps', target: 'cairn', status: 'ok', text: 'Answering in 12 ms', since: null },
    { id: 'orrery-up', name: 'Orrery up', group: 'apps', target: 'orrery', status: 'alert', text: 'Orrery is not answering on :8410 (fetch failed)', since: now },
    { id: 'orrery-errors', name: 'Orrery errors', group: 'apps', target: 'orrery', status: 'warn', text: '6 error lines in the last 15 minutes', since: now },
    { id: 'model-speed', name: 'Model speed', group: 'model', target: 'model', status: 'nodata', text: 'Not timed yet', since: null },
    { id: 'backup-job', name: 'Backup job', group: 'data', target: 'backups', status: 'warn', text: "Last night's backup finished with 1 failure", since: now },
  ],
  alerts: [],
}

const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

const serve = () => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (url === '/api/status') return reply(snapshot)
  if (url.startsWith('/api/events')) return reply([{ id: 1, ts: now, kind: 'deploy', target: 'cairn', severity: 'info', text: 'Cairn deployed c31ab25' }])
  if (url.startsWith('/api/history')) return reply([{ ts: Date.now() - 60_000, value: 10 }, { ts: Date.now() - 1000, value: 12 }])
  if (url === '/api/settings') return reply({ lmStudioUrl: 'http://127.0.0.1:1234', hasToken: true, probeEveryMinutes: 10, probeModel: '', expectModel: '', notifyMac: true, diskFreePct: 10, backupMaxHours: 26, ttftMaxMs: 5000, tpsMin: 10, errorsMax: 5 })
  return reply({})
}))

describe('App', () => {
  it('shows the dashboard: the summary, the triggered monitors, every monitor as a tile, the numbers, the graphs, the tables and the streams', async () => {
    vi.stubGlobal('EventSource', undefined)
    serve()
    render(<App />)
    expect(await screen.findByText('Orrery is not answering on :8410 (fetch failed)', { selector: '.trig-text' })).toBeInTheDocument()
    expect(document.querySelector('.topbar .pill')).toHaveTextContent('Alert')
    // The summary counts: 1 alert, 2 warn, 1 no data, 1 ok.
    const counts = [...document.querySelectorAll('.count-num')].map((el) => el.textContent)
    expect(counts).toEqual(['1', '2', '1', '1'])
    expect(screen.getByRole('status', { name: /Orrery up: Alert/ })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: /Cairn up: OK/ })).toBeInTheDocument()
    expect(screen.getByText('420 ms')).toBeInTheDocument()
    expect(screen.getByText('2', { selector: '.value-num' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Health check latency by app' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cairn' })).toHaveAttribute('href', 'https://studio.ts.net')
    expect(screen.getByText('c31ab25')).toBeInTheDocument()
    expect(screen.getByText('1,200 entries · 3 today')).toBeInTheDocument()
    expect(screen.getByText('Cairn deployed c31ab25')).toBeInTheDocument()
    expect(screen.getByText('[orrery] could not reach astro-mcp')).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('.ts-legend li')).toHaveTextContent('Cairn12 ms'))
  })

  it('remembers the time range chosen', async () => {
    vi.stubGlobal('EventSource', undefined)
    serve()
    render(<App />)
    await screen.findByRole('group', { name: 'Time range' })
    await userEvent.click(screen.getByRole('button', { name: '1w' }))
    expect(screen.getByRole('button', { name: '1w' })).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem('barometer.range')).toBe('168')
  })

  it('says so when the server gives an error', async () => {
    vi.stubGlobal('EventSource', undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'broken' }), { status: 500 })))
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('broken')
  })

  it('judges the overall light from the monitors', () => {
    expect(overallStatus(null)).toBe('nodata')
    expect(overallStatus(snapshot)).toBe('alert')
    expect(overallStatus({ ...snapshot, monitors: snapshot.monitors.filter((m) => m.status !== 'alert') })).toBe('warn')
    expect(overallStatus({ ...snapshot, monitors: [snapshot.monitors[0]!] })).toBe('ok')
  })
})
