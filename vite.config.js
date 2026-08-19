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
})
