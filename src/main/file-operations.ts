import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app, clipboard, shell } from 'electron'
import { SafetyRuleError, HashMismatchError, VeloFindError } from '@shared/errors'
import { QUARANTINE_FOLDER_NAME, MAX_FULL_RECHECK_SIZE } from '@shared/constants'
import { validateSelection, isProtectedPath } from '@shared/safety'
import type { DeleteItem, DuplicateGroup, FileOperationRecord, OpResult } from '@shared/types'
import type { EngineController } from '@engine/engine-controller'
import { computeFullHash } from '@engine/duplicates/full-hasher'
import { toWindowsLongPath } from '@engine/path-utils'
import type { PersistenceManager } from '@engine/persistence/persistence-manager'
import type { SettingsService } from './settings'

/**
 * خدمة عمليات الملفات — PRD §16 و§17
 * الإجراءات: سلة المحذوفات (الافتراضي)، مجلد العزل مع التراجع، الحذف النهائي المحرس
 * القواعد: منع حذف كل نسخ المجموعة، منع المساس بمجلدات النظام، إعادة التحقق قبل التنفيذ
 */

export class FileOperationsService {
  constructor(
    private engine: EngineController,
    private settings: SettingsService,
    private persistence: PersistenceManager
  ) {}

  /* ------------------- إجراءات بسيطة ------------------- */

  async openFile(filePath: string): Promise<OpResult> {
    if (!fs.existsSync(filePath)) return { ok: false, message: 'الملف غير موجود' }
    const error = await shell.openPath(toWindowsLongPath(filePath))
    return error ? { ok: false, message: error } : { ok: true }
  }

  async showInFolder(filePath: string): Promise<OpResult> {
    if (!fs.existsSync(filePath)) return { ok: false, message: 'الملف غير موجود' }
    shell.showItemInFolder(filePath)
    return { ok: true }
  }

  async copyPath(filePath: string): Promise<OpResult> {
    clipboard.writeText(filePath)
    return { ok: true, message: 'تم نسخ المسار' }
  }

  /* ------------------- الفحص الأمني قبل التنفيذ ------------------- */

  private buildGroupsMap(): Map<string, DuplicateGroup> {
    const map = new Map<string, DuplicateGroup>()
    for (const group of this.engine.listGroups()) map.set(group.id, group)
    return map
  }

  /**
   * الفحص الأمني الكامل قبل أي عملية:
   * 1) قواعد التحديد (لا حذف لكل نسخ المجموعة + مجلدات النظام)
   * 2) التحقق أن الملفات لم تتغير منذ آخر فحص (حجم + تاريخ تعديل)
   * 3) إعادة تحقق اختيارية من البصمة الكاملة — PRD §17
   * أي تغيير → إيقاف العملية بالكامل قبل المساس بأي ملف
   */
  private async precheck(items: DeleteItem[]): Promise<void> {
    if (items.length === 0) throw new VeloFindError('لم يتم تحديد أي ملفات')

    const violations = validateSelection(items, this.buildGroupsMap())
    if (violations.length > 0) throw new SafetyRuleError(violations)

    const changed: string[] = []
    const missing: string[] = []

    for (const item of items) {
      if (isProtectedPath(item.path)) {
        // محمي — التُقط بالفعل في validateSelection
        continue
      }
      const record = this.engine.getByPath(item.path)
      let stat: fs.Stats
      try {
        stat = await fsp.stat(toWindowsLongPath(item.path))
      } catch {
        missing.push(item.path)
        continue
      }
      if (record) {
        if (Math.floor(stat.mtimeMs) !== record.modifiedAt || stat.size !== record.size) {
          changed.push(item.path)
        }
      }
    }

    if (changed.length > 0 || missing.length > 0) {
      throw new HashMismatchError(
        changed.length > 0
          ? `تغير ${changed.length} ملف منذ آخر فحص؛ تم إيقاف العملية. أعد الفحص ثم أعد المحاولة`
          : `${missing.length} ملف غير موجود بالفعل؛ حدّث النتائج ثم أعد المحاولة`
      )
    }

    // إعادة التحقق من البصمة الكاملة (اختياري) — PRD §17
    if (this.settings.get('recheckBeforeDelete')) {
      const mismatched: string[] = []
      for (const item of items) {
        const record = this.engine.getByPath(item.path)
        if (!record?.fullHash) continue
        if (record.size > MAX_FULL_RECHECK_SIZE) continue // تجنب القراءات الطويلة جدًا
        try {
          const { hash } = await computeFullHash(item.path)
          if (hash !== record.fullHash) mismatched.push(item.path)
        } catch {
          // تعذر القراءة الآن — سيكتشفها stat أو فشل العملية نفسها
        }
      }
      if (mismatched.length > 0) {
        throw new HashMismatchError(`تغيرت بصمة ${mismatched.length} ملف منذ آخر فحص؛ تم إيقاف العملية`)
      }
    }
  }

