import type { IndexedFile } from '@shared/types'
import { CATEGORY_EXTENSIONS } from '@shared/constants'
import type { FileCategory } from '@shared/types'
import { extensionOf } from '../path-utils'

/**
 * فهرس الامتدادات: امتداد → معرفات الملفات
 * يدعم فلترة الفئات (صور/فيديو/صوت/مستندات) والاستعلامات ext: (PRD §18-19)
 */
export class ExtensionIndex {
  private extensions = new Map<string, Set<number>>()

  rebuild(files: IndexedFile[]): void {
    this.extensions.clear()
    for (const file of files) {
      const ext = file.extension || extensionOf(file.name)
      const set = this.extensions.get(ext) ?? new Set<number>()
      set.add(file.id)
      this.extensions.set(ext, set)
    }
  }

  filesWithExtension(ext: string): number[] {
    return [...(this.extensions.get(ext.toLowerCase())?.values() ?? [])]
  }

  filesInCategory(category: Exclude<FileCategory, 'all' | 'custom'>): number[] {
    const result: number[] = []
    for (const ext of CATEGORY_EXTENSIONS[category]) {
      result.push(...(this.extensions.get(ext)?.values() ?? []))
    }
    return result
  }

  /** الامتدادات موجودة مرتبة حسب عدد الملفات تنازليًا */
  topExtensions(limit = 20): Array<{ ext: string; count: number }> {
    return [...this.extensions.entries()]
      .map(([ext, ids]) => ({ ext, count: ids.size }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
  }

  get size(): number {
    return this.extensions.size
  }
}
