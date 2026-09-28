import os from 'node:os'
import type {
  AppSettings,
  DeleteItem,
  DuplicateGroup,
  EngineStats,
  IndexedFile,
  SavedLocation,
  ScanDoneResult,
  ScanPhase,
  ScanProgress,
  ScanRequest,
  SearchResult,
  VolumeInfo
} from '@shared/types'
import type { HashUpdate, WorkerOutMessage } from '@shared/worker-protocol'
import { VeloFindError } from '@shared/errors'
import { PersistenceManager } from './persistence/persistence-manager'
import { FileIndex } from './index/file-index'
import { JournalStateStore } from './journal/journal-state'
import { JournalSyncService } from './journal/journal-sync'
import { WorkerManager } from '@main/worker-manager'
import { groupsFromFullHashMap, groupsFromPartialHashMap } from './duplicates/duplicate-groups'
import { searchFiles } from './query/filters'
import { parseQuery } from './query/query-parser'
import { pathKey } from './path-utils'

/**
 * متحكم المحرك — الواجهة الموحدة لطبقة TypeScript Search/Index Engine — PRD §11
 * يربط: الفهرس، التخزين الدائم، عامل الفحص، المزامنة، البحث
 */

export interface EngineEvents {
  onScanPhase?: (phase: ScanPhase) => void
  onScanProgress?: (progress: ScanProgress) => void
  onScanDone?: (result: ScanDoneResult) => void
  onScanError?: (error: { message: string; code?: string }) => void
  onIndexChanged?: () => void
}

export class EngineController {
  private persistence!: PersistenceManager
  private index!: FileIndex
  private journalStates!: JournalStateStore
  private journalSync!: JournalSyncService
  private workerManager!: WorkerManager
  private events: EngineEvents = {}

  private groups: DuplicateGroup[] = []
  private duplicateFileIds = new Set<number>()
  private lastScanAt: number | null = null
  private scanning = false
  private hashBatchTimer: NodeJS.Timeout | null = null
  private pendingHashUpdates: HashUpdate[] = []
  private currentRequest: ScanRequest | null = null

  constructor(private readonly userDataDir: string, private readonly workerScriptDir: string) {}

  async initialize(settings: AppSettings): Promise<void> {
    this.persistence = await PersistenceManager.create(this.userDataDir)
    this.index = new FileIndex(this.persistence)
    await this.index.load()
    const saved = await this.persistence.getSetting('lastScanAt')
    const parsed = saved === null ? Number.NaN : Number(saved)
    this.lastScanAt = Number.isFinite(parsed) && parsed > 0 ? parsed : null
    this.rebuildGroups()

    this.journalStates = new JournalStateStore(this.persistence)
    // بوابة مزدوجة للطبقة التجريبية: إعداد المستخدم + متغير البيئة — PRD §28
    const usnEnabled = settings.useUsnJournal && process.env.VELOFIND_ENABLE_USN === '1'
    this.journalSync = new JournalSyncService({
      stateStore: this.journalStates,
      enabled: usnEnabled,
      onFileDeleted: (p) => void this.index.removePaths([p]).then(() => this.rebuildGroups()),
      onOutOfSync: (drive) => console.warn(`[velofind] القرص ${drive} خارج التزامن — يلزم إعادة فحص كامل`),
      onApplied: (drive, count) => console.info(`[velofind] طُبقت ${count} تغييرات USN على القرص ${drive}`)
    })

    this.workerManager = new WorkerManager(this.workerScriptDir, (m) => this.handleWorkerMessage(m))
  }

  setEvents(events: EngineEvents): void {
    this.events = events
  }

  /* ------------------------- الفحص ------------------------- */

  get isScanning(): boolean {
    return this.scanning
  }

  async startScan(request: ScanRequest): Promise<void> {
    if (this.scanning) {
      throw new VeloFindError('يوجد فحص قيد التشغيل بالفعل')
    }
    if (!request.locations || request.locations.length === 0) {
      throw new VeloFindError('لم يتم اختيار أي موقع للفحص')
    }

    this.scanning = true
    this.currentRequest = request

    // الفهرس الكامل (كل الأقراص) يُمرر للعامل:
    // - الملفات ضمن مواقع الفحص → استكمال تزايدي (PRD §15)
    // - الملفات خارج المواقع → تُحمل إلى اللقطة وتُقارن مع الجديد — المكررات العابرة
    //   للأقراص/الفحوصات السابقة تظهر دون إعادة قراءة أي قرص آخر
    const previous = this.index.memory.all()

    this.workerManager.start({
      request,
      previous,
      nextId: this.index.memory.nextId,
      concurrency: this.hashConcurrency()
    })
  }

