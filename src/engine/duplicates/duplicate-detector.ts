import type { DuplicateGroup, IndexedFile, ScanMode, ScanPhase, ScanWarning } from '@shared/types'
import { HASH_ALGORITHM, HASH_BATCH_SIZE, PARTIAL_HASH_CHUNK, PARTIAL_SKIP_SIZE, PROGRESS_INTERVAL_MS } from '@shared/constants'
import { CancellationToken, PauseGate, runPool } from '../concurrency'
import { candidateSizeGroups } from './size-grouper'
import { computePartialHash } from './partial-hasher'
import { computeFullHash } from './full-hasher'
import { buildDuplicateGroups, partialKey } from './duplicate-groups'
import type { HashUpdate } from '@shared/worker-protocol'

/**
 * كاشف الملفات المكررة — يطبق الاختبارات المتدرجة من PRD §8:
 *   الحجم → البصمة الجزئية (للملفات الكبيرة) → البصمة الكاملة → المجموعات
 * لا تُقرأ الملفات التي لم تتغير مرة أخرى (تُعاد بصماتها المحفوظة) — PRD §5
 */

export interface DetectHooks {
  onPhase: (phase: ScanPhase) => void
  onProgress: (snapshot: ProgressSnapshot) => void
  onHashBatch: (updates: HashUpdate[]) => void
  onWarning: (warning: ScanWarning) => void
}

export interface ProgressSnapshot {
  phase: ScanPhase
  paused: boolean
  filesScanned: number
  filesTotal: number
  bytesRead: number
  duplicateGroups: number
  currentPath?: string
  elapsedMs: number
}

export interface DetectResult {
  groups: DuplicateGroup[]
  bytesRead: number
}

export interface DetectOptions {
  mode: ScanMode
  concurrency: number
  token: CancellationToken
  gate: PauseGate
  hooks: DetectHooks
}

export class DuplicateDetector {
  private readonly token: CancellationToken
  private readonly gate: PauseGate
  private readonly hooks: DetectHooks
  private readonly mode: ScanMode
  private readonly concurrency: number

  private filesScanned = 0
  private filesTotal = 0
  private bytesRead = 0
  private duplicateGroups = 0
  private currentPath: string | undefined
  private startedAt = Date.now()
  private lastEmit = 0
  private timer: NodeJS.Timeout | null = null

  constructor(options: DetectOptions) {
    this.mode = options.mode
    this.concurrency = options.concurrency
    this.token = options.token
    this.gate = options.gate
    this.hooks = options.hooks
  }

  async detect(files: IndexedFile[]): Promise<DetectResult> {
    this.startedAt = Date.now()
    this.timer = setInterval(() => this.emit(), PROGRESS_INTERVAL_MS)
    this.timer.unref?.()

    try {
      this.hooks.onPhase('grouping_by_size')
      // الملفات المفقودة من القرص (missing) لا تُرشح للمقارنة — لا يمكن التحقق منها ولا استرداد مساحتها
      const eligible = files.filter((f) => f.scanState !== 'missing')
      const sizeGroups = candidateSizeGroups(eligible)
      const candidates = sizeGroups.flat()
      this.filesTotal = candidates.length
      this.filesScanned = 0
      this.emit(true)

      // 1) فصل المرشحين: ملفات لم تتغير ولديها بصمة كاملة صالحة مقابل بحاجة إلى حساب بصمة
      //    (إصلاح: الملفات المخزنة كانت تُهمل سابقًا فتفوت مجموعات كاملة — PRD §8/§15)
      const cachedFiles: IndexedFile[] = []
      const freshFiles: IndexedFile[] = []
      for (const file of candidates) {
        if (file.fullHash && file.scanState === 'unchanged') cachedFiles.push(file)
        else freshFiles.push(file)
      }

      // بصمات الملفات المخزنة تدخل خريطة النتائج مباشرة — إعادة استخدام دون قراءة
      const fullHashMap = new Map<string, IndexedFile[]>()
      for (const file of cachedFiles) this.pushToMap(fullHashMap, file.fullHash as string, file)

      // أحجام فيها توائم مخزنة — لا يجوز إسقاط أي ملف جديد بحجمها قبل التأكد بالبصمة الكاملة
      const cachedSizes = new Set(cachedFiles.map((f) => f.size))

      let groups: DuplicateGroup[]

      if (this.mode === 'quick') {
        // الفحص السريع: حجم + بصمة جزئية لكل المرشحين (المخزنون يُعاد استخدام بصمتهم المحفوظة) — PRD §18
        // إصلاح: سابقًا كان المخزنون يُستبعدون من التجميع فتختفي مكرراتهم في الفحص السريع
        this.hooks.onPhase('partial_hashing')
        const quickMap = await this.hashPartial(candidates)
        groups = buildDuplicateGroups(quickMap, 'partial')
      } else {
        // الفحص الدقيق
        this.hooks.onPhase('partial_hashing')
        const freshLarge = freshFiles.filter((f) => f.size > PARTIAL_SKIP_SIZE)
        const freshSmall = freshFiles.filter((f) => f.size <= PARTIAL_SKIP_SIZE)
        const cachedLarge = cachedFiles.filter((f) => f.size > PARTIAL_SKIP_SIZE)

        // التصفية المسبقة بالبصمة الجزئية تشمل المخزنين والجدد معًا حتى لا يفوت توأم مخزن
        const partialMap = await this.hashPartial([...cachedLarge, ...freshLarge])

        const survivors: IndexedFile[] = [...freshSmall]
        for (const bucket of partialMap.values()) {
          // المجموعة تشمل مخزنين وجدد — المخزن لا يحتاج بصمة جديدة، والجديد يُبصم كاملًا
          if (bucket.length > 1 || cachedSizes.has(bucket[0].size)) {
            for (const file of bucket) {
              if (!(file.fullHash && file.scanState === 'unchanged')) survivors.push(file)
            }
          }
        }

        this.hooks.onPhase('full_hashing')
        await this.hashFull(survivors, fullHashMap)
        groups = buildDuplicateGroups(fullHashMap, 'full')
      }

      this.hooks.onPhase('building_results')
      this.duplicateGroups = groups.length
      this.emit(true)

      return { groups, bytesRead: this.bytesRead }
    } finally {
      if (this.timer) clearInterval(this.timer)
      this.timer = null
    }
  }

