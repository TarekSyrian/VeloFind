import type { DuplicateGroup, FileSummary } from '@shared/types'

/**
 * ترتيب النتائج والمجموعات — PRD §19
 */

export type FileSortKey = 'name' | 'size' | 'modified' | 'path' | 'extension'
export type GroupSortKey = 'reclaimed' | 'size' | 'count' | 'path'
export type SortDir = 'asc' | 'desc'

export function sortFileSummaries(files: FileSummary[], key: FileSortKey, dir: SortDir = 'desc'): FileSummary[] {
  const factor = dir === 'asc' ? 1 : -1
  return [...files].sort((a, b) => {
    switch (key) {
      case 'name':
        return factor * a.name.localeCompare(b.name, 'ar')
      case 'path':
        return factor * a.path.localeCompare(b.path)
      case 'extension':
        return factor * a.extension.localeCompare(b.extension)
      case 'size':
        return factor * (a.size - b.size)
      case 'modified':
      default:
        return factor * (a.modifiedAt - b.modifiedAt)
    }
  })
}

export function sortGroups(groups: DuplicateGroup[], key: GroupSortKey = 'reclaimed', dir: SortDir = 'desc'): DuplicateGroup[] {
  const factor = dir === 'asc' ? 1 : -1
  return [...groups].sort((a, b) => {
    switch (key) {
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
}
