import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const BACKEND_URL = 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Allow reaching the dev server via the spaceempire.local hostname
    // (add "127.0.0.1 spaceempire.local" to /etc/hosts). Vite 8 otherwise
    // rejects any Host header that isn't localhost/127.0.0.1 with
    // "Blocked request. This host is not allowed." Same pattern as Yasen's
    // *.yasen.local dev hostnames.
    allowedHosts: ['spaceempire.local'],
    // When served behind the Apache reverse proxy on spaceempire.local:80, the
    // HMR client must connect back on port 80 (Apache tunnels the ws to Vite),
    // not on 5173. Gated on VITE_BEHIND_PROXY so a plain `npm run dev` reached
    // directly on :5173 keeps its normal HMR. Start proxied dev with:
    //   VITE_BEHIND_PROXY=1 npm run dev
    hmr: process.env.VITE_BEHIND_PROXY ? { clientPort: 80 } : undefined,
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
      '/ws': {
        target: BACKEND_URL,
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
