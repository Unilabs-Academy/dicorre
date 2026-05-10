import tailwindcss from '@tailwindcss/vite'
import crypto from 'node:crypto'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

if (!('hash' in crypto)) {
  Object.defineProperty(crypto, 'hash', {
    value: (algorithm: string, data: crypto.BinaryLike) =>
      crypto.createHash(algorithm).update(data).digest('hex'),
  })
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  build: {
    // Use esnext to support import.meta.url in production
    target: 'esnext',
    // Ensure workers are built as separate chunks
    rollupOptions: {
      output: {
        format: 'es',
        // Ensure workers get their own chunks
        manualChunks(id) {
          if (id.includes('worker')) {
            return 'worker'
          }
        }
      }
    }
  },
  worker: {
    format: 'es',
    plugins: () => [
      // Ensure workers can use the same module resolution
    ],
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js'
      }
    }
  },
  server: {
    proxy: {
      // Proxy Orthanc API requests to avoid CORS issues
      '/api/orthanc': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/orthanc/, ''),
        secure: false,
      }
    }
  }
})
