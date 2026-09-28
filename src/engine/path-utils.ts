import path from 'node:path'

/** أدوات مساعدة للمسارات على Windows (مسارات طويلة، حرف القرص، التطبيع) */

const IS_WINDOWS = process.platform === 'win32'

/** إضافة بادئة \\?\ للمسارات الطويلة تجنبًا لحد 260 حرفًا في Windows */
export function toWindowsLongPath(p: string): string {
  if (!IS_WINDOWS) return p
  if (p.startsWith('\\\\?\\')) return p
  const absolute = path.resolve(p)
  if (absolute.startsWith('\\\\')) {
    // مسار شبكة UNC → \\?\UNC\server\share\...
    return '\\\\?\\UNC\\' + absolute.slice(2)
  }
  return '\\\\?\\' + absolute
}

/** استخراج حرف القرص من مسار (C من C:\Users\...) أو '?' إذا تعذر */
export function driveLetterOf(p: string): string {
  const match = /^([a-zA-Z]):[\\/]/.exec(p)
  return match ? match[1].toUpperCase() : '?'
}

/** توحيد الفواصل وضبط حالة الأحرف للمفاتيح داخل الفهارس */
export function pathKey(p: string): string {
  return p.replace(/\//g, '\\').toLowerCase()
}

/** تطبيع مسار للمقارنة مع مواقع الاستثناء */
export function normalizePath(p: string): string {
  return pathKey(p).replace(/[\\]+$/, '')
}

/** هل المسار يقع ضمن موقع معين (prefix بنمط مجلدات)؟ */
export function isUnderPath(p: string, root: string): boolean {
  const np = normalizePath(p)
  const nr = normalizePath(root)
  return np === nr || np.startsWith(nr + '\\')
}

/** الحصول على الامتداد بدون النقطة وبأحرف صغيرة */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}
