import fs from 'node:fs'
import path from 'node:path'
import { seedDemo } from '../server/demo.ts'
import { Store } from '../server/store.ts'

/**
 * Fills .data-demo with six hours of a made-up bad afternoon (server/demo.ts)
 * for `npm run dev:demo`, which the README's screenshots are taken from. It
 * starts from an empty database every time and reads nothing real.
 */
const dir = path.resolve(process.cwd(), '.data-demo')
fs.rmSync(dir, { recursive: true, force: true })
const store = new Store(dir)
seedDemo(store)
store.close()
console.log(`seeded ${dir}`)
