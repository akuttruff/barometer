import { noReply, reachFetch } from './reach.ts'
import type { Alert, Event, Sample, Settings, Snapshot } from '../types.ts'

/** The server, from the page. Every call throws with the server's message on failure, or a plain one when it gave no reply (see lib/reach.ts). */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response
  try {
    r = await reachFetch(url, init)
  } catch (err) {
    if (!noReply(err)) throw err
    throw new Error("Can't reach Barometer. Check that Tailscale is connected, then try again.")
  }
  const body = await r.json().catch(() => ({})) as T & { error?: string }
  if (!r.ok) throw new Error(body.error || `${r.status} from ${url}`)
  return body
}

const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  status: () => request<Snapshot>('/api/status'),
  tick: () => request<Snapshot>('/api/tick', { method: 'POST' }),
  history: (target: string, metric: string, hours: number) => request<Sample[]>(`/api/history?target=${encodeURIComponent(target)}&metric=${encodeURIComponent(metric)}&hours=${hours}`),
  events: (limit = 60) => request<Event[]>(`/api/events?limit=${limit}`),
  alerts: () => request<Alert[]>('/api/alerts'),
  settings: () => request<Settings>('/api/settings'),
  saveSettings: (patch: Record<string, unknown>) => request<Settings>('/api/settings', jsonInit('PUT', patch)),
  pushKey: () => request<{ key: string }>('/api/push/key'),
  subscribePush: (sub: unknown) => request<{ ok: boolean }>('/api/push', jsonInit('POST', sub)),
  unsubscribePush: (endpoint: string) => request<{ ok: boolean }>('/api/push', jsonInit('DELETE', { endpoint })),
  testPush: () => request<{ ok: boolean; subscriptions: number }>('/api/push/test', { method: 'POST' }),
}
