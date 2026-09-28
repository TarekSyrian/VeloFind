import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { DEFAULT_SETTINGS } from '@shared/constants'
import { loadSettingsFrom, saveSettingsTo } from '@engine/persistence/persistence-manager'
import { PersistenceManager } from '@engine/persistence/persistence-manager'
import type { AppSettings } from '@shared/types'

/**
 * خدمة الإعدادات — PRD §24
 * تُحفظ في جدول settings (kv) داخل قاعدة البيانات الدائمة
 */

export class SettingsService {
  private settings: AppSettings = { ...DEFAULT_SETTINGS }
  private persistence: PersistenceManager | null = null
  private settingsPath: string

  private constructor(userDataDir: string) {
    this.settingsPath = path.join(userDataDir, 'settings.json')
  }

  static async create(userDataDir: string): Promise<SettingsService> {
    const service = new SettingsService(userDataDir)
    await service.load(userDataDir)
    return service
  }

  private async load(userDataDir: string): Promise<void> {
    // مصدر أولي: ملف settings.json (سريع قبل جاهزية قاعدة البيانات)
    try {
      const raw = await fs.promises.readFile(this.settingsPath, 'utf-8')
      this.settings = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) }
    } catch {
      this.settings = { ...DEFAULT_SETTINGS }
    }
    // مزامنة مع مخزن دائم إن وُجد
    try {
      this.persistence = await PersistenceManager.create(userDataDir)
      const persisted = await loadSettingsFrom(this.persistence)
      // الملف له أولوية عند التضارب (أحدث نسخة)
      this.settings = { ...persisted, ...this.settings }
    } catch {
      this.persistence = null
    }
  }

  get all(): AppSettings {
    return { ...this.settings }
  }

  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.settings[key]
  }

  async set(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = { ...this.settings, ...patch }
    try {
      await fs.promises.writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf-8')
    } catch (error) {
      console.warn('[velofind] تعذر حفظ ملف الإعدادات:', error)
    }
    if (this.persistence) {
      await saveSettingsTo(this.persistence, patch).catch(() => undefined)
    }
    return this.all
  }

  async close(): Promise<void> {
    await this.persistence?.close()
  }
}
