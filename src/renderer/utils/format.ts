/** تنسيق الأرقام والتواريخ والأحجام للواجهة العربية (بأرقام لاتينية للوضوح) */

const numberFormat = new Intl.NumberFormat('ar-u-nu-latn')

export function formatNumber(value: number): string {
  return numberFormat.format(value)
}

export function formatBytes(bytes: number, precision = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** index
  const digits = index === 0 || value >= 100 ? 0 : precision
  return `${value.toFixed(digits)} ${units[index]}`
}

export function formatDate(timestamp: number | null | undefined): string {
  if (!timestamp) return '—'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ar-u-nu-latn', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds} ثانية`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return `${minutes} د ${rest ? `و ${rest} ث` : ''}`.trim()
  const hours = Math.floor(minutes / 60)
  return `${hours} س ${minutes % 60} د`
}

/** اسم أيقونة (رمز) للامتداد — تُستخدم لاختيار لون ورمز الملف */
export function fileKindLabel(extension: string): string {
  const ext = extension.toLowerCase()
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'raw'].includes(ext)) return 'صورة'
  if (['mp4', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg'].includes(ext)) return 'فيديو'
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus'].includes(ext)) return 'صوت'
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'csv', 'md'].includes(ext)) return 'مستند'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'أرشيف'
  if (!ext) return 'ملف'
  return ext.toUpperCase()
}
