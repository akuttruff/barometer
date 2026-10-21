import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import TimeSeries from './TimeSeries'

describe('TimeSeries', () => {
  it('draws a line per series with axes, a legend with the latest values, and the values under the pointer', () => {
    const now = Date.now()
    const a = [{ ts: now - 3000_000, value: 10 }, { ts: now - 2000_000, value: 30 }, { ts: now - 1000, value: 20 }]
    const b = [{ ts: now - 3000_000, value: 5 }, { ts: now - 1000, value: 7 }]
    const { container } = render(<TimeSeries series={[{ name: 'Cairn', points: a, color: '#000' }, { name: 'Orrery', points: b, color: '#111' }]} unit=" ms" hours={1} label="Latency" />)
    expect(screen.getByRole('img', { name: 'Latency' })).toBeInTheDocument()
    expect(container.querySelectorAll('path').length).toBe(2)
    expect(container.querySelectorAll('.ts-tick').length).toBeGreaterThan(3)
    const legend = [...container.querySelectorAll('.ts-legend li')].map((li) => li.textContent)
    expect(legend).toEqual(['Cairn20 ms', 'Orrery7 ms'])
    const svg = container.querySelector('svg')!
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 170, right: 600, bottom: 170, x: 0, y: 0, toJSON: () => ({}) })
    fireEvent.pointerMove(svg, { clientX: 60, clientY: 50 })
    expect(container.querySelector('.ts-cursor')).toBeInTheDocument()
    expect(container.querySelector('.ts-legend-time')).toBeInTheDocument()
    fireEvent.pointerLeave(svg)
    expect(container.querySelector('.ts-cursor')).not.toBeInTheDocument()
  })

  it('says when there is nothing yet', () => {
    render(<TimeSeries series={[{ name: 'Load', points: [], color: '#000' }]} hours={6} label="Load" />)
    expect(screen.getByText('No data yet')).toBeInTheDocument()
  })
})
