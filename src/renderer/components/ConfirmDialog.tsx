import { useMemo, useState } from 'react'
import type { DeleteItem } from '@shared/types'
import { validateSelection } from '@shared/safety'
import type { DuplicateGroup } from '@shared/types'
import { formatBytes, formatNumber } from '@renderer/utils/format'
import { S } from '@renderer/i18n/strings'

/** نافذة تأكيد العمليات — عرض الملفات + حواجز الأمان — PRD §16-17 */
export function ConfirmDialog({
  mode,
  items,
  groups,
  onConfirm,
  onCancel
}: {
  mode: 'recycle' | 'quarantine' | 'permanent'
  items: DeleteItem[]
  groups: DuplicateGroup[]
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  const [confirmed, setConfirmed] = useState(!settingsNeedsConfirm(mode))

  const groupsMap = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])
  const violations = useMemo(() => validateSelection(items, groupsMap), [items, groupsMap])
  const reclaimBytes = useMemo(() => {
    let total = 0
    for (const item of items) {
      const group = groupsMap.get(item.groupId)
      if (group) total += group.size
    }
    return total
  }, [items, groupsMap])

  const title =
    mode === 'recycle' ? S.confirm.recycleTitle : mode === 'quarantine' ? S.confirm.quarantineTitle : S.confirm.permanentTitle
  const description =
    mode === 'recycle' ? S.confirm.recycleDesc : mode === 'quarantine' ? S.confirm.quarantineDesc : S.confirm.permanentDesc
  const danger = mode === 'permanent'

  const canExecute = violations.length === 0 && confirmed

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6 animate-fade-in" onClick={onCancel}>
      <div
        className="card w-full max-w-2xl shadow-pop animate-fade-up"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="flex items-center gap-3 border-b border-edge px-6 py-4">
          <span
            className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl ${
              danger ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning-600'
            }`}
          >
            {danger ? '⚠' : '🗑'}
          </span>
          <div>
            <h3 className="text-base font-bold text-ink">{title}</h3>
            <p className="text-xs text-muted">{description}</p>
          </div>
        </div>

        <div className="max-h-72 overflow-y-auto px-6 py-4">
          <div className="mb-3 flex items-center gap-2 text-sm">
            <span className="badge bg-primary/10 text-primary">{formatNumber(items.length)} {S.confirm.fileCount}</span>
            <span className="text-muted">
              ستُسترد <b className="text-accent-600 tabular-nums">{formatBytes(reclaimBytes)}</b>
            </span>
          </div>

          {/* مخالفات أمنية تمنع التنفيذ */}
          {violations.length > 0 && (
            <div className="mb-3 rounded-xl border border-danger/40 bg-danger/[0.07] p-3 text-sm">
              <div className="mb-1 font-bold text-danger">🔒 {S.confirm.safetyBlocked}</div>
              <ul className="list-inside list-disc space-y-1 text-xs text-danger/90">
                {violations.slice(0, 6).map((v, i) => (
                  <li key={i}>{v.message}</li>
                ))}
              </ul>
            </div>
          )}

          <ul className="space-y-1.5">
            {items.slice(0, 50).map((item, i) => (
              <li key={i} className="flex items-center gap-2 rounded-lg bg-panel-2 px-3 py-1.5">
                <span dir="ltr" className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink">
                  {item.path}
                </span>
              </li>
            ))}
            {items.length > 50 && (
              <li className="px-3 text-xs text-muted">+ {formatNumber(items.length - 50)} ملفات أخرى…</li>
            )}
          </ul>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-edge px-6 py-4">
          {danger ? (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="h-4 w-4 accent-danger"
              />
              {S.confirm.confirmPermanent}
            </label>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={onCancel}>
              {S.confirm.cancel}
            </button>
            <button
              className={danger ? 'btn-danger' : 'btn-primary'}
              disabled={!canExecute}
              onClick={onConfirm}
            >
              {S.confirm.execute}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function settingsNeedsConfirm(mode: 'recycle' | 'quarantine' | 'permanent'): boolean {
  return mode === 'permanent'
}
