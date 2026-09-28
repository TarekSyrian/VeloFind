import { useAppStore } from '@renderer/stores/app-store'

/** إشعارات داخل التطبيق — PRD §25 */
export function ToastHost(): JSX.Element | null {
  const toasts = useAppStore((s) => s.toasts)
  const dismissToast = useAppStore((s) => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-4 start-4 z-[60] flex w-96 max-w-[85vw] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-pop animate-fade-up ${
            toast.kind === 'success'
              ? 'border-accent/40 bg-panel'
              : toast.kind === 'error'
                ? 'border-danger/45 bg-panel'
                : toast.kind === 'warning'
                  ? 'border-warning/50 bg-panel'
                  : 'border-edge bg-panel'
          }`}
        >
          <span
            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-sm ${
              toast.kind === 'success'
                ? 'bg-accent/10 text-accent-600'
                : toast.kind === 'error'
                  ? 'bg-danger/10 text-danger'
                  : toast.kind === 'warning'
                    ? 'bg-warning/15 text-warning-600'
                    : 'bg-primary/10 text-primary'
            }`}
          >
            {toast.kind === 'success' ? '✓' : toast.kind === 'error' ? '✕' : toast.kind === 'warning' ? '⚠' : 'ℹ'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-ink">{toast.title}</div>
            {toast.message && <div className="mt-0.5 text-xs leading-relaxed text-muted">{toast.message}</div>}
          </div>
          <button
            onClick={() => dismissToast(toast.id)}
            className="text-muted transition hover:text-ink"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
