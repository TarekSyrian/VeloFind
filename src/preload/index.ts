import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type { AppNotification, Unsubscribe, VelofindApi } from '@shared/ipc-contract'
import type { DeleteItem, ScanRequest, ScanPhase, ScanProgress, ScanDoneResult, AppSettings } from '@shared/types'

/**
 * جسر preload الآمن — لا تتسرب أي قدرات Node إلى الصفحة
 * contextIsolation مفعّل + nodeIntegration معطل
 */

function subscribe<T>(channel: string): (cb: (payload: T) => void) => Unsubscribe {
  return (cb: (payload: T) => void): Unsubscribe => {
    const listener = (_event: IpcRendererEvent, payload: T): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }
}

const api: VelofindApi = {
  // الفحص
  startScan: (request: ScanRequest) => ipcRenderer.invoke(IPC.ScanStart, request),
  pauseScan: () => ipcRenderer.invoke(IPC.ScanPause),
  resumeScan: () => ipcRenderer.invoke(IPC.ScanResume),
  cancelScan: () => ipcRenderer.invoke(IPC.ScanCancel),
  onScanPhase: subscribe<ScanPhase>(IPC.ScanPhase),
  onScanProgress: subscribe<ScanProgress>(IPC.ScanProgress),
  onScanDone: subscribe<ScanDoneResult>(IPC.ScanDone),
  onScanError: subscribe<{ message: string; code?: string }>(IPC.ScanError),

  // الفهرس والمكررات
  listDuplicateGroups: () => ipcRenderer.invoke(IPC.DuplicatesList),
  getStats: () => ipcRenderer.invoke(IPC.IndexStats),
  clearIndex: () => ipcRenderer.invoke(IPC.IndexClear),
  search: (query: string, limit?: number) => ipcRenderer.invoke(IPC.SearchQuery, query, limit),
  onIndexChanged: subscribe<void>(IPC.IndexChanged),

  // المواقع والأقراص
  listLocations: () => ipcRenderer.invoke(IPC.LocationsList),
  saveLocations: (locations) => ipcRenderer.invoke(IPC.LocationsSave, locations),
  pickFolders: () => ipcRenderer.invoke(IPC.DialogPickFolders),
  listVolumes: () => ipcRenderer.invoke(IPC.VolumesList),

  // عمليات الملفات
  openFile: (filePath: string) => ipcRenderer.invoke(IPC.FileOpen, filePath),
  showInFolder: (filePath: string) => ipcRenderer.invoke(IPC.FileShowInFolder, filePath),
  copyPath: (filePath: string) => ipcRenderer.invoke(IPC.FileCopyPath, filePath),
  recycleFiles: (items: DeleteItem[]) => ipcRenderer.invoke(IPC.FilesRecycle, items),
  quarantineFiles: (items: DeleteItem[]) => ipcRenderer.invoke(IPC.FilesQuarantine, items),
  deleteFilesPermanent: (items: DeleteItem[], confirmed: boolean) =>
    ipcRenderer.invoke(IPC.FilesDeletePermanent, items, confirmed),
  listOperations: () => ipcRenderer.invoke(IPC.OpsList),
  undoOperation: (id: number) => ipcRenderer.invoke(IPC.OpsUndo, id),

  // الإعدادات
  getSettings: () => ipcRenderer.invoke(IPC.SettingsGet),
  setSettings: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IPC.SettingsSet, patch),

  // النافذة
  minimize: () => ipcRenderer.send(IPC.WinMinimize),
  toggleMaximize: () => ipcRenderer.send(IPC.WinToggleMaximize),
  closeWindow: () => ipcRenderer.send(IPC.WinClose),
  onWindowState: subscribe<{ maximized: boolean }>(IPC.WinState),

  // إشعارات
  onNotify: subscribe<AppNotification>(IPC.Notify),

  // معلومات
  versions: () => ipcRenderer.invoke('app:versions')
}

contextBridge.exposeInMainWorld('velofind', api)
