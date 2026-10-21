import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'

/** An element's width, kept current as the window changes, for drawing to the pixel. */
export default function useWidth(ref: RefObject<HTMLElement | null>, fallback = 600): number {
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => { const w = el.getBoundingClientRect().width; if (w > 0) setWidth(w) }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}
