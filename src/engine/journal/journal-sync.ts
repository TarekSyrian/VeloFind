import type { ScanWarning } from '@shared/types'
import { openVolume, queryUsnJournal, readUsnChanges, buildMftPathMap, USN_REASON } from '../platform/windows/ntfs'
import { JournalStateStore } from './journal-state'
import type { UsnSnapshot } from './journal-state'
import path from 'node:path'
import fs from 'node:fs/promises'

/**
 * مزامنة الفهرس مع USN Journal — PRD §10 (الطريقة المتقدمة) و§28
 * تجريبي: يتطلب Windows + koffi + NTFS؛ أي فشل → out_of_sync → إعادة فحص كامل للقرص
 */

export type SyncOutcome = 'applied' | 'out_of_sync' | 'skipped' | 'unsupported' | 'error'

export interface JournalSyncDeps {
  stateStore: JournalStateStore
  enabled: boolean
  /** تطبيق تغيير على الفهرس */
  onFileCreated?: (path: string) => void
  onFileDeleted?: (path: string) => void
  onFileChanged?: (path: string) => void
  onOutOfSync?: (drive: string) => void
  onApplied?: (drive: string, count: number) => void
}

export class JournalSyncService {
  constructor(private readonly deps: JournalSyncDeps) {}

  /** مزامنة قرص واحد: قراءة التغييرات الجديدة وتطبيقها على الفهرس */
  async syncVolume(drive: string): Promise<SyncOutcome> {
    if (!this.deps.enabled) return 'skipped'
    if (process.platform !== 'win32') return 'unsupported'

    const letter = drive.replace(/:$/, '').charAt(0).toUpperCase()
    const handle = await openVolume(letter)
    if (!handle) return 'unsupported'

    try {
      const snapshot = await queryUsnJournal(handle)
      if (!snapshot) return 'unsupported'

      const saved = await this.deps.stateStore.load(letter)

      // فقدان التزامن: نقطة البداية المحفوظة لم تعد موجودة → إعادة فهرسة كاملة — PRD §10
      if (!saved || saved.status !== 'ok' || saved.journalId !== snapshot.journalId) {
        await this.deps.stateStore.save({
          drive: letter,
          journalId: snapshot.journalId,
          nextUsn: snapshot.nextUsn,
          lastSyncAt: Date.now(),
          status: 'out_of_sync'
        })
        this.deps.onOutOfSync?.(letter)
        return 'out_of_sync'
      }

      if (!saved.nextUsn) {
        await this.saveOk(letter, snapshot)
        return 'applied'
      }

      const records = await readUsnChanges(handle, snapshot.journalId, saved.nextUsn)
      if (records === null) return 'error'

      // لا تغييرات؟ نحدّث المؤشر فقط
      const meaningful = records.filter((r) => r.reason & (USN_REASON.CLOSE | USN_REASON.FILE_CREATE | USN_REASON.FILE_DELETE | USN_REASON.RENAME_NEW_NAME | USN_REASON.DATA_EXTEND | USN_REASON.DATA_TRUNCATION))
      if (meaningful.length === 0) {
        await this.saveOk(letter, snapshot)
        return 'applied'
      }

      // بناء خريطة مسارات MFT لحل مسارات التغييرات (parent FRN → مسار)
      const mft = await buildMftPathMap(handle)
      if (!mft) return 'out_of_sync'

      let applied = 0
      for (const record of meaningful) {
        const parentPath = mft.get(record.parentFrn.toString())
        if (!parentPath) continue
        const fullPath = `${letter}:\\${parentPath.replace(/^\\/, '')}\\${record.name}`

        if (record.reason & USN_REASON.FILE_DELETE) {
          this.deps.onFileDeleted?.(fullPath)
          applied++
        } else if (record.reason & (USN_REASON.FILE_CREATE | USN_REASON.RENAME_NEW_NAME)) {
          this.deps.onFileCreated?.(fullPath)
          applied++
        } else if (record.reason & (USN_REASON.DATA_EXTEND | USN_REASON.DATA_TRUNCATION)) {
          this.deps.onFileChanged?.(fullPath)
          applied++
        }
      }

      await this.saveOk(letter, snapshot)
      this.deps.onApplied?.(letter, applied)
      return 'applied'
    } catch (error) {
      console.warn(`[velofind] فشل مزامنة USN للقرص ${letter}:`, error)
      void fs
      void path
      return 'error'
    } finally {
      handle.close()
    }
  }

  private async saveOk(drive: string, snapshot: UsnSnapshot): Promise<void> {
    await this.deps.stateStore.save({
      drive,
      journalId: snapshot.journalId,
      nextUsn: snapshot.nextUsn,
      lastSyncAt: Date.now(),
      status: 'ok'
    })
  }
}

export type { ScanWarning }
