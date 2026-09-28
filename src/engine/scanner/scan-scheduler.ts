import type { IndexedFile, ScanRequest, ScanSummary, ScanWarning } from '@shared/types'
import type { WorkerInit } from '@shared/worker-protocol'
import { resolveSystemFolderPaths } from './system-paths'
import { CancellationToken, PauseGate } from '../concurrency'
import { FileScanner } from './file-scanner'
import type { ScanFilters } from './file-scanner'
import { DuplicateDetector } from '../duplicates/duplicate-detector'
import type { ProgressSnapshot } from '../duplicates/duplicate-detector'
import type { HashUpdate } from '@shared/worker-protocol'

/**
 * مجدول الفحص — يدير مراحل الخط الكامل داخل عامل الفحص — PRD §15 و§22
 * preparing → scanning → grouping_by_size → partial_hashing → full_hashing → building_results → completed
 */

/**
 * المعرّف التالي المتاح بعد اللقطة الحالية.
 * حلقة تراكمية عمدًا: `Math.max(...files.map(...))` يرمي RangeError
 * (تجاوز حد الوسائط) على أي فهرس يتجاوز ~125 ألف ملف، فيفشل الفحص كاملًا
 * على الأقراص الكبيرة برسالة غامضة.
 */
export function nextIdAfter(files: IndexedFile[], start: number): number {
  let next = start
  for (const file of files) {
    if (file.id + 1 > next) next = file.id + 1
  }
  return next
}

export interface SchedulerOut {
  onPhase: (phase: import('@shared/types').ScanPhase) => void
  onProgress: (snapshot: ProgressSnapshot & { phase: import('@shared/types').ScanPhase }) => void
  onHashBatch: (updates: HashUpdate[]) => void
  onWarning: (warning: ScanWarning) => void
}

export class ScanScheduler {
  private readonly token: CancellationToken
  private readonly gate: PauseGate
  private readonly out: SchedulerOut
  private currentPhase: import('@shared/types').ScanPhase = 'preparing'

  constructor(token: CancellationToken, gate: PauseGate, out: SchedulerOut) {
    this.token = token
    this.gate = gate
    this.out = out
  }

  get phase(): import('@shared/types').ScanPhase {
    return this.currentPhase
  }

  async run(init: WorkerInit): Promise<{
    files: IndexedFile[]
    removedIds: number[]
    groups: import('@shared/types').DuplicateGroup[]
    summary: ScanSummary
    warnings: ScanWarning[]
    bytesRead: number
    durationMs: number
    mode: ScanRequest['mode']
  }> {
    const startedAt = Date.now()
    const request = init.request
    const warnings: ScanWarning[] = []
    let bytesRead = 0

    const setPhase = (phase: import('@shared/types').ScanPhase): void => {
      this.currentPhase = phase
      this.out.onPhase(phase)
    }

    // المرحلة 0: التجهيز
    setPhase('preparing')

    const filters: ScanFilters = {
      minSize: request.minSize,
      category: request.category ?? 'all',
      extensions: request.extensions ?? [],
      includeHidden: request.includeHidden ?? false
    }

    // مسارات النظام الحقيقية من بيئة التشغيل — لا استثناء بالاسم لتفادي إسقاط
    // مجلدات المستخدم العادية مثل L:\Windows (بلاغ المكررات العابرة للأقراص)
    const systemPaths = request.excludeSystemFolders === false ? [] : resolveSystemFolderPaths()

    const scanner = new FileScanner()
    let nextId = init.nextId

    // المرحلة 1: قراءة الملفات
    setPhase('scanning')
    const collected = await scanner.collect(filters, {
      locations: request.locations,
      excluded: request.excludedPaths ?? [],
      excludedFolderNames: request.excludedFolderNames ?? [],
      excludeSystemFolders: request.excludeSystemFolders ?? true,
      systemPaths,
      previous: init.previous,
      incremental: request.incremental ?? true,
      nextId,
      token: this.token,
      gate: this.gate,
      onWalkProgress: (scanned, currentPath) => {
        this.out.onProgress({
          phase: this.currentPhase,
          paused: this.gate.isPaused,
          filesScanned: scanned,
          filesTotal: 0,
          bytesRead,
          duplicateGroups: 0,
          currentPath,
          elapsedMs: Date.now() - startedAt
        })
      }
    })
    warnings.push(...collected.warnings)
    nextId = nextIdAfter(collected.files, nextId)

    // المراحل 2-5: التجميع والبصمات والنتائج (داخل الكاشف)
    const detector = new DuplicateDetector({
      mode: request.mode,
      concurrency: init.concurrency,
      token: this.token,
      gate: this.gate,
      hooks: {
        onPhase: setPhase,
        onProgress: (snapshot: ProgressSnapshot) => {
          this.out.onProgress({ ...snapshot, phase: this.currentPhase })
        },
        onHashBatch: (updates: HashUpdate[]) => this.out.onHashBatch(updates),
        onWarning: (w) => {
          warnings.push(w)
          this.out.onWarning(w)
        }
      }
    })

    const result = await detector.detect(collected.files)
    bytesRead = result.bytesRead

    const summary: ScanSummary = {
      added: collected.added,
      changed: collected.changed,
      unchanged: collected.unchanged,
      removed: collected.removedIds.length
    }

    return {
      files: collected.files,
      removedIds: collected.removedIds,
      groups: result.groups,
      summary,
      warnings,
      bytesRead,
      durationMs: Date.now() - startedAt,
      mode: request.mode
    }
  }
}
