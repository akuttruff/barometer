import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import api from './server/api.ts'
import { demoProbes } from './server/demo.ts'

// Any name on the tailnet, not one machine's: `tailscale serve` is what
// actually limits who can reach this, so a rename shouldn't break it.
const TAILNET = '.ts.net'

export default defineConfig(({ command, isPreview }) => {
  // `vite preview` is the one real instance (local and, via Tailscale,
  // remote): it keeps the samples and sends the alerts. `vite dev` watches
  // the same services but keeps its own scratch database and never probes
  // the model or notifies, so trying something out disturbs nothing.
  //
  // BAROMETER_DEMO=1 (`npm run dev:demo`) swaps the probes for a made-up bad
  // afternoon (server/demo.ts) on a database `npm run seed:demo` fills, for
  // the README's screenshots.
  const demo = !!process.env.BAROMETER_DEMO
  const real = !demo && (command === 'build' || isPreview)
  const dir = real ? undefined : path.resolve(process.cwd(), demo ? '.data-demo' : '.data-dev')

  return {
    plugins: [react(), api({ dir, quiet: !real, ...(demo ? { collector: { probes: demoProbes(), intervalMs: 2000, modelProbe: false } } : {}) })],
    server: {
      // Loopback only: `tailscale serve` proxies to 127.0.0.1, and nothing on the Wi-Fi should reach the board.
      host: '127.0.0.1',
      port: 8500,
      strictPort: true,
      allowedHosts: [TAILNET],
      watch: { ignored: ['**/coverage/**', '**/.data/**', '**/.data-dev/**', '**/.data-demo/**'] },
    },
    // A separate port from `server` above: the persistent, built instance
    // Tailscale points at, so it can run alongside `npm run dev`.
    preview: { host: '127.0.0.1', port: 8510, strictPort: true, allowedHosts: [TAILNET] },
  }
})
