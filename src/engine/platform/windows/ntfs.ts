import { tryLoadKernel32, isValidHandle, WIN32 } from './kernel32'

/**
 * عمليات NTFS عبر DeviceIoControl — USN Journal وMFT (تجريبي — PRD §10 الطريقة المتقدمة)
 * ملاحظة: هذه الطبقة تجريبية ومحمية ببوابة مزدوجة (إعداد + متغير بيئة)؛
 * الفشل في أي مرحلة يعني التحول لإعادة الفحص عبر fs — PRD §28
 */

export const FSCTL_ENUM_USN_DATA = 0x000900b3
export const FSCTL_READ_USN_JOURNAL = 0x000900bb
export const FSCTL_QUERY_USN_JOURNAL = 0x000900f4

/** أسباب تغيير USN المستخدمة في المزامنة */
export const USN_REASON = {
  DATA_OVERWRITE: 0x00000001,
  DATA_EXTEND: 0x00000002,
  DATA_TRUNCATION: 0x00000004,
  FILE_CREATE: 0x00000100,
  FILE_DELETE: 0x00000200,
  RENAME_OLD_NAME: 0x00001000,
  RENAME_NEW_NAME: 0x00002000,
  CLOSE: 0x80000000
} as const

export interface NtfsHandle {
  raw: number
  close(): void
}

export interface UsnChangeRecord {
  usn: bigint
  frn: bigint
  parentFrn: bigint
  reason: number
  attributes: number
  name: string
}

export interface UsnJournalSnapshot {
  journalId: string
  nextUsn: string
  firstUsn: string
}

/** فتح مقبض قراءة لقرص NTFS: \\.\C: */
export async function openVolume(driveLetter: string): Promise<NtfsHandle | null> {
  const k32 = await tryLoadKernel32()
  if (!k32) return null

  const drive = driveLetter.replace(/:$/, '').toUpperCase()
  const handle = k32.CreateFileW(
    `\\\\.\\${drive}:`,
    WIN32.GENERIC_READ,
    WIN32.FILE_SHARE_READ | WIN32.FILE_SHARE_WRITE | WIN32.FILE_SHARE_DELETE,
    null,
    WIN32.OPEN_EXISTING,
    0,
    null
  )

  if (!isValidHandle(handle)) return null
  return { raw: handle, close: () => k32.CloseHandle(handle) }
}

/** الاستعلام عن حالة USN Journal للقرص */
export async function queryUsnJournal(handle: NtfsHandle): Promise<UsnJournalSnapshot | null> {
  const k32 = await tryLoadKernel32()
  if (!k32) return null

  const out = k32.alloc('uint8', 64)
  const returned = k32.alloc('uint32')
  const ok = k32.DeviceIoControl(handle.raw, FSCTL_QUERY_USN_JOURNAL, null, 0, out, 64, returned)
  if (!ok) return null

  const view = new DataView(k32.decode(out) as ArrayBuffer)
  return {
    journalId: view.getBigUint64(0, true).toString(),
    nextUsn: view.getBigUint64(8, true).toString(),
    firstUsn: view.getBigUint64(16, true).toString()
  }
}

/** قراءة سجلات التغيير من USN Journal بدءًا من nextUsn المعطى */
export async function readUsnChanges(handle: NtfsHandle, journalId: string, fromUsn: string): Promise<UsnChangeRecord[] | null> {
  const k32 = await tryLoadKernel32()
  if (!k32) return null

  // READ_USN_JOURNAL_DATA_V0: StartUsn, ReasonMask, ReturnOnlyOnClose, Timeout, BytesToWaitFor, UsnJournalID
  const input = Buffer.alloc(40)
  input.writeBigUInt64LE(BigInt(fromUsn), 0)
  input.writeUInt32LE(0xffffffff, 8) // ReasonMask: الكل
  input.writeUInt32LE(0, 12) // ReturnOnlyOnClose
  input.writeBigUInt64LE(0n, 16) // Timeout
  input.writeBigUInt64LE(0n, 24) // BytesToWaitFor (0 = لا انتظار)
  input.writeBigUInt64LE(BigInt(journalId), 32)

  const out = k32.alloc('uint8', 1024 * 1024)
  const returned = k32.alloc('uint32')
  const ok = k32.DeviceIoControl(handle.raw, FSCTL_READ_USN_JOURNAL, input, input.length, out, 1024 * 1024, returned)
  if (!ok) return null

  const buffer = Buffer.from(k32.decode(out) as ArrayBuffer)
  const returnedBytes = new DataView(k32.decode(returned) as ArrayBuffer).getUint32(0, true)
  if (returnedBytes <= 8) return []

  // أول 8 بايتات: USN التالي
  const records: UsnChangeRecord[] = []
  let offset = 8
  const limit = returnedBytes

  while (offset + 60 <= limit) {
    const recordLength = buffer.readUInt32LE(offset)
    if (recordLength < 60 || offset + recordLength > limit) break

    const frn = buffer.readBigUInt64LE(offset + 8)
    const parentFrn = buffer.readBigUInt64LE(offset + 16)
    const usn = buffer.readBigUInt64LE(offset + 24)
    const reason = buffer.readUInt32LE(offset + 40)
    const attributes = buffer.readUInt32LE(offset + 52)
    const nameLength = buffer.readUInt16LE(offset + 56)
    const nameOffset = buffer.readUInt16LE(offset + 58)
    const name = buffer.toString('utf16le', offset + nameOffset, offset + nameOffset + nameLength).replace(/\0+$/, '')

    records.push({ usn, frn, parentFrn, reason, attributes, name })
    offset += recordLength
  }

  return records
}

