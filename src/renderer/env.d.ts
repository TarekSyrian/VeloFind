/// <reference types="vite/client" />
import type { VelofindApi } from '@shared/ipc-contract'

declare global {
  interface Window {
    velofind: VelofindApi
  }
}

declare module '*.wav?url' {
  const src: string
  export default src
}

export {}
