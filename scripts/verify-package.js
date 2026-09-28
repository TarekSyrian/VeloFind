#!/usr/bin/env node
/**
 * بوابة ما بعد التغليف — خطّاف afterPack في electron-builder.
 *
 * تتحقق من أن الحزمة النهائية تحتوي فعلًا على better_sqlite3.node نسخة ويندوز
 * (PE / ترويسة MZ). بدونها يسقط التطبيق المثبت بصمت إلى مخزن JSON البديل عند أول
 * تشغيل، فيظنّ المستخدم أن الفهرسة معطوبة.
 *
 * هذا هو الفحص الحاسم: سكربت fix-sqlite-win32.js قبل التغليف مجرد محاولة تحسين،
 * أما هذا فيرفض بناءً معطوبًا بدل تسليم ملف لا يعمل.
 *
 * يُستدعى بطريقتين:
 *   1) تلقائيًا من electron-builder  →  build.afterPack: "./scripts/verify-package.js"
 *      (electron-builder يستدعي التصدير كدالة مع كائن السياق)
 *   2) يدويًا:  npm run verify:package -- <appOutDir>
 */

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const BINARY_NAME = 'better_sqlite3.node'

function isWindowsPE(file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
  } catch {
    return false
  }
  try {
    const header = Buffer.alloc(2)
    fs.readSync(fd, header, 0, 2, 0)
    return header[0] === 0x4d && header[1] === 0x5a // 'MZ'
  } catch {
    return false
  } finally {
    fs.closeSync(fd)
  }
}

/** بحث عميق عن الملف داخل مجلد (بلا اعتماد على بنية asar الداخلية) */
function findBinary(dir, depth = 0) {
  if (depth > 6) return null
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && entry.name === BINARY_NAME) return full
    if (entry.isDirectory()) {
      const found = findBinary(full, depth + 1)
      if (found) return found
    }
  }
  return null
}

/** المسار المتوقّع بعد فكّ app.asar (build.asarUnpack) */
function expectedPath(appOutDir) {
  return path.join(
    appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    BINARY_NAME
  )
}

function locate(appOutDir) {
  const expected = expectedPath(appOutDir)
  if (fs.existsSync(expected)) return { found: expected, expected }
  const unpackedRoot = path.join(appOutDir, 'resources', 'app.asar.unpacked')
  if (fs.existsSync(unpackedRoot)) {
    const found = findBinary(unpackedRoot)
    if (found) return { found, expected }
  }
  return { found: null, expected }
}

function fail(found, expected) {
  if (found) {
    console.error(`[verify-package] ✗ ${found} موجود لكنه ليس ملف PE لويندوز (ترويسة MZ ناقصة).`)
  } else {
    console.error(`[verify-package] ✗ لم تُوجد ${BINARY_NAME} داخل الحزمة النهائية.`)
    console.error(`  المتوقع: ${expected}`)
  }
  console.error('  السبب المرجّح: أُعيد بناء الوحدة الأصلية لمنصة أخرى (لينكس) قبل التغليف.')
  console.error('  عندها يعمل التطبيق مثبَّتًا لكن الفهرسة تسقط بصمت إلى مخزن JSON البديل.')
  console.error('  الحل: ابنِ على windows-latest، أو ثبّت electron-rebuild قبل electron-builder.')
  process.exitCode = 1
}

/**
 * خطّاف electron-builder.
 * @param {{ appOutDir?: string, electronPlatformName?: string }} context
 */
async function afterPack(context) {
  const platform = (context && context.electronPlatformName) || 'win32'
  // النشر لويندوز فقط — نتخطى الفحص لأي منصة أخرى
  if (platform !== 'win32') {
    console.log(`[verify-package] منصة ${platform} — تُتخطى البوابة`)
    return
  }

  const appOutDir = (context && context.appOutDir) || path.join(ROOT, 'release', 'win-unpacked')
  if (!fs.existsSync(appOutDir)) {
    console.error(`[verify-package] خطأ: مجلد الحزمة غير موجود: ${appOutDir}`)
    process.exit(1)
  }

  const { found, expected } = locate(appOutDir)
  if (found && isWindowsPE(found)) {
    const size = fs.statSync(found).size
    console.log(`[verify-package] ✓ ${BINARY_NAME} نسخة PE لويندوز (${size} بايت)`)
    console.log(`[verify-package]   ${found}`)
    return
  }
  fail(found, expected)
}

module.exports = afterPack

// تشغيل يدوي:  npm run verify:package -- <appOutDir>
if (require.main === module) {
  const marker = process.argv.indexOf('--')
  const args = marker >= 0 ? process.argv.slice(marker + 1) : process.argv.slice(2)
  if (process.platform !== 'win32' || args[0] === '--skip') {
    console.log(`[verify-package] منصة ${process.platform} — تُتخطى البوابة`)
  } else {
    const appOutDir = args[0]
      ? path.resolve(args[0])
      : path.join(ROOT, 'release', 'win-unpacked')
    if (!fs.existsSync(appOutDir)) {
      console.error(`[verify-package] خطأ: مجلد الحزمة غير موجود: ${appOutDir}`)
      process.exit(1)
    }
    const { found, expected } = locate(appOutDir)
    if (found && isWindowsPE(found)) {
      console.log(`[verify-package] ✓ ${BINARY_NAME} نسخة PE لويندوز (${fs.statSync(found).size} بايت)`)
      console.log(`[verify-package]   ${found}`)
    } else {
      fail(found, expected)
      process.exit(process.exitCode || 1)
    }
  }
}
