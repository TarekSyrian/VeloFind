import type { FileCategory, IndexedFile, ScanWarning } from '@shared/types'
import { CATEGORY_EXTENSIONS } from '@shared/constants'
import fsp from 'node:fs/promises'
import { DirectoryWalker } from './directory-walker'
import type { WalkEntry } from './directory-walker'
import { isExcludedFolderName } from './directory-walker'
import { CancellationToken, PauseGate, runPool } from '../concurrency'
import { extensionOf, isUnderPath, pathKey, toWindowsLongPath } from '../path-utils'

/**
 * جامع بيانات الملفات وتحويلها إلى سجلات مفهرسة
 * الاستكمال التزايدي: الملف الذي لم يتغير (حجم + تاريخ تعديل) يُعاد استخدامه ببصماته — PRD §15
 * الفهرس تراكمي عبر الفحوصات والأقراص: الملفات المفهرسة سابقًا خارج مواقع هذا الفحص
 * تُحمل إلى اللقطة (مع تحقق stat خفيف) حتى تُقارن دائمًا مع كل الأقراص — إصلاح المكررات العابرة للأقراص
 */

export interface ScanFilters {
  minSize: number
  category: FileCategory
  extensions: string[]
  includeHidden: boolean
}

export interface CollectResult {
  files: IndexedFile[]
  removedIds: number[]
  added: number
  changed: number
  unchanged: number
  /** ملفات مفهرسة سابقًا خارج مواقع هذا الفحص حُملت إلى اللقطة كما هي */
  carriedOver: number
  warnings: ScanWarning[]
}

export interface CollectOptions {
  locations: string[]
  excluded: string[]
  excludedFolderNames?: string[]
  excludeSystemFolders: boolean
  /** المسارات الحقيقية لمجلدات النظام (resolveSystemFolderPaths) */
  systemPaths?: string[]
  /** الفهرس الكامل قبل الفحص (كل الأقراص) */
  previous: IndexedFile[]
  /** إعادة استخدام بصمات الملفات غير المتغيرة ضمن مواقع الفحص */
  incremental: boolean
  nextId: number
  token: CancellationToken
  gate: PauseGate
  onWalkProgress: (scanned: number, currentPath: string) => void
}

/** عدد ملفات تُحدَّث خصائصها بالتوازي في مرحلة تحقق الحمل */
const CARRY_STAT_CONCURRENCY = 32

function extensionAllowed(entry: { name: string; directory: string }, filters: ScanFilters): boolean {
  switch (filters.category) {
    case 'all':
      return true
    case 'custom': {
      if (filters.extensions.length === 0) return true
      const ext = extensionOf(entry.name)
      return filters.extensions.includes(ext)
    }
    default: {
      const ext = extensionOf(entry.name)
      return CATEGORY_EXTENSIONS[filters.category].includes(ext)
    }
  }
}

export class FileScanner {
  /** بناء خريطة الحالة السابقة (مسار → سجل) للملفات ضمن مواقع الفحص */
  static buildPreviousMap(
    previous: IndexedFile[],
    locations: string[],
    excluded: string[],
    excludedFolderNames: string[] = []
  ): Map<string, IndexedFile> {
    const map = new Map<string, IndexedFile>()
    for (const file of previous) {
      if (!locations.some((loc) => isUnderPath(file.path, loc))) continue
      if (excluded.some((ex) => isUnderPath(file.path, ex))) continue
      // ملف داخل مجلد مستثنى بالاسم (تحت جذر الموقع) يُحذف من الفهرس — متسق مع تخطي المتجول له
      if (isUnderExcludedFolderName(file.path, locations, excludedFolderNames)) continue
      map.set(pathKey(file.path), file)
    }
    return map
  }

  /** الملفات المفهرسة سابقًا التي تقع خارج مواقع هذا الفحص كله — تُحمل إلى اللقطة */
  static filesOutsideLocations(previous: IndexedFile[], locations: string[]): IndexedFile[] {
    return previous.filter((file) => !locations.some((loc) => isUnderPath(file.path, loc)))
  }

