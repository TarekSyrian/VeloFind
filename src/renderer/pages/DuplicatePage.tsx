import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@renderer/stores/app-store'
import { useDuplicateStore } from '@renderer/stores/duplicate-store'
import { DuplicateGroupCard } from '@renderer/components/DuplicateGroup'
import { FilterPanel } from '@renderer/components/FilterPanel'
import { EmptyState } from '@renderer/components/EmptyState'
import { ConfirmDialog } from '@renderer/components/ConfirmDialog'
import { formatBytes, formatNumber } from '@renderer/utils/format'
import { playSound, soundEnabled } from '@renderer/utils/sounds'
import { S } from '@renderer/i18n/strings'
import type { DeleteItem } from '@shared/types'

/** صفحة المكررات — النتائج والإجراءات الآمنة — PRD §14 و§16 */
type ConfirmMode = 'recycle' | 'quarantine' | 'permanent'

/** عدد المجموعات المعروضة أوليًا ثم يزيد عند «عرض المزيد» — يمنع ثقل الواجهة مع السجلات الضخمة */
const PAGE_SIZE = 80

export function DuplicatePage(): JSX.Element {
  const groups = useDuplicateStore((s) => s.groups)
  const filters = useDuplicateStore((s) => s.filters)
  const filtered = useDuplicateStore((s) => s.filteredGroups())
  const loading = useDuplicateStore((s) => s.loading)
  const clearAll = useDuplicateStore((s) => s.clearAllSelections)
  const selectedItems = useDuplicateStore((s) => s.selectedItems())
  const stats = useDuplicateStore((s) => s.selectionStats())
  const pushToast = useAppStore((s) => s.pushToast)
  const refreshStats = useAppStore((s) => s.refreshStats)

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  // أي تغيير في التصفية يعيد العدّاد للصفحة الأولى
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [filters])

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])

  const [confirmMode, setConfirmMode] = useState<ConfirmMode | null>(null)

  const drives = useMemo(() => {
    const set = new Set<string>()
    for (const group of groups) for (const file of group.files) set.add(file.drive)
    return [...set].sort()
  }, [groups])

  const extensions = useMemo(() => {
    const set = new Set<string>()
    for (const group of groups) {
      const ext = group.files[0]?.extension
      if (ext) set.add(ext)
    }
    return [...set].sort()
  }, [groups])

  const execute = async (mode: ConfirmMode): Promise<void> => {
    if (!confirmMode) return
    setConfirmMode(null)
    try {
      const result =
        mode === 'recycle'
          ? await window.velofind.recycleFiles(selectedItems)
          : mode === 'quarantine'
            ? await window.velofind.quarantineFiles(selectedItems)
            : await window.velofind.deleteFilesPermanent(selectedItems, true)

      const okCount = result.succeeded?.length ?? 0
      const failedCount = result.failed?.length ?? 0
      if (okCount > 0) {
        playSound('operation-done', soundEnabled(useAppStore.getState().settings))
      }
      pushToast(
        result.ok ? 'success' : failedCount > 0 ? 'warning' : 'error',
        result.ok ? S.toast.opDone : failedCount > 0 ? S.toast.opPartial : S.toast.opBlocked,
        result.message
      )
      await useDuplicateStore.getState().reload()
      await refreshStats()
      void okCount
    } catch (error) {
      pushToast('error', S.toast.opBlocked, (error as Error).message)
      await useDuplicateStore.getState().reload()
    }
  }

  if (groups.length === 0 && !loading) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <EmptyState variant="scan" title={S.duplicates.emptyTitle} description={S.duplicates.emptyDesc} />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto w-full max-w-6xl flex-1 space-y-3 overflow-y-auto p-6">
        <h2 className="text-lg font-bold text-ink">
          {S.duplicates.title}{' '}
          <span className="text-sm font-medium text-muted">
            ({formatNumber(filtered.length)} {S.home.duplicateGroups})
          </span>
        </h2>

        <FilterPanel drives={drives} extensions={extensions} />

        <div className="space-y-3 pb-28">
          {visible.map((group) => (
            <DuplicateGroupCard key={group.id} group={group} />
          ))}
          {visible.length < filtered.length && (
            <div className="pt-2 text-center">
              <button className="btn-ghost btn-sm" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
                {S.duplicates.loadMore} ({formatNumber(filtered.length - visible.length)} {S.home.duplicateGroups})
              </button>
            </div>
          )}
          {filtered.length === 0 && (
            <div className="card px-6 py-10 text-center text-sm text-muted">
              {filters.crossDriveOnly ? S.duplicates.noCrossDrive : S.home.noResults}
            </div>
          )}
        </div>
      </div>

      {/* شريط الإجراءات السفلي الثابت */}
      {selectedItems.length > 0 && (
        <div className="sticky bottom-0 z-20 border-t border-edge bg-panel px-6 py-3 shadow-card backdrop-blur animate-fade-up">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
            <span className="badge bg-danger/10 text-danger tabular-nums">
              {formatNumber(selectedItems.length)} {S.duplicates.bar.selectedCount}
            </span>
            <span className="text-sm text-muted">
              {S.duplicates.bar.willReclaim}{' '}
              <b className="text-accent-600 tabular-nums">{formatBytes(stats.reclaimBytes)}</b>
            </span>
            <div className="ms-auto flex flex-wrap items-center gap-2">
              <button className="btn-ghost btn-sm" onClick={clearAll}>
                {S.duplicates.actions.clearSelection}
              </button>
              <button className="btn-ghost btn-sm" onClick={() => setConfirmMode('quarantine')}>
                📦 {S.duplicates.actions.toQuarantine}
              </button>
              <button className="btn-danger-outline btn-sm" onClick={() => setConfirmMode('recycle')}>
                🗑 {S.duplicates.actions.toRecycleBin}
              </button>
              <button className="btn-danger btn-sm" onClick={() => setConfirmMode('permanent')}>
                ⚠ {S.duplicates.actions.deletePermanent}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* نافذة التأكيد */}
      {confirmMode && selectedItems.length > 0 && (
        <ConfirmDialog
          mode={confirmMode}
          items={selectedItems}
          groups={groups}
          onConfirm={() => void execute(confirmMode)}
          onCancel={() => setConfirmMode(null)}
        />
      )}
    </div>
  )
}
