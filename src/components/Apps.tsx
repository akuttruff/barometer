import { useHistory } from '../lib/useBoard.ts'
import { ago, duration, ms } from '../lib/format.ts'
import type { AppStatus, ServiceStatus } from '../types.ts'
import Dot from './Dot.tsx'
import Sparkline from './Sparkline.tsx'

function AppRow({ app }: { app: AppStatus }) {
  const latency = useHistory(app.id, 'latency', 3)
  const h = app.health
  const deps = Object.entries(h?.deps ?? {})
  return (
    <li className={`row app-row state-${app.state}`}>
      <div className="row-main">
        <Dot state={app.state} />
        <a className="row-name" href={app.url} target="_blank" rel="noopener noreferrer">{app.name}</a>
        {h && <span className="chip mono" title="The commit deployed">{h.version}</span>}
        <span className="row-fill" />
        <span className="row-num" title="How long the health route took">{ms(app.latencyMs)}</span>
        <Sparkline points={latency} label={`${app.name} latency, last 3 hours`} />
      </div>
      <div className="row-sub">
        {h ? (
          <>
            <span>up {duration(h.uptimeSeconds)}</span>
            {app.busyTotal > 0 && <span className="busy">{Object.entries(h.busy).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ')} in flight</span>}
            {deps.map(([name, state]) => <span key={name} className={`chip dep-${state}`}>{name}</span>)}
            {app.launchd?.runs !== null && app.launchd?.runs !== undefined && app.launchd.runs > 1 && <span title="Starts since launchd loaded it">{app.launchd.runs} starts</span>}
          </>
        ) : (
          <span className="error">{app.error ?? 'No answer'}{app.launchd?.pid ? ` · launchd pid ${app.launchd.pid}` : ' · not running under launchd'}</span>
        )}
        {h && app.error && <span className="error">{app.error}</span>}
      </div>
    </li>
  )
}

function ServiceRow({ svc }: { svc: ServiceStatus }) {
  return (
    <li className={`row state-${svc.state}`}>
      <div className="row-main">
        <Dot state={svc.state} />
        <span className="row-name">{svc.name}</span>
        {svc.detail && <span className="row-detail">{svc.detail}</span>}
        <span className="row-fill" />
        <span className="row-num">{ms(svc.latencyMs)}</span>
      </div>
      {svc.error && <div className="row-sub"><span className="error">{svc.error}</span></div>}
    </li>
  )
}

/** The four apps and the two services beside them, a row each. */
export default function Apps({ apps, services, ts }: { apps: AppStatus[]; services: ServiceStatus[]; ts: string }) {
  return (
    <section className="card">
      <h2 className="section-title">Apps <span className="section-note">looked at {ago(ts)}</span></h2>
      <ul className="rows">
        {apps.map((a) => <AppRow key={a.id} app={a} />)}
        {services.map((s) => <ServiceRow key={s.id} svc={s} />)}
      </ul>
    </section>
  )
}
