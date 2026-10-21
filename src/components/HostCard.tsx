import { useHistory } from '../lib/useBoard.ts'
import { bytes, duration, pct } from '../lib/format.ts'
import type { HostStatus, State } from '../types.ts'
import Dot from './Dot.tsx'
import Sparkline from './Sparkline.tsx'

const PRESSURE: Record<HostStatus['pressure'], { state: State; word: string }> = {
  normal: { state: 'ok', word: 'normal' }, warning: { state: 'warn', word: 'high' }, critical: { state: 'down', word: 'critical' }, unknown: { state: 'unknown', word: 'not known' },
}

const ROUTE: Record<string, string> = { en0: 'Ethernet', en1: 'Wi-Fi' }

/** The Mac itself: memory, disk, load, heat, and Tailscale. */
export default function HostCard({ host }: { host: HostStatus }) {
  const wired = useHistory('host', 'wired', 6, 5 * 60_000)
  const pressure = PRESSURE[host.pressure]
  const ts = host.tailscale
  return (
    <section className="card">
      <h2 className="section-title">Mac <span className="section-note">up {duration(host.uptimeSeconds)}</span></h2>
      <ul className="rows">
        <li className="row">
          <div className="row-main">
            <Dot state={pressure.state} />
            <span className="row-name">Memory</span>
            <span className="row-detail">pressure {pressure.word}</span>
            <span className="row-fill" />
            <span className="row-num">{bytes(host.wiredBytes)} wired</span>
            <Sparkline points={wired} label="Wired memory, last 6 hours" />
          </div>
          <div className="row-sub"><span>{bytes(host.freeBytes)} free of {bytes(host.memoryBytes)}</span></div>
        </li>
        <li className="row">
          <div className="row-main">
            <Dot state={host.diskFreeBytes !== null && host.diskTotalBytes !== null && host.diskFreeBytes / host.diskTotalBytes < 0.1 ? 'warn' : 'ok'} />
            <span className="row-name">Disk</span>
            <span className="row-fill" />
            <span className="row-num">{bytes(host.diskFreeBytes)} free · {pct(host.diskFreeBytes, host.diskTotalBytes)}</span>
          </div>
        </li>
        <li className="row">
          <div className="row-main">
            <Dot state={host.thermal === 'warning' ? 'warn' : host.thermal === 'ok' ? 'ok' : 'unknown'} />
            <span className="row-name">CPU</span>
            <span className="row-detail">{host.thermal === 'warning' ? 'throttled by heat' : 'cool'}</span>
            <span className="row-fill" />
            <span className="row-num">load {host.load.map((l) => l.toFixed(1)).join(' · ')}</span>
          </div>
        </li>
        <li className="row">
          <div className="row-main">
            <Dot state={ts.state} />
            <span className="row-name">Tailscale</span>
            <span className="row-detail">{ts.backend ?? 'not found'}{ts.online ? '' : ', offline'}</span>
            <span className="row-fill" />
            <span className="row-num">{ts.peersOnline} of {ts.peers} devices online</span>
          </div>
          <div className="row-sub">
            {ts.hostName && <span>{ts.hostName}</span>}
            {host.routeInterface && <span>via {ROUTE[host.routeInterface] ?? host.routeInterface}</span>}
          </div>
        </li>
      </ul>
    </section>
  )
}
