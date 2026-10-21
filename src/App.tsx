import { useEffect, useState } from 'react'
import { RefreshCw, Settings as SettingsIcon } from 'lucide-react'
import Apps from './components/Apps.tsx'
import DataCard from './components/DataCard.tsx'
import Dot from './components/Dot.tsx'
import HostCard from './components/HostCard.tsx'
import ModelCard from './components/ModelCard.tsx'
import Settings from './components/Settings.tsx'
import Timeline, { Alerts } from './components/Timeline.tsx'
import Unreachable from './components/Unreachable.tsx'
import { api } from './lib/api.ts'
import { ago } from './lib/format.ts'
import { useBoard } from './lib/useBoard.ts'
import { overall } from './types.ts'
import type { Settings as SettingsType } from './types.ts'

const WORD = { ok: 'All fine', warn: 'Needs a look', down: 'Something is down', unknown: 'Looking…' }

export default function App() {
  const board = useBoard()
  const [settings, setSettings] = useState<SettingsType | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  // The "ago" words tick over on their own.
  const [, setNow] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 10_000)
    return () => window.clearInterval(t)
  }, [])
  useEffect(() => { api.settings().then(setSettings).catch(() => { /* the sheet fetches again when opened */ }) }, [])

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    await board.refresh()
    setRefreshing(false)
  }

  const s = board.snapshot
  const state = s ? overall(s) : 'unknown'

  return (
    <div className="app">
      <Unreachable onBack={board.reload} />
      <header className="app-header">
        <div className="app-header-side">
          <button type="button" className={`icon-btn ${refreshing ? 'spinning' : ''}`} aria-label="Look again now" onClick={() => void refresh()}><RefreshCw size={20} aria-hidden="true" /></button>
        </div>
        <div className="app-title">
          <h1><Dot state={state} size={12} /> Barometer</h1>
          <span className="app-sub">{WORD[state]}{s ? ` · ${ago(s.ts)}` : ''}{board.live ? '' : s ? ' · polling' : ''}</span>
        </div>
        <div className="app-header-side end">
          <button type="button" className="icon-btn" aria-label="Settings" onClick={() => setSettingsOpen(true)}><SettingsIcon size={20} aria-hidden="true" /></button>
        </div>
      </header>
      <main className="scroll">
        {board.error && !s && <p className="error-card" role="alert">{board.error}</p>}
        {s && (
          <>
            <Alerts alerts={s.alerts} />
            <Apps apps={s.apps} services={s.services} ts={s.ts} />
            <ModelCard model={s.model} />
            <HostCard host={s.host} />
            <DataCard data={s.data} />
            <Timeline events={board.events} />
          </>
        )}
      </main>
      {settingsOpen && settings && (
        <Settings settings={settings} loaded={s?.model.loaded ?? []} onSaved={(next) => { setSettings(next); setSettingsOpen(false); void refresh() }} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  )
}
