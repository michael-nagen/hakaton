import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A FIXED dev/preview port keeps the browser origin stable (http://localhost:5199).
// WebLLM caches the downloaded on-device model per origin, so a stable port means
// the model is downloaded once and reused across runs instead of re-downloading.
// strictPort makes Vite fail loudly if 5199 is taken rather than silently switch
// ports (which would change the origin and invalidate the cached model).
export default defineConfig({
  plugins: [react()],
  server: { port: 5199, strictPort: true },
  preview: { port: 5199, strictPort: true },
})
