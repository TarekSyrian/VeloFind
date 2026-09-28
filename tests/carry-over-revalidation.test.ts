import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ScanScheduler, nextIdAfter } from '@engine/scanner/scan-scheduler'
import { refreshCarriedFiles } from '@engine/scanner/file-scanner'
import { MemoryIndex } from '@engine/index/memory-index'
import { groupsFromPartialHashMap, groupsFromFullHashMap, partialKey } from '@engine/duplicates/duplicate-groups'
import { computePartialHash } from '@engine/duplicates/partial-hasher'
import { CancellationToken, PauseGate } from '@engine/concurrency'
import type { IndexedFile, ScanPhase, ScanRequest, ScanWarning } from '@shared/types'

/**
 * اختبارات انحدار للسبب الجذري لبلاغ «الملفات المكررة على قرصين لا تُكتشف»:
 *
 * السبب: بوابة توفّر وحدة التخزين في refreshCarriedFiles كانت تستدعي stat على
 * الجذر بعد بادئة ‎\\?\‎ — وعلى Windows يرمي ذلك EISDIR، فتُعتبر كل الأقراص
 * «غير متصلة» ويُحمَّل ملفاتها بحجم وبصمات قديمة تُوثَّق بها إلى الأبد.
 * النتيجة: الملف المحمَّل من قرص آخر لا يدخل مجموعة الحجم الصحيحة أبدًا،
 * فيختفي التوأم العابر للأقراص مهما أُعيد الفحص.
 *
 * (هذا الفشل كان مخفيًا عن CI لأن اختباراته تعمل على Linux حيث لا بادئة ‎\\?\‎.)
 */

/** أكبر من PARTIAL_SKIP_SIZE (4MB) — يمرّ بمسار البصمة الجزئية كما في بلاغ ISO */
const BIG = 6 * 1024 * 1024

function write(dir: string, name: string, content: Buffer): string {
  const p = path.join(dir, name)
  fs.writeFileSync(p, content)
  return p
}

function statRecord(p: string, id: number, extra: Partial<IndexedFile> = {}): IndexedFile {
  const st = fs.statSync(p)
  return {
    id,
    volumeId: '',
    name: path.basename(p),
    path: p,
    directory: path.dirname(p),
    extension: path.extname(p).replace('.', ''),
    size: st.size,
    modifiedAt: Math.floor(st.mtimeMs),
    createdAt: Math.floor(st.birthtimeMs || st.ctimeMs),
    attributes: 0,
    isHidden: false,
    scanState: 'scanned',
    ...extra
  }
}

const noopOut = () => ({
  onPhase: (_p: ScanPhase) => undefined,
  onProgress: (_s: unknown) => undefined,
  onHashBatch: (_u: unknown[]) => undefined,
  onWarning: (w: ScanWarning) => w
})

function request(locations: string[]): ScanRequest {
  return {
    locations,
    mode: 'accurate',
    minSize: 0,
    excludeSystemFolders: true,
    excludedFolderNames: [],
    incremental: true
  }
}

async function runScheduler(locations: string[], previous: IndexedFile[], nextId: number) {
  const scheduler = new ScanScheduler(new CancellationToken(), new PauseGate(), noopOut())
  return scheduler.run({ request: request(locations), previous, nextId, concurrency: 4 })
}

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

/**
 * حذف مجلد مؤقت مع إعادة محاولة.
 *
 * على ويندوز يفشل الحذف بـ EBUSY/EPERM/ENOTEMPTY إذا كان هناك أي مقبض
 * ملف ما زال يُغلق، أو إذا كان برنامج مكافحة الفيروسات أو فهرس بحث ويندوز
 * يمسح الملف في تلك اللحظة. خيارات maxRetries/retryDelay في fs.rmSync
 * مصممة تحديدًا لهذه الأخطاء، والفشل كان يظهر على عدّاء Actions فقط.
 */
function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
}

