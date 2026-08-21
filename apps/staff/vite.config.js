import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  root: dirname,
  envDir: path.resolve(dirname, '../..'),
  publicDir: path.resolve(dirname, '../../public'),
  resolve: {
    alias: { '@shared': path.resolve(dirname, '../../packages/shared/src') },
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: path.resolve(dirname, '../../dist/staff'),
    emptyOutDir: true,
  },
})
