import { ago, bytes, context, duration, ms } from '../lib/format.ts'
import type { AppStatus, DataStatus, ModelStatus, MonitorStatus, ServiceStatus, State } from '../types.ts'
import { StatusPill } from './Monitors.tsx'
import Widget from './Widget.tsx'

const asStatus = (s: State): MonitorStatus => (s === 'down' ? 'alert' : s === 'warn' ? 'warn' : s === 'unknown' ? 'nodata' : 'ok')

/** The apps and services, a row each, with what their health route said. */
export function AppsTable({ apps, services, model }: { apps: AppStatus[]; services: ServiceStatus[]; model: ModelStatus }) {
  return (
    <Widget title="Services" note={`${apps.length + services.length + 1}`} className="table-widget">
      <div className="table-scroll">
        <table className="table">
          <thead><tr><th>Service</th><th>Status</th><th>Version</th><th>Up</th><th>Latency</th><th>In flight</th><th>Depends on</th><th>Starts</th><th>Errors 15 m</th></tr></thead>
          <tbody>
            {apps.map((a) => {
              const h = a.health
              return (
                <tr key={a.id} className={`tr-${a.state}`}>
                  <td><a href={a.url} target="_blank" rel="noopener noreferrer">{a.name}</a><span className="td-sub">:{a.port}</span></td>
                  <td><StatusPill status={asStatus(a.state)} />{a.error && <span className="td-err">{a.error}</span>}</td>
                  <td className="mono">{h?.version ?? '—'}</td>
                  <td>{h ? duration(h.uptimeSeconds) : '—'}</td>
                  <td className="num">{ms(a.latencyMs)}</td>
                  <td className="num">{h ? Object.entries(h.busy).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ') || '0' : '—'}</td>
                  <td>{h ? Object.entries(h.deps).map(([d, s]) => <span key={d} className={`dep dep-${s}`}>{d}</span>) : '—'}</td>
                  <td className="num">{a.launchd?.runs ?? '—'}</td>
                  <td className={`num ${a.errors.last15m ? 'warn-text' : ''}`}>{a.errors.last15m}</td>
                </tr>
              )
            })}
            {services.map((s) => (
              <tr key={s.id} className={`tr-${s.state}`}>
                <td>{s.name}</td>
                <td><StatusPill status={asStatus(s.state)} />{s.error && <span className="td-err">{s.error}</span>}</td>
                <td colSpan={2} className="dim">{s.detail ?? ''}</td>
                <td className="num">{ms(s.latencyMs)}</td>
                <td colSpan={2} />
                <td className="num">{s.launchd?.runs ?? '—'}</td>
                <td />
              </tr>
            ))}
            <tr className={`tr-${model.state}`}>
              <td>LM Studio<span className="td-sub">{model.url.replace(/^https?:\/\//, '')}</span></td>
              <td><StatusPill status={asStatus(model.state)} />{model.error && <span className="td-err">{model.error}</span>}</td>
              <td colSpan={5} className="dim">{model.loaded.length ? model.loaded.map((m) => <span key={m.id} className="loaded"><span className="mono">{m.id}</span>{m.contextLength !== null && <span className="td-sub">{context(m.contextLength)} ctx</span>}</span>) : 'nothing loaded'}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>
    </Widget>
  )
}

/** Each database: size, counts, its check, and its newest backup. */
export function DataTable({ data }: { data: DataStatus }) {
  const log = data.backupLog
  return (
    <Widget title="Data" note={log.lastRun ? `backup job ran ${ago(log.lastRun)}${log.failures ? `, ${log.failures} failed` : ''}` : 'backup job not seen'} className="table-widget">
      <div className="table-scroll">
        <table className="table">
          <thead><tr><th>Database</th><th>Size</th><th>Rows</th><th>Written</th><th>Check</th><th>Newest backup</th></tr></thead>
          <tbody>
            {data.files.map((f) => (
              <tr key={f.id}>
                <td>{f.name}<span className="td-sub mono">{f.file}</span></td>
                <td className="num">{bytes(f.bytes)}</td>
                <td>{Object.entries(f.counts).map(([k, n]) => `${n.toLocaleString()} ${k}`).join(' · ') || '—'}</td>
                <td>{f.lastWrite ? ago(f.lastWrite) : '—'}</td>
                <td><StatusPill status={f.check === 'ok' ? 'ok' : f.check === 'bad' ? 'alert' : 'nodata'} /></td>
                <td>
                  <StatusPill status={f.backup.state === 'ok' ? 'ok' : f.backup.state === 'unknown' ? 'nodata' : 'warn'} />
                  <span className="td-sub">{f.backup.newest ?? 'none'}{f.backup.ageHours !== null ? ` · ${Math.round(f.backup.ageHours)} h` : ''}</span>
                  {f.error && <span className="td-err">{f.error}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Widget>
  )
}
