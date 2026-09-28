import type { PersistenceManager } from '../persistence/persistence-manager'
import type { IndexedFile } from '@shared/types'
import { MemoryIndex } from './memory-index'
import { PathIndex } from './path-index'
import { ExtensionIndex } from './extension-index'

/**
 * الواجهة الموحدة للفهرس: ذاكرة نشطة + تخزين دائم + فهارس ثانوية
 * الفهرس ليس بديلًا عن بصمة المحتوى بل طبقة تسريع — PRD §10
 */
export class FileIndex {
  readonly memory = new MemoryIndex()
  readonly paths = new PathIndex()
  readonly extensions = new ExtensionIndex()

  constructor(private readonly persistence: PersistenceManager) {}

  /** تحميل الفهرس المحفوظ عند بدء التشغيل (استكمال آخر فحص) */
  async load(): Promise<void> {
    const files = await this.persistence.loadFiles()
    this.memory.bulkLoad(files)
    this.rebuildSecondary()
  }

  rebuildSecondary(): void {
    const all = this.memory.all()
    this.paths.rebuild(all)
    this.extensions.rebuild(all)
  }

  /** تطبيق نتيجة فحص كاملة (من العامل) على الذاكرة والتخزين */
  async applySnapshot(files: IndexedFile[], removedIds: number[]): Promise<void> {
    this.memory.bulkLoad(files)
    this.rebuildSecondary()
    await this.persistence.replaceFiles(files)
    if (removedIds.length > 0) await this.persistence.deleteFiles(removedIds)
  }

  updateHashes(id: number, patch: { partialHash?: string; fullHash?: string; algorithm?: string; scannedAt: number }): void {
    this.memory.updateHashes(id, patch)
  }

  async removePaths(paths: string[]): Promise<number> {
    const removedIds: number[] = []
    for (const p of paths) {
      const file = this.memory.getByPath(p)
      if (file) {
        removedIds.push(file.id)
        this.memory.removeById(file.id)
      }
    }
    if (removedIds.length > 0) {
      this.rebuildSecondary()
      await this.persistence.deleteFiles(removedIds)
    }
    return removedIds.length
  }

  async clear(): Promise<void> {
    this.memory.clear()
    this.rebuildSecondary()
    await this.persistence.clearFiles()
  }

  async flush(): Promise<void> {
    await this.persistence.flush()
  }
}
