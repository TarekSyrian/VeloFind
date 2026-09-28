import type {
  AppSettings,
  DeleteItem,
  DuplicateGroup,
  EngineStats,
  FileOperationRecord,
  OpResult,
  SavedLocation,
  ScanDoneResult,
  ScanPhase,
  ScanProgress,
  ScanRequest,
  SearchResult,
  VolumeInfo
} from './types'

/**
 * قنوات IPC بين Renderer و Main — PRD §23
 * الطلبات عبر ipcRenderer.invoke والأحداث عبر webContents.send
 */
export const IPC = {
  // الفحص
  ScanStart: 'scan:start',
  ScanPause: 'scan:pause',
  ScanResume: 'scan:resume',
  ScanCancel: 'scan:cancel',
  ScanPhase: 'scan:phase',
  ScanProgress: 'scan:progress',
  ScanDone: 'scan:done',
  ScanError: 'scan:error',

  // الفهرس والمكررات والبحث
  DuplicatesList: 'duplicates:list',
  IndexStats: 'index:stats',
  IndexClear: 'index:clear',
  IndexChanged: 'index:changed',
  SearchQuery: 'search:query',

  // مواقع الفحص والأقراص
  LocationsList: 'locations:list',
  LocationsSave: 'locations:save',
  DialogPickFolders: 'dialog:pick-folders',
  VolumesList: 'volumes:list',

  // عمليات الملفات
  FileOpen: 'file:open',
  FileShowInFolder: 'file:show-in-folder',
  FileCopyPath: 'file:copy-path',
  FilesRecycle: 'files:recycle',
  FilesQuarantine: 'files:quarantine',
  FilesDeletePermanent: 'files:delete-permanent',
  OpsList: 'ops:list',
  OpsUndo: 'ops:undo',

  // الإعدادات والإشعارات
  SettingsGet: 'settings:get',
  SettingsSet: 'settings:set',
  Notify: 'app:notify',

  // التحكم بالنافذة (شريط عنوان مخصص)
  WinMinimize: 'win:minimize',
  WinToggleMaximize: 'win:toggle-maximize',
  WinClose: 'win:close',
  WinState: 'win:state'
} as const

export type IPCChannel = (typeof IPC)[keyof typeof IPC]

export interface AppNotification {
  kind: 'success' | 'info' | 'warning' | 'error'
  title: string
  message?: string
}

export type Unsubscribe = () => void

/** الواجهة التي يكشفها preload داخل الصفحة عبر window.velofind */
export interface VelofindApi {
  // الفحص
  startScan(request: ScanRequest): Promise<void>
  pauseScan(): Promise<void>
  resumeScan(): Promise<void>
  cancelScan(): Promise<void>
  onScanPhase(cb: (phase: ScanPhase) => void): Unsubscribe
  onScanProgress(cb: (progress: ScanProgress) => void): Unsubscribe
  onScanDone(cb: (result: ScanDoneResult) => void): Unsubscribe
  onScanError(cb: (error: { message: string; code?: string }) => void): Unsubscribe

  // الفهرس والمكررات والبحث
  listDuplicateGroups(): Promise<DuplicateGroup[]>
  getStats(): Promise<EngineStats>
  clearIndex(): Promise<void>
  search(query: string, limit?: number): Promise<SearchResult>
  onIndexChanged(cb: () => void): Unsubscribe

  // مواقع الفحص والأقراص
  listLocations(): Promise<SavedLocation[]>
  saveLocations(locations: SavedLocation[]): Promise<void>
  pickFolders(): Promise<string[]>
  listVolumes(): Promise<VolumeInfo[]>

  // عمليات الملفات
  openFile(path: string): Promise<OpResult>
  showInFolder(path: string): Promise<OpResult>
  copyPath(path: string): Promise<OpResult>
  recycleFiles(items: DeleteItem[]): Promise<OpResult>
  quarantineFiles(items: DeleteItem[]): Promise<OpResult>
  deleteFilesPermanent(items: DeleteItem[], confirmed: boolean): Promise<OpResult>
  listOperations(): Promise<FileOperationRecord[]>
  undoOperation(id: number): Promise<OpResult>

  // الإعدادات
  getSettings(): Promise<AppSettings>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>

  // النافذة
  minimize(): void
  toggleMaximize(): void
  closeWindow(): void
  onWindowState(cb: (state: { maximized: boolean }) => void): Unsubscribe

  // إشعارات عامة من العملية الرئيسية
  onNotify(cb: (n: AppNotification) => void): Unsubscribe

  // معلومات النظام
  versions(): Promise<{ app: string; electron: string; node: string; platform: string }>
}
