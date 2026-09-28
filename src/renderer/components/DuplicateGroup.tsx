import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  const anchorRef = useRef<HTMLButtonElement>(null)

  const idSet = new Set(selection)
  // الأصل = أقدم ملف (يُعرض بشارة الأصل ويبقى دائمًا)
  const keeperId = [...group.files].sort((a, b) => a.modifiedAt - b.modifiedAt)[0]?.id

  const selectedBytes = group.size * selection.length

  const handleToggle = (fileId: number): void => {
    const file = group.files.find((f) => f.id === fileId)
    if (!file) return
    const ok = toggleFile(group, fileId)
    if (!ok) pushToast('warning', S.duplicates.selectBlocked)
  }

  return (
    <div className="card card-hover animate-fade-up">
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
            <div className="relative">
              <button
                ref={anchorRef}
                className="btn-ghost btn-sm"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
              >
                ⚡ {S.duplicates.autoSelect} ▾
              </button>
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

      {menuOpen && (
        <AutoSelectMenu
          anchorRef={anchorRef}
          onClose={() => setMenuOpen(false)}
          onPick={(options) => {
            autoSelect(group.id, options)
            setMenuOpen(false)
          }}
        />
      )}
    </div>
  )
}

interface MenuPos {
  left: number
  top: number
  width: number
}

/**
 * قائمة «تحديد المكررات تلقائياً».
 *
 * تُركَّب في document.body عبر createPortal لا داخل بطاقة المجموعة، لأن:
 *  1) البطاقة كانت تحمل overflow-hidden فكانت القائمة تُقصّ تمامًا
 *  2) حاوية النتائج نفسها قابلة للتمرير، فقائمة أسفل آخر مجموعة تُقصّ أيضًا
 * بـ position: fixed مع انقلاب لأعلى عند نقص المساحة أسفل الزر.
 */
function AutoSelectMenu({
  anchorRef,
  onClose,
  onPick
}: {
  anchorRef: React.RefObject<HTMLButtonElement>
  onClose: () => void
  onPick: (options: AutoSelectOptions) => void
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<MenuPos | null>(null)

  const place = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const width = 256
    const estimatedHeight = panelRef.current?.offsetHeight ?? 176
    const spaceBelow = window.innerHeight - rect.bottom
    const flipUp = spaceBelow < estimatedHeight + 16 && rect.top > spaceBelow
    setPos({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: flipUp ? Math.max(8, rect.top - estimatedHeight - 6) : rect.bottom + 6,
      width
    })
  }, [anchorRef])

  useLayoutEffect(place, [place])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onReflow = (): void => place()
    window.addEventListener('resize', onReflow)
    // التمرير يغيّر موضع الزر — نعيد الحساب بدل ترك القائمة في مكانها
    window.addEventListener('scroll', onReflow, true)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', onReflow)
      window.removeEventListener('scroll', onReflow, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, place])

  // النقر خارج القائمة يغلقها
  useEffect(() => {
    const onPointer = (e: MouseEvent): void => {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [anchorRef, onClose])

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        ref={panelRef}
        role="menu"
        className="card fixed z-50 p-1.5 shadow-pop animate-fade-up"
        style={{
          left: pos?.left ?? -9999,
          top: pos?.top ?? -9999,
          width: pos?.width ?? 256,
          visibility: pos ? 'visible' : 'hidden'
        }}
      >
        <MenuItem label={S.duplicates.auto.oldest} onClick={() => onPick({ keep: 'oldest' })} />
        <MenuItem label={S.duplicates.auto.newest} onClick={() => onPick({ keep: 'newest' })} />
        <MenuItem
          label={S.duplicates.auto.outsideDownloads}
          onClick={() => onPick({ keep: 'outside_downloads' })}
        />
        <MenuItem
          label={S.duplicates.auto.backupsOnly}
          onClick={() => onPick({ keep: 'oldest', markBackupsOnly: true })}
        />
      </div>
    </>,
    document.body
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
