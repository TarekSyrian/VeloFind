import { useAppStore } from '@renderer/stores/app-store'
import { useScanStore, isScanActive } from '@renderer/stores/scan-store'
import { useDuplicateStore } from '@renderer/stores/duplicate-store'
import { formatBytes, formatNumber } from '@renderer/utils/format'
import { S } from '@renderer/i18n/strings'
import type { Page } from '@renderer/stores/app-store'

/** شريط التنقل الجانبي (يظهر يمينًا بسبب RTL) */
export function Sidebar(): JSX.Element {
  const page = useAppStore((s) => s.page)
  const setPage = useAppStore((s) => s.setPage)
  const stats = useAppStore((s) => s.stats)
  const phase = useScanStore((s) => s.phase)
  const groups = useDuplicateStore((s) => s.groups)
  const active = isScanActive(phase)

  const items: Array<{ id: Page; label: string; icon: JSX.Element; badge?: number }> = [
    { id: 'home', label: S.nav.home, icon: <IconHome /> },
    { id: 'duplicates', label: S.nav.duplicates, icon: <IconLayers />, badge: groups.length || undefined },
    { id: 'scan', label: S.nav.scan, icon: <IconRadar /> },
    { id: 'settings', label: S.nav.settings, icon: <IconGear /> }
  ]

  return (
    <aside className="flex w-60 shrink-0 flex-col border-e border-edge bg-panel">
      <nav className="flex-1 space-y-1 p-3">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => setPage(item.id)}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${
              page === item.id
                ? 'bg-primary/10 text-primary'
                : 'text-muted hover:bg-panel-2 hover:text-ink'
            }`}
          >
            <span className={page === item.id ? 'text-primary' : 'text-muted'}>{item.icon}</span>
            <span className="flex-1 text-start">{item.label}</span>
            {item.badge !== undefined && (
              <span className="badge bg-primary/10 text-primary">{formatNumber(item.badge)}</span>
            )}
            {item.id === 'scan' && active && (
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
            )}
          </button>
        ))}
      </nav>

      <div className="space-y-2 border-t border-edge p-4 text-xs text-muted">
        <Row label={S.home.indexedFiles} value={formatNumber(stats?.indexedFiles ?? 0)} />
        <Row label={S.home.reclaimable} value={formatBytes(stats?.reclaimableBytes ?? 0)} />
        <Row
          label={S.states.db}
          value={stats?.indexStore === 'json' ? 'JSON' : 'SQLite'}
        />
      </div>
    </aside>
  )
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="font-semibold text-ink tabular-nums">{value}</span>
    </div>
  )
}

/* ----------------------------- أيقونات ----------------------------- */

function IconHome(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  )
}

function IconLayers(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="11" height="14" rx="2" />
      <rect x="9" y="7" width="11" height="14" rx="2" fill="var(--panel)" />
    </svg>
  )
}

function IconRadar(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </svg>
  )
}

function IconGear(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
