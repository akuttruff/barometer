import { useEffect, useState } from 'react'
import { RefreshCw, Settings as SettingsIcon } from 'lucide-react'
import Graphs from './components/Graphs.tsx'
import { MonitorGrid, MonitorSummary, STATUS_WORD, Triggered } from './components/Monitors.tsx'
import Settings from './components/Settings.tsx'
import { EventStream, RecentErrors } from './components/Streams.tsx'
import { AppsTable, DataTable } from './components/Tables.tsx'
import Unreachable from './components/Unreachable.tsx'
import Values from './components/Values.tsx'
import { api } from './lib/api.ts'
import { ago } from './lib/format.ts'
import { useBoard } from './lib/useBoard.ts'
import type { MonitorStatus, Settings as SettingsType, Snapshot } from './types.ts'

/** The windows the graphs can show. */
export const RANGES: { label: string; hours: number }[] = [{ label: '1h', hours: 1 }, { label: '6h', hours: 6 }, { label: '1d', hours: 24 }, { label: '1w', hours: 168 }]

/** The worst status across the monitors: the light in the title. */
export function overallStatus(s: Snapshot | null): MonitorStatus {
  if (!s) return 'nodata'
  const all = s.monitors.map((m) => m.status)
  if (all.includes('alert')) return 'alert'
  if (all.includes('warn')) return 'warn'
  return all.length && all.every((x) => x === 'nodata') ? 'nodata' : 'ok'
}

const readRange = (): number => { try { return Number(localStorage.getItem('barometer.range')) || 6 } catch { return 6 } }

export default function App() {
  const board = useBoard()
  const [settings, setSettings] = useState<SettingsType | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [hours, setHoursState] = useState(readRange)
  const setHours = (h: number) => { setHoursState(h); try { localStorage.setItem('barometer.range', String(h)) } catch { /* a preference */ } }
  // The "ago" words tick over on their own.
  const [, setNow] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 10_000)
    return () => window.clearInterval(t)
  }, [])
  useEffect(() => { api.settings().then(setSettings).catch(() => { /* fetched again when the sheet opens */ }) }, [])

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    await board.refresh()
    setRefreshing(false)
  }

  const s = board.snapshot
  const status = overallStatus(s)

  return (
    <div className="app">
      <Unreachable onBack={board.reload} />
      <header className="topbar">
        <div className="topbar-title">
          <h1>Barometer</h1>
          <span className={`pill pill-${status}`}>{STATUS_WORD[status]}</span>
          <span className="topbar-sub">{s ? `updated ${ago(s.ts)}` : 'loading'}{board.live ? ' · live' : s ? ' · polling' : ''}</span>
        </div>
        <div className="topbar-tools">
          <div className="range" role="group" aria-label="Time range">
            {RANGES.map((r) => <button key={r.hours} type="button" className={hours === r.hours ? 'on' : ''} aria-pressed={hours === r.hours} onClick={() => setHours(r.hours)}>{r.label}</button>)}
          </div>
          <button type="button" className={`icon-btn ${refreshing ? 'spinning' : ''}`} aria-label="Look again now" onClick={() => void refresh()}><RefreshCw size={18} aria-hidden="true" /></button>
          <button type="button" className="icon-btn" aria-label="Settings" onClick={() => setSettingsOpen(true)}><SettingsIcon size={18} aria-hidden="true" /></button>
        </div>
      </header>
      <main className="dash">
        {board.error && !s && <p className="error-card" role="alert">{board.error}</p>}
        {s && (
          <>
            <MonitorSummary monitors={s.monitors} />
            <Triggered monitors={s.monitors} />
            <MonitorGrid monitors={s.monitors} />
            <Values snapshot={s} />
            <Graphs snapshot={s} hours={hours} />
            <AppsTable apps={s.apps} services={s.services} model={s.model} />
            <DataTable data={s.data} />
            <EventStream events={board.events} />
            <RecentErrors apps={s.apps} />
          </>
        )}
      </main>
      {settingsOpen && settings && (
        <Settings settings={settings} loaded={s?.model.loaded ?? []} onSaved={(next) => { setSettings(next); setSettingsOpen(false); void refresh() }} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  )
}
