import type { DuplicateGroup } from '@shared/types'
import type { GroupSortKey, SortDir } from './sorter'

/**
 * تصفية مجموعات المكررات — منطق نقي مشترك بين الواجهة والاختبارات
 * يتضمن فلتر «عبر الأقراص فقط»: المجموعات التي تحتوي نسخًا على أكثر من قرص واحد
 */

export interface DuplicateFilters {
  text: string
  drive: string
  minSize: number | null
  sortKey: GroupSortKey
  sortDir: SortDir
  onlySelected: boolean
  /** عرض المجموعات الممتدة على أكثر من قرص فقط (⇄ عبر الأقراص) */
  crossDriveOnly: boolean
}

export const DEFAULT_DUPLICATE_FILTERS: DuplicateFilters = {
  text: '',
  drive: '',
  minSize: null,
  sortKey: 'reclaimed',
  sortDir: 'desc',
  onlySelected: false,
  crossDriveOnly: false
}

export function filterDuplicateGroups(
  groups: DuplicateGroup[],
  filters: DuplicateFilters,
  selection: Record<string, number[]>
): DuplicateGroup[] {
  const text = filters.text.trim().toLowerCase()

  let result = groups.filter((group) => {
    if (filters.drive && !group.files.some((f) => f.drive === filters.drive)) return false
    if (filters.minSize !== null && group.size < filters.minSize) return false
    if (filters.onlySelected && (selection[group.id]?.length ?? 0) === 0) return false
    if (filters.crossDriveOnly && new Set(group.files.map((f) => f.drive)).size < 2) return false
    if (text) {
      const match = group.files.some(
        (f) => f.name.toLowerCase().includes(text) || f.path.toLowerCase().includes(text)
      )
      if (!match) return false
    }
    return true
  })

  const factor = filters.sortDir === 'asc' ? 1 : -1
  result = [...result].sort((a, b) => {
    switch (filters.sortKey) {
      case 'size':
        return factor * (a.size - b.size)
      case 'count':
        return factor * (a.fileCount - b.fileCount)
      case 'path':
        return factor * (a.files[0]?.path ?? '').localeCompare(b.files[0]?.path ?? '')
      case 'reclaimed':
      default:
        return factor * (a.reclaimedBytes - b.reclaimedBytes)
    }
  })

  return result
}
