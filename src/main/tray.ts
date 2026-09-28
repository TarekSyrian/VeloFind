import { app, Menu, Notification, Tray } from 'electron'
import { APP_NAME } from '@shared/constants'
import type { AppSettings } from '@shared/types'
import { loadTrayImage, loadNotificationImage } from './icons'
import type { WindowService } from './windows'
import type { EngineController } from '@engine/engine-controller'

/**
 * أيقونة System Tray — PRD §24 و§29 (v0.3)
 * الإصلاح: أيقونة التراي تظهر دائمًا حتى في الحزمة المثبتة (مسارات متوافقة + بديل مضمّن)
 */

export class TrayService {
  private tray: Tray | null = null

  constructor(
    private windows: WindowService,
    private engine: EngineController,
    private settings?: { get<K extends keyof AppSettings>(key: K): AppSettings[K] }
  ) {}

  init(): void {
    try {
      this.tray = new Tray(loadTrayImage())
      this.tray.setToolTip(`${APP_NAME} — ابحث عن الملفات المكررة`)
      this.tray.setContextMenu(this.buildMenu())
      this.tray.on('click', () => this.windows.focusMain())
      this.tray.on('double-click', () => this.windows.focusMain())
    } catch (error) {
      console.warn('[velofind] تعذر إنشاء أيقونة التراي:', error)
    }
  }

  private buildMenu(): Menu {
    return Menu.buildFromTemplate([
      {
        label: 'فتح VeloFind',
        click: () => this.windows.focusMain()
      },
      { type: 'separator' },
      {
        label: this.engine.isScanning ? 'الفحص جارٍ…' : 'جاهز',
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'إنهاء',
        click: () => {
          app.quit()
        }
      }
    ])
  }

  refresh(): void {
    this.tray?.setContextMenu(this.buildMenu())
  }

  /** إشعار نظام — PRD §25 (يحترم إعداد الإشعارات، وصوته الجميل يُشغَّل من الواجهة) */
  notify(title: string, body: string): void {
    try {
      if (this.settings && !this.settings.get('notificationsEnabled')) return
      if (!Notification.isSupported()) return
      const notification = new Notification({
        title,
        body,
        // نُشغّل أصواتًا مخصصة واضحة في الواجهة — نكتم صوت ويندوز الافتراضي لتجنب التضارب
        silent: true,
        icon: loadNotificationImage()
      })
      notification.on('click', () => {
        this.windows.focusMain()
      })
      notification.show()
    } catch {
      /* الإشعارات اختيارية */
    }
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
