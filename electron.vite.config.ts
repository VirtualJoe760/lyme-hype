import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

/**
 * Stamped into main at compile time so a running window can say which build it
 * is. Launching `electron .` starts whatever sits in out/, so a window can be
 * hours behind the source with nothing on screen admitting it — that cost a
 * whole debugging session on 2026-08-31.
 */
function buildStamp(): string {
  // Local time, not UTC: a stamp reading 22:16 next to a clock reading 15:16 is
  // exactly the "is this build current?" confusion this is meant to end.
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  const when = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
    return `${when} · ${sha}`
  } catch {
    return when
  }
}

export default defineConfig({
  main: {
    define: { __BUILD_STAMP__: JSON.stringify(buildStamp()) },
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
