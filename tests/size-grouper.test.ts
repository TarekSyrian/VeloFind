import { describe, expect, it } from 'vitest'
import { groupBySize, candidateSizeGroups } from '@engine/duplicates/size-grouper'
import type { IndexedFile } from '@shared/types'

function file(id: number, size: number, path?: string): IndexedFile {
  return {
    id,
    volumeId: 'C',
    name: `f${id}.bin`,
    path: path ?? `C:\\data\\f${id}.bin`,
    directory: 'C:\\data',
    extension: 'bin',
    size,
    modifiedAt: id,
    createdAt: id,
    attributes: 0,
    isHidden: false,
    scanState: 'scanned'
  }
}

describe('groupBySize — PRD §8 المرحلة الثانية', () => {
  it('يجمع الملفات ذات الحجم نفسه', () => {
    const groups = groupBySize([file(1, 100), file(2, 200), file(3, 100)])
    expect(groups.get(100)).toHaveLength(2)
    expect(groups.get(200)).toHaveLength(1)
  })

  it('يعيد خريطة فارغة لقائمة فارغة', () => {
    expect(groupBySize([]).size).toBe(0)
  })
})

describe('candidateSizeGroups — تجاهل الملفات الأحادية', () => {
  it('يرجع فقط المجموعات التي تحتوي أكثر من ملف', () => {
    // وفق مثال PRD: 1KB → ملف واحد → تجاهل، 25MB → 4 ملفات، 100MB → 2 ملفات
    const kb = 1024, mb = 1024 * 1024
    const files = [
      file(1, kb),
      file(2, 25 * mb), file(3, 25 * mb), file(4, 25 * mb), file(5, 25 * mb),
      file(6, 100 * mb), file(7, 100 * mb)
    ]
    const candidates = candidateSizeGroups(files)
    expect(candidates).toHaveLength(2)
    expect(candidates[0][0].size).toBe(25 * mb) // الأصغر أولًا — PRD §20
    expect(candidates[0]).toHaveLength(4)
    expect(candidates[1]).toHaveLength(2)
  })

  it('يرجع مصفوفة فارغة عندما لا توجد تكرارات حسب الحجم', () => {
    expect(candidateSizeGroups([file(1, 1), file(2, 2), file(3, 3)])).toHaveLength(0)
  })

  it('يتجاهل الملفات الفارغة (0 بايت) مهما تعددت', () => {
    // الملفات الفارغة لا محتوى لها — لا تُعد مكررات وفقًا لإصلاح v0.3.0
    const files = [file(1, 0), file(2, 0), file(3, 0), file(4, 100), file(5, 100)]
    const candidates = candidateSizeGroups(files)
    expect(candidates).toHaveLength(1)
    expect(candidates[0][0].size).toBe(100)
  })
})
