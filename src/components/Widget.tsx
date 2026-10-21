import type { ReactNode } from 'react'

interface Props {
  title: string
  /** A note beside the title. */
  note?: ReactNode
  /** Columns of twelve on a wide window; a phone gives every widget the full width. */
  span?: 3 | 4 | 6 | 8 | 12
  className?: string
  children: ReactNode
}

/** A tile on the dashboard. */
export default function Widget({ title, note, span = 12, className, children }: Props) {
  return (
    <section className={`widget span-${span} ${className ?? ''}`} aria-label={title}>
      <header className="widget-head">
        <h2>{title}</h2>
        {note && <span className="widget-note">{note}</span>}
      </header>
      <div className="widget-body">{children}</div>
    </section>
  )
}
