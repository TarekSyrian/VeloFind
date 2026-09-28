import type { IndexedFile } from '@shared/types'
import { extensionOf } from '../path-utils'

/**
 * المرحلة الثانية: التجميع حسب الحجم — PRD §8
 * لا تُحسب أي بصمة لملف لا يوجد ملف آخر بنفس حجمه
 */

/** تجميع الملفات حسب الحجم */
export function groupBySize(files: IndexedFile[]): Map<number, IndexedFile[]> {
  const groups = new Map<number, IndexedFile[]>()
  for (const file of files) {
    const bucket = groups.get(file.size)
    if (bucket) bucket.push(file)
    else groups.set(file.size, [file])
  }
  return groups
}

/** المجموعات المرشحة فقط (أكثر من ملف بالحجم نفسه) — الأصغر أولًا (PRD §20) */
export function candidateSizeGroups(files: IndexedFile[]): IndexedFile[][] {
  const groups: IndexedFile[][] = []
  for (const bucket of groupBySize(files).values()) {
    // الملفات الفارغة (0 بايت) لا محتوى لها للمقارنة — استثناؤها يمنع مجموعة ضخمة بلا فائدة
    if (bucket.length > 1 && bucket[0].size > 0) groups.push(bucket)
  }
  groups.sort((a, b) => a[0].size - b[0].size)
  return groups
}

/** اسم العرض لمجموعة حجم (تُستخدم في السجلات) */
export function sizeGroupLabel(group: IndexedFile[]): string {
  const file = group[0]
  return `${file?.name ?? '?'} (${group.length} ملفات — ${extensionOf(file?.name ?? '') || 'بلا امتداد'})`
}
