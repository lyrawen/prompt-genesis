import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { divineApiPlugin } from './vite-plugin-divine-api'

export default defineConfig({
  plugins: [tailwindcss(), divineApiPlugin()],
})
