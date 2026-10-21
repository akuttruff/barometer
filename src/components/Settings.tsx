import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../lib/api.ts'
import { disablePush, enablePush, pushState } from '../lib/push.ts'
import type { PushState } from '../lib/push.ts'
import type { LoadedModel, Settings as SettingsType } from '../types.ts'

interface Props {
  settings: SettingsType
  loaded: LoadedModel[]
  onSaved: (s: SettingsType) => void
  onClose: () => void
}

const PUSH_WORD: Record<PushState, string> = { unsupported: 'Not possible in this browser', denied: 'Blocked in this browser\'s settings', on: 'On for this device', off: 'Off for this device' }

/** Where the model server is, how often to time it, what to warn about, and which devices to tell. */
export default function Settings({ settings, loaded, onSaved, onClose }: Props) {
  const [s, setS] = useState(settings)
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [push, setPush] = useState<PushState>('off')
  const [pushBusy, setPushBusy] = useState(false)
  const [tested, setTested] = useState<string | null>(null)

  useEffect(() => { void pushState().then(setPush) }, [])

  const set = <K extends keyof SettingsType>(key: K, value: SettingsType[K]) => setS((cur) => ({ ...cur, [key]: value }))
  const num = (key: keyof SettingsType) => (e: React.ChangeEvent<HTMLInputElement>) => set(key, Number(e.target.value) as never)

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const { hasToken: _h, ...patch } = s
      const next = await api.saveSettings(token ? { ...patch, apiToken: token } : patch)
      onSaved(next)
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  const togglePush = async (): Promise<void> => {
    setPushBusy(true)
    setError(null)
    try { setPush(await (push === 'on' ? disablePush() : enablePush())) } catch (e) { setError((e as Error).message) }
    setPushBusy(false)
  }

  const test = async (): Promise<void> => {
    setTested(null)
    try {
      const r = await api.testPush()
      setTested(r.subscriptions === 0 ? 'Sent to the Mac. No phone is signed up yet.' : `Sent to the Mac and ${r.subscriptions} device${r.subscriptions === 1 ? '' : 's'}.`)
    } catch (e) { setError((e as Error).message) }
  }

  const models = loaded.map((m) => m.id)
  if (s.probeModel && !models.includes(s.probeModel)) models.push(s.probeModel)

  return (
    <div className="sheet" role="dialog" aria-label="Settings">
      <header className="sheet-head">
        <h2>Settings</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={20} aria-hidden="true" /></button>
      </header>
      <div className="sheet-body">
        <h3 className="section-title">Model server</h3>
        <label className="field">LM Studio URL<input value={s.lmStudioUrl} onChange={(e) => set('lmStudioUrl', e.target.value)} inputMode="url" autoCapitalize="off" /></label>
        <label className="field">API token{s.hasToken ? ' (set; leave blank to keep)' : ''}<input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" /></label>
        <div className="field-row">
          <label className="field">Time the model every<input type="number" min={0} value={s.probeEveryMinutes} onChange={num('probeEveryMinutes')} /> </label>
          <label className="field">Using<select value={s.probeModel} onChange={(e) => set('probeModel', e.target.value)}><option value="">the smallest loaded</option>{models.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
        </div>
        <p className="dim">Minutes between timings; 0 never. A timing is a short completion, sent only while nothing else is being written.</p>
        <label className="field">A model that should always be loaded<input value={s.expectModel} onChange={(e) => set('expectModel', e.target.value)} placeholder="any" autoCapitalize="off" /></label>

        <h3 className="section-title">Warn when</h3>
        <div className="field-row">
          <label className="field">Disk free below, %<input type="number" min={0} max={100} value={s.diskFreePct} onChange={num('diskFreePct')} /></label>
          <label className="field">Backup older than, hours<input type="number" min={1} value={s.backupMaxHours} onChange={num('backupMaxHours')} /></label>
        </div>
        <div className="field-row">
          <label className="field">First token slower than, ms<input type="number" min={0} value={s.ttftMaxMs} onChange={num('ttftMaxMs')} /></label>
          <label className="field">Fewer tokens / s than<input type="number" min={0} value={s.tpsMin} onChange={num('tpsMin')} /></label>
        </div>

        <h3 className="section-title">Tell me</h3>
        <label className="field check"><input type="checkbox" checked={s.notifyMac} onChange={(e) => set('notifyMac', e.target.checked)} /> With a notification on the Mac</label>
        <div className="push">
          <span>Push to this device: {PUSH_WORD[push]}</span>
          {(push === 'on' || push === 'off') && <button type="button" className="btn" disabled={pushBusy} onClick={() => void togglePush()}>{push === 'on' ? 'Turn off' : 'Turn on'}</button>}
        </div>
        <p className="dim">On a phone, add Barometer to the home screen first; push only works from there.</p>
        <button type="button" className="btn" onClick={() => void test()}>Send a test</button>
        {tested && <p className="dim">{tested}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <footer className="sheet-foot">
        <button type="button" className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
      </footer>
    </div>
  )
}