  async collect(filters: ScanFilters, options: CollectOptions): Promise<CollectResult> {
    const { token, gate } = options
    const previousMap = options.incremental
      ? FileScanner.buildPreviousMap(
          options.previous,
          options.locations,
          options.excluded,
          options.excludedFolderNames ?? []
        )
      : new Map<string, IndexedFile>()
    const files: IndexedFile[] = []
    const seenPaths = new Set<string>()
    const warnings: ScanWarning[] = []
    let added = 0
    let changed = 0
    let unchanged = 0
    let nextId = options.nextId

    const walker = new DirectoryWalker(
      {
        locations: options.locations,
        excluded: options.excluded,
        excludedFolderNames: options.excludedFolderNames,
        includeHidden: filters.includeHidden,
        excludeSystemFolders: options.excludeSystemFolders,
        systemPaths: options.systemPaths
      },
      token,
      gate
    )

    const now = Date.now()

    await walker.walk({
      onEntry: (entry: WalkEntry) => {
        if (entry.size < filters.minSize) return
        if (!extensionAllowed(entry, filters)) return

        const key = pathKey(entry.path)
        seenPaths.add(key)

        const prev = previousMap.get(key)
        if (prev && prev.size === entry.size && prev.modifiedAt === entry.modifiedAt) {
          // لم يتغير → إعادة استخدام البصمات المحفوظة (عدم إعادة قراءة الملف)
          files.push({ ...prev, lastScannedAt: now, scanState: 'unchanged' })
          unchanged += 1
          return
        }

        const record: IndexedFile = {
          id: prev ? prev.id : nextId++,
          volumeId: entry.volumeId,
          name: entry.name,
          path: entry.path,
          directory: entry.directory,
          extension: extensionOf(entry.name),
          size: entry.size,
          modifiedAt: entry.modifiedAt,
          createdAt: entry.createdAt,
          attributes: entry.attributes,
          isHidden: entry.isHidden,
          // ملف جديد أو متغير → بصماته القديمة لصالحها (PRD §10 التحديثات)
          scanState: prev ? 'changed' : 'new'
        }
        if (prev) changed += 1
        else added += 1
        files.push(record)
      },
      onProgress: options.onWalkProgress,
      onWarning: (w) => warnings.push(w)
    })

    // الملفات التي كانت في الفهرس ولم تعد موجودة → إزالة (PRD §10)
    const removedIds: number[] = []
    for (const [key, prev] of previousMap) {
      if (!seenPaths.has(key)) {
        removedIds.push(prev.id)
      }
    }

    // حمل الملفات خارج مواقع هذا الفحص — بقاء الفهرس تراكميًا عبر الأقراص والفحوصات
    const outside = FileScanner.filesOutsideLocations(options.previous, options.locations)
    const carried = await refreshCarriedFiles(outside, token, gate)
    files.push(...carried.files)

    return {
      files,
      removedIds,
      added,
      changed,
      unchanged,
      carriedOver: carried.count,
      warnings
    }
  }
}

/**
 * تحقق stat خفيف للملفات المحمولة من فحوصات سابقة:
 * - القرص غير متاح (جذر القرص لا يُقرأ) → تُحمل الملفات كما هي دون أي فحص (حماية الأقراص غير المتصلة)
 * - الحجم وتاريخ التعديل كما هما وبها بصمات → scanState = unchanged (إعادة استخدام البصمات دون قراءة)
 * - تغيّر الحجم/التاريخ → تُصفَّر بصماته ويُعاد تصنيفه جديدًا ليُبصم في هذا الفحص
 * - اختفى من القرص بينما القرص متاح → scanState = missing (يبقى بالفهرس حتى فحص موقعه، ويُستبعد من المجموعات)
 * - تعذّر الفحص لأي سبب آخر (صلاحيات/مقفل/شبكة) → scanState = unreadable مع تصفير البصمات
 *   (لا يجوز الوثوق ببصمة قديمة: تجميدها تُسقط مكررات الملف الحقيقية)
 */
export async function refreshCarriedFiles(
  files: IndexedFile[],
  token: CancellationToken,
  gate: PauseGate
): Promise<{ files: IndexedFile[]; count: number }> {
  if (files.length === 0) return { files: [], count: 0 }

  // بوابة القرص: إن لم يُقرأ جذر وحدة التخزين نحمل ملفاتها كما هي بلا فحص
  // (قرص غير متصل/شبكة مقطوعة) — لا يجوز أن نبني مجموعات مكررات من بيانات لم تتحقق
  const byRoot = new Map<string, IndexedFile[]>()
  for (const file of files) {
    const root = volumeRootOf(file.path)
    const bucket = byRoot.get(root)
    if (bucket) bucket.push(file)
    else byRoot.set(root, [file])
  }

  const result: IndexedFile[] = []
  for (const [root, bucket] of byRoot) {
    // جذر غير معروف (مسار نادر خارج الأنماط الثلاثة) → لا نُغلق البوابة:
    // الافتراض الصحيح هو «افحص كل ملف» لا «اعتبر الوحدة كلها غير متصلة».
    // الافتراض الثاني هو نمط الخطأ نفسه: تجميد بيانات قديمة إلى الأبد.
    if (root !== '' && !(await volumeRootAvailable(root))) {
      result.push(...bucket.map((f) => withStatePreserved(f)))
      continue
    }

    // النتائج تُكتب بمكانها الأصلي — ترتيب ثابت لا يتغير بين الفحوصات
    const refreshed: IndexedFile[] = new Array(bucket.length)
    await runPool(
      bucket,
      CARRY_STAT_CONCURRENCY,
      async (file, index) => {
        token.throwIfCancelled()
        refreshed[index] = await refreshOne(file, fsp)
      },
      token,
      gate
    )
    result.push(...refreshed)
  }

  return { files: result, count: result.length }
}

