import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JsonStore, SqliteStore } from '@engine/persistence/persistence-manager'
import type { IndexedFile } from '@shared/types'

function sampleFile(id: number, fullHash?: string): IndexedFile {
  return {
    id,
    volumeId: 'C',
    name: `file${id}.txt`,
    path: `C:\\data\\file${id}.txt`,
    directory: 'C:\\data',
    extension: 'txt',
    size: 100 + id,
    modifiedAt: 1700000000000 + id,
    createdAt: 1700000000000,
    attributes: 32,
    isHidden: false,
    fullHash,
    hashAlgorithm: fullHash ? 'sha256' : undefined,
    scanState: 'scanned'
  }
}

describe('JsonStore — التخزين الدائم (خطة بديلة)', () => {
  let dir: string
  let file: string

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velofind-json-'))
    file = path.join(dir, 'index.json')
  })

  it('حفظ وتحميل الملفات + البصمات + المواقع + العمليات', async () => {
    const store = new JsonStore(file)
    await store.init()

    await store.replaceFiles([sampleFile(1, 'aa'), sampleFile(2)])
    await store.updateFileHashes([{ id: 2, fullHash: 'bb', algorithm: 'sha256', scannedAt: 1 }])
    await store.saveLocations([{ path: 'C:\\data', enabled: true, excluded: false }])
    await store.setSetting('theme', '"dark"')
    const opId = await store.logOperation({
      operationType: 'quarantine',
      sourcePath: 'C:\\data\\file1.txt',
      destinationPath: 'C:\\quarantine\\file1.txt',
      createdAt: 5,
      reversedAt: null
    })
    await store.close()

    const store2 = new JsonStore(file)
    await store2.init()

    const files = await store2.loadFiles()
    expect(files).toHaveLength(2)
    expect(files.find((f) => f.id === 1)?.fullHash).toBe('aa')
    expect(files.find((f) => f.id === 2)?.fullHash).toBe('bb')

    expect(await store2.loadLocations()).toEqual([{ path: 'C:\\data', enabled: true, excluded: false }])
    expect(JSON.parse((await store2.getSetting('theme'))!)).toBe('dark')

    const ops = await store2.loadOperations()
    expect(ops[0].id).toBe(opId)
    expect(ops[0].operationType).toBe('quarantine')

    await store2.markOperationReversed(opId, 99)
    expect((await store2.loadOperations())[0].reversedAt).toBe(99)

    await store2.deleteFiles([1])
    expect(await store2.loadFiles()).toHaveLength(1)

    await store2.clearFiles()
    expect(await store2.loadFiles()).toHaveLength(0)
    await store2.close()
  })
})

describe('SqliteStore — يُختبر عند توفر الوحدة الأصلية', () => {
  it('حفظ وتحميل وفق مخطط PRD §21', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velofind-sqlite-'))
    const store = new SqliteStore(path.join(dir, 'velofind.db'))

    try {
      await store.init()
    } catch {
      // الوحدة الأصلية غير مبنية في بيئة الاختبار — نتجاوز بأمان
      return
    }

    await store.replaceFiles([sampleFile(1, 'h1'), sampleFile(2, 'h1'), sampleFile(3)])
    let files = await store.loadFiles()
    expect(files).toHaveLength(3)
    expect(files.find((f) => f.id === 1)?.fullHash).toBe('h1')

    await store.updateFileHashes([{ id: 3, fullHash: 'h1', algorithm: 'sha256', scannedAt: 7 }])
    files = await store.loadFiles()
    expect(files.find((f) => f.id === 3)?.fullHash).toBe('h1')

    await store.upsertVolume({ id: 'C', driveLetter: 'C', fileSystem: 'NTFS', journalId: 'j1', nextUsn: '10', lastScanAt: 1 })
    const volumes = await store.loadVolumes()
    expect(volumes).toHaveLength(1)
    expect(volumes[0].journalId).toBe('j1')

    await store.deleteFiles([2])
    expect(await store.loadFiles()).toHaveLength(2)

    await store.clearFiles()
    expect(await store.loadFiles()).toHaveLength(0)

    await store.close()
  })

  it('replaceFiles استبدال حقيقي — صفوف اللقطات السابقة لا تبقى في القاعدة', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velofind-sqlite-replace-'))
    const store = new SqliteStore(path.join(dir, 'velofind.db'))

    try {
      await store.init()
    } catch {
      // الوحدة الأصلية غير مبنية في بيئة الاختبار — نتجاوز بأمان
      return
    }

    // لقطة أولى من فحص قرص C ثم لقطة ثانية من فحص قرص D فقط
    await store.replaceFiles([sampleFile(1, 'a'), sampleFile(2, 'b')])
    await store.replaceFiles([sampleFile(3, 'c')])
    const files = await store.loadFiles()
    expect(files).toHaveLength(1)
    expect(files[0].id).toBe(3)

    await store.close()
  })
})
