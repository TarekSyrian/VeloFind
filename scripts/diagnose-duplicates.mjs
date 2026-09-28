#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════════
 *  تشخيص: لماذا لا يكتشف المحرك ملفَّين مكررين؟
 * ════════════════════════════════════════════════════════════════════════
 *
 * هذا السكربت يقرأ فقط — لا يكتب ولا يحذف ولا يعدّل أي ملف.
 * يشخّص المسارين خطوة بخطوة عبر نفس خط أنابيب VeloFind:
 *
 *   1) إحصاء الملف (stat) — هل يُقرأ أصلًا؟ وما الحجم الحقيقي؟
 *   2) قواعد الاستثناء — نظام/مخفي/امتداد/حجم أدنى/أسماء مجلدات مستثناة
 *   3) مجموعة الحجم — هل الحجمان متساويان؟ (شرط التكرار الأول)
 *   4) البصمة الجزئية — أول+منتصف+آخر 64KB
 *   5) البصمة الكاملة — SHA-256 متدفقة
 *   6) مقارنة بايت ببايت — في حال اختلفت البصمة: أين أول اختلاف؟
 *
 * الخطوة 6 هي الحاسمة: إن اختلف الملفان بايتًا واحدًا فلا يوجد أي برنامج
 * في العالم يعتبرهما مكررين، والتطبيق على حق.
 *
 * الاستخدام (استخدم مسار Node.js كاملًا إذا لم يكن node في PATH):
 *   node scripts/diagnose-duplicates.mjs "مسار1" "مسار2"
 *
 * أمثلة:
 *   node scripts/diagnose-duplicates.mjs ^
 *     "H:\New folder (2)\WIN10.PRO.AIO.SUPERLITE+SE+COMPACT.U7.X64.(WPE+).ISO" ^
 *     "L:\Windows\windows 10\WIN10.PRO.AIO.SUPERLITE+SE+COMPACT.U7.X64.(WPE+).ISO"
 *
 * على PowerShell يعمل السطر أعلاه كما هو. على cmd استخدم ^ للسطور.
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IS_WINDOWS = process.platform === 'win32'

/* ══════════════════════════════════════════════════════════════════════
   1) قيم خط الأنابيب — تُقرأ من المصدر نفسه لمنع الانحراف
   ══════════════════════════════════════════════════════════════════════ */

/** استخراج ثابت رقمي من شيفرة المصدر حتى لا تفترق القيم عن التطبيق */
function constantFromSource(file, name, fallback) {
  try {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf-8')
    const m = new RegExp(`${name}\\s*=\\s*([0-9*\\s().]+)`).exec(src)
    if (!m) return { value: fallback, source: 'افتراضي (تعذّر قراءته من المصدر)' }
    // eslint-disable-next-line no-new-func
    const value = Function(`"use strict";return (${m[1].trim()})`)()
    if (!Number.isFinite(value)) return { value: fallback, source: 'افتراضي' }
    return { value, source: `${file} ← ${m[1].trim()}` }
  } catch {
    return { value: fallback, source: 'افتراضي' }
  }
}

const PARTIAL_HASH_CHUNK = constantFromSource('src/shared/constants.ts', 'PARTIAL_HASH_CHUNK', 64 * 1024)
const PARTIAL_SKIP_SIZE = constantFromSource('src/shared/constants.ts', 'PARTIAL_SKIP_SIZE', 4 * 1024 * 1024)
const STREAM_CHUNK = constantFromSource('src/shared/constants.ts', 'STREAM_CHUNK', 1024 * 1024)

/** قائمة أسماء المجلدات المستثناة افتراضيًا (نفس DEFAULT_EXCLUDED_FOLDERS) */
function defaultExcludedFolders() {
  try {
    const src = fs.readFileSync(path.join(ROOT, 'src/shared/constants.ts'), 'utf-8')
    const block = /DEFAULT_EXCLUDED_FOLDERS\s*=\s*\[([\s\S]*?)\]/.exec(src)
    if (!block) return []
    return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1].toLowerCase())
  } catch {
    return []
  }
}

