import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.ts'
import { reach } from './reach.ts'
import type { Event, Snapshot } from '../types.ts'

/** How often to ask again when the live stream is not open. */
export const POLL_MS = 60_000
/** The timeline keeps this many recent events on the page. */
const EVENTS_KEPT = 80

export interface Board {
  snapshot: Snapshot | null
  events: Event[]
  error: string | null
  /** Whether the live stream is open; otherwise the page polls. */
  live: boolean
  /** Ask for a round now. */
  refresh: () => Promise<void>
  /** Fetch what a launch could not, when the server is back. */
  reload: () => void
}

/**
 * The board, kept current: the last round at once, then every round and
 * event as the server sends them over its stream. If the stream will not
 * open (an old proxy, a flaky tunnel), the page polls instead.
 */
export function useBoard(): Board {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [events, setEvents] = useState<Event[]>([])
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const [generation, setGeneration] = useState(0)
  const source = useRef<EventSource | null>(null)

  const load = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([api.status(), api.events()])
      setSnapshot(s)
      setEvents(e)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const reload = useCallback(() => setGeneration((g) => g + 1), [])

  useEffect(() => {
    void load()
    if (typeof EventSource === 'undefined') return undefined
    const es = new EventSource('/api/stream')
    source.current = es
    es.addEventListener('snapshot', (e) => { setSnapshot(JSON.parse((e as MessageEvent<string>).data) as Snapshot); setError(null) })
    es.addEventListener('event', (e) => {
      const event = JSON.parse((e as MessageEvent<string>).data) as Event
      setEvents((cur) => (cur.some((x) => x.id === event.id) ? cur : [event, ...cur].slice(0, EVENTS_KEPT)))
    })
    es.onopen = () => setLive(true)
    es.onerror = () => setLive(false)
    return () => { es.close(); source.current = null }
  }, [load, generation])

  // Without the stream, poll; and whenever the page comes back on screen, catch up.
  useEffect(() => {
    const timer = window.setInterval(() => { if (!live && !reach.down) void load() }, POLL_MS)
    const onShow = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onShow)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onShow) }
  }, [live, load])

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await api.tick())
      setEvents(await api.events())
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  return { snapshot, events, error, live, refresh, reload }
}

/** A metric's recent samples for a sparkline, fetched now and then. */
export function useHistory(target: string, metric: string, hours: number, everyMs = 60_000): { ts: number; value: number }[] {
  const [points, setPoints] = useState<{ ts: number; value: number }[]>([])
  useEffect(() => {
    let live = true
    const fetchIt = () => { api.history(target, metric, hours).then((p) => { if (live) setPoints(p) }).catch(() => { /* the line is a convenience */ }) }
    fetchIt()
    const timer = window.setInterval(fetchIt, everyMs)
    return () => { live = false; window.clearInterval(timer) }
  }, [target, metric, hours, everyMs])
  return points
}

/** Several metrics' samples for one graph, fetched together now and then, and again when the window changes. */
export function useHistories(specs: { target: string; metric: string }[], hours: number, everyMs = 60_000): { ts: number; value: number }[][] {
  const [series, setSeries] = useState<{ ts: number; value: number }[][]>([])
  const key = specs.map((s) => `${s.target}/${s.metric}`).join(',')
  useEffect(() => {
    let live = true
    const fetchIt = () => {
      Promise.all(specs.map((s) => api.history(s.target, s.metric, hours).catch(() => [] as { ts: number; value: number }[])))
        .then((all) => { if (live) setSeries(all) })
    }
    fetchIt()
    const timer = window.setInterval(fetchIt, everyMs)
    return () => { live = false; window.clearInterval(timer) }
    // The specs are compared by their key, so a fresh array each render does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hours, everyMs])
  return series
}
