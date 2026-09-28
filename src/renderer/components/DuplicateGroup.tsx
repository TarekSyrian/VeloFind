import { useRef, useState } from 'react'
import type { DuplicateGroup } from '@shared/types'
import type { AutoSelectOptions } from '@shared/auto-select'
import { useAppStore } from '@renderer/stores/app-store'
import { useDuplicateStore } from '@renderer/stores/duplicate-store'
import { DuplicateFileRow } from './DuplicateFileRow'
import { formatBytes, formatDate, formatNumber, fileKindLabel } from '@renderer/utils/format'
import { S } from '@renderer/i18n/strings'

/** بطاقة مجموعة مكررة — العرض المطلوب في PRD §14 */
export function DuplicateGroupCard({ group }: { group: DuplicateGroup }): JSX.Element {
  const expanded = useDuplicateStore((s) => s.expanded[group.id] ?? false)
  const toggleExpand = useDuplicateStore((s) => s.toggleExpand)
  const selection = useDuplicateStore((s) => s.selection[group.id] ?? [])
  const toggleFile = useDuplicateStore((s) => s.toggleFile)
  const keepOriginal = useDuplicateStore((s) => s.keepOriginal)
  const autoSelect = useDuplicateStore((s) => s.autoSelect)
  const pushToast = useAppStore((s) => s.pushToast)

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const idSet = new Set(selection)
  // الأصل = أقدم ملف (يُعرض بشارة الأصل ويبقى دائمًا)
  const keeperId = [...group.files].sort((a, b) => a.modifiedAt - b.modifiedAt)[0]?.id

  const selectedBytes = group.size * selection.length

  const applyAuto = (options: AutoSelectOptions): void => {
    autoSelect(group.id, options)
    setMenuOpen(false)
  }

  const handleToggle = (fileId: number): void => {
    const file = group.files.find((f) => f.id === fileId)
    if (!file) return
    const ok = toggleFile(group, fileId)
    if (!ok) pushToast('warning', S.duplicates.selectBlocked)
  }

  return (
    <div className="card card-hover overflow-hidden animate-fade-up">
      {/* رأس المجموعة */}
      <button className="flex w-full items-center gap-3 px-4 py-3.5 text-start" onClick={() => toggleExpand(group.id)}>
        <span className={`text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}>‹</span>

        <span className="badge shrink-0 bg-primary/10 text-primary">{fileKindLabel(group.files[0]?.extension ?? '')}</span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-bold text-ink">{group.files[0]?.name}</span>
            {group.hashKind === 'partial' && (
              <span className="badge bg-warning/15 text-warning-600" title={S.duplicates.partialNote}>
                سريع
              </span>
            )}
          </span>
          <span dir="ltr" className="block truncate font-mono text-[10px] text-muted">
            {group.hash.slice(0, 46)}…
          </span>
        </span>

        <span className="hidden shrink-0 items-center gap-4 text-xs text-muted md:flex">
          <Stat label={S.duplicates.copies} value={`×${formatNumber(group.fileCount)}`} />
          <Stat label="الحجم" value={formatBytes(group.size)} />
          <Stat label={S.duplicates.reclaimable} value={formatBytes(group.reclaimedBytes)} accent />
        </span>

        {selection.length > 0 && (
          <span className="badge shrink-0 bg-danger/10 text-danger tabular-nums">
            {formatNumber(selection.length)} محدد
          </span>
        )}
      </button>

      {/* جسم المجموعة */}
      {expanded && (
        <div className="space-y-3 px-4 pb-4 animate-fade-in">
          <div className="space-y-1.5">
            {group.files.map((file) => (
              <DuplicateFileRow
                key={file.id}
                file={file}
                selected={idSet.has(file.id)}
                keeper={file.id === keeperId}
                onToggle={() => handleToggle(file.id)}
              />
            ))}
          </div>

          {/* أزرار المجموعة — التحديد التلقائي وفق قواعد PRD §14 */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative" ref={menuRef}>
              <button className="btn-ghost btn-sm" onClick={() => setMenuOpen((v) => !v)}>
                ⚡ {S.duplicates.autoSelect} ▾
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                  <div className="card absolute top-full z-40 mt-1.5 w-64 p-1.5 shadow-pop animate-fade-up">
                    <MenuItem
                      label={S.duplicates.auto.oldest}
                      onClick={() => applyAuto({ keep: 'oldest' })}
                    />
                    <MenuItem
                      label={S.duplicates.auto.newest}
                      onClick={() => applyAuto({ keep: 'newest' })}
                    />
                    <MenuItem
                      label={S.duplicates.auto.outsideDownloads}
                      onClick={() => applyAuto({ keep: 'outside_downloads' })}
                    />
                    <MenuItem
                      label={S.duplicates.auto.backupsOnly}
                      onClick={() => applyAuto({ keep: 'oldest', markBackupsOnly: true })}
                    />
                  </div>
                </>
              )}
            </div>

            <button
              className="btn-ghost btn-sm"
              onClick={() => keepOriginal(group.id, 'oldest')}
              title="تحديد كل النسخ ما عدا الأقدم"
            >
              📌 {S.duplicates.keepOriginal}
            </button>

            {selection.length > 0 && (
              <button className="btn-ghost btn-sm" onClick={() => useDuplicateStore.getState().clearGroupSelection(group.id)}>
                ✕ مسح تحديد المجموعة
                <span className="badge bg-danger/10 text-danger tabular-nums">{formatBytes(selectedBytes)}</span>
              </button>
            )}

            <span className="ms-auto text-[11px] text-muted">
              {S.duplicates.modified}: {formatDate(group.files[0]?.modifiedAt)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }): JSX.Element {
  return (
    <span className="flex flex-col items-end">
      <span>{label}</span>
      <span className={`font-bold tabular-nums ${accent ? 'text-accent-600' : 'text-ink'}`}>{value}</span>
    </span>
  )
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="block w-full rounded-lg px-3 py-2 text-start text-sm text-ink transition hover:bg-primary/10"
    >
      {label}
    </button>
  )
}
