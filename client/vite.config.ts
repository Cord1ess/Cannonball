import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
      '@vendor': fileURLToPath(new URL('../vendor/arc', import.meta.url)),
    },
  },
  server: {
    fs: { allow: ['..'] },
  },
})
