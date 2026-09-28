#!/usr/bin/env node
/**
 * يضمن أن وحدة better-sqlite3 الأصلية داخل node_modules هي نسخة prebuilt
 * لويندوز (win32-x64) متوافقة مع ABI نسخة Electron المستخدمة في التغليف.
 *
 * لماذا؟ البناء والتغليف قد يتمان على بيئة غير ويندوز (أو بعد electron-rebuild
 * على لينكس) — عندها تكون binary إما لينيكس أو بمفتاح ABI خاطئ، وعندها فقط
 * يفشل تحميل SQLite داخل التطبيق المثبت ويسقط التطبيق صامتًا إلى مخزن JSON
 * (بلاغ المستخدم: «الفهرس يحفظ JSON بدل SQLite»).
 *
 * ملاحظة مهمة: هذه الخطوة **ليست** البوابة النهائية.
 * electron-builder نفسه يعيد بناء الوحدات الأصلية أثناء التغليف (npmRebuild)،
 * والبوابة الحقيقية التي ترفض بناءً معطوبًا هي scripts/verify-package.js
 * (خطّاف afterPack). لذلك لا يُفشل هذا السكربت البناء عند الفشل، بل ينبّه
 * بوضوح ويترك التحقق النهائي لما بعد التغليف.
 *
 * يعمل قبل التغليف تلقائيًا عبر predist:
 *   npm run dist → predist → electron-vite build → electron-builder
 */

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const SQLITE_DIR = path.join(ROOT, 'node_modules', 'better-sqlite3')
const BINARY = path.join(SQLITE_DIR, 'build', 'Release', 'better_sqlite3.node')

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

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

function warn(message) {
  console.warn(`[fix-sqlite] ⚠ ${message}`)
}

/**
 * استدعاء prebuild-install دون الاعتماد على node_modules/.bin:
 * الاعتماد على shim الملف_exec غير موجود مع بعض مديري الحزم (pnpm) أو بعد
 * تثبيت بـ --ignore-scripts، فكنا نخرج مبكّرًا. نبحث عن مدخل الحزمة نفسها.
 */
function resolvePrebuildInstall() {
  const candidates = [
    () => require.resolve('prebuild-install/bin.js', { paths: [SQLITE_DIR] }),
    () => path.join(SQLITE_DIR, 'node_modules', 'prebuild-install', 'bin.js'),
    () => path.join(ROOT, 'node_modules', 'prebuild-install', 'bin.js'),
    () => path.join(ROOT, 'node_modules', '.bin', 'prebuild-install')
  ]
  for (const candidate of candidates) {
    try {
      const resolved = candidate()
      if (resolved && fs.existsSync(resolved)) return resolved
    } catch {
      /* جرّب التالي */
    }
  }
  return null
}

function tryPrebuildInstall(electronVersion) {
  const bin = resolvePrebuildInstall()
  if (!bin) {
    warn('prebuild-install غير متاح داخل better-sqlite3 — تُخطّى هذه المحاولة')
    return false
  }
  const args = [
    bin,
    '--runtime=electron',
    `--target=${electronVersion}`,
    '--platform=win32',
    '--arch=x64'
  ]
  try {
    execFileSync(process.execPath, args, { cwd: SQLITE_DIR, stdio: 'inherit' })
    return true
  } catch (error) {
    warn(`فشل prebuild-install: ${error.message}`)
    return false
  }
}

/**
 * خطة بديلة: electron-rebuild — نفس الأداة التي يستخدمها electron-builder.
 * نستدعي واجهتها البرمجية لا ملف CLI، لأن مسار الملف تغيّر بين الإصدارين.
 * وأسماء الخيارات نفسها تغيّرت (v3: version/whichModule، v4: electronVersion/onlyModules)
 * فنمرّر الاسمين معًا — الخيارات غير المعروفة تُتجاهل بهدوء في الإصدارين.
 */
async function tryElectronRebuild(electronVersion) {
  let rebuild
  try {
    ;({ rebuild } = require('@electron/rebuild'))
  } catch {
    warn('@electron/rebuild غير متاح — تُخطّى هذه المحاولة')
    return false
  }
  try {
    await rebuild({
      buildPath: ROOT,
      force: true,
      // v4
      electronVersion,
      onlyModules: ['better-sqlite3'],
      // v3
      version: electronVersion,
      whichModule: ['better-sqlite3'],
      platform: 'win32',
      arch: 'x64'
    })
    return true
  } catch (error) {
    warn(`فشل electron-rebuild: ${error.message}`)
    return false
  }
}

async function main() {
  if (!fs.existsSync(SQLITE_DIR)) {
    warn('better-sqlite3 غير مثبّت — تُخطّى الخطوة (سيُبنى التطبيق بمخزن JSON البديل)')
    return
  }

  const sqliteVersion = readJson(path.join(SQLITE_DIR, 'package.json')).version
  const electronPkg = path.join(ROOT, 'node_modules', 'electron', 'package.json')
  if (!fs.existsSync(electronPkg)) {
    warn('electron غير مثبّت — تُخطّى الخطوة')
    return
  }
  const electronVersion = readJson(electronPkg).version
  console.log(`[fix-sqlite] better-sqlite3 ${sqliteVersion} | electron ${electronVersion} | الهدف: win32-x64`)

  if (isWindowsPE(BINARY)) {
    console.log('[fix-sqlite] ✓ better_sqlite3.node نسخة ويندوز موجودة مسبقًا — لا حاجة لإعادة')
    return
  }

  const ok = (await tryPrebuildInstall(electronVersion)) || (await tryElectronRebuild(electronVersion))

  if (ok && isWindowsPE(BINARY)) {
    const size = fs.statSync(BINARY).size
    console.log(`[fix-sqlite] ✓ better_sqlite3.node جاهزة: PE win32-x64 electron@${electronVersion} (${size} بايت)`)
    return
  }

  // لا نفشل البناء هنا: electron-builder يعيد البناء أثناء التغليف، وخطّاف
  // afterPack (verify-package.js) هو من يرفض الحزمة المعطوبة فعليًا.
  warn('لم تتوفر نسخة ويندوز من better_sqlite3.node قبل التغليف.')
  warn('سيحاول electron-builder إعادة البناء تلقائيًا؛ وscripts/verify-package.js سيمنع نشر حزمة معطوبة.')
}

main().catch((error) => {
  warn(`خطأ غير متوقع: ${error && error.message ? error.message : error}`)
})
