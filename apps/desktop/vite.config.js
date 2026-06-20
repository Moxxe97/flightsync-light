import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(() => {
  return {
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    // No source maps — Light ships with zero telemetry and no upload target.
    sourcemap: false,
    // Vite 8 / rolldown's default minifier (oxc) mangles React 19's production
    // build and breaks it at runtime in the Android WebView ("Cannot read
    // properties of null (reading 'useState')"). terser is battle-tested with
    // React and produces a working minified bundle.
    minify: 'terser',
  },
  optimizeDeps: {
    // Serve the local workspace package as live source so edits to
    // @flightsync/core hot-reload in dev. Without this Vite pre-bundles it and
    // core changes need a `rm -rf node_modules/.vite` + dev-server restart.
    // Dev-only: optimizeDeps has no effect on the production `vite build`.
    exclude: ['@flightsync/core'],
  },
  // No server.open: this app runs in the Tauri webview (launched via
  // beforeDevCommand). Auto-opening a browser would load a broken context —
  // Tauri APIs, the loopback OAuth flow, and WebKit IndexedDB are all absent
  // outside the native webview.
  }
})
