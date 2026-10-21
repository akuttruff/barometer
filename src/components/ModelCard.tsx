import { useHistory } from '../lib/useBoard.ts'
import { ago, context, ms } from '../lib/format.ts'
import type { ModelStatus } from '../types.ts'
import Dot from './Dot.tsx'
import Sparkline from './Sparkline.tsx'

/** LM Studio: what is loaded, and how fast it answered when last timed. */
export default function ModelCard({ model }: { model: ModelStatus }) {
  const ttft = useHistory('model', 'ttft', 24, 5 * 60_000)
  const p = model.probe
  return (
    <section className="card">
      <h2 className="section-title">Model <span className="section-note">{model.available} on disk</span></h2>
      <div className="row-main">
        <Dot state={model.state} />
        <span className="row-name">LM Studio</span>
        <span className="row-detail">{model.url.replace(/^https?:\/\//, '')}</span>
      </div>
      {model.error && <p className="error">{model.error}</p>}
      <ul className="plain">
        {model.loaded.map((m) => (
          <li key={m.id} className="loaded">
            <span className="mono">{m.id}</span>
            {m.contextLength !== null && <span className="chip">{context(m.contextLength)} context</span>}
          </li>
        ))}
        {model.loaded.length === 0 && model.state !== 'down' && <li className="dim">Nothing loaded</li>}
      </ul>
      {p && (
        <div className="probe">
          <div className="stats">
            <div className="stat"><span className="stat-num">{ms(p.ttftMs)}</span><span className="stat-label">to first token</span></div>
            <div className="stat"><span className="stat-num">{p.tokensPerSecond}</span><span className="stat-label">tokens / s</span></div>
            <Sparkline points={ttft} label="Time to first token, last day" width={100} />
          </div>
          <p className="dim">{p.model.replace(/^.*\//, '')}, timed {ago(p.at)}</p>
        </div>
      )}
    </section>
  )
}
