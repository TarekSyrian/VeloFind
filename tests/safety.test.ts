import { describe, expect, it } from 'vitest'
import { validateSelection, isProtectedPath } from '@shared/safety'
import type { DeleteItem, DuplicateGroup } from '@shared/types'

function group(id: string, paths: string[]): DuplicateGroup {
  return {
    id,
    hash: 'sha256:x',
    hashKind: 'full',
    size: 10,
    fileCount: paths.length,
    reclaimedBytes: 10 * (paths.length - 1),
    files: paths.map((path, i) => ({
      id: i + 1,
      path,
      name: path.split('\\').pop() ?? '',
      directory: path.split('\\').slice(0, -1).join('\\'),
      drive: 'C',
      extension: 'txt',
      size: 10,
      modifiedAt: i,
      createdAt: i,
      isHidden: false
    }))
  }
}

describe('منع حذف جميع نسخ المجموعة — PRD §17', () => {
  const groups = new Map([
    ['g1', group('g1', ['C:\\a\\f.txt', 'C:\\b\\f.txt', 'C:\\c\\f.txt'])]
  ])

  it('حذف كل النسخ → مخالفة', () => {
    const items: DeleteItem[] = [
      { path: 'C:\\a\\f.txt', groupId: 'g1' },
      { path: 'C:\\b\\f.txt', groupId: 'g1' },
      { path: 'C:\\c\\f.txt', groupId: 'g1' }
    ]
    const violations = validateSelection(items, groups)
    expect(violations.some((v) => v.kind === 'deletes_all_copies')).toBe(true)
  })

  it('الإبقاء على نسخة واحدة → آمن', () => {
    const items: DeleteItem[] = [
      { path: 'C:\\a\\f.txt', groupId: 'g1' },
      { path: 'C:\\b\\f.txt', groupId: 'g1' }
    ]
    expect(validateSelection(items, groups)).toHaveLength(0)
  })

  it('مجموعة مفقودة → مخالفة', () => {
    const items: DeleteItem[] = [{ path: 'C:\\x\\f.txt', groupId: 'ghost' }]
    expect(validateSelection(items, groups).some((v) => v.kind === 'missing_group')).toBe(true)
  })
})

describe('مجلدات النظام المحمية — PRD §17', () => {
  it('يرفض المسارات داخل C:\\Windows وProgram Files', () => {
    expect(isProtectedPath('C:\\Windows\\System32\\x.dll')).toBe(true)
    expect(isProtectedPath('C:\\Program Files\\App\\x.exe')).toBe(true)
    expect(isProtectedPath('C:\\Program Files (x86)\\App\\x.exe')).toBe(true)
    expect(isProtectedPath('c:\\programdata\\x')).toBe(true)
  })

  it('يسمح بالمسارات العادية', () => {
    expect(isProtectedPath('C:\\Users\\Me\\Documents\\file.txt')).toBe(false)
    expect(isProtectedPath('D:\\Backup\\file.txt')).toBe(false)
    // حماية من البداية الكاذبة: WindowsApps ≠ Windows
    expect(isProtectedPath('C:\\WindowsApps\\x')).toBe(false)
  })
})
