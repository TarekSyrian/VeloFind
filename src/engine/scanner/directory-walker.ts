import fs from 'node:fs/promises'
import type { Stats, Dirent } from 'node:fs'
import path from 'node:path'
import type { ScanWarning } from '@shared/types'
import { DRIVE_ROOT_EXCLUDES } from '@shared/constants'
import { CancellationToken, PauseGate } from '../concurrency'
import { driveLetterOf, normalizePath, toWindowsLongPath } from '../path-utils'

/**
 * التجول في شجرة المجلدات — PRD §8 المرحلة الأولى
 * يجمع: المسار، الاسم، الحجم، تواريخ التعديل/الإنشاء، الخصائص، القرص
 * قواعد: تجاهل الروابط الرمزية/نقاط الربط (PRD §9)، تجاهل المستثنى، مرونة مع الأخطاء
 */

export interface WalkEntry {
  path: string
  name: string
  directory: string
  size: number
  modifiedAt: number
  createdAt: number
  attributes: number
  isHidden: boolean
  volumeId: string
}

export interface WalkOptions {
  locations: string[]
  excluded: string[]
  /** أسماء مجلدات تُستثنى في أي مكان بالشجرة (node_modules وغيرها) */
  excludedFolderNames?: string[]
  includeHidden: boolean
  excludeSystemFolders: boolean
  /** المسارات الحقيقية لمجلدات النظام (من resolveSystemFolderPaths) — تُستثنى هي فقط لا الأسماء المتشابهة */
  systemPaths?: string[]
}

export interface WalkHooks {
  onEntry: (entry: WalkEntry) => void
  onProgress: (scanned: number, currentPath: string) => void
  onWarning: (warning: ScanWarning) => void
}

const FILE_ATTRIBUTE_HIDDEN = 0x2

function isExcludedPath(p: string, excluded: string[]): boolean {
  const np = normalizePath(p)
  return excluded.some((e) => {
    const ne = normalizePath(e)
    return np === ne || np.startsWith(ne + '\\')
  })
}

/** مطابقة اسم مجلد ضمن قائمة الاستثناء — غير حساسة لحالة الأحرف */
export function isExcludedFolderName(name: string, excluded: string[] | undefined): boolean {
  if (!excluded || excluded.length === 0) return false
  const lower = name.toLowerCase()
  return excluded.some((e) => e.toLowerCase() === lower)
}

function nameLooksHidden(name: string): boolean {
  return name.startsWith('.')
}

/** هل المسار جذر قرص مباشر (X:\)؟ يُستخدم لمطابقة مجلدات جذر القرص الخاصة فقط */
export function isDriveRoot(p: string): boolean {
  return /^[a-zA-Z]:[\\/]?$/.test(p.trim())
}

/** هل المجلد يقع مباشرةً تحت جذر قرص (والده جذر القرص)؟ */
function parentIsDriveRoot(dir: string): boolean {
  return isDriveRoot(path.dirname(dir))
}

/** قرار استثناء مجلد حسب قواعد النظام: مسارات النظام الحقيقية + مجلدات جذر القرص الخاصة */
function isSystemExcluded(
  dir: string,
  systemPaths: string[] | undefined,
  excludeSystemFolders: boolean
): boolean {
  if (!excludeSystemFolders) return false
  if (systemPaths && systemPaths.length > 0 && isExcludedPath(dir, systemPaths)) return true
  // مجلدات خاصة مثل $Recycle.Bin وSystem Volume Information — فقط تحت جذر القرص مباشرة
  if (parentIsDriveRoot(dir) && DRIVE_ROOT_EXCLUDES.includes(path.basename(dir).toLowerCase())) return true
  return false
}

export class DirectoryWalker {
  private scanned = 0

  constructor(
    private readonly options: WalkOptions,
    private readonly token: CancellationToken,
    private readonly gate: PauseGate
  ) {}

  async walk(hooks: WalkHooks): Promise<void> {
    for (const location of this.options.locations) {
      this.token.throwIfCancelled()
      await this.gate.wait()
      let stat: Stats
      try {
        stat = await fs.stat(toWindowsLongPath(location))
      } catch {
        hooks.onWarning({
          path: location,
          kind: 'access_denied',
          message: `تعذر الوصول إلى الموقع: ${location}`
        })
        continue
      }
      if (stat.isFile()) {
        await this.visitFile(location, path.dirname(location), hooks)
      } else if (stat.isDirectory()) {
        // الموقع مختار صراحةً من المستخدم — لا تُطبق عليه قواعد الأسماء أبدًا
        await this.walkDir(location, hooks, true)
      }
    }
  }

  private async walkDir(dir: string, hooks: WalkHooks, isRoot = false): Promise<void> {
    if (isExcludedPath(dir, this.options.excluded)) return
    // الموقع الجذري مختار صراحةً — قواعد استثناء النظام والأسماء لا تنطبق عليه
    if (!isRoot) {
      if (
        isSystemExcluded(
          dir,
          this.options.systemPaths ?? [],
          this.options.excludeSystemFolders
        )
      ) {
        return
      }
      if (nameLooksHidden(path.basename(dir)) && !this.options.includeHidden) return
      // أسماء المجلدات المستثناة تُطبق على المجلدات الفرعية فقط — المجلدات المختارة صراحةً تُفحص كاملة
      if (isExcludedFolderName(path.basename(dir), this.options.excludedFolderNames)) return
    }

    this.token.throwIfCancelled()
    await this.gate.wait()

    let entries: Dirent[]
    try {
      entries = await fs.readdir(toWindowsLongPath(dir), { withFileTypes: true })
    } catch {
      hooks.onWarning({
        path: dir,
        kind: 'access_denied',
        message: `تعذر قراءة المجلد: ${dir}`
      })
      return
    }

    for (const entry of entries) {
      this.token.throwIfCancelled()
      await this.gate.wait()

      const full = path.join(dir, entry.name)

      // الروابط الرمزية ونقاط الربط تُتجاهل لمنع العد المزدوج — PRD §9
      if (entry.isSymbolicLink()) continue

      if (entry.isDirectory()) {
        await this.walkDir(full, hooks)
      } else if (entry.isFile()) {
        await this.visitFile(full, dir, hooks)
      }
    }
  }

  private async visitFile(full: string, directory: string, hooks: WalkHooks): Promise<void> {
    try {
      const st = await fs.stat(toWindowsLongPath(full))
      const winAttrs = (st as Stats & { attributes?: number }).attributes
      const isHidden =
        winAttrs !== undefined ? (winAttrs & FILE_ATTRIBUTE_HIDDEN) !== 0 : nameLooksHidden(path.basename(full))

      if (isHidden && !this.options.includeHidden) return

      hooks.onEntry({
        path: full,
        name: path.basename(full),
        directory,
        size: st.size,
        modifiedAt: Math.floor(st.mtimeMs),
        createdAt: Math.floor(st.birthtimeMs || st.ctimeMs),
        attributes: winAttrs ?? 0,
        isHidden,
        volumeId: driveLetterOf(full)
      })

      this.scanned += 1
      if (this.scanned % 25 === 0) hooks.onProgress(this.scanned, full)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      hooks.onWarning({
        path: full,
        kind: code === 'EACCES' || code === 'EPERM' ? 'access_denied' : 'unreadable',
        message: `تعذر قراءة خصائص الملف: ${full}`
      })
      void error
    }
  }
}
