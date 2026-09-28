import { describe, expect, it } from 'vitest'
import { isExcludedFolderName } from '@engine/scanner/directory-walker'
import { FileScanner, isUnderExcludedFolderName } from '@engine/scanner/file-scanner'
import { DEFAULT_EXCLUDED_FOLDERS } from '@shared/constants'
import type { IndexedFile } from '@shared/types'

function record(id: number, path: string): IndexedFile {
  const name = path.split('\\').pop() ?? `f${id}`
  return {
    id,
    volumeId: 'C',
    name,
    path,
    directory: path.slice(0, path.lastIndexOf('\\')) || 'C:\\',
    extension: 'bin',
    size: 100,
    modifiedAt: id,
    createdAt: id,
    attributes: 0,
    isHidden: false,
    scanState: 'scanned'
  }
}

describe('isExcludedFolderName — مطابقة أسماء المجلدات المستثناة', () => {
  it('يطابق الاسم بأي حالة أحرف', () => {
    expect(isExcludedFolderName('node_modules', ['node_modules'])).toBe(true)
    expect(isExcludedFolderName('Node_Modules', ['node_modules'])).toBe(true)
    expect(isExcludedFolderName('.git', ['.git'])).toBe(true)
  })

  it('لا يطابق أسماء مشابهة جزئيًا', () => {
    expect(isExcludedFolderName('my_modules', ['node_modules'])).toBe(false)
    expect(isExcludedFolderName('gitignore', ['.git'])).toBe(false)
  })

  it('قائمة فارغة أو غير معرفة → لا استثناء', () => {
    expect(isExcludedFolderName('node_modules', [])).toBe(false)
    expect(isExcludedFolderName('node_modules', undefined)).toBe(false)
  })

  it('القائمة الافتراضية تتضمن node_modules وغيرها', () => {
    expect(DEFAULT_EXCLUDED_FOLDERS).toContain('node_modules')
    expect(DEFAULT_EXCLUDED_FOLDERS).toContain('.git')
  })
})

describe('FileScanner.buildPreviousMap — استبعاد مجلدات بالاسم', () => {
  const locations = ['C:\\data']
  const excluded: string[] = []

  it('ملف داخل مجلد مستثنى بالاسم يُحذف من الخريطة السابقة', () => {
    const previous = [
      record(1, 'C:\\data\\node_modules\\lib\\a.js'),
      record(2, 'C:\\data\\src\\b.js'),
      record(3, 'C:\\data\\.git\\objects\\c')
    ]
    const map = FileScanner.buildPreviousMap(previous, locations, excluded, ['node_modules', '.git'])
    expect(map.size).toBe(1)
    expect([...map.values()][0].path).toBe('C:\\data\\src\\b.js')
  })

  it('ملف تحت موقع فحص اختير صراحةً واسمه مستثنى يبقى في الخريطة', () => {
    const previous = [record(1, 'C:\\data\\node_modules\\a.js')]
    const map = FileScanner.buildPreviousMap(previous, ['C:\\data\\node_modules'], excluded, ['node_modules'])
    expect(map.size).toBe(1)
  })
})

describe('isUnderExcludedFolderName — مقاطع المسار تحت جذر الموقع', () => {
  it('يكشف المجلد المستثنى في أي عمق', () => {
    expect(
      isUnderExcludedFolderName('C:\\data\\x\\node_modules\\y\\z.js', ['C:\\data'], ['node_modules'])
    ).toBe(true)
    expect(isUnderExcludedFolderName('C:\\data\\x\\y.js', ['C:\\data'], ['node_modules'])).toBe(false)
  })

  it('الجذر نفسه لا يُعد مستثنى (اختيار صريح)', () => {
    expect(isUnderExcludedFolderName('C:\\data\\node_modules\\a.js', ['C:\\data\\node_modules'], ['node_modules'])).toBe(
      false
    )
  })
})
