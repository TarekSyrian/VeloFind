import { useAppStore } from '@renderer/stores/app-store'
import { useScanStore } from '@renderer/stores/scan-store'
import { isScanActive } from '@renderer/stores/scan-store'
import { S } from '@renderer/i18n/strings'

/** حالة فارغة مع رسم توضيحي — تستخدم في الرئيسية والمكررات */
export function EmptyState({
  variant,
  title,
  description,
  actionLabel,
  onAction
}: {
  variant: 'search' | 'scan' | 'no-results'
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}): JSX.Element {
  const setPage = useAppStore((s) => s.setPage)
  const phase = useScanStore((s) => s.phase)

  // أثناء فحص نشط نعرض التقدم بدل الحالة الفارغة
  if (variant === 'scan' && isScanActive(phase)) {
    return <div />
  }

  return (
    <div className="card flex flex-col items-center justify-center gap-3 px-8 py-14 text-center animate-fade-up">
      <Illustration variant={variant} />
      <h3 className="text-lg font-bold text-ink">{title}</h3>
      <p className="max-w-md text-sm leading-relaxed text-muted">{description}</p>
      {actionLabel && (
        <button
          className="btn-primary mt-2"
          onClick={() => (onAction ? onAction() : setPage('scan'))}
        >
          {actionLabel ?? S.home.newScan}
        </button>
      )}
    </div>
  )
}

function Illustration({ variant }: { variant: 'search' | 'scan' | 'no-results' }): JSX.Element {
  if (variant === 'scan') {
    return (
      <svg width="120" height="90" viewBox="0 0 120 90" fill="none">
        <rect x="18" y="14" width="46" height="60" rx="8" fill="#5B5FEF" opacity="0.14" />
        <rect x="26" y="24" width="30" height="4" rx="2" fill="#5B5FEF" opacity="0.45" />
        <rect x="26" y="34" width="30" height="4" rx="2" fill="#5B5FEF" opacity="0.3" />
        <rect x="56" y="22" width="46" height="60" rx="8" fill="#21C7A8" opacity="0.16" />
        <rect x="64" y="34" width="30" height="4" rx="2" fill="#21C7A8" opacity="0.5" />
        <rect x="64" y="44" width="30" height="4" rx="2" fill="#21C7A8" opacity="0.35" />
        <circle cx="82" cy="30" r="16" stroke="#5B5FEF" strokeWidth="4" fill="none" />
        <path d="m94 42 12 12" stroke="#474BD6" strokeWidth="5" strokeLinecap="round" />
        <path d="M85 24l-4 7h5l-3 8 8-10h-4.5l3-5z" fill="#F0A202" />
      </svg>
    )
  }
  return (
    <svg width="120" height="90" viewBox="0 0 120 90" fill="none">
      <circle cx="52" cy="38" r="24" stroke="#5B5FEF" strokeWidth="5" fill="none" opacity="0.8" />
      <path d="m70 56 18 18" stroke="#474BD6" strokeWidth="6" strokeLinecap="round" />
      <rect x="38" y="28" width="13" height="17" rx="2" fill="#9BA1F2" opacity="0.8" />
      <rect x="45" y="33" width="13" height="17" rx="2" fill="#21C7A8" opacity="0.9" />
      <path d="M96 22l-2.5 4.5H98L93 34" stroke="#F0A202" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  )
}
