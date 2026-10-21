import type { State } from '../types.ts'

const WORD: Record<State, string> = { ok: 'fine', warn: 'needs a look', down: 'down', unknown: 'not known yet' }

/** The light beside a name. */
export default function Dot({ state, size = 10 }: { state: State; size?: number }) {
  return <span className={`dot dot-${state}`} style={{ width: size, height: size }} role="img" aria-label={WORD[state]} />
}
