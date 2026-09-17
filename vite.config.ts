import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  test: {
    // 规则引擎是纯 TS，不需要 DOM 环境
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