/* ══════════════════════════════════════════════════════════════════════
   2) أدوات مطابقة المسارات — نفس منطق التطبيق
   ══════════════════════════════════════════════════════════════════════ */

const toWindowsLongPath = (p) => {
  if (!IS_WINDOWS) return p
  if (p.startsWith('\\\\?\\')) return p
  const absolute = path.resolve(p)
  return absolute.startsWith('\\\\') ? '\\\\?\\UNC\\' + absolute.slice(2) : '\\\\?\\' + absolute
}

const normalizePath = (p) => p.replace(/\//g, '\\').toLowerCase().replace(/[\\]+$/, '')

const isUnderPath = (p, root) => {
  const np = normalizePath(p)
  const nr = normalizePath(root)
  return np === nr || np.startsWith(nr + '\\')
}

/** نفس منطق resolveSystemFolderPaths في src/engine/scanner/system-paths.ts */
function resolveSystemFolderPaths(env = process.env) {
  const out = []
  const push = (v) => {
    if (v && v.trim()) out.push(v.trim())
  }
  push(env.SystemRoot)
  push(env.windir)
  push(env.ProgramFiles)
  push(env['ProgramFiles(x86)'])
  push(env.ProgramData)
  const sysDrive = (env.SystemDrive ?? 'C:').replace(/[\\]+$/, '')
  if (/^[a-zA-Z]:$/.test(sysDrive)) {
    out.push(`${sysDrive}\\Recovery`)
    out.push(`${sysDrive}\\PerfLogs`)
  }
  return out
}

const DRIVE_ROOT_EXCLUDES = ['$recycle.bin', 'system volume information']

/** نفس computePartialRanges في src/engine/duplicates/partial-hasher.ts */
function computePartialRanges(size, chunk) {
  if (size <= 0) return []
  if (size <= chunk * 3) return [{ start: 0, end: size }]
  const ranges = [
    { start: 0, end: Math.min(chunk, size) },
    { start: Math.max(0, size - chunk), end: size }
  ]
  const midStart = Math.floor((size - chunk) / 2)
  ranges.push({ start: midStart, end: midStart + chunk })
  return ranges
}

function mergeRanges(ranges) {
  if (ranges.length === 0) return []
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    const cur = sorted[i]
    if (cur.start <= last.end) last.end = Math.max(last.end, cur.end)
    else merged.push({ ...cur })
  }
  return merged
}

/* ══════════════════════════════════════════════════════════════════════
   3) الطباعة
   ══════════════════════════════════════════════════════════════════════ */

const C = process.stdout.isTTY
  ? {
      b: '\x1b[1m', dim: '\x1b[2m', r: '\x1b[0m',
      g: '\x1b[32m', y: '\x1b[33m', red: '\x1b[31m', c: '\x1b[36m'
    }
  : { b: '', dim: '', r: '', g: '', y: '', red: '', c: '' }

let step = 0
const head = (t) => console.log(`\n${C.b}${C.c}[${++step}] ${t}${C.r}`)
const ok = (t) => console.log(`    ${C.g}✓${C.r} ${t}`)
const bad = (t) => console.log(`    ${C.red}✗${C.r} ${t}`)
const warn = (t) => console.log(`    ${C.y}!${C.r} ${t}`)
const info = (t) => console.log(`    ${C.dim}·${C.r} ${C.dim}${t}${C.r}`)

