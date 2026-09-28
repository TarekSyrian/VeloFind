import { BACKUP_FOLDER_HINTS, DOWNLOADS_HINTS } from './constants'
import type { DuplicateFileInfo, DuplicateGroup } from './types'

/**
 * قواعد التحديد التلقائي للنسخ المكررة — PRD §14
 * دوال نقية قابلة للاختبار، تُستخدم من الواجهة مباشرة.
 * مبدأ أساسي: لا يتم أبدًا تحديد جميع نسخ المجموعة — تبقى نسخة الأصل محفوظة.
 */

export type KeepRule = 'oldest' | 'newest' | 'outside_downloads' | 'in_folder'

export interface AutoSelectOptions {
  /** أي نسخة يُبقى عليها؟ */
  keep: KeepRule
  /** عند keep = in_folder: المجلد المطلوب الإبقاء داخله */
  keepFolder?: string
  /** تحديد النسخ الموجودة في مجلدات النسخ الاحتياطي فقط */
  markBackupsOnly?: boolean
  /** مجلدات لا يُسمح بالتحديد داخلها أبدًا */
  neverSelectFolders?: string[]
}

/**
 * مطابقة مجلد كسلسلة بادئة: يجب أن ينتهي عند حدّ مسار فعلي.
 * بلا هذا الشرط كان `C:\Data\Photos` يطابق `C:\Data\PhotosBackup\...`
 * فيُحفظ خطأً أصلٌ من خارج المجلد المقصود وتبقى النسخة الحقيقية قابلة للحذف.
 */
function isUnderDirectory(directory: string, parent: string): boolean {
  const dir = directory.toLowerCase().replace(/[\\/]+$/, '')
  const root = parent.toLowerCase().replace(/[\\/]+$/, '')
  if (!root) return false
  return dir === root || dir.startsWith(root + '\\') || dir.startsWith(root + '/')
}

/**
 * كلمات دل على مجلد نسخ احتياطي — يجب أن تطابق اسم مجلد كاملًا (مقطعًا مستقلًا)
 * لا جزءًا من أي كلمة: المطابقة الجزئية تجعل `C:\Users\holder` و`Golden`
 * مجلّدَي نسخ احتياطي فتُتخطّى من التحديد التلقائي بصمت.
 *
 * مقصود: مطابقة تامة فقط لا مطابقة حدّية، لأن هذه الكلمة تُستخدم لتحديد ملفات
 * للحذف — والأمان هنا أهم من التغطية: لا نحدّد ملفًا على أساس تخمين.
 */
export function isBackupPath(directory: string): boolean {
  const segments = directory.toLowerCase().split(/[\\/]+/)
  return BACKUP_FOLDER_HINTS.some((hint) => segments.includes(hint))
}

/**
 * مجلد التنزيلات: مقطع مستقل، أو مقطع يبدأ بالكلمة متبوعًا بفاصل
 * (`Downloads (2)` و `downloads-old` و `التنزيلات (2)` كلها مجلدات تنزيلات).
 * اتجاه المطابقة هنا أوسع من النسخ الاحتياطي عمدًا: هذه الكلمة تحمي ملفًا من
 * الاختيار لا تختاره للحذف، فالخطأ في الاتجاهين غير ضار.
 */
export function isDownloadsPath(directory: string): boolean {
  const segments = directory.toLowerCase().split(/[\\/]+/)
  return DOWNLOADS_HINTS.some((hint) => segments.some((s) => isHintSegment(s, hint)))
}

/** مطابقة مقطع مع ترخيص لاحقة مفصولة بفاصل: downloads / downloads (2) / downloads-old */function isHintSegment(segment: string, hint: string): boolean {
  if (segment === hint) return true
  if (!segment.startsWith(hint)) return false
  const next = segment.charAt(hint.length)
  return next === ' ' || next === '_' || next === '-' || next === '.'
}

function byOldest(a: DuplicateFileInfo, b: DuplicateFileInfo): number {
  return a.modifiedAt - b.modifiedAt
}

/** اختيار نسخة الأصل وفق القاعدة — تبقى هذه النسخة غير محددة دائمًا */
export function pickKeeper(group: DuplicateGroup, opts: AutoSelectOptions): DuplicateFileInfo {
  const files = [...group.files].sort(byOldest)

  if (opts.keep === 'in_folder' && opts.keepFolder) {
    const inside = files.find((f) => isUnderDirectory(f.directory, opts.keepFolder as string))
    if (inside) return inside
  }

  switch (opts.keep) {
    case 'newest':
      return files[files.length - 1]
    case 'outside_downloads': {
      const outside = files.find((f) => !isDownloadsPath(f.directory))
      return outside ?? files[0]
    }
    case 'in_folder':
    case 'oldest':
    default:
      return files[0]
  }
}

function inNeverFolders(file: DuplicateFileInfo, folders: string[] | undefined): boolean {
  if (!folders || folders.length === 0) return false
  return folders.some((f) => isUnderDirectory(file.directory, f))
}

/**
 * حساب قائمة معرفات الملفات المحددة للحذف داخل مجموعة واحدة.
 * تضمن: نسخة الأصل غير محددة + احترام المجلدات المحمية من التحديد.
 */
export function autoSelectForGroup(group: DuplicateGroup, opts: AutoSelectOptions): number[] {
  const keeper = pickKeeper(group, opts)
  const selected: number[] = []

  for (const file of group.files) {
    if (file.id === keeper.id) continue
    if (inNeverFolders(file, opts.neverSelectFolders)) continue
    if (opts.markBackupsOnly && !isBackupPath(file.directory)) continue
    selected.push(file.id)
  }

  return selected
}

/** تطبيق القاعدة على عدة مجموعات دفعة واحدة */
export function autoSelectForGroups(groups: DuplicateGroup[], opts: AutoSelectOptions): Record<string, number[]> {
  const result: Record<string, number[]> = {}
  for (const group of groups) result[group.id] = autoSelectForGroup(group, opts)
  return result
}
