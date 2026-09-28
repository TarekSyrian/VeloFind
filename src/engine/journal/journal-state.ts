import type { PersistenceManager } from '../persistence/persistence-manager'
import { openVolume, queryUsnJournal } from '../platform/windows/ntfs'

/**
 * حالة USN Journal لكل قرص — PRD §10 و§28
 * حفظ journal_id و next_usn واكتشاف فقدان السجلات
 */

export interface JournalState {
  drive: string
  journalId?: string
  nextUsn?: string
  lastSyncAt?: number
  status: 'ok' | 'out_of_sync' | 'disabled'
}

function settingKey(drive: string): string {
  return `journal:${drive.toLowerCase()}`
}

export class JournalStateStore {
  constructor(private readonly persistence: PersistenceManager) {}

  async load(drive: string): Promise<JournalState | null> {
    const raw = await this.persistence.getSetting(settingKey(drive))
    if (!raw) return null
    try {
      return JSON.parse(raw) as JournalState
    } catch {
      return null
    }
  }

  async save(state: JournalState): Promise<void> {
    await this.persistence.setSetting(settingKey(state.drive), JSON.stringify(state))
    // مزامنة جدول volumes حسب PRD §21
    const volumeId = state.drive.toUpperCase()
    await this.persistence.upsertVolume({
      id: volumeId,
      driveLetter: state.drive.toUpperCase(),
      journalId: state.journalId,
      nextUsn: state.nextUsn,
      lastScanAt: state.lastSyncAt,
      scanState: state.status
    })
  }

  /** هل فقد التزامن؟ (تغير journalId يعني إعادة تهيئة السجل) — PRD §28 */
  isOutOfSync(current: UsnSnapshot, saved: JournalState | null): boolean {
    if (!saved?.journalId) return true
    return saved.journalId !== current.journalId
  }
}

export interface UsnSnapshot {
  journalId: string
  nextUsn: string
}

/** التقاط لقطة حالة السجل الحالية لقرص ما */
export async function captureJournalSnapshot(drive: string): Promise<UsnSnapshot | null> {
  const handle = await openVolume(drive)
  if (!handle) return null
  try {
    const snapshot = await queryUsnJournal(handle)
    if (!snapshot) return null
    return { journalId: snapshot.journalId, nextUsn: snapshot.nextUsn }
  } finally {
    handle.close()
  }
}
