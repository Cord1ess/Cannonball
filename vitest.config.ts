import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['vendor/**/*.test.ts', 'shared/**/*.test.ts'],
  },
})
