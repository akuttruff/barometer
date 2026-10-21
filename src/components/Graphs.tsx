import { useHistories } from '../lib/useBoard.ts'
import type { Snapshot } from '../types.ts'
import TimeSeries, { PALETTE } from './TimeSeries.tsx'
import Widget from './Widget.tsx'

const GB = (v: number): string => `${(v / 1e9).toFixed(v >= 10e9 ? 0 : 1)}`

/** The graphs: what the numbers have been doing over the chosen window. */
export default function Graphs({ snapshot, hours }: { snapshot: Snapshot; hours: number }) {
  const apps = snapshot.apps
  const latency = useHistories(apps.map((a) => ({ target: a.id, metric: 'latency' })), hours)
  const errors = useHistories(apps.map((a) => ({ target: a.id, metric: 'errors' })), hours)
  const memory = useHistories([{ target: 'host', metric: 'wired' }, { target: 'host', metric: 'free' }], hours)
  const ttft = useHistories([{ target: 'model', metric: 'ttft' }], hours)
  const tps = useHistories([{ target: 'model', metric: 'tps' }], hours)
  const load = useHistories([{ target: 'host', metric: 'load' }], hours)
  const disk = useHistories([{ target: 'host', metric: 'diskFree' }], hours)

  const perApp = (points: ReturnType<typeof useHistories>) => apps.map((a, i) => ({ name: a.name, points: points[i] ?? [], color: PALETTE[i % PALETTE.length]! }))

  return (
    <>
      <Widget title="Health check latency" note="ms" span={6}>
        <TimeSeries series={perApp(latency)} unit=" ms" hours={hours} label="Health check latency by app" />
      </Widget>
      <Widget title="Errors logged" note="lines per round" span={6}>
        <TimeSeries series={perApp(errors)} hours={hours} label="Error lines logged by app" />
      </Widget>
      <Widget title="Memory" note="GB" span={6}>
        <TimeSeries series={[{ name: 'Wired', points: memory[0] ?? [], color: PALETTE[0]! }, { name: 'Free', points: memory[1] ?? [], color: PALETTE[2]! }]} format={GB} unit=" GB" hours={hours} label="Wired and free memory" />
      </Widget>
      <Widget title="Model: time to first token" note="ms" span={6}>
        <TimeSeries series={[{ name: 'First token', points: ttft[0] ?? [], color: PALETTE[1]! }]} unit=" ms" hours={hours} label="Time to first token" />
      </Widget>
      <Widget title="Model: tokens a second" span={4}>
        <TimeSeries series={[{ name: 'Tokens / s', points: tps[0] ?? [], color: PALETTE[3]! }]} hours={hours} label="Tokens a second" height={140} />
      </Widget>
      <Widget title="Load average" note="1 min" span={4}>
        <TimeSeries series={[{ name: 'Load', points: load[0] ?? [], color: PALETTE[4]! }]} hours={hours} label="Load average" height={140} />
      </Widget>
      <Widget title="Disk free" note="GB" span={4}>
        <TimeSeries series={[{ name: 'Free', points: disk[0] ?? [], color: PALETTE[5]! }]} format={GB} unit=" GB" hours={hours} label="Disk free" height={140} fromZero={false} />
      </Widget>
    </>
  )
}