  pauseScan(): void {
    this.workerManager.pause()
  }

  resumeScan(): void {
    this.workerManager.resume()
  }

  cancelScan(): void {
    this.workerManager.cancel()
  }

  private hashConcurrency(): number {
    const cores = os.cpus().length || 4
    return Math.max(2, Math.min(8, cores - 1))
  }

  private handleWorkerMessage(message: WorkerOutMessage): void {
    switch (message.type) {
      case 'phase':
        this.events.onScanPhase?.(message.phase)
        break

      case 'progress':
        this.events.onScanProgress?.(message.progress)
        break

      case 'hash-batch':
        this.queueHashUpdates(message.updates)
        break

      case 'warnings':
        break

      case 'done': {
        this.scanning = false
        this.currentRequest = null
        void this.finishScan(message)
        break
      }

      case 'error': {
        this.scanning = false
        this.currentRequest = null
        this.events.onScanError?.({ message: message.message, code: message.code })
        break
      }
    }
  }

  private async finishScan(message: Extract<WorkerOutMessage, { type: 'done' }>): Promise<void> {
    try {
      // تطبيق البصمات المتبقية ثم اللقطة النهائية
      await this.flushHashUpdates()

      // تعبئة بصمات العامل داخل السجلات قبل الحفظ
      const workerFiles = message.files
      await this.index.applySnapshot(workerFiles, message.removedIds)

      this.groups = message.groups
      this.rebuildDuplicateIds()

      const lastScanAt = Date.now()
      this.lastScanAt = lastScanAt
      const volumes = this.computeVolumes(lastScanAt)
      for (const volume of volumes) {
        await this.persistence.upsertVolume({
          id: volume.drive,
          driveLetter: volume.drive,
          lastScanAt,
          scanState: 'completed'
        })
      }
      await this.persistence.setSetting('lastScanAt', String(lastScanAt))

      const stats: EngineStats = {
        indexedFiles: workerFiles.length,
        duplicateGroups: this.groups.length,
        duplicateFiles: this.groups.reduce((s, g) => s + g.fileCount, 0),
        reclaimableBytes: this.groups.reduce((s, g) => s + g.reclaimedBytes, 0),
        lastScanAt,
        volumes,
        indexStore: this.persistence.kind
      }

      this.events.onScanDone?.({
        groups: this.groups,
        stats,
        summary: message.summary,
        warnings: message.warnings,
        durationMs: message.durationMs,
        mode: message.mode ?? 'accurate'
      })
      this.events.onIndexChanged?.()
    } catch (error) {
      this.events.onScanError?.({ message: (error as Error).message, code: 'PERSISTENCE' })
    }
  }

  private queueHashUpdates(updates: HashUpdate[]): void {
    this.pendingHashUpdates.push(...updates)
    if (!this.hashBatchTimer) {
      this.hashBatchTimer = setTimeout(() => {
        this.hashBatchTimer = null
        void this.flushHashUpdates()
      }, 2000)
    }
  }

  private async flushHashUpdates(): Promise<void> {
    if (this.hashBatchTimer) {
      clearTimeout(this.hashBatchTimer)
      this.hashBatchTimer = null
    }
    if (this.pendingHashUpdates.length === 0) return
    const updates = this.pendingHashUpdates.splice(0)
    try {
      await this.persistence.updateFileHashes(
        updates.map((u) => ({
          id: u.id,
          partialHash: u.partialHash,
          fullHash: u.fullHash,
          algorithm: u.algorithm,
          scannedAt: u.scannedAt
        }))
      )
    } catch (error) {
      console.warn('[velofind] تعذر حفظ دفعة بصمات:', error)
    }
  }

  /* ------------------------- النتائج والبحث ------------------------- */

  listGroups(): DuplicateGroup[] {
    return this.groups
  }

  getGroup(id: string): DuplicateGroup | undefined {
    return this.groups.find((g) => g.id === id)
  }

