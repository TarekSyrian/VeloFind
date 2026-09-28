import type { DuplicateFileInfo, DuplicateGroup, IndexedFile } from '@shared/types'
import { driveLetterOf, extensionOf } from '../path-utils'

/**
 * المرحلة الخامسة: تكوين المجموعات — PRD §8
 * fullHash → list of files ؛ أي قيمة تحتوي أكثر من ملف تمثل مجموعة مكررة
 */

/**
 * مفتاح تجميع البصمة الجزئية — الحجم جزء من الهوية وإلا اختلطت ملفات مختلفة الحجم.
 * مصدر واحد للمفتاح: يستخدمه الكاشف عند الفحص والفهرس عند إعادة بناء المجموعات بعد
 * إعادة التشغيل (اختلاف الصيغة بين المسارين كان يُسقط مجموعات الفحص السريع بالكامل).
 */
export function partialKey(size: number, partialHash: string): string {
  return `${size}|${partialHash}`
}

export function toDuplicateFileInfo(file: IndexedFile): DuplicateFileInfo {
  return {
    id: file.id,
    path: file.path,
    name: file.name,
    directory: file.directory,
    drive: driveLetterOf(file.path),
    extension: file.extension || extensionOf(file.name),
    size: file.size,
    modifiedAt: file.modifiedAt,
    createdAt: file.createdAt,
    isHidden: file.isHidden
  }
}

/**
 * بناء المجموعات من خريطة (بصمة → ملفات).
 * kind = full: تكرار مؤكد (Exact Duplicate)
 * kind = partial: نتيجة فحص سريع (حجم + بصمة جزئية)
 */
export function buildDuplicateGroups(hashMap: Map<string, IndexedFile[]>, kind: 'full' | 'partial'): DuplicateGroup[] {
  const groups: DuplicateGroup[] = []

  for (const [hash, files] of hashMap) {
    if (files.length < 2) continue
    const size = files[0].size
    groups.push({
      id: `${kind}:${hash}`,
      hash: `${kind === 'full' ? 'sha256' : 'sha256-partial'}:${hash}`,
      hashKind: kind,
      size,
      fileCount: files.length,
      reclaimedBytes: size * (files.length - 1),
      files: files.map(toDuplicateFileInfo).sort((a, b) => a.modifiedAt - b.modifiedAt)
    })
  }

  // الأكثر استردادًا للمساحة أولًا
  groups.sort((a, b) => b.reclaimedBytes - a.reclaimedBytes)
  return groups
}

/** إعادة بناء المجموعات من الفهرس المحفوظ (عند بدء التشغيل أو بعد عمليات الملفات) */
export function groupsFromFullHashMap(entries: Array<[string, IndexedFile[]]>): DuplicateGroup[] {
  const map = new Map<string, IndexedFile[]>(entries)
  return buildDuplicateGroups(map, 'full')
}

/**
 * إعادة بناء مجموعات الفحص السريع من الفهرس المحفوظ.
 * الفحص السريع لا يحسب بصمة كاملة، فكانت المجموعات تختفي كليًا بعد إعادة تشغيل
 * التطبيق؛ تُعاد هنا بنفس صيغة المفتاح التي استخدمها الكاشف وقت الفحص.
 */
export function groupsFromPartialHashMap(entries: Array<[string, IndexedFile[]]>): DuplicateGroup[] {
  const map = new Map<string, IndexedFile[]>(entries)
  return buildDuplicateGroups(map, 'partial')
}
