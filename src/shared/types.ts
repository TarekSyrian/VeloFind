/**
 * أنواع البيانات المشتركة بين جميع طبقات VeloFind
 * (Renderer / Main / Engine / Worker)
 */

/** حالات الفحص — PRD §22 */
export type ScanPhase =
  | 'idle'
  | 'preparing'
  | 'scanning'
  | 'grouping_by_size'
  | 'partial_hashing'
  | 'full_hashing'
  | 'building_results'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'out_of_sync'

/** وضع الفحص: سريع (حجم + بصمة جزئية) أو دقيق (+ بصمة كاملة) — PRD §18 */
export type ScanMode = 'quick' | 'accurate'

/** فئات أنواع الملفات — PRD §18 */
export type FileCategory = 'all' | 'images' | 'video' | 'audio' | 'documents' | 'custom'

/** حالة ملف داخل الفهرس */
export type FileScanState =
  | 'new'
  | 'unchanged'
  | 'changed'
  | 'hash_stale'
  | 'scanned'
  | 'unreadable'
  | 'missing'

/** ملف مفهرس (metadata فقط — لا يُحفظ محتوى الملفات أبدًا) */
export interface IndexedFile {
  id: number
  volumeId: string
  name: string
  path: string
  directory: string
  extension: string
  size: number
  modifiedAt: number
  createdAt: number
  attributes: number
  isHidden: boolean
  partialHash?: string
  fullHash?: string
  hashAlgorithm?: string
  lastScannedAt?: number
  scanState: FileScanState
}

/** ملف داخل مجموعة تكرار (عرض مختصر للواجهة) */
export interface DuplicateFileInfo {
  id: number
  path: string
  name: string
  directory: string
  drive: string
  extension: string
  size: number
  modifiedAt: number
  createdAt: number
  isHidden: boolean
}

/** مجموعة ملفات مكررة — PRD §8 المرحلة الخامسة */
export interface DuplicateGroup {
  id: string
  /** بصمة المجموعة بصيغة sha256:<hex> أو sha256-partial:<hex> */
  hash: string
  hashKind: 'full' | 'partial'
  /** حجم كل ملف داخل المجموعة (متساوي بحكم التعريف) */
  size: number
  fileCount: number
  /** المساحة القابلة للاسترداد = size × (العدد − 1) */
  reclaimedBytes: number
  files: DuplicateFileInfo[]
}

/** طلب بدء فحص — PRD §23 */
export interface ScanRequest {
  locations: string[]
  excludedPaths?: string[]
  /** أسماء مجلدات مستثناة في أي مكان بالشجرة (node_modules وغيرها) — إعداد قابل للتعديل */
  excludedFolderNames?: string[]
  mode: ScanMode
  minSize: number
  category?: FileCategory
  extensions?: string[]
  includeHidden?: boolean
  excludeSystemFolders?: boolean
  /** استكمال آخر فحص: إعادة فحص الملفات المتغيرة فقط */
  incremental?: boolean
}

/** تقدم الفحص — PRD §23 */
export interface ScanProgress {
  phase: ScanPhase
  paused: boolean
  filesScanned: number
  filesTotal: number
  bytesRead: number
  duplicateGroups: number
  currentPath?: string
  elapsedMs: number
}

/** تحذير أثناء الفحص (ملف غير قابل للقراءة، صلاحيات، تغير مفاجئ...) */
export interface ScanWarning {
  path: string
  kind: 'unreadable' | 'access_denied' | 'changed' | 'other'
  message: string
}

/** ملخص تغييرات فحص تزايدي */
export interface ScanSummary {
  added: number
  changed: number
  unchanged: number
  removed: number
}

/** نتيجة اكتمال الفحص */
export interface ScanDoneResult {
  groups: DuplicateGroup[]
  stats: EngineStats
  summary: ScanSummary
  warnings: ScanWarning[]
  durationMs: number
  mode: ScanMode
}

/** معلومات قرص */
export interface VolumeInfo {
  drive: string
  fileCount: number
  lastScanAt: number | null
  journalState: 'ok' | 'out_of_sync' | 'disabled'
}

/** إحصاءات المحرك */
export interface EngineStats {
  indexedFiles: number
  duplicateGroups: number
  duplicateFiles: number
  reclaimableBytes: number
  lastScanAt: number | null
  volumes: VolumeInfo[]
  /** نوع مخزن الفهرسة الفعلي (sqlite أو json كخطة بديلة) */
  indexStore: 'sqlite' | 'json'
}

/** نتيجة ملف في البحث */
export interface FileSummary {
  id: number
  name: string
  path: string
  directory: string
  drive: string
  extension: string
  size: number
  modifiedAt: number
  inDuplicateGroup: boolean
}

/** نتيجة بحث */
export interface SearchResult {
  query: string
  total: number
  tookMs: number
  files: FileSummary[]
}

/** موقع محفوظ للفحص — جدول scan_locations في PRD §21 */
export interface SavedLocation {
  path: string
  enabled: boolean
  excluded: boolean
}

/** سجل عملية ملفات — جدول file_operations في PRD §21 */
export interface FileOperationRecord {
  id: number
  operationType: 'recycle' | 'quarantine' | 'permanent_delete'
  sourcePath: string
  destinationPath?: string | null
  createdAt: number
  reversedAt?: number | null
}

/** إعدادات التطبيق — PRD §24 */
export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  language: 'ar'
  confirmOperations: boolean
  launchOnStartup: boolean
  minimizeToTray: boolean
  deleteMode: 'recycle' | 'quarantine' | 'permanent'
  quarantinePath: string
  minFileSize: number
  scanModeDefault: ScanMode
  hashWorkers: number
  autoScanOnStart: boolean
  useUsnJournal: boolean
  recheckBeforeDelete: boolean
  excludeSystemFolders: boolean
  includeHiddenFiles: boolean
  /** أسماء مجلدات مستثناة من الفحص في أي مكان (قابلة للتعديل من الإعدادات) */
  excludedFolders: string[]
  /** إشعارات ويندوز عند اكتمال الفحص والعمليات */
  notificationsEnabled: boolean
  /** أصوات إشعارات ممتعة عند الأحداث */
  notificationSound: boolean
  lastPage: 'home' | 'duplicates' | 'scan' | 'settings'
}

/** نتيجة عملية على الملفات */
export interface OpResult {
  ok: boolean
  message?: string
  succeeded?: string[]
  failed?: { path: string; reason: string }[]
}

/** عنصر محدد للحذف/النقل (يرتبط بمجموعته لفرض قواعد الأمان) */
export interface DeleteItem {
  path: string
  groupId: string
}

/** مخالفة أمنية — PRD §17 */
export interface SafetyViolation {
  kind: 'deletes_all_copies' | 'protected_path' | 'missing_group' | 'file_changed'
  path?: string
  groupId?: string
  message: string
}
