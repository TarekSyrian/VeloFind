import type {
  DuplicateGroup,
  EngineStats,
  IndexedFile,
  ScanPhase,
  ScanProgress,
  ScanRequest,
  ScanSummary,
  ScanWarning
} from './types'

/**
 * بروتوكول التواصل بين العملية الرئيسية وعامل الفحص (Worker Thread)
 * يُنفَّذ الفحص وحساب البصمات في Worker حتى لا تتجمد الواجهة — PRD §20
 */

export interface HashUpdate {
  id: number
  partialHash?: string
  fullHash?: string
  algorithm: string
  scannedAt: number
}

export interface WorkerInit {
  request: ScanRequest
  /** الفهرس الكامل قبل الفحص (كل الأقراص): استكمال تزايدي ضمن المواقع + حمل ما دونها للمقارنة العابرة للأقراص */
  previous: IndexedFile[]
  nextId: number
  concurrency: number
}

export type WorkerInMessage = { type: 'pause' } | { type: 'resume' } | { type: 'cancel' }

export type WorkerOutMessage =
  | { type: 'phase'; phase: ScanPhase }
  | { type: 'progress'; progress: ScanProgress }
  | { type: 'hash-batch'; updates: HashUpdate[]; bytesRead: number }
  | { type: 'warnings'; warnings: ScanWarning[] }
  | {
      type: 'done'
      files: IndexedFile[]
      removedIds: number[]
      groups: DuplicateGroup[]
      summary: ScanSummary
      stats: EngineStats
      warnings: ScanWarning[]
      durationMs: number
      mode: ScanRequest['mode']
    }
  | { type: 'error'; message: string; code?: string }
