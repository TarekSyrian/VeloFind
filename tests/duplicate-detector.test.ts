import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DuplicateDetector } from '@engine/duplicates/duplicate-detector'
import { computePartialHash } from '@engine/duplicates/partial-hasher'
import { CancellationToken, PauseGate } from '@engine/concurrency'
import type { IndexedFile, ScanPhase, ScanWarning } from '@shared/types'
import type { DetectHooks } from '@engine/duplicates/duplicate-detector'
import type { HashUpdate } from '@shared/worker-protocol'

function makeRecord(dir: string, name: string, size: number, id: number): IndexedFile {
  const p = path.join(dir, name)
  const st = fs.statSync(p)
  return {
    id,
    volumeId: 'C',
    name,
    path: p,
    directory: dir,
    extension: 'bin',
    size: st.size,
    modifiedAt: Math.floor(st.mtimeMs),
    createdAt: Math.floor(st.mtimeMs),
    attributes: 0,
    isHidden: false,
    scanState: 'scanned'
  }
}

function write(dir: string, name: string, content: Buffer): void {
  fs.writeFileSync(path.join(dir, name), content)
}

const hooks = (): { warnings: ScanWarning[]; batches: HashUpdate[][]; phases: string[]; hooks: DetectHooks } => {
  const warnings: ScanWarning[] = []
  const batches: HashUpdate[][] = []
  const phases: string[] = []
  return {
    warnings,
    batches,
    phases,
    hooks: {
      onPhase: (p: ScanPhase) => phases.push(p),
      onProgress: () => undefined,
      onHashBatch: (u: HashUpdate[]) => batches.push(u),
      onWarning: (w: ScanWarning) => warnings.push(w)
    }
  }
}

describe('DuplicateDetector — اختبار تكاملي شبه كامل (PRD §26)', () => {
  it('يكتشف المتطابق فقط ويتجاهل المتشابه بالاسم والحجم', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velofind-det-'))
    // a1 و a2 متطابقان → مجموعة
    const same = Buffer.from('identical-content-'.repeat(100))
    write(dir, 'a1.bin', same)
    write(dir, 'a2.bin', same)
    // b1 و b2 بنفس الحجم ومحتوى مختلف → ليسا مكررين
    write(dir, 'b1.bin', Buffer.alloc(1800, 1))
    write(dir, 'b2.bin', Buffer.alloc(1800, 2))
    // c وحيد → يُتجاهل (لا ملف آخر بحجمه)
    write(dir, 'c.bin', Buffer.from('unique'))

    const files = [
      makeRecord(dir, 'a1.bin', same.length, 1),
      makeRecord(dir, 'a2.bin', same.length, 2),
      makeRecord(dir, 'b1.bin', 1800, 3),
      makeRecord(dir, 'b2.bin', 1800, 4),
      makeRecord(dir, 'c.bin', 7, 5)
    ]

    const ctx = hooks()
    const detector = new DuplicateDetector({
      mode: 'accurate',
      concurrency: 4,
      token: new CancellationToken(),
      gate: new PauseGate(),
      hooks: ctx.hooks
    })

    const { groups } = await detector.detect(files)

    expect(groups).toHaveLength(1)
    expect(groups[0].fileCount).toBe(2)
    expect(groups[0].files.map((f) => f.name).sort()).toEqual(['a1.bin', 'a2.bin'])
    expect(groups[0].hashKind).toBe('full')
    // لا تحذيرات — كل الملفات قابلة للقراءة
    expect(ctx.warnings).toHaveLength(0)
  })

  it('الوضع السريع يبني مجموعات ببصمة جزئية', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velofind-quick-'))
    const same = Buffer.from('quick-mode-test-'.repeat(50))
    write(dir, 'q1.bin', same)
    write(dir, 'q2.bin', same)

    const files = [makeRecord(dir, 'q1.bin', same.length, 1), makeRecord(dir, 'q2.bin', same.length, 2)]

    const ctx = hooks()
    const detector = new DuplicateDetector({
      mode: 'quick',
      concurrency: 2,
      token: new CancellationToken(),
      gate: new PauseGate(),
      hooks: ctx.hooks
    })

    const { groups } = await detector.detect(files)
    expect(groups).toHaveLength(1)
    expect(groups[0].hashKind).toBe('partial')
  })

  it('الملفات غير القابلة للقراءة تتحول لتحذيرات بدل الفشل', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velofind-err-'))
    const same = Buffer.from('readable-'.repeat(50))
    write(dir, 'ok1.bin', same)
    write(dir, 'ok2.bin', same)

    const files = [
      makeRecord(dir, 'ok1.bin', same.length, 1),
      makeRecord(dir, 'ok2.bin', same.length, 2),
      // ملف غير موجود بحجم مطابق لـ ok1 → خطأ قراءة
      { ...makeRecord(dir, 'ok1.bin', same.length, 3), path: path.join(dir, 'missing.bin'), name: 'missing.bin' }
    ]

    const ctx = hooks()
    const detector = new DuplicateDetector({
      mode: 'accurate',
      concurrency: 2,
      token: new CancellationToken(),
      gate: new PauseGate(),
      hooks: ctx.hooks
    })

    const { groups } = await detector.detect(files)
    expect(groups[0]?.fileCount).toBe(2)
    expect(ctx.warnings.length).toBe(1)
  })

  it('الإلغاء يوقف العملية بخطأ الإلغاء', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velofind-cancel-'))
    const big = Buffer.alloc(1024 * 1024, 3)
    const files: IndexedFile[] = []
    for (let i = 0; i < 6; i++) {
      write(dir, `big${i}.bin`, big)
      files.push(makeRecord(dir, `big${i}.bin`, big.length, i + 1))
    }

    const token = new CancellationToken()
    const ctx = hooks()
    const detector = new DuplicateDetector({
      mode: 'accurate',
      concurrency: 1,
      token,
      gate: new PauseGate(),
      hooks: ctx.hooks
    })

    token.cancel()
    await expect(detector.detect(files)).rejects.toMatchObject({ name: 'ScanCancelledError' })
  })
})

