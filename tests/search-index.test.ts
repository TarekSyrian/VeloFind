import { describe, expect, it } from 'vitest'
import { MemoryIndex } from '@engine/index/memory-index'
import { searchFiles } from '@engine/query/filters'
import { parseQuery } from '@engine/query/query-parser'
import { groupsFromFullHashMap } from '@engine/duplicates/duplicate-groups'
import { sortFileSummaries, sortGroups } from '@engine/query/sorter'
import type { IndexedFile } from '@shared/types'

function file(id: number, name: string, size: number, modified: number, dir = 'C:\\data'): IndexedFile {
  return {
    id,
    volumeId: 'C',
    name,
    path: `${dir}\\${name}`,
    directory: dir,
    extension: name.split('.').pop()?.toLowerCase() ?? '',
    size,
    modifiedAt: modified,
    createdAt: modified,
    attributes: 0,
    isHidden: false,
    fullHash: `h${id % 2}`,
    scanState: 'scanned'
  }
}

describe('MemoryIndex', () => {
  it('يحافظ على خرائط البحث عند الإضافة والحذف', () => {
    const index = new MemoryIndex()
    index.bulkLoad([file(1, 'a.txt', 10, 1), file(2, 'b.jpg', 10, 2)])
    expect(index.size).toBe(2)
    expect(index.filesWithFullHash('h1')).toHaveLength(1)
    expect(index.getByPath('c:\\data\\a.txt')?.id).toBe(1) // غير حساس لحالة الأحرف

    index.removeById(1)
    expect(index.size).toBe(1)
    expect(index.getByPath('C:\\data\\a.txt')).toBeUndefined()
  })
})

describe('البحث عبر الفهرس — PRD §19', () => {
  const index = new MemoryIndex()
  index.bulkLoad([
    file(1, 'invoice2024.pdf', 500, 1700000000000),
    file(2, 'photo.jpg', 4_000_000, 1700000100000),
    file(3, 'video.mp4', 200_000_000, 1700000200000),
    file(4, 'photo-copy.jpg', 4_000_000, 1700000300000, 'D:\\Backup')
  ])

  const dupIds = new Set([2, 4])

  it('بحث نصي حر', () => {
    const result = searchFiles(index, parseQuery('invoice'), { duplicateFileIds: dupIds })
    expect(result.total).toBe(1)
    expect(result.files[0].name).toBe('invoice2024.pdf')
  })

  it('ext:mp4', () => {
    const result = searchFiles(index, parseQuery('ext:mp4'), { duplicateFileIds: dupIds })
    expect(result.files[0].name).toBe('video.mp4')
  })

  it('size:>100MB', () => {
    const result = searchFiles(index, parseQuery('size:>100MB'), { duplicateFileIds: dupIds })
    expect(result.files[0].name).toBe('video.mp4')
  })

  it('*.jpg wildcard + duplicate معًا', () => {
    const result = searchFiles(index, parseQuery('*.jpg duplicate'), { duplicateFileIds: dupIds })
    expect(result.total).toBe(2)
  })

  it('path:D:\\Backup', () => {
    const result = searchFiles(index, parseQuery('path:D:\\Backup'), { duplicateFileIds: dupIds })
    expect(result.files[0].directory).toBe('D:\\Backup')
  })
})

describe('groupsFromFullHashMap — إعادة بناء النتائج عند بدء التشغيل', () => {
  it('يبني المجموعات من الفهرس المحفوظ', () => {
    const index = new MemoryIndex()
    index.bulkLoad([file(1, 'a.jpg', 100, 1), file(3, 'c.jpg', 100, 3), file(2, 'b.jpg', 200, 2)])
    // h1 مشترك بين 1 و3 → مجموعة
    const groups = groupsFromFullHashMap(index.fullHashEntries().map(([hash, files]) => [
      hash,
      files.map((f) => ({ ...f, fullHash: hash }))
    ]))
    expect(groups).toHaveLength(1)
    expect(groups[0].files.map((f) => f.id).sort()).toEqual([1, 3])
    expect(groups[0].reclaimedBytes).toBe(100)
  })
})

describe('الترتيب', () => {
  it('sortFileSummaries حسب الحجم', () => {
    const files = [file(1, 'a.txt', 30, 1), file(2, 'b.txt', 10, 2), file(3, 'c.txt', 20, 3)].map((f) => ({
      ...f,
      drive: 'C',
      inDuplicateGroup: false
    }))
    const sorted = sortFileSummaries(files, 'size', 'desc')
    expect(sorted.map((f) => f.size)).toEqual([30, 20, 10])
  })

  it('sortGroups حسب المساحة القابلة للاسترداد', () => {
    const g1 = groupsFromFullHashMap([]) // فارغ — نبني يدويًا بدلًا منه
    void g1
    const groups = [
      { id: '1', hash: 'h', hashKind: 'full' as const, size: 10, fileCount: 2, reclaimedBytes: 10, files: [] },
      { id: '2', hash: 'h', hashKind: 'full' as const, size: 10, fileCount: 5, reclaimedBytes: 40, files: [] }
    ]
    const sorted = sortGroups(groups, 'reclaimed', 'desc')
    expect(sorted[0].id).toBe('2')
  })
})