  private rebuildGroups(): void {
    // ملف مفقود من القرص أو تعذّرت قراءته لا يُشكّل مكررة مؤكدة:
    // missing موجود في السجل لكنه غير موجود فعلًا، وunreadable بصمته لم تتحقق (أو صُفّرت)
    const usable = (f: IndexedFile): boolean =>
      f.scanState !== 'missing' && f.scanState !== 'unreadable'

    // 1) ملفات لها بصمة كاملة → مجموعات مؤكدة (حجم + بصمة كاملة)
    const fullEntries = this.index.memory
      .fullHashEntries()
      .map(([hash, files]) => [hash, files.filter(usable)] as [string, IndexedFile[]])
      .filter(([, files]) => files.length > 1)

    // 2) ملفات بلا بصمة كاملة (نتيجة فحص سريع) → مجموعات جزئية
    //    بدونها كانت كل مجموعات الفحص السريع تختفي فور إعادة تشغيل التطبيق
    const partialEntries = this.index.memory
      .partialHashEntries()
      .map(([key, files]) => [key, files.filter(usable)] as [string, IndexedFile[]])
      .filter(([, files]) => files.length > 1)

    this.groups = [...groupsFromFullHashMap(fullEntries), ...groupsFromPartialHashMap(partialEntries)].sort(
      (a, b) => b.reclaimedBytes - a.reclaimedBytes
    )
    this.rebuildDuplicateIds()
  }

  private rebuildDuplicateIds(): void {
    this.duplicateFileIds = new Set()
    for (const group of this.groups) {
      for (const file of group.files) this.duplicateFileIds.add(file.id)
    }
  }

  search(query: string, limit = 100): SearchResult {
    const parsed = parseQuery(query)
    const result = searchFiles(this.index.memory, parsed, { duplicateFileIds: this.duplicateFileIds }, { limit })
    return { query, total: result.total, tookMs: result.tookMs, files: result.files }
  }

  stats(): EngineStats {
    return {
      indexedFiles: this.index.memory.size,
      duplicateGroups: this.groups.length,
      duplicateFiles: this.groups.reduce((s, g) => s + g.fileCount, 0),
      reclaimableBytes: this.groups.reduce((s, g) => s + g.reclaimedBytes, 0),
      lastScanAt: this.lastScanAt,
      volumes: this.computeVolumes(this.lastScanAt),
      indexStore: this.persistence.kind
    }
  }

  volumes(): VolumeInfo[] {
    return this.computeVolumes(null)
  }

  private computeVolumes(lastScanAt: number | null): VolumeInfo[] {
    const drives = new Map<string, { count: number; lastScan: number | null }>()
    for (const file of this.index.memory.all()) {
      const drive = (file.volumeId || file.path.charAt(0) || '?').toUpperCase()
      const entry = drives.get(drive) ?? { count: 0, lastScan: null }
      entry.count += 1
      if (file.lastScannedAt && (!entry.lastScan || file.lastScannedAt > entry.lastScan)) {
        entry.lastScan = file.lastScannedAt
      }
      drives.set(drive, entry)
    }
    return [...drives.entries()]
      .map(([drive, v]) => ({
        drive,
        fileCount: v.count,
        lastScanAt: lastScanAt ?? v.lastScan,
        journalState: 'disabled' as const
      }))
      .sort((a, b) => a.drive.localeCompare(b.drive))
  }

  getByPath(p: string): IndexedFile | undefined {
    return this.index.memory.getByPath(p)
  }

  /* ------------------------- إدارة الفهرس ------------------------- */

  /** إزالة ملفات محذوفة من الفهرس (بعد عمليات المستخدم) ثم إعادة بناء المجموعات */
  async removePaths(paths: string[]): Promise<number> {
    const removed = await this.index.removePaths(paths)
    this.rebuildGroups()
    this.events.onIndexChanged?.()
    return removed
  }

  async clearIndex(): Promise<void> {
    await this.index.clear()
    this.groups = []
    this.duplicateFileIds.clear()
    this.events.onIndexChanged?.()
  }

  /* ------------------------- المواقع والإعدادات ------------------------- */

  listLocations(): Promise<SavedLocation[]> {
    return this.persistence.loadLocations()
  }

  async saveLocations(locations: SavedLocation[]): Promise<void> {
    // إزالة التكرارات مع الحفاظ على الترتيب
    const seen = new Set<string>()
    const unique = locations.filter((loc) => {
      const key = pathKey(loc.path)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    await this.persistence.saveLocations(unique)
  }

  async journalStatus(drive: string): Promise<'ok' | 'out_of_sync' | 'disabled'> {
    const state = await this.journalStates.load(drive)
    return state?.status ?? 'disabled'
  }

  /* ------------------------- دورة الحياة ------------------------- */

  async flush(): Promise<void> {
    await this.flushHashUpdates()
    await this.index.flush()
  }

  async shutdown(): Promise<void> {
    this.workerManager.terminate()
    await this.flush()
    await this.persistence.close()
  }
}

export function resolveWorkerDir(): string {
  // في البناء: out/main/scan-worker.js بجوار index.js
  return __dirname
}
