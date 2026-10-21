import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import api from './server/api.ts'

// Any name on the tailnet, not one machine's: `tailscale serve` is what
// actually limits who can reach this, so a rename shouldn't break it.
const TAILNET = '.ts.net'

export default defineConfig(({ command, isPreview }) => {
  // `vite preview` is the one real instance (local and, via Tailscale,
  // remote): it keeps the samples and sends the alerts. `vite dev` watches
  // the same services but keeps its own scratch database and never probes
  // the model or notifies, so trying something out disturbs nothing.
  const real = command === 'build' || isPreview
  const dir = real ? undefined : path.resolve(process.cwd(), '.data-dev')

  return {
    plugins: [react(), api({ dir, quiet: !real })],
    server: {
      host: true,
      port: 8500,
      strictPort: true,
      allowedHosts: [TAILNET],
      watch: { ignored: ['**/coverage/**', '**/.data/**', '**/.data-dev/**'] },
    },
    // A separate port from `server` above: the persistent, built instance
    // Tailscale points at, so it can run alongside `npm run dev`.
    preview: { host: true, port: 8510, strictPort: true, allowedHosts: [TAILNET] },
  }
})
