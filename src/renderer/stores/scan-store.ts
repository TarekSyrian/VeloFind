import { create } from 'zustand'
import type { ScanDoneResult, ScanPhase, ScanProgress, ScanRequest, ScanWarning } from '@shared/types'

const ACTIVE_PHASES: ScanPhase[] = [
  'preparing',
  'scanning',
  'grouping_by_size',
  'partial_hashing',
  'full_hashing',
  'building_results',
  'paused'
]

interface ScanState {
  phase: ScanPhase
  paused: boolean
  progress: ScanProgress | null
  request: ScanRequest | null
  done: ScanDoneResult | null
  warnings: ScanWarning[]
  startedAt: number | null

  start(request: ScanRequest): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  cancel(): Promise<void>
  handlePhase(phase: ScanPhase): void
  handleProgress(progress: ScanProgress): void
  handleDone(result: ScanDoneResult): void
  handleError(error: { message: string; code?: string }): void
  reset(): void
}

export const useScanStore = create<ScanState>((set) => ({
  phase: 'idle',
  paused: false,
  progress: null,
  request: null,
  done: null,
  warnings: [],
  startedAt: null,

  start: async (request: ScanRequest) => {
    set({ request, done: null, warnings: [], startedAt: Date.now(), phase: 'preparing', progress: null })
    try {
      await window.velofind.startScan(request)
    } catch (error) {
      set({ phase: 'failed' })
      throw error
    }
  },

  pause: async () => {
    await window.velofind.pauseScan()
  },

  resume: async () => {
    await window.velofind.resumeScan()
  },

  cancel: async () => {
    await window.velofind.cancelScan()
  },

  handlePhase: (phase) => set({ phase, paused: phase === 'paused' }),

  handleProgress: (progress) => set({ progress, paused: progress.paused, phase: progress.phase }),

  handleDone: (result) =>
    set({ phase: 'completed', done: result, progress: null, warnings: result.warnings, paused: false }),

  handleError: (error) => {
    void error
    set({ phase: 'failed', progress: null, paused: false })
  },

  reset: () => set({ phase: 'idle', progress: null, done: null, warnings: [], paused: false })
}))

export function isScanActive(phase: ScanPhase): boolean {
  return ACTIVE_PHASES.includes(phase)
}
