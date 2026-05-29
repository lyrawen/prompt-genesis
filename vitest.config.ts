import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.{ts,js}', 'server/**/__tests__/**/*.test.{ts,js}'],
  },
})
