import { BrowserWindow, shell } from 'electron'
import path from 'node:path'
import type { AppSettings } from '@shared/types'
import { APP_NAME } from '@shared/constants'
import { resolveAppIconPath } from './icons'

/**
 * إدارة النافذة الرئيسية — إطار مخصص بشريط عنوان عربي RTL — PRD §14
 */

export class WindowService {
  private mainWindow: BrowserWindow | null = null
  private forceClose = false

  constructor(private settingsAccessor: { get<K extends keyof AppSettings>(key: K): AppSettings[K] }) {}

  async createMainWindow(): Promise<BrowserWindow> {
    const dark = this.isDark()
    const win = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 1000,
      minHeight: 640,
      show: false,
      frame: false,
      title: APP_NAME,
      backgroundColor: dark ? '#17191D' : '#F6F7F9',
      icon: resolveAppIconPath(),
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false
      }
    })

    win.on('ready-to-show', () => win.show())

    // إغلاق إلى System Tray عند التفعيل — PRD §24
    win.on('close', (event) => {
      if (this.settingsAccessor.get('minimizeToTray') && !this.forceClose) {
        event.preventDefault()
        win.hide()
      }
    })

    win.on('maximize', () => this.sendWindowState())
    win.on('unmaximize', () => this.sendWindowState())

    if (process.env.ELECTRON_RENDERER_URL) {
      await win.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
      await win.loadFile(path.join(__dirname, '../renderer/index.html'))
    }

    // منع فتح نوافذ جديدة خارج التطبيق
    win.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })

    this.mainWindow = win
    return win
  }

  private isDark(): boolean {
    const theme = this.settingsAccessor.get('theme')
    if (theme === 'dark') return true
    if (theme === 'light') return false
    return nativeThemeShouldUseDark()
  }

  get window(): BrowserWindow | null {
    return this.mainWindow
  }

  send(channel: string, payload?: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, payload)
    }
  }

  focusMain(): void {
    if (!this.mainWindow) return
    if (this.mainWindow.isMinimized()) this.mainWindow.restore()
    this.mainWindow.show()
    this.mainWindow.focus()
  }

  minimize(): void {
    this.mainWindow?.minimize()
  }

  toggleMaximize(): void {
    const win = this.mainWindow
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  }

  close(): void {
    this.forceClose = true
    this.mainWindow?.close()
  }

  sendWindowState(): void {
    this.send('win:state', { maximized: this.mainWindow?.isMaximized() ?? false })
  }
}

import { nativeTheme } from 'electron'

function nativeThemeShouldUseDark(): boolean {
  return nativeTheme.shouldUseDarkColors
}

/** مسارات الأيقونات — انقل إلى main/icons.js (متوافقة مع الحزمة المثبتة) */
export { resolveAppIconPath as resolveIconPath } from './icons'
