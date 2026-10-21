import { ago, bytes } from '../lib/format.ts'
import type { DataStatus, State } from '../types.ts'
import Dot from './Dot.tsx'

/** Each database: how big, how busy, whether it checks out, and when it was last copied. */
export default function DataCard({ data }: { data: DataStatus }) {
  const log = data.backupLog
  return (
    <section className="card">
      <h2 className="section-title">Data <span className="section-note">backups {log.lastRun ? `ran ${ago(log.lastRun)}` : 'never seen'}{log.failures ? `, ${log.failures} failed` : ''}</span></h2>
      <ul className="rows">
        {data.files.map((f) => {
          const state: State = f.check === 'bad' ? 'down' : f.backup.state === 'ok' && f.bytes !== null ? 'ok' : f.backup.state === 'unknown' && f.bytes !== null ? 'warn' : f.bytes === null ? 'down' : 'warn'
          return (
            <li key={f.id} className="row">
              <div className="row-main">
                <Dot state={state} />
                <span className="row-name">{f.name}</span>
                <span className="row-detail mono">{f.file}</span>
                <span className="row-fill" />
                <span className="row-num">{bytes(f.bytes)}</span>
              </div>
              <div className="row-sub">
                {Object.entries(f.counts).map(([k, n]) => <span key={k}>{n.toLocaleString()} {k}</span>)}
                {f.lastWrite && <span>written {ago(f.lastWrite)}</span>}
                <span className={f.backup.state === 'ok' ? '' : 'error'}>{f.backup.newest ? `backup ${f.backup.newest}` : 'no backup'}</span>
                {f.check === 'bad' && <span className="error">failed its check</span>}
              </div>
              {f.error && <div className="row-sub"><span className="error">{f.error}</span></div>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
