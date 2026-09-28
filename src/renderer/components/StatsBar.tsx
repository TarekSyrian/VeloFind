import { useAppStore } from '@renderer/stores/app-store'
import { useScanStore } from '@renderer/stores/scan-store'
import { formatBytes, formatDate, formatNumber } from '@renderer/utils/format'
import { S } from '@renderer/i18n/strings'

/** شريط الإحصاءات — PRD §14 */
export function StatsBar(): JSX.Element {
  const stats = useAppStore((s) => s.stats)
  const phase = useScanStore((s) => s.phase)

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        title={S.home.reclaimable}
        value={formatBytes(stats?.reclaimableBytes ?? 0)}
        accent="accent"
        icon={<IconSpark />}
        large
      />
      <StatCard
        title={S.home.duplicateGroups}
        value={formatNumber(stats?.duplicateGroups ?? 0)}
        icon={<IconLayers />}
      />
      <StatCard
        title={S.home.duplicateFiles}
        value={formatNumber(stats?.duplicateFiles ?? 0)}
        icon={<IconFiles />}
      />
      <StatCard
        title={S.home.lastScan}
        value={stats?.lastScanAt ? formatDate(stats.lastScanAt) : phase === 'idle' ? '—' : 'الآن'}
        icon={<IconClock />}
      />
    </div>
  )
}

function StatCard({
  title,
  value,
  icon,
  accent,
  large
}: {
  title: string
  value: string
  icon: JSX.Element
  accent?: 'accent'
  large?: boolean
}): JSX.Element {
  return (
    <div className={`card card-hover flex items-center gap-3 p-4 ${large ? 'col-span-2 lg:col-span-1' : ''}`}>
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          accent === 'accent' ? 'bg-accent/10 text-accent-600' : 'bg-primary/10 text-primary'
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs text-muted">{title}</div>
        <div
          className={`truncate font-bold tabular-nums ${large ? 'text-xl text-accent-600' : 'text-[15px] text-ink'}`}
        >
          {value}
        </div>
      </div>
    </div>
  )
}

function IconSpark(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  )
}

function IconLayers(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="11" height="14" rx="2" />
      <rect x="9" y="7" width="11" height="14" rx="2" fill="var(--panel)" />
    </svg>
  )
}

function IconFiles(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  )
}

function IconClock(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  )
}