describe('إعادة التحقق من الملفات المحمولة — السبب الجذري لغياب المكررات العابرة للأقراص', () => {
  it('ملف تغيّر حجمه على القرص يُحدَّث ويُعاد تصنيفه (كان يبقى بحجمه القديم إلى الأبد)', async () => {
    const root = tmp('vf-carry-size-')
    const p = write(root, 'a.iso', Buffer.alloc(1024, 1))
    const record = statRecord(p, 1, { fullHash: 'old-hash', partialHash: 'old-partial' })

    // الملف استُبدل على القرص بحجم مختلف (حجم تنزيل ISO غير مكتمل مثلًا)
    fs.writeFileSync(p, Buffer.alloc(2048, 2))

    const r = await refreshCarriedFiles([record], new CancellationToken(), new PauseGate())
    expect(r.files[0].size).toBe(2048)
    expect(r.files[0].scanState).toBe('new')
    expect(r.files[0].fullHash).toBeUndefined()
    expect(r.files[0].partialHash).toBeUndefined()
    cleanup(root)
  })

  it('ملف لم يتغير يُعاد ببصماته (unchanged) — مسار عدم إعادة القراءة يبقى سليمًا', async () => {
    const root = tmp('vf-carry-same-')
    const p = write(root, 'a.iso', Buffer.from('stable-content'))
    const record = statRecord(p, 1, { fullHash: 'keep-me', partialHash: 'keep-partial' })
    const r = await refreshCarriedFiles([record], new CancellationToken(), new PauseGate())
    expect(r.files[0].scanState).toBe('unchanged')
    expect(r.files[0].fullHash).toBe('keep-me')
    cleanup(root)
  })

  it('ملف محذوف يُعلَّم missing ويُستبعد من المجموعات', async () => {
    const root = tmp('vf-carry-gone-')
    const p = write(root, 'a.iso', Buffer.from('bye'))
    const record = statRecord(p, 1, { fullHash: 'h' })
    fs.unlinkSync(p)
    const r = await refreshCarriedFiles([record], new CancellationToken(), new PauseGate())
    expect(r.files[0].scanState).toBe('missing')
    cleanup(root)
  })

  it('ملف على وحدة تخزين غير متاحة يُحمَّل كما هو (لا يُفقد مفهرسته)', async () => {
    const root = tmp('vf-carry-offline-')
    const p = write(root, 'a.iso', Buffer.from('offline-content'))
    // القرص Z: غير موجود في بيئة الاختبار = قرص مفصول
    const record = statRecord(p, 1, { volumeId: 'Z', fullHash: 'h', scanState: 'scanned' })
    const r = await refreshCarriedFiles([record], new CancellationToken(), new PauseGate())
    expect(r.files[0].scanState).toBe('unchanged')
    expect(r.files[0].fullHash).toBe('h')
    cleanup(root)
  })

  it('ترتيب الملفات المحمولة ثابت بين الفحوصات (نتائج متوازية لا تتبدّل)', async () => {
    const root = tmp('vf-carry-order-')
    const paths: string[] = []
    for (let i = 0; i < 40; i++) paths.push(write(root, `f${i}.bin`, Buffer.alloc(64, i)))
    const records = paths.map((p, i) => statRecord(p, i + 1))
    const a = await refreshCarriedFiles(records, new CancellationToken(), new PauseGate())
    const b = await refreshCarriedFiles(records, new CancellationToken(), new PauseGate())
    expect(a.files.map((f) => f.id)).toEqual(records.map((r) => r.id))
    expect(a.files.map((f) => f.id)).toEqual(b.files.map((f) => f.id))
    cleanup(root)
  })
})

describe('سيناريو البلاغ: ISO كبير على قرصين مع فحصين متتاليين', () => {
  it('حجم الملف تغيّر بين الفحصين → التوأم العابر للأقراص يُكتشف', async () => {
    const root = tmp('vf-iso-size-')
    const dirL = path.join(root, 'Windows', 'windows 10')
    const dirH = path.join(root, 'New folder (2)')
    fs.mkdirSync(dirL, { recursive: true })
    fs.mkdirSync(dirH, { recursive: true })

    const name = 'WIN10.PRO.AIO.SUPERLITE+SE+COMPACT.U7.X64.(WPE+).ISO'
    const pL = write(dirL, name, Buffer.alloc(2 * 1024 * 1024, 0x11)) // تنزيل ناقص
    const pH = write(dirH, name, Buffer.alloc(BIG, 0x22)) // النسخة الكاملة

    // الفحص 1: قرص L: فقط → يُفهرس الملف ناقصًا بحجمه الحقيقي وقت الفحص
    const scan1 = await runScheduler([dirL], [], 1)
    expect(scan1.files.find((f) => f.path === pL)?.size).toBe(2 * 1024 * 1024)

    // الملف على L: اكتمل تنزيله الآن (الحجم الحقيقي = حجم نسخة H:)
    fs.writeFileSync(pL, Buffer.alloc(BIG, 0x22))

    // الفحص 2: قرص H: فقط → يجب أن يُحمَّل ملف L: بحجمه الجديد وينضم للمجموعة
    const scan2 = await runScheduler([dirH], scan1.files, 100)
    const carried = scan2.files.find((f) => f.path === pL)
    expect(carried?.size).toBe(BIG)

    const group = scan2.groups.find((g) => g.files.some((f) => f.path === pL))
    expect(group, 'التوأم العابر للأقراص يجب أن يظهر كمجموعة').toBeTruthy()
    expect(group?.files.some((f) => f.path === pH)).toBe(true)
    cleanup(root)
  })

  it('محتوى الملف تغيّر بنفس الحجم وبصمة كاملة قديمة → المجموعة تُبنى من البصمة الجديدة', async () => {
    const root = tmp('vf-iso-content-')
    const dirL = path.join(root, 'Windows', 'windows 10')
    const dirH = path.join(root, 'New folder (2)')
    fs.mkdirSync(dirL, { recursive: true })
    fs.mkdirSync(dirH, { recursive: true })

    const name = 'payload.iso'
    const pL = write(dirL, name, Buffer.alloc(BIG, 0xaa))
    const pLtw = write(dirL, 'payload.copy.iso', Buffer.alloc(BIG, 0xaa)) // توأم محلي يجعل البصمة تُحسب
    const pH = write(dirH, name, Buffer.alloc(BIG, 0xbb))

    const scan1 = await runScheduler([dirL], [], 1)
    expect(scan1.groups).toHaveLength(1)
    const oldHash = scan1.files.find((f) => f.path === pL)?.fullHash
    expect(oldHash).toBeTruthy()

    // استبدال ملف L: بمحتوى جديد بالحجم نفسه (توقّع الفحص القديم: تغيير الوقت لا الحجم)
    const replacement = Buffer.alloc(BIG, 0xbb)
    fs.writeFileSync(pL, replacement)
    const future = new Date(Date.now() + 5000)
    fs.utimesSync(pL, future, future)

    const scan2 = await runScheduler([dirH], scan1.files, 100)
    const carried = scan2.files.find((f) => f.path === pL)
    // البصمة القديمة لا يجوز الوثوق بها: الملف تغير فعلًا
    expect(carried?.scanState).not.toBe('unchanged')

    const group = scan2.groups.find((g) => g.files.some((f) => f.path === pL))
    expect(group, 'النسختان L: و H: متطابقتان الآن ويجب أن تظهرا كمجموعة').toBeTruthy()
    expect(group?.files.some((f) => f.path === pH)).toBe(true)
    void pLtw
    cleanup(root)
  })
})

