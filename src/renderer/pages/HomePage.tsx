import { useEffect } from 'react'
import { useAppStore } from '@renderer/stores/app-store'
import { useScanStore, isScanActive } from '@renderer/stores/scan-store'
import { useDuplicateStore } from '@renderer/stores/duplicate-store'
import { SearchBar } from '@renderer/components/SearchBar'
import { StatsBar } from '@renderer/components/StatsBar'
import { ScanProgress } from '@renderer/components/ScanProgress'
import { DuplicateGroupCard } from '@renderer/components/DuplicateGroup'
import { EmptyState } from '@renderer/components/EmptyState'
import { formatNumber } from '@renderer/utils/format'
import { S } from '@renderer/i18n/strings'
import type { SavedLocation } from '@shared/types'

/** الشاشة الرئيسية المركزة على الملفات المكررة — PRD §14 */
export function HomePage(): JSX.Element {
  const setPage = useAppStore((s) => s.setPage)
  const pushToast = useAppStore((s) => s.pushToast)
  const stats = useAppStore((s) => s.stats)
  const groups = useDuplicateStore((s) => s.groups)
  const reload = useDuplicateStore((s) => s.reload)
  const phase = useScanStore((s) => s.phase)
  const start = useScanStore((s) => s.start)

  const active = isScanActive(phase)
  const topGroups = groups.slice(0, 6)

  const pickAndGo = async (): Promise<void> => {
    const folders = await window.velofind.pickFolders()
    if (folders.length === 0) return
    const locations: SavedLocation[] = folders.map((path) => ({ path, enabled: true, excluded: false }))
    const existing = await window.velofind.listLocations()
    await window.velofind.saveLocations([...existing, ...locations])
    pushToast('success', 'تمت إضافة المجلدات', 'راجع الإعدادات ثم ابدأ الفحص')
    setPage('scan')
  }

  const resumeLast = async (): Promise<void> => {
    try {
      const locations = (await window.velofind.listLocations()).filter((l) => l.enabled && !l.excluded)
      if (locations.length === 0) {
        pushToast('warning', 'لا توجد مواقع محفوظة', 'اختر مجلدات أولًا ثم ابدأ الفحص')
        setPage('scan')
        return
      }
      const settings = useAppStore.getState().settings
      await start({
        locations: locations.map((l) => l.path),
        // بدون هذا السطر كان «استكمال آخر فحص» يتجاهل استثناءات المجلدات
        // فيفحص node_modules و.git بينما فحص صفحة الإعدادات يستثنيهما
        excludedFolderNames: settings?.excludedFolders ?? [],
        mode: settings?.scanModeDefault ?? 'accurate',
        minSize: settings?.minFileSize ?? 0,
        category: 'all',
        extensions: [],
        includeHidden: settings?.includeHiddenFiles ?? false,
        excludeSystemFolders: settings?.excludeSystemFolders ?? true,
        incremental: true
      })
      setPage('scan')
    } catch (error) {
      pushToast('error', 'تعذر بدء الفحص', (error as Error).message)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      {/* البحث */}
      <SearchBar />

      {/* أزرار الإجراءات */}
      <div className="flex flex-wrap items-center gap-2.5">
        <button className="btn-primary" onClick={() => setPage('scan')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          {S.home.newScan}
        </button>
        <button className="btn-ghost" onClick={() => void pickAndGo()}>
          📁 {S.home.pickFolders}
        </button>
        <button className="btn-ghost" onClick={() => void resumeLast()} disabled={active}>
          ⚡ {S.home.resumeLast}
        </button>
      </div>

      {/* الإحصاءات */}
      <StatsBar />

      {/* تقدم الفحص الجاري */}
      {active && (
        <div>
          <h3 className="mb-2 text-sm font-bold text-muted">{S.home.scanningNow}</h3>
          <ScanProgress compact />
        </div>
      )}

      {/* أكبر المجموعات أو حالة فارغة */}
      {stats && stats.duplicateGroups > 0 && topGroups.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink">
              {S.home.topGroups} <span className="text-muted">({formatNumber(stats.duplicateGroups)})</span>
            </h3>
            <button className="text-xs font-semibold text-primary hover:underline" onClick={() => setPage('duplicates')}>
              {S.home.viewAll} ←
            </button>
          </div>
          {topGroups.map((group) => (
            <DuplicateGroupCard key={group.id} group={group} />
          ))}
        </div>
      ) : (
        !active && (
          <EmptyState
            variant="scan"
            title={S.home.emptyTitle}
            description={S.home.emptyDesc}
            actionLabel={S.home.newScan}
          />
        )
      )}

      {/* إعادة تحميل المجموعات عند أول دخول */}
      {groups.length === 0 && !active && <ReloadOnce onReload={() => void reload()} />}
    </div>
  )
}

function ReloadOnce({ onReload }: { onReload: () => void }): null {
  useEffect(() => {
    onReload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}
