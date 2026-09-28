import { create } from 'zustand'
import type { DeleteItem, DuplicateGroup } from '@shared/types'
import { autoSelectForGroup } from '@shared/auto-select'
import type { AutoSelectOptions } from '@shared/auto-select'
import { DEFAULT_DUPLICATE_FILTERS, filterDuplicateGroups } from '@engine/query/duplicate-filters'
import type { DuplicateFilters } from '@engine/query/duplicate-filters'

interface DuplicateState {
  groups: DuplicateGroup[]
  loading: boolean
  selection: Record<string, number[]>
  expanded: Record<string, boolean>
  filters: DuplicateFilters

  reload(): Promise<void>
  toggleExpand(groupId: string): void
  toggleFile(group: DuplicateGroup, fileId: number): boolean
  clearGroupSelection(groupId: string): void
  clearAllSelections(): void
  autoSelect(groupId: string, options: AutoSelectOptions): void
  keepOriginal(groupId: string, keep: AutoSelectOptions['keep'], keepFolder?: string): void
  setFilters(patch: Partial<DuplicateFilters>): void
  filteredGroups(): DuplicateGroup[]
  selectedItems(): DeleteItem[]
  selectionStats(): { count: number; reclaimBytes: number }
}

export const useDuplicateStore = create<DuplicateState>((set, get) => ({
  groups: [],
  loading: false,
  selection: {},
  expanded: {},
  filters: { ...DEFAULT_DUPLICATE_FILTERS },

  reload: async () => {
    set({ loading: true })
    try {
      const groups = await window.velofind.listDuplicateGroups()
      set({ groups })
      // الاحتفاظ فقط بالتحديدات التي ما تزال صالحة
      const valid = new Map(groups.map((g) => [g.id, new Set(g.files.map((f) => f.id))]))
      set((state) => {
        const selection: Record<string, number[]> = {}
        for (const [groupId, ids] of Object.entries(state.selection)) {
          const allowed = valid.get(groupId)
          if (!allowed) continue
          const kept = ids.filter((id) => allowed.has(id))
          if (kept.length > 0) selection[groupId] = kept
        }
        return { selection }
      })
    } finally {
      set({ loading: false })
    }
  },

  toggleExpand: (groupId) =>
    set((state) => ({ expanded: { ...state.expanded, [groupId]: !state.expanded[groupId] } })),

  /** تبديل تحديد ملف — يمنع تحديد جميع النسخ (PRD §17). يرجع false عند المنع */
  toggleFile: (group, fileId) => {
    const current = get().selection[group.id] ?? []
    const isSelected = current.includes(fileId)
    if (!isSelected && current.length + 1 >= group.files.length) {
      return false
    }
    const next = isSelected ? current.filter((id) => id !== fileId) : [...current, fileId]
    set((state) => ({ selection: { ...state.selection, [group.id]: next } }))
    return true
  },

  clearGroupSelection: (groupId) =>
    set((state) => {
      const selection = { ...state.selection }
      delete selection[groupId]
      return { selection }
    }),

  clearAllSelections: () => set({ selection: {} }),

  autoSelect: (groupId, options) => {
    const group = get().groups.find((g) => g.id === groupId)
    if (!group) return
    const ids = autoSelectForGroup(group, options)
    set((state) => ({ selection: { ...state.selection, [groupId]: ids } }))
  },

  keepOriginal: (groupId, keep, keepFolder) => {
    get().autoSelect(groupId, { keep, keepFolder })
  },

  setFilters: (patch) => set((state) => ({ filters: { ...state.filters, ...patch } })),

  filteredGroups: () => {
    const { groups, filters, selection } = get()
    return filterDuplicateGroups(groups, filters, selection)
  },

  selectedItems: () => {
    const { groups, selection } = get()
    const items: DeleteItem[] = []
    for (const group of groups) {
      const ids = selection[group.id]
      if (!ids || ids.length === 0) continue
      const idSet = new Set(ids)
      for (const file of group.files) {
        if (idSet.has(file.id)) items.push({ path: file.path, groupId: group.id })
      }
    }
    return items
  },

  selectionStats: () => {
    const { groups, selection } = get()
    let count = 0
    let reclaimBytes = 0
    for (const group of groups) {
      const ids = selection[group.id]
      if (!ids || ids.length === 0) continue
      count += ids.length
      reclaimBytes += group.size * ids.length
    }
    return { count, reclaimBytes }
  }
}))
