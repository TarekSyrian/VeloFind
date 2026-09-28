import { PROTECTED_PATHS } from './constants'
import type { DeleteItem, DuplicateGroup, SafetyViolation } from './types'

/**
 * محرك قواعد الأمان — PRD §17
 * دوال نقية تُستخدم في الواجهة (قبل التنفيذ) وفي العملية الرئيسية (الفرض النهائي).
 */

/** تطبيع مسار Windows للمقارنة: فواصل موحدة + أحرف صغيرة + بلا مائل زائد */
export function normalizeWinPath(path: string): string {
  return path.replace(/\//g, '\\').toLowerCase().replace(/[\\]+$/, '')
}

/** هل المسار داخل مجلد نظام محمي؟ */
export function isProtectedPath(path: string): boolean {
  const n = normalizeWinPath(path)
  return PROTECTED_PATHS.some((prefix) => n === prefix || n.startsWith(prefix + '\\'))
}

/**
 * التحقق من أمان مجموعة تحديد قبل أي عملية حذف/نقل:
 * - عدم حذف جميع نسخ أي مجموعة (يبقى نسخة واحدة على الأقل)
 * - عدم المساس بمجلدات النظام المحمية
 * - رفض المجموعات غير المعروفة
 */
export function validateSelection(items: DeleteItem[], groups: Map<string, DuplicateGroup>): SafetyViolation[] {
  const violations: SafetyViolation[] = []

  const selectedByGroup = new Map<string, Set<string>>()
  for (const item of items) {
    const set = selectedByGroup.get(item.groupId) ?? new Set<string>()
    set.add(normalizeWinPath(item.path))
    selectedByGroup.set(item.groupId, set)
  }

  for (const [groupId, selected] of selectedByGroup) {
    const group = groups.get(groupId)
    if (!group) {
      violations.push({
        kind: 'missing_group',
        groupId,
        message: 'المجموعة المرتبطة بالتحديد غير موجودة؛ يُرجى تحديث النتائج وإعادة المحاولة'
      })
      continue
    }
    const remaining = group.files.filter((f) => !selected.has(normalizeWinPath(f.path)))
    if (remaining.length === 0) {
      violations.push({
        kind: 'deletes_all_copies',
        groupId,
        message: `لا يمكن حذف جميع نسخ "${group.files[0]?.name ?? 'الملف'}" — يجب الإبقاء على نسخة واحدة على الأقل`
      })
    }
  }

  for (const item of items) {
    if (isProtectedPath(item.path)) {
      violations.push({
        kind: 'protected_path',
        path: item.path,
        message: `"${item.path}" داخل مجلد نظام محمي ولا يمكن حذفه عبر VeloFind`
      })
    }
  }

  return violations
}
