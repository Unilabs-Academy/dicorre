import { fileURLToPath } from 'node:url'
import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    exclude: [...configDefaults.exclude, '../../.reference/**'],
    root: fileURLToPath(new URL('./', import.meta.url)),
  },
  resolve: {
    alias: {
      '@dicorre/shared': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
