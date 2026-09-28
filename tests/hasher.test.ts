import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { computePartialHash, computePartialRanges, mergeRanges } from '@engine/duplicates/partial-hasher'
import { computeFullHash } from '@engine/duplicates/full-hasher'
import { PARTIAL_HASH_CHUNK } from '@shared/constants'

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'velofind-hash-'))
}

describe('computePartialRanges', () => {
  it('الملف الصغير يُقرأ كاملًا', () => {
    expect(computePartialRanges(1000)).toEqual([{ start: 0, end: 1000 }])
  })

  it('الملف الكبير: ثلاث كتل بلا تداخل بعد الدمج', () => {
    const size = 10 * 1024 * 1024
    const ranges = computePartialRanges(size)
    expect(ranges.length).toBe(3)
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i].start).toBeGreaterThanOrEqual(ranges[i - 1].end)
    }
    expect(ranges[0].start).toBe(0)
    expect(ranges[ranges.length - 1].end).toBe(size)
  })
})

describe('mergeRanges', () => {
  it('يدمج النطاقات المتداخلة ويرتبها', () => {
    expect(mergeRanges([{ start: 10, end: 20 }, { start: 0, end: 12 }, { start: 30, end: 40 }])).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 40 }
    ])
  })
})

describe('البصمات على ملفات فعلية — PRD §26', () => {
  it('محتوى متطابق → بصمة كاملة متطابقة', async () => {
    const dir = tmpdir()
    const data = Buffer.from('hello velofind '.repeat(4096))
    fs.writeFileSync(path.join(dir, 'a.bin'), data)
    fs.writeFileSync(path.join(dir, 'b.bin'), data)

    const a = await computeFullHash(path.join(dir, 'a.bin'))
    const b = await computeFullHash(path.join(dir, 'b.bin'))
    expect(a.hash).toBe(b.hash)
    expect(a.bytesRead).toBe(data.length)
  })

  it('نفس الحجم بمحتوى مختلف → بصمة كاملة مختلفة', async () => {
    const dir = tmpdir()
    fs.writeFileSync(path.join(dir, 'a.bin'), Buffer.alloc(64 * 1024, 1))
    fs.writeFileSync(path.join(dir, 'b.bin'), Buffer.alloc(64 * 1024, 2))
    const a = await computeFullHash(path.join(dir, 'a.bin'))
    const b = await computeFullHash(path.join(dir, 'b.bin'))
    expect(a.hash).not.toBe(b.hash)
  })

  it('البصمة الجزئية تتطابق مع المحتوى نفسه', async () => {
    const dir = tmpdir()
    const data = Buffer.from('repeat-me '.repeat(20000))
    fs.writeFileSync(path.join(dir, 'a.bin'), data)
    fs.writeFileSync(path.join(dir, 'b.bin'), data)
    const a = await computePartialHash(path.join(dir, 'a.bin'), data.length)
    const b = await computePartialHash(path.join(dir, 'b.bin'), data.length)
    expect(a).toBe(b)
  })

  it('اختلاف داخل فجوة البصمة الجزئية → جزئية متساوية وكاملة مختلفة', async () => {
    const dir = tmpdir()
    const size = 300000
    const a = Buffer.alloc(size, 7)
    const b = Buffer.alloc(size, 7)
    // نضع الاختلاف في الفجوة بين أول كتلة وكتلة المنتصف
    const firstEnd = PARTIAL_HASH_CHUNK
    const midStart = Math.floor((size - PARTIAL_HASH_CHUNK) / 2)
    const gap = Math.floor((firstEnd + midStart) / 2)
    b[gap] = 200

    fs.writeFileSync(path.join(dir, 'a.bin'), a)
    fs.writeFileSync(path.join(dir, 'b.bin'), b)

    const pa = await computePartialHash(path.join(dir, 'a.bin'), size)
    const pb = await computePartialHash(path.join(dir, 'b.bin'), size)
    expect(pa).toBe(pb) // الجزئية لا ترى الفجوة

    const fa = await computeFullHash(path.join(dir, 'a.bin'))
    const fb = await computeFullHash(path.join(dir, 'b.bin'))
    expect(fa.hash).not.toBe(fb.hash) // الكاملة تميزهما — PRD §8
  })

  it('computeFullHash يقرأ بحجم كبير متدفق', async () => {
    const dir = tmpdir()
    const chunk = Buffer.alloc(1024 * 1024, 9)
    const handle = fs.openSync(path.join(dir, 'big.bin'), 'w')
    for (let i = 0; i < 8; i++) fs.writeSync(handle, chunk)
    fs.closeSync(handle)
    const result = await computeFullHash(path.join(dir, 'big.bin'))
    expect(result.bytesRead).toBe(8 * 1024 * 1024)
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
