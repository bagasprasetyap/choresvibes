import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/anthropic': { // Any request to /api/anthropic will be proxied
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/anthropic/, ''), // Remove /api/anthropic prefix
        configure: (proxy, options) => {
          // You might need to configure headers here if the API expects them
          // But the API key should still ideally be added by a backend for security in prod
        }
      }
    }
  }
})
