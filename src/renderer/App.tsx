import { useEffect } from 'react'
import { useAppStore } from '@renderer/stores/app-store'
import { useScanStore } from '@renderer/stores/scan-store'
import { useDuplicateStore } from '@renderer/stores/duplicate-store'
import { TitleBar } from '@renderer/components/TitleBar'
import { Sidebar } from '@renderer/components/Sidebar'
import { ToastHost } from '@renderer/components/Toast'
import { HomePage } from '@renderer/pages/HomePage'
import { DuplicatePage } from '@renderer/pages/DuplicatePage'
import { ScanPage } from '@renderer/pages/ScanPage'
import { SettingsPage } from '@renderer/pages/SettingsPage'
import { S } from '@renderer/i18n/strings'
import { formatBytes, formatNumber } from '@renderer/utils/format'
import { playSound, preloadSounds, soundEnabled } from '@renderer/utils/sounds'

/** جذر التطبيق: ربط أحداث IPC + التخطيط RTL — PRD §14 */
export default function App(): JSX.Element {
  const page = useAppStore((s) => s.page)
  const pushToast = useAppStore((s) => s.pushToast)

  useEffect(() => {
    let cancelled = false

    void useAppStore.getState().init()
    void useDuplicateStore.getState().reload()
    preloadSounds()

    const unsubs = [
      window.velofind.onScanPhase((phase) => {
        useScanStore.getState().handlePhase(phase)
        if (phase === 'paused') pushToast('warning', S.toast.scanPaused)
      }),
      window.velofind.onScanProgress((progress) => useScanStore.getState().handleProgress(progress)),
      window.velofind.onScanDone((result) => {
        useScanStore.getState().handleDone(result)
        void useDuplicateStore.getState().reload()
        void useAppStore.getState().refreshStats()
        // نغمة اكتمال لطيفة وواضحة — تحترم إعداد الأصوات
        playSound('scan-done', soundEnabled(useAppStore.getState().settings))
        pushToast(
          'success',
          S.toast.scanDone,
          `${formatNumber(result.groups.length)} مجموعة — ${formatBytes(result.stats.reclaimableBytes)} قابلة للاسترداد`
        )
      }),
      window.velofind.onScanError((error) => {
        useScanStore.getState().handleError(error)
        if (error.code === 'SCAN_CANCELLED') pushToast('warning', S.toast.scanCancelled)
        else pushToast('error', S.toast.scanFailed, error.message)
      }),
      window.velofind.onIndexChanged(() => {
        void useDuplicateStore.getState().reload()
        void useAppStore.getState().refreshStats()
      }),
      window.velofind.onNotify((n) => pushToast(n.kind, n.title, n.message))
    ]

    return () => {
      cancelled = true
      void cancelled
      for (const unsub of unsubs) unsub()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-full flex-col bg-bg text-ink">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto">
          {page === 'home' && <HomePage />}
          {page === 'duplicates' && <DuplicatePage />}
          {page === 'scan' && <ScanPage />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>

      {/* شريط الحالة السفلي */}
      <StatusBar />

      <ToastHost />
    </div>
  )
}

function StatusBar(): JSX.Element {
  const phase = useScanStore((s) => s.phase)
  const stats = useAppStore((s) => s.stats)

  const status =
    phase === 'idle' || phase === 'completed'
      ? S.states.ready
      : phase === 'paused'
        ? S.scan.paused
        : S.scan.phases[phase as keyof typeof S.scan.phases] ?? phase

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-edge bg-panel px-4 text-[11px] text-muted">
      <span className="flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            phase === 'idle' || phase === 'completed'
              ? 'bg-accent'
              : phase === 'paused'
                ? 'bg-warning'
                : 'animate-pulse bg-primary'
          }`}
        />
        {status}
      </span>
      <span>·</span>
      <span className="tabular-nums">
        {formatNumber(stats?.indexedFiles ?? 0)} {S.home.indexedFiles}
      </span>
      {stats && stats.duplicateGroups > 0 && (
        <>
          <span>·</span>
          <span className="tabular-nums">
            {formatNumber(stats.duplicateGroups)} {S.home.duplicateGroups}
          </span>
        </>
      )}
      <span className="ms-auto" dir="ltr">
        VeloFind
      </span>
    </footer>
  )
}
