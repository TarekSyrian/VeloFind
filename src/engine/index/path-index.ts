import type { IndexedFile } from '@shared/types'
import { isUnderPath, normalizePath } from '../path-utils'

/**
 * فهرس المسارات: دليل → معرفات الملفات + بحث بالبادئة
 * يدعم استعلامات path: في البحث (PRD §19)
 */
export class PathIndex {
  private dirs = new Map<string, Set<number>>()

  rebuild(files: IndexedFile[]): void {
    this.dirs.clear()
    for (const file of files) {
      const key = normalizePath(file.directory)
      const set = this.dirs.get(key) ?? new Set<number>()
      set.add(file.id)
      this.dirs.set(key, set)
    }
  }

  /** معرفات الملفات تحت مسار معين (مجلد أو قرص) */
  filesUnder(prefix: string): number[] {
    const root = normalizePath(prefix)
    const result: number[] = []
    for (const [dir, ids] of this.dirs) {
      if (isUnderPath(dir, root)) result.push(...ids)
    }
    return result
  }

  get size(): number {
    return this.dirs.size
  }
}
