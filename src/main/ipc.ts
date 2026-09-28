import { clipboard, dialog, ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type { AppNotification } from '@shared/ipc-contract'
import type { DeleteItem, ScanRequest, ScanPhase } from '@shared/types'
import { SafetyRuleError } from '@shared/errors'
import type { EngineController } from '@engine/engine-controller'
import type { WindowService } from './windows'
import type { SettingsService } from './settings'
import type { FileOperationsService } from './file-operations'
import type { TrayService } from './tray'
import { app } from 'electron'

/**
 * تسجيل معالجات IPC وفق عقد ipc-contract — PRD §23
 */

export interface IpcContext {
  engine: EngineController
  windows: WindowService
  settings: SettingsService
  fileOps: FileOperationsService
  tray: TrayService
}

export function registerIpcHandlers(ctx: IpcContext): void {
  const { engine, windows, settings, fileOps, tray } = ctx

  /* ------------------- الفحص ------------------- */

  ipcMain.handle(IPC.ScanStart, async (_e, request: ScanRequest) => {
    await engine.startScan(request)
  })
  ipcMain.handle(IPC.ScanPause, () => engine.pauseScan())
  ipcMain.handle(IPC.ScanResume, () => engine.resumeScan())
  ipcMain.handle(IPC.ScanCancel, () => engine.cancelScan())

  /* ------------------- الفهرس والمكررات ------------------- */

  ipcMain.handle(IPC.DuplicatesList, () => engine.listGroups())
  ipcMain.handle(IPC.IndexStats, () => engine.stats())
  ipcMain.handle(IPC.IndexClear, () => engine.clearIndex())
  ipcMain.handle(IPC.SearchQuery, (_e, query: string, limit?: number) => engine.search(query, limit))

  /* ------------------- المواقع والأقراص ------------------- */

  ipcMain.handle(IPC.LocationsList, () => engine.listLocations())
  ipcMain.handle(IPC.LocationsSave, (_e, locations) => engine.saveLocations(locations))
  ipcMain.handle(IPC.DialogPickFolders, async () => {
    const result = await dialog.showOpenDialog(windows.window!, {
      title: 'اختيار مجلدات للفحص',
      properties: ['openDirectory', 'multiSelections']
    })
    return result.filePaths
  })
  ipcMain.handle(IPC.VolumesList, () => engine.volumes())

  /* ------------------- عمليات الملفات ------------------- */

  ipcMain.handle(IPC.FileOpen, (_e, filePath: string) => fileOps.openFile(filePath))
  ipcMain.handle(IPC.FileShowInFolder, (_e, filePath: string) => fileOps.showInFolder(filePath))
  ipcMain.handle(IPC.FileCopyPath, (_e, filePath: string) => fileOps.copyPath(filePath))
  ipcMain.handle(IPC.FilesRecycle, (_e, items: DeleteItem[]) => fileOps.recycle(items))
  ipcMain.handle(IPC.FilesQuarantine, (_e, items: DeleteItem[]) => fileOps.quarantine(items))
  ipcMain.handle(IPC.FilesDeletePermanent, (_e, items: DeleteItem[], confirmed: boolean) =>
    fileOps.deletePermanent(items, confirmed)
  )
  ipcMain.handle(IPC.OpsList, () => fileOps.listOperations())
  ipcMain.handle(IPC.OpsUndo, (_e, id: number) => fileOps.undo(id))

  /* ------------------- الإعدادات ------------------- */

  ipcMain.handle(IPC.SettingsGet, () => settings.all)
  ipcMain.handle(IPC.SettingsSet, async (_e, patch) => {
    const updated = await settings.set(patch)
    if (typeof patch.launchOnStartup === 'boolean') {
      try {
        app.setLoginItemSettings({ openAtLogin: patch.launchOnStartup })
      } catch {
        /* متاح على Windows/macOS فقط */
      }
    }
    return updated
  })

  /* ------------------- النافذة ------------------- */

  ipcMain.on(IPC.WinMinimize, () => windows.minimize())
  ipcMain.on(IPC.WinToggleMaximize, () => windows.toggleMaximize())
  ipcMain.on(IPC.WinClose, () => windows.close())

  /* ------------------- معلومات ------------------- */

  ipcMain.handle('app:versions', () => ({
    app: app.getVersion(),
    electron: process.versions.electron ?? '',
    node: process.versions.node ?? '',
    platform: process.platform
  }))

  /* ------------------- ربط أحداث المحرك بالواجهة ------------------- */

  engine.setEvents({
    onScanPhase: (phase: ScanPhase) => windows.send(IPC.ScanPhase, phase),
    onScanProgress: (progress) => windows.send(IPC.ScanProgress, progress),
    onScanDone: (result) => {
      windows.send(IPC.ScanDone, result)
      tray.refresh()
      // إشعار نظام عند اكتمال الفحص — PRD §25
      const windowVisible = windows.window?.isVisible() ?? false
      if (!windowVisible) {
        tray.notify(
          'اكتمل الفحص',
          `تم العثور على ${result.groups.length} مجموعة مكررة — المساحة القابلة للاسترداد: ${formatBytesForNotification(result.stats.reclaimableBytes)}`
        )
      }
    },
    onScanError: (error) => windows.send(IPC.ScanError, error),
    onIndexChanged: () => windows.send(IPC.IndexChanged)
  })
}

export function notifyRenderer(windows: WindowService, notification: AppNotification): void {
  windows.send(IPC.Notify, notification)
}

function formatBytesForNotification(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} TB`
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

export { clipboard, shell, SafetyRuleError }
