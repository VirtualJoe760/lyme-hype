import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          secure: resolve(__dirname, 'src/preload/secure.ts')
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    // Honour an assigned PORT so the dev server is findable when 5173 is taken by
    // another project; main reads ELECTRON_RENDERER_URL, so no port is hardcoded.
    server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : undefined,
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          secure: resolve(__dirname, 'src/renderer/secure.html')
        }
      }
    }
  }
})
