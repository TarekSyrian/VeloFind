import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ScanScheduler } from '@engine/scanner/scan-scheduler'
import { FileScanner, refreshCarriedFiles } from '@engine/scanner/file-scanner'
import { DuplicateDetector } from '@engine/duplicates/duplicate-detector'
import { isDriveRoot } from '@engine/scanner/directory-walker'
import { filterDuplicateGroups } from '@engine/query/duplicate-filters'
import { CancellationToken, PauseGate } from '@engine/concurrency'
import type { DuplicateGroup, IndexedFile, ScanPhase, ScanRequest, ScanWarning } from '@shared/types'

/**
 * اختبارات انحدار لبلاغ المستخدم:
 * ملف على H:\ ومكرره على L:\ لا يظهران كمكررين، وفلترة الأقراص تعرض قرصًا واحدًا.
 * الجذور التي تُغطى هنا:
 *  1) اللقطة كانت تستبدل الفهرس فتفقد ملفات الأقراص الأخرى → الآن تُحمل (carry-over)
 *  2) مجلد المستخدم «Windows» كان يُستثنى بالاسم → الآن استثناء مسارات النظام الحقيقية فقط
 *  3) زر «عبر الأقراص فقط» يعرض المجموعات الممتدة على أكثر من قرص
 */

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

const noopHooks = () => ({
  phases: [] as ScanPhase[],
  warnings: [] as ScanWarning[],
  out: {
    onPhase: (_p: ScanPhase) => undefined,
    onProgress: (_s: unknown) => undefined,
    onHashBatch: (_u: unknown[]) => undefined,
    onWarning: (w: ScanWarning) => w
  }
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
  const scheduler = new ScanScheduler(new CancellationToken(), new PauseGate(), noopHooks().out)
  return scheduler.run({ request: request(locations), previous, nextId, concurrency: 4 })
}

describe('السجل التراكمي عبر الفحوصات — بلاغ المكررات العابرة للأقراص', () => {
  it('فحص قرص آخر يحمل ملفات القرص الأول ويكتشف التوأم العابر دون إعادة قراءته', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'velofind-xdrive-'))
    const dirB = path.join(root, 'diskB') // يمثل L:\Windows\windows 10
    const dirA = path.join(root, 'diskA') // يمثل H:\New folder (2)
    fs.mkdirSync(dirB)
    fs.mkdirSync(dirA)

    const content = Buffer.from('WIN10-ISO-CONTENT-'.repeat(4096))
    const pB = write(dirB, 'WIN10.PRO.AIO.ISO', content)
    const pBTwin = write(dirB, 'WIN10.PRO.AIO.COPY.ISO', content) // توأم محلي يجعل الفحص الأول يحسب البصمة
    const pA = write(dirA, 'WIN10.PRO.AIO.ISO', content)

    // الفحص 1: قرص B وحده → بصمة كاملة مخزنة للملفين
    const scan1 = await runScheduler([dirB], [], 1)
    expect(scan1.groups).toHaveLength(1)
    const recB = scan1.files.find((f) => f.path === pB)
    expect(recB?.fullHash).toBeTruthy()
    expect(recB?.scanState).toBe('scanned')

    // الفحص 2: قرص A وحده فقط — يجب أن يُحمل ملف B من الفهرس ويظهر التوأم العابر
    const scan2 = await runScheduler([dirA], scan1.files, 2)
    const recA = scan2.files.find((f) => f.path === pA)
    const recB2 = scan2.files.find((f) => f.path === pB)

    // اللقطة تحتوي القرصين معًا (لم يعد الفحص يمسح القرص الآخر)
    expect(recA).toBeTruthy()
    expect(recB2).toBeTruthy()

    // ملف B لم يُقرأ مجددًا: حمل بحالته وبصمته (unchanged بنفس البصمة)
    expect(recB2?.scanState).toBe('unchanged')
    expect(recB2?.fullHash).toBe(recB?.fullHash)

    // التوأم العابر للأقراص اكتُشف في فحص القرص A وحده (3 نسخ: واحدة من A واثنتان من B)
    expect(scan2.groups).toHaveLength(1)
    const group = scan2.groups[0]
    expect(group.fileCount).toBe(3)
    expect(group.files.map((f) => f.path).sort()).toEqual([pA, pB, pBTwin].sort())
  })

  it('فحص موقع متعدد المواقع يقارن المواقع معًا فورًا', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'velofind-multi-'))
    const dir1 = path.join(root, 'one')
    const dir2 = path.join(root, 'two')
    fs.mkdirSync(dir1)
    fs.mkdirSync(dir2)
    const content = Buffer.from('same-bytes-'.repeat(1000))
    write(dir1, 'a.bin', content)
    write(dir2, 'b.bin', content)

    const scan = await runScheduler([dir1, dir2], [], 1)
    expect(scan.groups).toHaveLength(1)
    expect(scan.groups[0].fileCount).toBe(2)
  })

  it('مجلد عادي اسمه windows لا يُستثنى (كان يفوّت ملفات المستخدم)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'velofind-winname-'))
    // مجلد يحمل اسم نظام ويندوز داخل قرص بيانات — مجلد المستخدم وليس مجلد النظام
    const windowsDir = path.join(root, 'Windows')
    const deep = path.join(windowsDir, 'windows 10')
    fs.mkdirSync(deep, { recursive: true })
    const content = Buffer.from('inside-user-windows-folder')
    const p = write(deep, 'data.bin', content)

    const scan = await runScheduler([root], [], 1)
    expect(scan.files.some((f) => f.path === p)).toBe(true)
  })

  it('موقع مختار صراحةً باسم يستثنى بالنظام يُفحص كاملًا', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'velofind-rootpick-'))
    const windowsDir = path.join(root, 'Windows')
    fs.mkdirSync(windowsDir)
    const p = write(windowsDir, 'picked.bin', Buffer.from('explicit-root'))
    const scan = await runScheduler([windowsDir], [], 1)
    expect(scan.files.some((f) => f.path === p)).toBe(true)
  })
})