  private pushToMap(map: Map<string, IndexedFile[]>, key: string, file: IndexedFile): void {
    const bucket = map.get(key)
    if (bucket) bucket.push(file)
    else map.set(key, [file])
  }

  private batch: HashUpdate[] = []

  private flushBatch(force = false): void {
    if (this.batch.length === 0) return
    if (!force && this.batch.length < HASH_BATCH_SIZE) return
    this.hooks.onHashBatch(this.batch.splice(0))
  }

  /** حساب البصمات الجزئية بالتوازي المحدود وإرجاع خريطة (حجم|بصمة → ملفات) */
  private async hashPartial(files: IndexedFile[]): Promise<Map<string, IndexedFile[]>> {
    const map = new Map<string, IndexedFile[]>()
    this.filesTotal = files.length
    this.filesScanned = 0
    this.emit(true)

    await runPool(
      files,
      this.concurrency,
      async (file) => {
        try {
          this.currentPath = file.path

          // البصمة الجزئية المحفوظة لملف لم يتغير تُعاد استخدامها دون أي قراءة من القرص — PRD §15
          if (file.partialHash && file.scanState === 'unchanged') {
            this.pushToMap(map, partialKey(file.size, file.partialHash), file)
          } else {
            const partialHash = await computePartialHash(file.path, file.size, this.token)
            file.partialHash = partialHash
            file.hashAlgorithm = HASH_ALGORITHM
            file.scanState = 'scanned'
            this.bytesRead += Math.min(file.size, PARTIAL_HASH_CHUNK * 3)
            this.batch.push({ id: file.id, partialHash, algorithm: HASH_ALGORITHM, scannedAt: Date.now() })
            this.flushBatch()

            this.pushToMap(map, partialKey(file.size, partialHash), file)
          }
        } catch (error) {
          this.handleFileError(file, error)
        } finally {
          this.filesScanned += 1
          this.emit()
        }
      },
      this.token,
      this.gate
    )

    this.flushBatch(true)
    return map
  }

  /** حساب البصمات الكاملة بالتوازي وتعبئة خريطة البصمة الكاملة */
  private async hashFull(files: IndexedFile[], map: Map<string, IndexedFile[]>): Promise<void> {
    this.filesTotal = files.length
    this.filesScanned = 0
    this.emit(true)

    await runPool(
      files,
      this.concurrency,
      async (file) => {
        try {
          this.currentPath = file.path
          const { hash, bytesRead } = await computeFullHash(file.path, this.token, (bytes) => {
            this.bytesRead += bytes
          })
          file.fullHash = hash
          file.hashAlgorithm = HASH_ALGORITHM
          file.scanState = 'scanned'
          this.batch.push({ id: file.id, fullHash: hash, algorithm: HASH_ALGORITHM, scannedAt: Date.now() })
          this.flushBatch()

          this.pushToMap(map, hash, file)
        } catch (error) {
          this.handleFileError(file, error)
        } finally {
          this.filesScanned += 1
          this.emit()
        }
      },
      this.token,
      this.gate
    )

    this.flushBatch(true)
  }

  private handleFileError(file: IndexedFile, error: unknown): void {
    const code = (error as NodeJS.ErrnoException).code
    if ((error as Error).name === 'ScanCancelledError') throw error
    file.scanState = 'unreadable'
    this.hooks.onWarning({
      path: file.path,
      kind: code === 'EACCES' || code === 'EPERM' ? 'access_denied' : 'unreadable',
      message: `تعذر قراءة الملف: ${file.path}`
    })
  }

  private emit(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastEmit < PROGRESS_INTERVAL_MS) return
    this.lastEmit = now
    this.hooks.onProgress({
      phase: 'idle', // تُستبدل بالمرحلة الحالية في المجدول
      paused: this.gate.isPaused,
      filesScanned: this.filesScanned,
      filesTotal: this.filesTotal,
      bytesRead: this.bytesRead,
      duplicateGroups: this.duplicateGroups,
      currentPath: this.currentPath,
      elapsedMs: now - this.startedAt
    })
  }
}
