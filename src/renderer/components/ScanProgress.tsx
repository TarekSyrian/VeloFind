import { useScanStore } from '@renderer/stores/scan-store'
import { formatBytes, formatNumber } from '@renderer/utils/format'
import { S } from '@renderer/i18n/strings'
import type { ScanPhase } from '@shared/types'

/** مكوّن تقدم الفحص — مراحل واضحة + تحكم كامل (إيقاف/استكمال/إلغاء) — PRD §15 و§20 */
const PHASE_STEPS: Array<{ key: ScanPhase; label: string }> = [
  { key: 'preparing', label: S.scan.phases.preparing },
  { key: 'scanning', label: S.scan.phases.scanning },
  { key: 'grouping_by_size', label: S.scan.phases.grouping_by_size },
  { key: 'partial_hashing', label: S.scan.phases.partial_hashing },
  { key: 'full_hashing', label: S.scan.phases.full_hashing },
  { key: 'building_results', label: S.scan.phases.building_results }
]

export function ScanProgress({ compact = false }: { compact?: boolean }): JSX.Element {
  const phase = useScanStore((s) => s.phase)
  const paused = useScanStore((s) => s.paused)
  const progress = useScanStore((s) => s.progress)
  const warnings = useScanStore((s) => s.warnings)
  const pause = useScanStore((s) => s.pause)
  const resume = useScanStore((s) => s.resume)
  const cancel = useScanStore((s) => s.cancel)

  const currentIndex = PHASE_STEPS.findIndex((p) => p.key === phase)
  const filesPct = progress && progress.filesTotal > 0 ? (progress.filesScanned / progress.filesTotal) * 100 : null

  return (
    <div className="card p-5 animate-fade-up">
      {/* المراحل */}
      <div className="flex flex-wrap items-center gap-1.5">
        {PHASE_STEPS.map((step, index) => {
          const doneState = currentIndex > index || phase === 'completed'
          const activeState = currentIndex === index && phase !== 'completed'
          return (
            <div key={step.key} className="flex items-center gap-1.5">
              <span
                className={`badge ${
                  doneState
                    ? 'bg-accent/10 text-accent-600'
                    : activeState
                      ? 'bg-primary text-white'
                      : 'bg-edge text-muted'
                }`}
              >
                {doneState ? '✓' : index + 1} · {step.label}
              </span>
              {index < PHASE_STEPS.length - 1 && <span className="text-edge">—</span>}
            </div>
          )
        })}
      </div>

      {/* أشرطة التقدم */}
      <div className="mt-4 space-y-3">
        <Bar
          label={`${S.scan.filesScanned}: ${formatNumber(progress?.filesScanned ?? 0)}${
            progress?.filesTotal ? ` / ${formatNumber(progress.filesTotal)}` : ''
          }`}
          percent={filesPct}
          indeterminate={filesPct === null && phase !== 'completed'}
        />
        <Bar
          label={`${S.scan.bytesRead}: ${formatBytes(progress?.bytesRead ?? 0)}`}
          percent={null}
          indeterminate={phase !== 'completed' && (progress?.bytesRead ?? 0) > 0}
        />
      </div>

      {/* معلومات مباشرة */}
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs lg:grid-cols-4">
        <Info label={S.scan.groupsFound} value={formatNumber(progress?.duplicateGroups ?? 0)} accent />
        <Info
          label="الزمن"
          value={formatElapsed(progress?.elapsedMs ?? 0)}
        />
        <div className="col-span-2 lg:col-span-2 min-w-0">
          <div className="text-muted">{S.scan.currentPath}</div>
          {progress?.currentPath && (
            <div dir="ltr" className="truncate font-mono text-[11px] text-ink">
              {progress.currentPath}
            </div>
          )}
        </div>
      </div>

      {/* حالة الإيقاف */}
      {paused && (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-warning/10 px-4 py-2.5 text-sm font-semibold text-warning-600">
          <span className="h-2 w-2 rounded-full bg-warning" />
          {S.scan.paused}
        </div>
      )}

      {/* التحذيرات */}
      {!compact && warnings.length > 0 && (
        <details className="mt-4 rounded-xl border border-edge bg-panel-2 px-4 py-2 text-xs">
          <summary className="cursor-pointer font-semibold text-warning-600">
            {S.scan.warnings} ({formatNumber(warnings.length)})
          </summary>
          <ul dir="ltr" className="mt-2 max-h-32 space-y-1 overflow-y-auto font-mono text-[10px] text-muted">
            {warnings.slice(0, 60).map((w, i) => (
              <li key={i} className="truncate">
                {w.path}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* أزرار التحكم */}
      <div className="mt-5 flex items-center gap-2">
        {paused ? (
          <button className="btn-primary" onClick={() => void resume()}>
            ▶ {S.scan.resume}
          </button>
        ) : (
          <button className="btn-ghost" onClick={() => void pause()} disabled={phase === 'completed'}>
            ⏸ {S.scan.pause}
          </button>
        )}
        <button className="btn-danger-outline" onClick={() => void cancel()} disabled={phase === 'completed'}>
          ✕ {S.scan.cancel}
        </button>
      </div>
    </div>
  )
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds} ث`
  return `${Math.floor(seconds / 60)} د ${seconds % 60} ث`
}

function Bar({
  label,
  percent,
  indeterminate
}: {
  label: string
  percent: number | null
  indeterminate?: boolean
}): JSX.Element {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        {percent !== null && <span className="font-semibold text-ink tabular-nums">{percent.toFixed(1)}%</span>}
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-edge">
        {indeterminate ? (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-l from-primary to-accent" />
        ) : (
          <div
            className="progress-fill h-full rounded-full bg-gradient-to-l from-primary to-accent"
            style={{ width: `${Math.min(100, percent ?? 0)}%` }}
          />
        )}
      </div>
    </div>
  )
}

function Info({ label, value, accent }: { label: string; value: string; accent?: boolean }): JSX.Element {
  return (
    <div className="rounded-xl bg-panel-2 px-3 py-2">
      <div className="text-muted">{label}</div>
      <div className={`font-bold tabular-nums ${accent ? 'text-accent-600' : 'text-ink'}`}>{value}</div>
    </div>
  )
}