describe('refreshCarriedFiles — قواعد تحقق الملفات المحمولة', () => {
  it('غير المتغير → unchanged مع الحفاظ على البصمة، المتغير → new بلا بصمة، المفقود → missing', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'velofind-carry-'))
    // volumeId فارغ → القرص يُشتق من أول محرف '/' وجذرها متاح في بيئة الاختبار
    const kept = write(root, 'kept.bin', Buffer.from('stable-content'))
    const changed = write(root, 'changed.bin', Buffer.from('original-content'))
    const gone = write(root, 'gone.bin', Buffer.from('will-be-deleted'))

    // السجلات تُلتقط قبل أي تعديل (كما كانت معروفة من فحص سابق)
    const keptRec = statRecord(kept, 1, { fullHash: 'h1' })
    const changedRec = statRecord(changed, 2, { fullHash: 'h2' })
    const goneRec = statRecord(gone, 3, { fullHash: 'h3' })

    const token = new CancellationToken()
    const gate = new PauseGate()

    // 1) ملف لم يتغير وبصمة محفوظة → unchanged
    const r1 = await refreshCarriedFiles([keptRec], token, gate)
    expect(r1.files[0].scanState).toBe('unchanged')
    expect(r1.files[0].fullHash).toBe('h1')

    // 2) ملف تغير حجمه → new وتُصفَّر بصماته
    fs.writeFileSync(changed, Buffer.from('original-content-extended-now'))
    const r2 = await refreshCarriedFiles([changedRec], token, gate)
    expect(r2.files[0].scanState).toBe('new')
    expect(r2.files[0].fullHash).toBeUndefined()
    expect(r2.files[0].size).toBe(fs.statSync(changed).size)

    // 3) ملف حُذف بينما القرص متاح → missing
    fs.unlinkSync(gone)
    const r3 = await refreshCarriedFiles([goneRec], token, gate)
    expect(r3.files[0].scanState).toBe('missing')
    // المفقود يبقى في اللقطة (يُزال لاحقًا عند فحص موقعه)
    expect(r3.count).toBe(1)
  })

  it('قرص غير متاح (جذره لا يُقرأ) → تُحمل ملفاته كما هي دون استثناء', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'velofind-offline-'))
    const p = write(root, 'x.bin', Buffer.from('offline-drive-file'))
    // volumeId 'Z' → جذر Z:\ غير موجود في بيئة الاختبار = قرص مفصول
    const record = statRecord(p, 9, { volumeId: 'Z', fullHash: 'hz', scanState: 'scanned' })
    const r = await refreshCarriedFiles([record], new CancellationToken(), new PauseGate())
    expect(r.files[0].scanState).toBe('unchanged')
    expect(r.files[0].fullHash).toBe('hz')
  })
})

