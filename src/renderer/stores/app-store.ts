import { create } from 'zustand'
import type { AppSettings } from '@shared/types'
import type { AppNotification } from '@shared/ipc-contract'
import type { EngineStats } from '@shared/types'
import type { FileSummary, SearchResult } from '@shared/types'

export type Page = 'home' | 'duplicates' | 'scan' | 'settings'

export interface Toast {
  id: number
  kind: AppNotification['kind']
  title: string
  message?: string
}

interface AppState {
  page: Page
  theme: AppSettings['theme']
  settings: AppSettings | null
  stats: EngineStats | null
  toasts: Toast[]
  search: {
    query: string
    results: FileSummary[] | null
    total: number
    tookMs: number
    searching: boolean
  }

  setPage(page: Page): void
  applyTheme(theme: AppSettings['theme']): void
  init(): Promise<void>
  refreshStats(): Promise<void>
  updateSettings(patch: Partial<AppSettings>): Promise<void>
  pushToast(kind: AppNotification['kind'], title: string, message?: string): void
  dismissToast(id: number): void
  runSearch(query: string): Promise<void>
  clearSearch(): void
}

let toastId = 0
let searchTimer: ReturnType<typeof setTimeout> | null = null

export const useAppStore = create<AppState>((set, get) => ({
  page: 'home',
  theme: 'system',
  settings: null,
  stats: null,
  toasts: [],
  search: { query: '', results: null, total: 0, tookMs: 0, searching: false },

  setPage(page: Page): void {
    set({ page })
    void window.velofind.setSettings({ lastPage: page })
  },

  applyTheme(theme: AppSettings['theme']): void {
    set({ theme })
    const dark =
      theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', dark)
  },

  async init(): Promise<void> {
    const settings = await window.velofind.getSettings()
    set({ settings, page: settings.lastPage ?? 'home' })
    get().applyTheme(settings.theme)
    await get().refreshStats()

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (get().theme === 'system') get().applyTheme('system')
    })
  },

  async refreshStats(): Promise<void> {
    try {
      const stats = await window.velofind.getStats()
      set({ stats })
    } catch {
      /* تجاهل — سيتحدث عند اكتمال الفحص */
    }
  },

  async updateSettings(patch: Partial<AppSettings>): Promise<void> {
    const updated = await window.velofind.setSettings(patch)
    set({ settings: updated })
    if (patch.theme) get().applyTheme(patch.theme)
  },

  pushToast(kind, title, message): void {
    const id = ++toastId
    set((state) => ({ toasts: [...state.toasts, { id, kind, title, message }] }))
    setTimeout(() => get().dismissToast(id), 5200)
  },

  dismissToast(id: number): void {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },

  async runSearch(query: string): Promise<void> {
    if (searchTimer) clearTimeout(searchTimer)
    if (!query.trim()) {
      set({ search: { query: '', results: null, total: 0, tookMs: 0, searching: false } })
      return
    }
    set((state) => ({ search: { ...state.search, query, searching: true } }))
    searchTimer = setTimeout(async () => {
      try {
        const result: SearchResult = await window.velofind.search(query, 60)
        set({ search: { query, results: result.files, total: result.total, tookMs: result.tookMs, searching: false } })
      } catch {
        set((state) => ({ search: { ...state.search, searching: false } }))
      }
    }, 220)
  },

  clearSearch(): void {
    if (searchTimer) clearTimeout(searchTimer)
    set({ search: { query: '', results: null, total: 0, tookMs: 0, searching: false } })
  }
}))