function human(bytes) {
  if (!Number.isFinite(bytes)) return 'غير محدد'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${u[i]} (${en(bytes)} بايت)`
}

const en = (n) => Number(n).toLocaleString('en-US')
const hr = () => console.log(C.dim + '─'.repeat(72) + C.r)

/* ══════════════════════════════════════════════════════════════════════
   4) التحليل
   ══════════════════════════════════════════════════════════════════════ */

async function analyzeFile(p, settings) {
  const label = path.basename(p) || p
  console.log(`\n${C.b}▸ ${label}${C.r}`)
  info(`المسار: ${p}`)

  // 4.1 — stat
  head(`stat على: ${label}`)
  let st
  try {
    st = await fsp.stat(toWindowsLongPath(p))
    ok(`الحجم: ${human(st.size)}`)
    info(`آخر تعديل: ${new Date(st.mtimeMs).toISOString()}`)
  } catch (error) {
    bad(`stat فشل: ${error.code || ''} ${error.message}`)
    return null
  }

  // 4.2 — قواعد الاستثناء
  head(`قواعد الاستثناء على: ${label}`)
  const dir = path.dirname(p)
  const rejected = []

  // (أ) مجلد نظام حقيقي
  if (settings.excludeSystemFolders) {
    const sysMatch = settings.systemPaths.find((s) => isUnderPath(dir, s))
    if (sysMatch) {
      bad(`مجلد نظام حقيقي: «${dir}» يقع ضمن «${sysMatch}»`)
      rejected.push('نظام')
    } else {
      ok('ليس ضمن مسارات النظام الحقيقية')
    }
  } else {
    info('خيار «استثناء ملفات النظام» معطّل — لا فحص')
  }

  // (ب) مجلدات خاصة تحت جذر القرص
  const parentIsRoot = /^[a-zA-Z]:[\\/]?$/.test(path.dirname(dir).trim())
  if (parentIsRoot && DRIVE_ROOT_EXCLUDES.includes(path.basename(dir).toLowerCase())) {
    bad(`مجلد خاص في جذر القرص: ${dir}`)
    rejected.push('جذرقرص')
  } else {
    ok('ليس مجلدًا خاصًا في جذر القرص')
  }

  // (ج) مخفي
  const FILE_ATTRIBUTE_HIDDEN = 0x2
  const isHidden = (st.attributes & FILE_ATTRIBUTE_HIDDEN) !== 0
  if (isHidden && !settings.includeHidden) {
    bad('الملف مخفي وخيار «الملفات المخفية» معطّل')
    rejected.push('مخفي')
  } else {
    ok('ليس مخفيًا (أو أن خيار إظهار المخفي مفعّل)')
  }

  // (د) امتداد ضمن الفئة
  const ext = path.extname(p).replace('.', '').toLowerCase()
  if (settings.category !== 'all') {
    const cats = {
      images: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'raw', 'cr2', 'nef'],
      video: ['mp4', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', '3gp', 'ts'],
      audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus', 'aiff'],
      documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'ods', 'odp', 'csv', 'md']
    }
    const list = cats[settings.category] || []
    if (list.length > 0 && !list.includes(ext)) {
      bad(`الامتداد .${ext} خارج فئة «${settings.category}»`)
      rejected.push('فئة')
    } else {
      ok(`.${ext} ضمن الفئة «${settings.category}»`)
    }
  } else {
    ok(`الفئة «الكل» — الامتداد .${ext} مقبول`)
  }

  // (هـ) الحد الأدنى للحجم
  if (st.size < settings.minSize) {
    bad(`الحجم أصغر من الحد الأدنى (${human(settings.minSize)})`)
    rejected.push('حد أدنى')
  } else {
    ok(`يحقّق الحد الأدنى للحجم (${human(settings.minSize)})`)
  }

  // (و) أسماء مجلدات مستثناة (مقاطع مستقلة)
  const segments = dir.toLowerCase().split(/[\\/]+/)
  const nameHit = settings.excludedFolderNames.find((n) => segments.includes(n.toLowerCase()))
  if (nameHit) {
    bad(`المجلد «${nameHit} ضمن قائمة المجلدات المستثناة بالاسم`)
    rejected.push('اسم مجلد مستثنى')
  } else {
    ok('لا مجلد مستثنى بالاسم في المسار')
  }

  return { path: p, size: st.size, dir, ext, rejected }
}

async function partialHash(p, size) {
  const ranges = mergeRanges(computePartialRanges(size, PARTIAL_HASH_CHUNK.value))
  const h = createHash('sha256')
  const fh = await fsp.open(toWindowsLongPath(p), 'r')
  try {
    for (const r of ranges) {
      const len = r.end - r.start
      const buf = Buffer.allocUnsafe(len)
      const { bytesRead } = await fh.read(buf, 0, len, r.start)
      h.update(buf.subarray(0, bytesRead))
    }
  } finally {
    await fh.close()
  }
  return h.digest('hex')
}

async function fullHash(p, onProgress) {
  const h = createHash('sha256')
  let read = 0
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(toWindowsLongPath(p), { highWaterMark: STREAM_CHUNK.value })
    stream.on('data', (c) => {
      h.update(c)
      read += c.length
      onProgress?.(read)
    })
    stream.on('error', reject)
    stream.on('end', () => resolve({ hash: h.digest('hex'), bytesRead: read }))
  })
}

/** أول موضع يختلف فيه الملفان — يحوّل «غير مكرر» إلى سبب محدد */
async function firstDifference(a, b) {
  const CH = 4 * 1024 * 1024
  const ha = await fsp.open(toWindowsLongPath(a), 'r')
  const hb = await fsp.open(toWindowsLongPath(b), 'r')
  const ba = Buffer.allocUnsafe(CH)
  const bb = Buffer.allocUnsafe(CH)
  let offset = 0
  try {
    for (;;) {
      const ra = await ha.read(ba, 0, CH, offset)
      const rb = await hb.read(bb, 0, CH, offset)
      const n = Math.min(ra.bytesRead, rb.bytesRead)
      for (let i = 0; i < n; i++) {
        if (ba[i] !== bb[i]) {
          return { offset: offset + i, byteA: ba[i], byteB: bb[i], shortA: ra.bytesRead < CH, shortB: rb.bytesRead < CH }
        }
      }
      if (ra.bytesRead < CH || rb.bytesRead < CH) {
        return ra.bytesRead === rb.bytesRead ? null : { offset, shortA: true, shortB: true }
      }
      offset += n
    }
  } finally {
    await ha.close()
    await hb.close()
  }
}

/* ══════════════════════════════════════════════════════════════════════
   5) التشغيل
   ══════════════════════════════════════════════════════════════════════ */

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (args.length !== 2) {
  console.log(`
${C.b}الاستخدام:${C.r}
  node scripts/diagnose-duplicates.mjs "المسار الأول" "المسار الثاني"

${C.b}الخيارات:${C.r}
  --include-system     فعّل استثناء ملفات النظام (افتراضيًا معطّل، كإعدادك)
  --min-size <بايت>    الحد الأدنى للحجم (افتراضيًا 0)
  --skip-full-hash     تخطّي البصمة SHA-256 (أسرع). المقارنة البايتية تبقى
                       شغّالة، فالنتيجة لا تتأثر.

${C.b}ملاحظة:${C.r} السكربت يقرأ فقط ولا يعدّل أي ملف.
  على ملفات 5GB خذ بالحسبان أن البصمة الكاملة تقرأ 10GB من القرص.
`)
  process.exit(args.length === 0 ? 0 : 1)
}

const settings = {
  excludeSystemFolders: !process.argv.includes('--include-system'),
  includeHidden: false,
  category: 'all',
  minSize: (() => {
    const i = process.argv.indexOf('--min-size')
    return i >= 0 ? Number(process.argv[i + 1]) || 0 : 0
  })(),
  excludedFolderNames: defaultExcludedFolders(),
  systemPaths: resolveSystemFolderPaths()
}

const skipFull = process.argv.includes('--skip-full-hash')

console.log(`${C.b}${C.c}══ تشخيص المكررات — VeloFind ══${C.r}`)
console.log(`${C.dim}المنصة: ${process.platform} | Node ${process.version}${C.r}`)
info(`PARTIAL_HASH_CHUNK = ${en(PARTIAL_HASH_CHUNK.value)}  (${PARTIAL_HASH_CHUNK.source})`)
info(`PARTIAL_SKIP_SIZE  = ${en(PARTIAL_SKIP_SIZE.value)}  (${PARTIAL_SKIP_SIZE.source})`)
info(`STREAM_CHUNK       = ${en(STREAM_CHUNK.value)}  (${STREAM_CHUNK.source})`)
hr()

head('مسارات النظام الحقيقية كما يقرأها المحرك من بيئة التشغيل')
for (const s of settings.systemPaths) info(s)
if (settings.systemPaths.some((s) => /^[lL]:/.test(s))) {
  console.log(`    ${C.y}تنبيه: بعض مسارات النظام على القرص L: — تحقّق أدناه${C.r}`)
} else {
  ok('لا يوجد مسار نظام على القرص L:')
}
if (settings.excludeSystemFolders) {
  warn('خيار «استثناء ملفات النظام» مُفعّل في هذا التشخيص — شغّل بدون --include-system لمطابقة إعدادك')
} else {
  ok('إعدادك مطبَّق: استثناء ملفات النظام معطّل')
}

const [p1, p2] = args
const a = await analyzeFile(p1, settings)
hr()
const b = await analyzeFile(p2, settings)
hr()

head('الخلاصة الأولى: الاستثناءات')
const anyRejected = [...(a?.rejected ?? []), ...(b?.rejected ?? [])]
if (anyRejected.length === 0) {
  ok('الملفان يجتازان كل قواعد الاستثناء — ليس الاستثناء هو السبب')
} else {
  bad(`أحد الملفين أو كلاهما مستثنى بسبب: ${[...new Set(anyRejected)].join('، ')}`)
  console.log(`    ${C.dim}هذا سبب كافٍ لعدم ظهورهما كمكررين. صحّح الإعداد أو انقل الملف.${C.r}`)
}

if (!a || !b) {
  console.log(`\n${C.red}لا يمكن المتابعة: أحد الملفين غير قابل للإحصاء.${C.r}`)
  process.exit(2)
}

head('تجميع حسب الحجم (الشرط الأول للتكرار)')
/**
 * حالة الحكم: unknown لم يُحسم بعد | identical ثبت التطابق | different ثبت الاختلاف.
 * لا نحكم بـ identical إلا بدليل قاطع (SHA-256 متطابقة أو مقارنة بايت بلا فرق)،
 * فسكربت تشخيص يُعطي نتيجة خاطئة أسوأ من عدمه.
 */
let verdict = 'unknown'

if (a.size === b.size) {
  ok(`الحجمان متساويان: ${human(a.size)}`)
} else {
  bad(
    `الحجمان مختلفان!\n        1: ${en(a.size)}\n        2: ${en(b.size)}` +
      `\n        فرق: ${en(Math.abs(a.size - b.size))} بايت`
  )
  verdict = 'different'
}
console.log(
  `    ${C.dim}الملفات تجتمع في مجموعة حجم واحدة فقط عند التساوي التام. أي فرق يُخرجهما من المقارنة نهائيًا.${C.r}`
)

head('البصمة الجزئية (أول + منتصف + آخر 64KB)')
const pa = await partialHash(a.path, a.size)
const pb = await partialHash(b.path, b.size)
info(`1: ${pa}`)
info(`2: ${pb}`)
if (pa === pb) {
  ok('البصمة الجزئية متطابقة — الملفان مرشّحان للمقارنة الكاملة')
} else {
  bad('البصمة الجزئية مختلفة — يوجد اختلاف في البداية أو المنتصف أو النهاية')
  verdict = 'different'
}

if (verdict === 'unknown' && !skipFull) {
  head('البصمة الكاملة SHA-256 (قراءة الملفين كاملين)')
  const t0 = Date.now()
  const spinner = setInterval(() => {
    if (!process.stdout.isTTY) return
    process.stdout.write(`\r    ${C.dim}… ${Math.round((Date.now() - t0) / 1000)}s${C.r}`)
  }, 1000)
  const ra = await fullHash(a.path)
  const rb = await fullHash(b.path)
  clearInterval(spinner)
  if (process.stdout.isTTY) process.stdout.write('\r' + ' '.repeat(30) + '\r')
  ok(`1: ${ra.hash}  (${human(ra.bytesRead)} في ${Math.round((Date.now() - t0) / 1000)}ث)`)
  ok(`2: ${rb.hash}`)
  if (ra.hash === rb.hash) {
    ok('البصمة الكاملة متطابقة — يجب أن يعرضهما التطبيق كمجموعة مكررة واحدة')
    verdict = 'identical'
  } else {
    bad('البصمة الكاملة مختلفة — الملفان ليسا مكررين')
    verdict = 'different'
  }
}

// المقارنة البايتية تُشغَّل دائمًا ما لم يثبت التطابق بالSHA-256.
// تشغيلها شرط وليس ترفًا: البصمة الجزئية تنظر 192KB من 5GB، فلا تكشف
// الاختلاف في 나머ية الملف — وبدون مقارنة كاملة قد نحكم خطأً.
if (verdict !== 'identical') {
  head('مقارنة بايت ببايت: أين الاختلاف بالضبط؟')
  const t0 = Date.now()
  const d = await firstDifference(a.path, b.path)
  if (!d) {
    ok('لا يوجد اختلاف على الإطلاق — الملفات متطابقة تمامًا')
    verdict = 'identical'
  } else if (d.shortA && d.shortB) {
    bad(`أحد الملفين ينتهي عند الإزاحة ${en(d.offset)} بايت`)
    verdict = 'different'
  } else {
    bad(`أول اختلاف عند الإزاحة ${en(d.offset)} بايت`)
    info(`القيمة في 1: 0x${d.byteA?.toString(16).padStart(2, '0') ?? '؟'}`)
    info(`القيمة في 2: 0x${d.byteB?.toString(16).padStart(2, '0') ?? '؟'}`)
    verdict = 'different'
  }
  info(`استغرق ${Math.round((Date.now() - t0) / 1000)} ثانية`)
}

if (verdict === 'unknown') {
  warn('لم يُحسم الحكم — أعد التشغيل بدون --skip-full-hash')
}

hr()
console.log(`\n${C.b}النتيجة${C.r}`)
if (verdict === 'identical') {
  console.log(`${C.g}الملفان متطابقان بايتًا ببايت.${C.r}`)
  console.log(`
${C.b}إذًا المشكلة ليست في المحتوى.${C.r} الأسباب المحتملة المتبقية داخل التطبيق:
  1) ${C.b}فهرس قديم${C.r}: البصمات المخزّنة تُوثَّق عند تطابق الحجم+الوقت ولا تُعاد قراءتها.
     الحل: ${C.b}الإعدادات ← «مسح الفهرس والنتائج»${C.r} ثم فحص شامل للقرصين معًا.
  2) ${C.b}الملفان ليسا في نفس نتيجة الفحص${C.r}: افحص القرصين في ${C.b}فحص واحد${C.r}.
  3) ${C.b}وضع الفحص السريع${C.r}: يعرض المجموعات بوسم «سريع» — تحقّق من ظهوره.
  4) ${C.b}فلتر في صفحة المكررات${C.r}: «عبر الأقراص فقط» أو «القرص» قد يخفي المجموعة.
  5) تحقّق من ${C.b}الحد الأدنى للحجم${C.r} و${C.b}الفئة${C.r} أعلى أزرار الفحص.
`)
} else {
  console.log(`${C.y}الملفان ليسا متطابقين.${C.r} لا يوجد برنامج يعتبرهما مكررين، والتطبيق على حق.`)
  console.log(`
${C.b}إن كنت متأكدًا أنهما النسخة نفسها:${C.r}
  - قد يكون أحدهما ${C.b}تنزيلًا ناقصًا${C.r} (أعد تحميله كاملًا)
  - قد يكون ISO أُعيد إنشاؤه بقطاع مختلف → نفس المحتوى منطقيًا، مختلف بايتًا
  - قارن بصمات MD5 السريعة للطرفين عبر تفاصيل الملف في Explorer's
`)
}
console.log()