describe('isDriveRoot — جذر القرص لمطابقة مجلداته الخاصة فقط', () => {
  it('يتعرف على جذور الأقراص بصيغها المختلفة', () => {
    expect(isDriveRoot('C:\\')).toBe(true)
    expect(isDriveRoot('C:')).toBe(true)
    expect(isDriveRoot('c:/')).toBe(true)
    expect(isDriveRoot('C:\\Users')).toBe(false)
    expect(isDriveRoot('\\\\server\\share')).toBe(false)
  })
})

describe('كاشف المكررات — الملفات المفقودة مستبعدة من الترشيح', () => {
  it('missing لا يمنع بقاء مجموعة النسخ الموجودة', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velofind-miss-'))
    const content = Buffer.from('duplicated-payload-'.repeat(500))
    const p1 = write(dir, 'a.bin', content)
    const p2 = write(dir, 'b.bin', content)
    const pDeleted = write(dir, 'deleted.bin', content)

    const files: IndexedFile[] = [
      statRecord(p1, 1, { fullHash: 'deadbeef', scanState: 'unchanged' }),
      statRecord(p2, 2, { fullHash: 'deadbeef', scanState: 'unchanged' }),
      statRecord(pDeleted, 3, { fullHash: 'deadbeef', scanState: 'missing' })
    ]

    const detector = new DuplicateDetector({
      mode: 'accurate',
      concurrency: 2,
      token: new CancellationToken(),
      gate: new PauseGate(),
      hooks: {
        onPhase: () => undefined,
        onProgress: () => undefined,
        onHashBatch: () => undefined,
        onWarning: () => undefined
      }
    })
    const result = await detector.detect(files)
    // النسختان الموجودتان فعلًا تظهران، والمفقود لا يُحسب ضمن المجموعة
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].fileCount).toBe(2)
  })
})

describe('فلترة «عبر الأقراص فقط» — منطق التصفية المشترك', () => {
  const groups: DuplicateGroup[] = [
    {
      id: 'full:h1',
      hash: 'sha256:h1',
      hashKind: 'full',
      size: 10,
      fileCount: 2,
      reclaimedBytes: 10,
      files: [
        { id: 1, path: 'H:\\a.bin', name: 'a.bin', directory: 'H:\\', drive: 'H', extension: 'bin', size: 10, modifiedAt: 1, createdAt: 1, isHidden: false },
        { id: 2, path: 'L:\\a.bin', name: 'a.bin', directory: 'L:\\', drive: 'L', extension: 'bin', size: 10, modifiedAt: 2, createdAt: 1, isHidden: false }
      ]
    },
    {
      id: 'full:h2',
      hash: 'sha256:h2',
      hashKind: 'full',
      size: 20,
      fileCount: 2,
      reclaimedBytes: 20,
      files: [
        { id: 3, path: 'H:\\b1.bin', name: 'b1.bin', directory: 'H:\\', drive: 'H', extension: 'bin', size: 20, modifiedAt: 1, createdAt: 1, isHidden: false },
        { id: 4, path: 'H:\\b2.bin', name: 'b2.bin', directory: 'H:\\', drive: 'H', extension: 'bin', size: 20, modifiedAt: 2, createdAt: 1, isHidden: false }
      ]
    }
  ]

  it('عند التفعيل تظهر المجموعات الممتدة على أكثر من قرص فقط', () => {
    const filtered = filterDuplicateGroups(groups, { ...baseFilters, crossDriveOnly: true }, {})
    expect(filtered.map((g) => g.id)).toEqual(['full:h1'])
  })

  it('عند التعطيل تظهر كل المجموعات', () => {
    expect(filterDuplicateGroups(groups, baseFilters, {})).toHaveLength(2)
  })

  const baseFilters = {
    text: '',
    drive: '',
    minSize: null,
    sortKey: 'reclaimed' as const,
    sortDir: 'desc' as const,
    onlySelected: false,
    crossDriveOnly: false
  }
})