describe('بقاء المجموعات بعد إعادة تشغيل التطبيق', () => {
  it('مجموعات الفحص السريع (بصمة جزئية فقط) تُعاد بناؤها من الفهرس', async () => {
    const root = tmp('vf-restart-quick-')
    const p1 = write(root, 'a.bin', Buffer.from('quick-content-payload'))
    const p2 = write(root, 'b.bin', Buffer.from('quick-content-payload'))
    const partialHash = await computePartialHash(p1, fs.statSync(p1).size)

    const index = new MemoryIndex()
    index.bulkLoad([statRecord(p1, 1, { partialHash }), statRecord(p2, 2, { partialHash })])

    // لا توجد بصمة كاملة إطلاقًا — هذا واقع الفحص السريع
    expect(index.fullHashEntries()).toHaveLength(0)

    const entries = index
      .partialHashEntries()
      .map(([key, files]) => [key, files] as [string, IndexedFile[]])
      .filter(([, files]) => files.length > 1)
    const groups = groupsFromPartialHashMap(entries)

    expect(groups).toHaveLength(1)
    expect(groups[0].fileCount).toBe(2)
    expect(groups[0].hashKind).toBe('partial')
    expect(groups[0].files.map((f) => f.path).sort()).toEqual([p1, p2].sort())
    cleanup(root)
  })

  it('الملفات التي لها بصمة كاملة لا تُحتسب مرتين (جزئي + كامل)', async () => {
    const root = tmp('vf-restart-mixed-')
    const p1 = write(root, 'a.bin', Buffer.from('mixed-payload'))
    const p2 = write(root, 'b.bin', Buffer.from('mixed-payload'))
    const partialHash = await computePartialHash(p1, fs.statSync(p1).size)

    const index = new MemoryIndex()
    index.bulkLoad([
      statRecord(p1, 1, { partialHash, fullHash: 'full-a' }),
      statRecord(p2, 2, { partialHash, fullHash: 'full-a' })
    ])

    // المجموعة الكاملة وحدها — لا نسخة جزئية موازية لنفس الملفين
    expect(index.partialHashEntries()).toHaveLength(0)
    const full = groupsFromFullHashMap(index.fullHashEntries())
    expect(full).toHaveLength(1)
    expect(full[0].files.map((f) => f.path).sort()).toEqual([p1, p2].sort())
    cleanup(root)
  })

  it('مفتاح البصمة الجزئية موحّد بين الكاشف والفهرس', () => {
    expect(partialKey(1234, 'abc')).toBe('1234|abc')
  })
})

describe('حساب المعرّف التالي على فهارس ضخمة', () => {
  it('لا يرمي على فهرس يتجاوز حد الوسائط (كان Math.max(...spread) يفشل عند ~125 ألف ملف)', () => {
    // سجلات وهمية بأرقام معرّفات متسلسلة — لا نلمس القرص
    const many = Array.from({ length: 200_000 }, (_, i) => ({ id: i + 1 }) as IndexedFile)
    expect(() => nextIdAfter(many, 1)).not.toThrow()
    expect(nextIdAfter(many, 1)).toBe(200_001)
  })

  it('يحترم المعرّفات المحمّلة من فحوصات سابقة', () => {
    const files = [{ id: 3 }, { id: 900 }, { id: 12 }] as IndexedFile[]
    expect(nextIdAfter(files, 1)).toBe(901)
  })

  it('لا ينقص عن البداية', () => {
    expect(nextIdAfter([], 7)).toBe(7)
    expect(nextIdAfter([{ id: 1 }] as IndexedFile[], 50)).toBe(50)
  })
})
