import { describe, expect, it } from 'vitest'
import { autoSelectForGroup, pickKeeper, isBackupPath, isDownloadsPath } from '@shared/auto-select'
import type { DuplicateGroup } from '@shared/types'

function group(paths: Array<[id: number, path: string, modifiedAt: number]>): DuplicateGroup {
  return {
    id: 'g1',
    hash: 'sha256:abc',
    hashKind: 'full',
    size: 100,
    fileCount: paths.length,
    reclaimedBytes: 100 * (paths.length - 1),
    files: paths.map(([id, path, modifiedAt]) => ({
      id,
      path,
      name: path.split('\\').pop() ?? '',
      directory: path.split('\\').slice(0, -1).join('\\'),
      drive: 'C',
      extension: 'jpg',
      size: 100,
      modifiedAt,
      createdAt: modifiedAt,
      isHidden: false
    }))
  }
}

describe('قواعد الأصل — PRD §14', () => {
  const g = group([
    [1, 'C:\\Users\\U\\Downloads\\photo.jpg', 1700000000000],
    [2, 'C:\\Users\\U\\Pictures\\photo.jpg', 1690000000000],
    [3, 'D:\\Backup\\photo.jpg', 1680000000000]
  ])

  it('الأقدم يُبقى عليه', () => {
    expect(pickKeeper(g, { keep: 'oldest' }).id).toBe(3)
  })

  it('الأحدث يُبقى عليه', () => {
    expect(pickKeeper(g, { keep: 'newest' }).id).toBe(1)
  })

  it('خارج التنزيلات يُبقى عليه (الأقدم خارج التنزيلات أولًا)', () => {
    expect(pickKeeper(g, { keep: 'outside_downloads' }).id).toBe(3)
  })

  it('داخل مجلد محدد يُبقى عليه', () => {
    expect(pickKeeper(g, { keep: 'in_folder', keepFolder: 'D:\\Backup' }).id).toBe(3)
  })
})

describe('التحديد التلقائي — لا يحدد جميع النسخ أبدًا (PRD §17)', () => {
  const g = group([
    [1, 'C:\\Users\\U\\Downloads\\photo.jpg', 1700000000000],
    [2, 'C:\\Users\\U\\Pictures\\photo.jpg', 1690000000000],
    [3, 'D:\\Backup\\photo.jpg', 1680000000000]
  ])

  it('الأصل غير محدد دائمًا', () => {
    const selected = autoSelectForGroup(g, { keep: 'oldest' })
    expect(selected).not.toContain(3) // الأقدم = الأصل
    expect(selected).toContain(1)
    expect(selected).toContain(2)
    expect(selected.length).toBeLessThan(g.files.length)
  })

  it('قاعدة النسخ الاحتياطي تحدد فقط ما داخل مجلدات النسخ', () => {
    const g4 = group([
      [1, 'C:\\Users\\U\\Downloads\\photo.jpg', 1700000000000],
      [2, 'C:\\Users\\U\\Pictures\\photo.jpg', 1690000000000],
      [3, 'D:\\Backup\\photo.jpg', 1680000000000], // الأقدم → الأصل
      [4, 'E:\\Backup\\photo.jpg', 1695000000000] // نسخة احتياطية زائدة
    ])
    const selected = autoSelectForGroup(g4, { keep: 'oldest', markBackupsOnly: true })
    expect(selected).toEqual([4])
  })

  it('neverSelectFolders يستثني المجلدات المحمية', () => {
    const selected = autoSelectForGroup(g, { keep: 'oldest', neverSelectFolders: ['C:\\Users\\U\\Downloads'] })
    expect(selected).toEqual([2])
  })

  it('مجموعة من نسختين: يبقى الأصل فقط غير محدد', () => {
    const g2 = group([
      [10, 'C:\\a\\x.txt', 100],
      [11, 'C:\\b\\x.txt', 200]
    ])
    const selected = autoSelectForGroup(g2, { keep: 'newest' })
    expect(selected).toEqual([10])
    expect(selected.length).toBe(g2.files.length - 1)
  })
})

describe('كشف المسارات', () => {
  it('يكتشف مجلدات النسخ الاحتياطي', () => {
    expect(isBackupPath('D:\\Backup\\2024')).toBe(true)
    expect(isBackupPath('C:\\Data\\نسخة احتياطية')).toBe(true)
    expect(isBackupPath('C:\\Projects\\App')).toBe(false)
  })

  it('مجلد التنزيلات', () => {
    expect(isDownloadsPath('C:\\Users\\U\\Downloads')).toBe(true)
    expect(isDownloadsPath('C:\\Users\\U\\التنزيلات')).toBe(true)
    expect(isDownloadsPath('C:\\Users\\U\\Documents')).toBe(false)
  })

  it('الكلمات تُطابَق كمقاطع مستقلة لا كنص جزئي', () => {
    // "holder" و "Golden" تحتويان "old" لكنهما مجلدان عاديان
    expect(isBackupPath('C:\\Users\\holder\\Documents')).toBe(false)
    expect(isBackupPath('C:\\Photos\\Golden')).toBe(false)
    // المقطع المستقل يبقى مطابقًا
    expect(isBackupPath('C:\\Data\\old\\stuff')).toBe(true)
    expect(isBackupPath('C:\\Data\\archive')).toBe(true)
    // النسخ الاحتياطي يحدّد للحذف، فالمطابقة التامة مقصودة: لا تغطية على حساب الأمان
    expect(isBackupPath('C:\\Data\\old-stuff')).toBe(false)
  })

  it('مجلدات التنزيلات بأرقام أو لاحقات', () => {
    expect(isDownloadsPath('C:\\Users\\U\\Downloads (2)')).toBe(true)
    expect(isDownloadsPath('C:\\Users\\U\\downloads-old')).toBe(true)
    expect(isDownloadsPath('C:\\Users\\U\\التنزيلات (2)')).toBe(true)
    // الكلمة داخل الاسم بلا فاصل ليست مجلد تنزيلات
    expect(isDownloadsPath('C:\\Users\\U\\Downloadsevil')).toBe(false)
  })
})

describe('حدود مجلد في القاعدة — لا تطابق أسماء مجلدات مشابهة', () => {
  const g = group([
    [1, 'C:\\Data\\Photos\\a.jpg', 100],
    [2, 'C:\\Data\\PhotosBackup\\a.jpg', 200],
    [3, 'C:\\Data\\Archive\\a.jpg', 300]
  ])

  it('in_folder لا يطابق مجلدًا يبدأ بنفس النص فقط', () => {
    // C:\Data\PhotosBackup ليس داخل C:\Data\Photos → يبقى الأصل الأقدم الافتراضي
    expect(pickKeeper(g, { keep: 'in_folder', keepFolder: 'C:\\Data\\Photos' }).id).toBe(1)
  })

  it('in_folder يطابق المجلد المتطابق حرفيًا', () => {
    expect(pickKeeper(g, { keep: 'in_folder', keepFolder: 'C:\\Data\\PhotosBackup' }).id).toBe(2)
  })

  it('neverSelectFolders لا يحمي مجلدًا مشابهًا بالاسم', () => {
    // المحمي: id 1 (داخل C:\Data\Photos). غير المحمي: id 2 (PhotosBackup) و id 3
    const selected = autoSelectForGroup(g, { keep: 'newest', neverSelectFolders: ['C:\\Data\\Photos'] })
    expect(selected).toEqual([2])
  })
})
