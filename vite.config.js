import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // In `npm run dev`, forward API calls to the local backend so the web app and
  // server share an origin. For the Android build, set VITE_API_BASE instead.
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
  build: {
    // Split the single ~617 KB bundle so the heavy libraries (OCR, maps, React)
    // download in parallel and cache separately from the app code — the app entry
    // (index.html → assets/index-*.js) and dist/ layout are unchanged; only the
    // vendor code is pulled out into its own long-lived chunks.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('tesseract')) return 'ocr'      // Tesseract OCR (heavy)
          if (id.includes('leaflet')) return 'maps'        // Leaflet map tiles
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'react'
          return 'vendor'
        },
      },
    },
  },
})