/**
 * بناء خريطة (FRN → مسار) عبر تعداد MFT — تُستخدم لحل مسارات التغييرات
 * FSCTL_ENUM_USN_DATA ببداية V0
 */
export async function buildMftPathMap(handle: NtfsHandle): Promise<Map<string, string> | null> {
  const k32 = await tryLoadKernel32()
  if (!k32) return null

  const map = new Map<string, { parent: bigint; name: string }>()
  const input = Buffer.alloc(24) // MFT_ENUM_DATA_V0
  input.writeBigUInt64LE(0n, 0) // StartFileReferenceNumber
  input.writeBigUInt64LE(0n, 8) // MinFileSize
  input.writeBigUInt64LE(0xffffffffffffffffn, 16) // MaxFileSize

  const out = k32.alloc('uint8', 1024 * 1024)
  const returned = k32.alloc('uint32')

  for (let pass = 0; pass < 1000; pass++) {
    const ok = k32.DeviceIoControl(handle.raw, FSCTL_ENUM_USN_DATA, input, input.length, out, 1024 * 1024, returned)
    if (!ok) break

    const buffer = Buffer.from(k32.decode(out) as ArrayBuffer)
    const returnedBytes = new DataView(k32.decode(returned) as ArrayBuffer).getUint32(0, true)
    if (returnedBytes <= 8) break

    let offset = 8
    while (offset + 60 <= returnedBytes) {
      const recordLength = buffer.readUInt32LE(offset)
      if (recordLength < 60 || offset + recordLength > returnedBytes) break

      const frn = buffer.readBigUInt64LE(offset + 8)
      const parent = buffer.readBigUInt64LE(offset + 16)
      const attributes = buffer.readUInt32LE(offset + 52)
      const nameLength = buffer.readUInt16LE(offset + 56)
      const nameOffset = buffer.readUInt16LE(offset + 58)
      const name = buffer.toString('utf16le', offset + nameOffset, offset + nameOffset + nameLength).replace(/\0+$/, '')

      // نحتفظ بالملفات والمجلدات لبناء المسارات
      map.set(frn.toString(), { parent, name })
      void attributes
      offset += recordLength
    }

    const nextFrn = buffer.readBigUInt64LE(0)
    input.writeBigUInt64LE(nextFrn, 0)
  }

  // بناء المسارات الكاملة: جذر MFT هو FRN 5 → \
  const paths = new Map<string, string>()
  const resolvePath = (frn: string, depth = 0): string | null => {
    if (paths.has(frn)) return paths.get(frn)!
    if (depth > 64) return null
    const entry = map.get(frn)
    if (!entry) return null
    if (entry.parent === 5n || frn === '5') {
      const p = `\\${entry.name}`
      paths.set(frn, p)
      return p
    }
    const parentPath = resolvePath(entry.parent.toString(), depth + 1)
    if (parentPath === null) return null
    const p = `${parentPath}\\${entry.name}`
    paths.set(frn, p)
    return p
  }

  const result = new Map<string, string>()
  for (const frn of map.keys()) {
    const p = resolvePath(frn)
    if (p) result.set(frn, p)
  }
  return result
}
