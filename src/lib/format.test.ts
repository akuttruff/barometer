import { describe, expect, it } from 'vitest'
import { ago, bytes, context, duration, ms, pct, when } from './format.ts'

describe('format', () => {
  const now = Date.parse('2026-10-21T12:00:00.000Z')

  it('says how long ago', () => {
    expect(ago(null)).toBe('never')
    expect(ago('2026-10-21T11:59:58.000Z', now)).toBe('just now')
    expect(ago('2026-10-21T11:59:30.000Z', now)).toBe('30 s ago')
    expect(ago('2026-10-21T11:45:00.000Z', now)).toBe('15 min ago')
    expect(ago('2026-10-21T04:00:00.000Z', now)).toBe('8 h ago')
    expect(ago('2026-10-17T12:00:00.000Z', now)).toBe('4 d ago')
  })

  it('says how long, how big, how much and how fast', () => {
    expect(duration(45)).toBe('45 s')
    expect(duration(600)).toBe('10 min')
    expect(duration(3 * 3600 + 120)).toBe('3 h 2 min')
    expect(duration(8 * 86400 + 9 * 3600)).toBe('8 d 9 h')
    expect(bytes(null)).toBe('—')
    expect(bytes(512)).toBe('512 B')
    expect(bytes(700_416)).toBe('700 kB')
    expect(bytes(2_150_400)).toBe('2.2 MB')
    expect(bytes(31e9)).toBe('31.0 GB')
    expect(pct(500e9, 1000e9)).toBe('50%')
    expect(pct(null, 1)).toBe('—')
    expect(ms(12)).toBe('12 ms')
    expect(ms(1500)).toBe('1.5 s')
    expect(context(131072)).toBe('128k')
    expect(context(null)).toBe('')
  })

  it('shows a time today and a date before', () => {
    expect(when(new Date(now).toISOString(), now)).toMatch(/^\d{1,2}:\d{2}/)
    expect(when('2026-10-19T09:30:00.000Z', now)).toMatch(/^Oct 19 /)
  })
})
