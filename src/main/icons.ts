import { app, nativeImage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * مسارات الأيقونات المتوافقة مع التطوير والحزمة المثبتة
 * المشكلة السابقة: app.getAppPath() داخل الحزمة يشير إلى app.asar بينما extraResources
 * ينسخ الأيقونات إلى process.resourcesPath — فتصل الأيقونة فارغة وتظهر أيقونة التراي مخفية.
 */

/** أيقونة 32×32 مضمّنة في الكود كشبكة أمان أخيرة — لا تفشل أبدًا */
const EMBEDDED_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA5ElEQVR42tWXsQ2DMBBFUZaIKFIwTYqMQMFgqULFJmyQNRKxAMiRTkKW7fP9Owdj6Xdnv2cj4XPTnGlc29uak0OgRWS0cJWEFRySSC3UD59gzCSkYKmIGv58Lb+kaiAJDk7gfVL1YgkpPCaQK8EKcHCXbp5gCfXuSSAmITqF1OQcAZfveMFPgZvIwdFTyBag+NCqBIp+Ak4iBC8mEIq5gEQChZsJmPwNNYv4uT/e2H1gJUH1TkR9GUmu2n2Ng1NMBJCGhJOA+0BJJxST+Gsz6ksc0hGTwHna8ioeJlU8zap4nJYeG/XRzc4bxdBoAAAAAElFTkSuQmCC'

/** أول مسار موجود من قائمة مرشحين وفق بيئة التشغيل */
function firstExisting(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch {
      /* تجاهل وفحص التالي */
    }
  }
  return null
}

/** أيقونة التطبيق (النافذة والإشعارات) */
export function resolveAppIconPath(): string {
  const found = firstExisting([
    // حزمة مثبتة/محمولة: extraResources تضع الملفات بجوار app.asar مباشرة
    path.join(process.resourcesPath ?? '', 'icon.png'),
    path.join(process.resourcesPath ?? '', 'icon.ico'),
    // التطوير: مجلد resources بجوار جذر المشروع
    path.join(app.getAppPath(), 'resources', 'icon.png'),
    path.join(app.getAppPath(), 'resources', 'icon.ico')
  ])
  return found ?? path.join(app.getAppPath(), 'resources', 'icon.png')
}

/** أيقونة التراي (16–32 بكسل بجوار ساعة ويندوز) */
export function resolveTrayIconPath(): string {
  const found = firstExisting([
    path.join(process.resourcesPath ?? '', 'tray.png'),
    path.join(process.resourcesPath ?? '', 'icon.png'),
    path.join(app.getAppPath(), 'resources', 'tray.png'),
    path.join(app.getAppPath(), 'resources', 'icon.png')
  ])
  return found ?? ''
}

/** تحميل أيقونة تراي غير فارغة دائمًا — مع بديل مضمّن عند فقدان الملفات */
export function loadTrayImage(): Electron.NativeImage {
  const trayPath = resolveTrayIconPath()
  if (trayPath) {
    const icon = nativeImage.createFromPath(trayPath)
    if (!icon.isEmpty()) {
      const size = icon.getSize()
      if (size.width > 32) return icon.resize({ width: 32, height: 32 })
      return icon
    }
  }
  // الشبكة الأخيرة: أيقونة مضمّنة داخل الكود — تضمن ظهور التراي دائمًا
  return nativeImage.createFromDataURL(`data:image/png;base64,${EMBEDDED_ICON_BASE64}`)
}

/** أيقونة غير فارغة للإشعارات (NativeImage يقبل المسار أو البديل المضمّن) */
export function loadNotificationImage(): Electron.NativeImage {
  const iconPath = resolveAppIconPath()
  try {
    if (fs.existsSync(iconPath)) {
      const image = nativeImage.createFromPath(iconPath)
      if (!image.isEmpty()) return image
    }
  } catch {
    /* يقع إلى البديل المضمّن */
  }
  return nativeImage.createFromDataURL(`data:image/png;base64,${EMBEDDED_ICON_BASE64}`)
}
