import { app } from 'electron'
import type { AppSettings } from '@shared/types'
import { APP_NAME, APP_VERSION } from '@shared/constants'
import { EngineController } from '@engine/engine-controller'
import { WindowService } from './windows'
import { SettingsService } from './settings'
import { TrayService } from './tray'
import { FileOperationsService } from './file-operations'
import { PersistenceManager } from '@engine/persistence/persistence-manager'
import { registerIpcHandlers } from './ipc'

/**
 * تشغيل التطبيق — PRD §11 (Main Process)
 * Window Management + IPC + File Operations + Worker Management
 */

interface AppContext {
  settings: SettingsService
  engine: EngineController
  windows: WindowService
  tray: TrayService
  fileOps: FileOperationsService
}

let ctx: AppContext | null = null

export function startApp(): void {
  // مثيل واحد فقط — PRD §5 (تجربة بسيطة ومتوقعة)
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.setAppUserModelId('com.velofind.app')

  app.on('second-instance', () => {
    ctx?.windows.focusMain()
  })

  app.whenReady().then(async () => {
    try {
      await bootstrap()
    } catch (error) {
      console.error('[velofind] فشل التشغيل:', error)
      app.quit()
    }
  })

  app.on('window-all-closed', () => {
    // عند تفعيل الإغلاق إلى التراي تُخفى النافذة ولا يصل هذا الحدث
    app.quit()
  })

  app.on('before-quit', () => {
    void shutdown()
  })

  process.on('uncaughtException', (error) => {
    console.error('[velofind] استثناء غير معالج:', error)
  })
}

async function bootstrap(): Promise<void> {
  const userDataDir = app.getPath('userData')

  // الإعدادات
  const settings = await SettingsService.create(userDataDir)
  if (settings.get('launchOnStartup')) {
    try {
      app.setLoginItemSettings({ openAtLogin: true })
    } catch {
      /* Windows فقط */
    }
  }

  // المحرك (المفهرس + التخزين الدائم + العامل)
  const engine = new EngineController(userDataDir, __dirname)
  await engine.initialize(settings.all)

  // التخزين الدائم لسجل العمليات (نفس قاعدة البيانات)
  const persistence = await PersistenceManager.create(userDataDir)

  // النافذة والتراي وعمليات الملفات
  const windows = new WindowService(settings)
  const tray = new TrayService(windows, engine, settings)
  const fileOps = new FileOperationsService(engine, settings, persistence)

  registerIpcHandlers({ engine, windows, settings, fileOps, tray })

  await windows.createMainWindow()
  tray.init()

  ctx = { settings, engine, windows, tray, fileOps }

  console.info(`[velofind] ${APP_NAME} v${APP_VERSION} جاهز — المخزن: ${engine.stats().indexStore}`)
}

async function shutdown(): Promise<void> {
  try {
    await ctx?.engine.shutdown()
    await ctx?.settings.close()
  } catch {
    /* إغلاق صامت */
  }
}