/**
 * بوابة توفر وحدة التخزين.
 * ملاحظة حرجة: لا يجوز تمرير بادئة ‎\\?\‎ هنا — فـ stat على جذر ‎\\?\C:\‎ يرمي EISDIR
 * على Windows، فتُعتبر كل الأقراص غير متصلة ويُحمَّل ملفاتها ببيانات وبصمات قديمة
 * تُوثَّق بها إلى الأبد (السبب الجذري لفوات المكررات العابرة للأقراص).
 * الجذر قصير جدًا فلا يعرّضه حد 260 محرفًا أبدًا، فـ stat المباشر هو الخيار الصحيح.
 */
async function volumeRootAvailable(root: string): Promise<boolean> {
  if (!root) return false
  try {
    await fsp.stat(root)
    return true
  } catch {
    return false
  }
}
/** الحفاظ على الملف كما هو مع تفعيل إعادة استخدام بصماته إن وُجدت */
function withStatePreserved(file: IndexedFile): IndexedFile {
  const hasHash = Boolean(file.partialHash || file.fullHash)
  return {
    ...file,
    scanState: hasHash && file.scanState !== 'missing' ? 'unchanged' : file.scanState
  }
}

/**
 * جذر وحدة التخزين الذي يقع فيه المسار — يُستخدم كبوابة توفر:
 *   X:\...            → X:\
 *   /mnt/data/...     → /
 *   \\server\share\.. → \\server\share
 * المسار يُشتق من المسار نفسه لا من volumeId (قد يكون فارغًا أو قديمًا في السجلات المحمولة).
 */
function volumeRootOf(filePath: string): string {
  const drive = /^([a-zA-Z]):[\\/]/.exec(filePath)
  if (drive) return `${drive[1]}:\\`
  if (filePath.startsWith('/')) return '/'
  if (filePath.startsWith('\\\\')) {
    const parts = filePath.replace(/[\\/]+$/, '').split(/[\\/]/)
    if (parts.length >= 3 && parts[1] && parts[2]) return `\\\\${parts[1]}\\${parts[2]}`
  }
  return ''
}

async function refreshOne(file: IndexedFile, fsp: typeof import('node:fs/promises')): Promise<IndexedFile> {
  try {
    const st = await fsp.stat(toWindowsLongPath(file.path))
    const mtime = Math.floor(st.mtimeMs)
    if (st.size === file.size && mtime === file.modifiedAt) {
      return withStatePreserved(file)
    }
    // تغير الملف منذ آخر فحص → بصماته القديمة تسقط ويُعاد حسابها
    return {
      ...file,
      size: st.size,
      modifiedAt: mtime,
      createdAt: Math.floor(st.birthtimeMs || st.ctimeMs),
      partialHash: undefined,
      fullHash: undefined,
      hashAlgorithm: undefined,
      scanState: 'new'
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      // مفقود بينما القرص متاح → يبقى بالفهرس لكنه مستبعد من المجموعات حتى يُفحص موقعه
      return { ...file, scanState: 'missing' }
    }
    // تعذّر التحقق (صلاحيات/مقفل/شبكة): لا يجوز الوثوق ببصمة وحجم قديمين —
//    تجميد الملف كمكرر مؤكد كان يُسقط مكرراته الحقيقية. تُصفَّر البصمات
    // وتُعاد محاولة قراءته في الفحص التالي بدل تثبيت نتيجة خاطئة.
    return {
      ...file,
      partialHash: undefined,
      fullHash: undefined,
      hashAlgorithm: undefined,
      scanState: 'unreadable'
    }
  }
}

/** هل يقع المسار داخل مجلد مستثنى بالاسم (مقارنة بمقاطع المسار تحت جذر الموقع)؟ */
export function isUnderExcludedFolderName(
  filePath: string,
  locations: string[],
  excludedFolderNames: string[]
): boolean {
  if (excludedFolderNames.length === 0) return false
  const segments = pathSegmentsUnderLocation(filePath, locations)
  return segments.some((seg) => isExcludedFolderName(seg, excludedFolderNames))
}

/** مقاطع المسار تحت أول موقع يشمله (جذر الموقع نفسه مستبعد من المقاطع) */
function pathSegmentsUnderLocation(filePath: string, locations: string[]): string[] {
  for (const loc of locations) {
    const rel = relativeUnder(filePath, loc)
    if (rel) return rel.split('\\')
  }
  return []
}

function relativeUnder(filePath: string, location: string): string | null {
  const np = pathKey(filePath).replace(/[\\]+$/, '')
  const nl = pathKey(location).replace(/[\\]+$/, '')
  if (np === nl || !np.startsWith(nl + '\\')) return null
  return np.slice(nl.length + 1)
}