describe('DuplicateDetector — انحدار الملفات المخزنة (إصلاح فوات المكررات)', () => {
  it('الوضع الدقيق: ملف مخزن (بصمة كاملة محفوظة) + ملف جديد مطابق → مجموعة كاملة', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velofind-cache-acc-'))
    const content = Buffer.from('cached-twin-content-'.repeat(40))
    write(dir, 'old.bin', content) // بقي من فحص سابق → unchanged
    write(dir, 'copy.bin', content) // نسخة أُضيفت حديثًا → بلا بصمة

    const partialHash = await computePartialHash(path.join(dir, 'old.bin'), content.length)
    const fullHash = createHash('sha256').update(content).digest('hex')

    const cachedRecord: IndexedFile = {
      ...makeRecord(dir, 'old.bin', content.length, 1),
      partialHash,
      fullHash,
      scanState: 'unchanged'
    }
    const freshRecord = makeRecord(dir, 'copy.bin', content.length, 2)

    const ctx = hooks()
    const detector = new DuplicateDetector({
      mode: 'accurate',
      concurrency: 2,
      token: new CancellationToken(),
      gate: new PauseGate(),
      hooks: ctx.hooks
    })

    const { groups } = await detector.detect([cachedRecord, freshRecord])
    expect(groups).toHaveLength(1)
    expect(groups[0].fileCount).toBe(2)
    expect(groups[0].files.map((f) => f.name).sort()).toEqual(['copy.bin', 'old.bin'])
  })

  it('الوضع الدقيق: توأم مخزن لملف كبير (> 4MB) لا يُسقط من التصفية الجزئية', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velofind-cache-big-'))
    // ملف أكبر من PARTIAL_SKIP_SIZE (4MB) — المكان الوحيد الذي كانت التصفية الجزئية تُفوّت التوأم المخزن
    const content = Buffer.alloc(5 * 1024 * 1024, 9)
    write(dir, 'big-old.bin', content)
    write(dir, 'big-copy.bin', content)

    const bigOldPath = path.join(dir, 'big-old.bin')
    const partialHash = await computePartialHash(bigOldPath, content.length)
    const fullHash = createHash('sha256').update(content).digest('hex')

    const cachedRecord: IndexedFile = {
      ...makeRecord(dir, 'big-old.bin', content.length, 1),
      partialHash,
      fullHash,
      scanState: 'unchanged'
    }
    const freshRecord = makeRecord(dir, 'big-copy.bin', content.length, 2)

    const ctx = hooks()
    const detector = new DuplicateDetector({
      mode: 'accurate',
      concurrency: 2,
      token: new CancellationToken(),
      gate: new PauseGate(),
      hooks: ctx.hooks
    })

    const { groups } = await detector.detect([cachedRecord, freshRecord])
    expect(groups).toHaveLength(1)
    expect(groups[0].fileCount).toBe(2)
    expect(groups[0].hashKind).toBe('full')
  })

  it('الوضع السريع: ملف مخزن ببصمة جزئية محفوظة يُجمَّع مع نسخته الجديدة دون إعادة قراءة', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velofind-cache-quick-'))
    const content = Buffer.from('quick-cached-'.repeat(80))
    write(dir, 'q-old.bin', content)
    write(dir, 'q-copy.bin', content)

    const partialHash = await computePartialHash(path.join(dir, 'q-old.bin'), content.length)

    const cachedRecord: IndexedFile = {
      ...makeRecord(dir, 'q-old.bin', content.length, 1),
      partialHash,
      scanState: 'unchanged'
    }
    const freshRecord = makeRecord(dir, 'q-copy.bin', content.length, 2)

    const ctx = hooks()
    const detector = new DuplicateDetector({
      mode: 'quick',
      concurrency: 2,
      token: new CancellationToken(),
      gate: new PauseGate(),
      hooks: ctx.hooks
    })

    const { groups } = await detector.detect([cachedRecord, freshRecord])
    expect(groups).toHaveLength(1)
    expect(groups[0].fileCount).toBe(2)
    expect(groups[0].hashKind).toBe('partial')
    // الملف المخزن لم يُلمس: بصمته وسجلّه لم يتغيرا
    expect(cachedRecord.scanState).toBe('unchanged')
  })

  it('الملفات الفارغة (0 بايت) لا تُعد مكررات', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velofind-empty-'))
    write(dir, 'e1.bin', Buffer.alloc(0))
    write(dir, 'e2.bin', Buffer.alloc(0))

    const files = [makeRecord(dir, 'e1.bin', 0, 1), makeRecord(dir, 'e2.bin', 0, 2)]

    const ctx = hooks()
    const detector = new DuplicateDetector({
      mode: 'accurate',
      concurrency: 2,
      token: new CancellationToken(),
      gate: new PauseGate(),
      hooks: ctx.hooks
    })

    const { groups } = await detector.detect(files)
    expect(groups).toHaveLength(0)
  })
})