  private async afterDelete(succeeded: string[]): Promise<void> {
    if (succeeded.length > 0) {
      await this.engine.removePaths(succeeded)
    }
  }

  private async logOperations(
    type: FileOperationRecord['operationType'],
    paths: string[],
    destinationOf?: (p: string) => string | null
  ): Promise<void> {
    const now = Date.now()
    for (const p of paths) {
      await this.persistence
        .logOperation({
          operationType: type,
          sourcePath: p,
          destinationPath: destinationOf ? destinationOf(p) : null,
          createdAt: now,
          reversedAt: null
        })
        .catch(() => undefined)
    }
  }

  /* ------------------- النقل إلى سلة المحذوفات (الافتراضي) ------------------- */

  async recycle(items: DeleteItem[]): Promise<OpResult> {
    await this.precheck(items)

    const succeeded: string[] = []
    const failed: { path: string; reason: string }[] = []

    for (const item of items) {
      try {
        await shell.trashItem(item.path)
        succeeded.push(item.path)
        await this.persistence
          .logOperation({ operationType: 'recycle', sourcePath: item.path, destinationPath: null, createdAt: Date.now(), reversedAt: null })
          .catch(() => undefined)
      } catch (error) {
        failed.push({ path: item.path, reason: (error as Error).message ?? 'فشل النقل إلى سلة المحذوفات' })
      }
    }

    await this.afterDelete(succeeded)
    return {
      ok: failed.length === 0,
      succeeded,
      failed,
      message:
        failed.length === 0
          ? `تم نقل ${succeeded.length} ملف إلى سلة المحذوفات`
          : `نجح نقل ${succeeded.length} وفشل ${failed.length}`
    }
  }

  /* ------------------- النقل إلى مجلد العزل مع التراجع ------------------- */

  private quarantineRoot(): string {
    const configured = this.settings.get('quarantinePath')
    return configured && configured.trim().length > 0
      ? configured
      : path.join(app.getPath('userData'), QUARANTINE_FOLDER_NAME)
  }

