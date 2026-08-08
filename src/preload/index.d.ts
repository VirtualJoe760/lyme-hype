import type { LymeApi } from './index'

declare global {
  interface Window {
    /** Present in Electron. Absent in plain-browser preview, where the mock bridge takes over. */
    lyme?: LymeApi
  }
}

export {}
