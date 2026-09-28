import type { AppSettings, FileCategory } from './types'

/** اسم التطبيق وهويته — PRD §30 */
export const APP_NAME = 'VeloFind'
export const APP_DESCRIPTION = 'ابحث عن الملفات المكررة واحذفها بأمان'
export const APP_VERSION = '0.3.1'

/** خوارزمية البصمة الافتراضية — PRD §8 */
export const HASH_ALGORITHM = 'sha256'

/** حجم الكتلة الواحدة في البصمة الجزئية (بداية + منتصف + نهاية) */
export const PARTIAL_HASH_CHUNK = 64 * 1024

/** الملفات الأصغر من هذا الحجم تُبصم كاملة مباشرة (البصمة الجزئية تصبح بالكاد مفيدة) */
export const PARTIAL_SKIP_SIZE = 4 * 1024 * 1024

/** حجم كتلة القراءة المتدفقة عند حساب البصمة الكاملة */
export const STREAM_CHUNK = 1024 * 1024

/** عدد تحديثات البصمات المجمّعة قبل إرسالها للعملية الرئيسية */
export const HASH_BATCH_SIZE = 200

/** الفاصل الزمني لإرسال رسائل التقدم */
export const PROGRESS_INTERVAL_MS = 250

/** الحد الأقصى لحجم إعادة التحقق من البصمة الكاملة قبل الحذف */
export const MAX_FULL_RECHECK_SIZE = 256 * 1024 * 1024

/** امتدادات الفئات الجاهزة — PRD §18 */
export const CATEGORY_EXTENSIONS: Record<Exclude<FileCategory, 'all' | 'custom'>, string[]> = {
  images: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'raw', 'cr2', 'nef'],
  video: ['mp4', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', '3gp', 'ts'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus', 'aiff'],
  documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'ods', 'odp', 'csv', 'md']
}

/** مسارات النظام المحمية — يمنع حذف ملفاتها تلقائيًا (PRD §17) */
export const PROTECTED_PATHS = [
  'c:\\windows',
  'c:\\program files',
  'c:\\program files (x86)',
  'c:\\programdata',
  'c:\\users\\all users'
]

/**
 * أسماء مجلدات خاصة تُستثنى فقط إذا وُجدت مباشرةً تحت جذر قرص (X:\Name).
 * لا تُطابَق أبدًا بأي عمق آخر — مجلد المستخدم «Windows» داخل قرص بيانات مثلًا
 * مجلد عادي تمامًا ويجب فحصه (إصلاح بلاغ المكررات العابرة للأقراص).
 */
export const DRIVE_ROOT_EXCLUDES = ['$recycle.bin', 'system volume information']

/**
 * المجلدات المستثناة افتراضيًا من الفحص (بأي مكان بالشجرة) — إعداد قابل للتعديل من واجهة الإعدادات
 * مجلدات أدوات التطوير والحزم التي لا معنى لبحثها عن مكررات ولا يفترض أن يلمسها المستخدم
 */
export const DEFAULT_EXCLUDED_FOLDERS = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.gradle',
  '.idea',
  '.vs',
  '.vscode',
  '__pycache__',
  '.venv',
  'venv',
  'bower_components',
  '.next',
  '.nuxt',
  'vendor'
]

/** كلمات تدل على مجلدات النسخ الاحتياطي — قواعد التحديد التلقائي (PRD §14) */
export const BACKUP_FOLDER_HINTS = [
  'backup',
  'bak',
  'old',
  'archive',
  'archiv',
  'نسخة احتياطية',
  'نسخ احتياطي',
  'أرشيف',
  'احتياطي'
]

/** كلمات تدل على مجلد التنزيلات */
export const DOWNLOADS_HINTS = ['downloads', 'download', 'التنزيلات']

/** اسم مجلد العزل — PRD §16 */
export const QUARANTINE_FOLDER_NAME = 'VeloFind Quarantine'

/** الإعدادات الافتراضية */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  language: 'ar',
  confirmOperations: true,
  launchOnStartup: false,
  minimizeToTray: true,
  deleteMode: 'recycle',
  quarantinePath: '',
  minFileSize: 0,
  scanModeDefault: 'accurate',
  hashWorkers: 0, // 0 = تلقائي (عدد الأنوية − 1 بحد أقصى 8)
  autoScanOnStart: false,
  useUsnJournal: false,
  recheckBeforeDelete: true,
  excludeSystemFolders: true,
  includeHiddenFiles: false,
  excludedFolders: [...DEFAULT_EXCLUDED_FOLDERS],
  notificationsEnabled: true,
  notificationSound: true,
  lastPage: 'home'
}