  async quarantine(items: DeleteItem[]): Promise<OpResult> {
    await this.precheck(items)

    const root = this.quarantineRoot()
    const batchDir = path.join(root, `batch-${Date.now()}`)
    await fsp.mkdir(batchDir, { recursive: true })

    const succeeded: string[] = []
    const destinations = new Map<string, string>()
    const failed: { path: string; reason: string }[] = []

    for (const item of items) {
      try {
        let target = path.join(batchDir, path.basename(item.path))
        let counter = 1
        while (fs.existsSync(target)) {
          const ext = path.extname(item.path)
          const base = path.basename(item.path, ext)
          target = path.join(batchDir, `${base} (${counter})${ext}`)
          counter += 1
        }
        try {
          await fsp.rename(toWindowsLongPath(item.path), toWindowsLongPath(target))
        } catch {
          // عبر أقراص مختلفة: نسخ ثم حذف
          await fsp.copyFile(toWindowsLongPath(item.path), toWindowsLongPath(target))
          await fsp.unlink(toWindowsLongPath(item.path))
        }
        succeeded.push(item.path)
        destinations.set(item.path, target)
        await this.persistence
          .logOperation({
            operationType: 'quarantine',
            sourcePath: item.path,
            destinationPath: target,
            createdAt: Date.now(),
            reversedAt: null
          })
          .catch(() => undefined)
      } catch (error) {
        failed.push({ path: item.path, reason: (error as Error).message ?? 'فشل النقل إلى العزل' })
      }
    }

    await this.afterDelete(succeeded)
    return {
      ok: failed.length === 0,
      succeeded,
      failed,
      message:
        failed.length === 0
          ? `تم نقل ${succeeded.length} ملف إلى مجلد العزل (قابل للتراجع)`
          : `نجح نقل ${succeeded.length} وفشل ${failed.length}`
    }
  }

  /* ------------------- الحذف النهائي (خيار متقدم محرس) ------------------- */

  async deletePermanent(items: DeleteItem[], confirmed: boolean): Promise<OpResult> {
    if (!confirmed) {
      return { ok: false, message: 'الحذف النهائي يتطلب تأكيدًا صريحًا من المستخدم' }
    }
    await this.precheck(items)

    const succeeded: string[] = []
    const failed: { path: string; reason: string }[] = []

    for (const item of items) {
      try {
        await fsp.unlink(toWindowsLongPath(item.path))
        succeeded.push(item.path)
        await this.persistence
          .logOperation({ operationType: 'permanent_delete', sourcePath: item.path, destinationPath: null, createdAt: Date.now(), reversedAt: null })
          .catch(() => undefined)
      } catch (error) {
        failed.push({ path: item.path, reason: (error as Error).message ?? 'فشل الحذف' })
      }
    }

    await this.afterDelete(succeeded)
    return {
      ok: failed.length === 0,
      succeeded,
      failed,
      message: failed.length === 0 ? `تم حذف ${succeeded.length} ملف نهائيًا` : `نجح حذف ${succeeded.length} وفشل ${failed.length}`
    }
  }

  /* ------------------- سجل العمليات والتراجع ------------------- */

  async listOperations(): Promise<FileOperationRecord[]> {
    return this.persistence.loadOperations()
  }

  /** التراجع عن عملية عزل: إعادة الملف إلى موقعه الأصلي — PRD §16 */
  async undo(id: number): Promise<OpResult> {
    const ops = await this.persistence.loadOperations()
    const op = ops.find((o) => o.id === id)
    if (!op) return { ok: false, message: 'العملية غير موجودة' }
    if (op.reversedAt) return { ok: false, message: 'تم التراجع عن هذه العملية مسبقًا' }
    if (op.operationType === 'recycle') {
      return { ok: false, message: 'استعد الملفات من سلة محذوفات Windows ثم حدّث الفحص' }
    }
    if (op.operationType === 'permanent_delete') {
      return { ok: false, message: 'لا يمكن التراجع عن الحذف النهائي' }
    }
    if (!op.destinationPath || !fs.existsSync(op.destinationPath)) {
      return { ok: false, message: 'الملف المعزول لم يعد موجودًا في مجلد العزل' }
    }

    try {
      await fsp.mkdir(path.dirname(op.sourcePath), { recursive: true })
      await fsp.rename(toWindowsLongPath(op.destinationPath), toWindowsLongPath(op.sourcePath))
      await this.persistence.markOperationReversed(id, Date.now())
      return { ok: true, message: `تمت إعادة الملف إلى: ${op.sourcePath}` }
    } catch (error) {
      return { ok: false, message: (error as Error).message ?? 'فشل التراجع' }
    }
  }
}
