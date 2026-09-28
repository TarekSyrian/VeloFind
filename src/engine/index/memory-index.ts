import type { IndexedFile } from '@shared/types'
import { extensionOf, pathKey } from '../path-utils'
import { partialKey } from '../duplicates/duplicate-groups'

/**
 * فهرس الذاكرة النشط — يحتفظ بـ metadata فقط (PRD §10 و§20)
 * خرائط متعددة للبحث السريع: بالمعرف، المسار، الحجم، الامتداد، البصمة، الدليل
 */
export class MemoryIndex {
  private byId = new Map<number, IndexedFile>()
  private byPath = new Map<string, number>()
  private bySize = new Map<number, Set<number>>()
  private byExt = new Map<string, Set<number>>()
  private byFullHash = new Map<string, Set<number>>()
  private byPartialHash = new Map<string, Set<number>>()
  private byDir = new Map<string, Set<number>>()
  private _nextId = 1

  get nextId(): number {
    return this._nextId
  }

  get size(): number {
    return this.byId.size
  }

  assignId(): number {
    return this._nextId++
  }

  get(id: number): IndexedFile | undefined {
    return this.byId.get(id)
  }

  getByPath(path: string): IndexedFile | undefined {
    const id = this.byPath.get(pathKey(path))
    return id === undefined ? undefined : this.byId.get(id)
  }

  add(file: IndexedFile): void {
    this.removeById(file.id)
    this.byId.set(file.id, file)
    this.byPath.set(pathKey(file.path), file.id)

    const sizeSet = this.bySize.get(file.size) ?? new Set<number>()
    sizeSet.add(file.id)
    this.bySize.set(file.size, sizeSet)

    const ext = file.extension || extensionOf(file.name)
    const extSet = this.byExt.get(ext) ?? new Set<number>()
    extSet.add(file.id)
    this.byExt.set(ext, extSet)

    const dirSet = this.byDir.get(pathKey(file.directory)) ?? new Set<number>()
    dirSet.add(file.id)
    this.byDir.set(pathKey(file.directory), dirSet)

    if (file.fullHash) {
      const hashSet = this.byFullHash.get(file.fullHash) ?? new Set<number>()
      hashSet.add(file.id)
      this.byFullHash.set(file.fullHash, hashSet)
    }

    if (file.partialHash) {
      const key = partialKey(file.size, file.partialHash)
      const phSet = this.byPartialHash.get(key) ?? new Set<number>()
      phSet.add(file.id)
      this.byPartialHash.set(key, phSet)
    }
  }

  /** تحديث البصمات مع صيانة خرائط الفهرسة */
  updateHashes(id: number, patch: { partialHash?: string; fullHash?: string; algorithm?: string; scannedAt: number }): void {
    const file = this.byId.get(id)
    if (!file) return

    if (file.fullHash && file.fullHash !== patch.fullHash) {
      const set = this.byFullHash.get(file.fullHash)
      set?.delete(id)
    }
    if (file.partialHash && file.partialHash !== patch.partialHash) {
      this.byPartialHash.get(partialKey(file.size, file.partialHash))?.delete(id)
    }
    if (patch.partialHash !== undefined) file.partialHash = patch.partialHash
    if (patch.fullHash !== undefined) file.fullHash = patch.fullHash
    if (patch.algorithm !== undefined) file.hashAlgorithm = patch.algorithm
    file.lastScannedAt = patch.scannedAt

    if (file.fullHash) {
      const set = this.byFullHash.get(file.fullHash) ?? new Set<number>()
      set.add(id)
      this.byFullHash.set(file.fullHash, set)
    }
    if (file.partialHash) {
      const key = partialKey(file.size, file.partialHash)
      const set = this.byPartialHash.get(key) ?? new Set<number>()
      set.add(id)
      this.byPartialHash.set(key, set)
    }
  }

  removeById(id: number): void {
    const file = this.byId.get(id)
    if (!file) return
    this.byId.delete(id)
    this.byPath.delete(pathKey(file.path))

    const sizeSet = this.bySize.get(file.size)
    sizeSet?.delete(id)

    const extSet = this.byExt.get(file.extension || extensionOf(file.name))
    extSet?.delete(id)

    const dirSet = this.byDir.get(pathKey(file.directory))
    dirSet?.delete(id)

    if (file.fullHash) {
      const hashSet = this.byFullHash.get(file.fullHash)
      hashSet?.delete(file.id)
    }
    if (file.partialHash) {
      this.byPartialHash.get(partialKey(file.size, file.partialHash))?.delete(file.id)
    }
  }

  removeByIds(ids: number[]): void {
    for (const id of ids) this.removeById(id)
  }

  removeByPath(path: string): boolean {
    const id = this.byPath.get(pathKey(path))
    if (id === undefined) return false
    this.removeById(id)
    return true
  }

  all(): IndexedFile[] {
    return [...this.byId.values()]
  }

  ids(): number[] {
    return [...this.byId.keys()]
  }

  filesWithFullHash(hash: string): IndexedFile[] {
    const set = this.byFullHash.get(hash)
    if (!set) return []
    return [...set].map((id) => this.byId.get(id)!).filter(Boolean)
  }

  fullHashEntries(): Array<[string, IndexedFile[]]> {
    const entries: Array<[string, IndexedFile[]]> = []
    for (const [hash, ids] of this.byFullHash) {
      const files = [...ids].map((id) => this.byId.get(id)!).filter(Boolean)
      if (files.length > 0) entries.push([hash, files])
    }
    return entries
  }

  /**
   * تجميع ملفات الفحص السريع (بصمة جزئية فقط) بمفتاح (الحجم|البصمة الجزئية).
   * تُستخدم لإعادة بناء المجموعات بعد إعادة تشغيل التطبيق، لأن الفحص السريع
   * لا يخزّن بصمة كاملة — فبدونها كانت كل المجموعات تختفي عند الإغلاق.
   * الملفات التي لها بصمة كاملة مستثناة: هي مُغطّاة بمجموعات fullHashEntries.
   */
  partialHashEntries(): Array<[string, IndexedFile[]]> {
    const entries: Array<[string, IndexedFile[]]> = []
    for (const [key, ids] of this.byPartialHash) {
      const files = [...ids]
        .map((id) => this.byId.get(id)!)
        .filter((f) => Boolean(f) && !f.fullHash)
      if (files.length > 0) entries.push([key, files])
    }
    return entries
  }

  extensions(): string[] {
    return [...this.byExt.keys()]
  }

  directoryKeys(): string[] {
    return [...this.byDir.keys()]
  }

  /** تحميل دفعة كاملة (بعد الفحص أو عند بدء التشغيل) */
  bulkLoad(files: IndexedFile[]): void {
    this.clear()
    let maxId = 0
    for (const file of files) {
      if (file.id > maxId) maxId = file.id
      this.add(file)
    }
    this._nextId = maxId + 1
  }

  clear(): void {
    this.byId.clear()
    this.byPath.clear()
    this.bySize.clear()
    this.byExt.clear()
    this.byFullHash.clear()
    this.byPartialHash.clear()
    this.byDir.clear()
    this._nextId = 1
  }
}
