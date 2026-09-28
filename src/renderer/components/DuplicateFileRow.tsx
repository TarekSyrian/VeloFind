import type { DuplicateFileInfo } from '@shared/types'
import { formatBytes, formatDate } from '@renderer/utils/format'
import { S } from '@renderer/i18n/strings'

/** صف ملف داخل مجموعة تكرار — كل التفاصيل والإجراءات المطلوبة في PRD §14 */
export function DuplicateFileRow({
  file,
  selected,
  keeper,
  onToggle
}: {
  file: DuplicateFileInfo
  selected: boolean
  keeper: boolean
  onToggle: () => void
}): JSX.Element {
  const openFile = (): void => void window.velofind.openFile(file.path)
  const showInFolder = (): void => void window.velofind.showInFolder(file.path)
  const copyPath = (): void =>
    void window.velofind.copyPath(file.path).then((r) => {
      void r
    })

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all ${
        selected
          ? 'border-danger/45 bg-danger/[0.06]'
          : keeper
            ? 'border-accent/40 bg-accent/[0.05]'
            : 'border-edge bg-panel-2 hover:border-primary/30'
      }`}
    >
      {/* مربع التحديد — محجوب إذا كان سيؤدي لتحديد كل النسخ */}
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        title={S.duplicates.selectForDelete}
        className="h-4 w-4 shrink-0 cursor-pointer accent-danger"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-ink">{file.name}</span>
          {keeper && <span className="badge bg-accent/15 text-accent-700">الأصل</span>}
          {selected && <span className="badge bg-danger/10 text-danger">{S.duplicates.selected}</span>}
        </div>
        <div dir="ltr" className="truncate font-mono text-[11px] text-muted" title={file.path}>
          {file.path}
        </div>
      </div>

      <div className="hidden shrink-0 text-end text-[11px] text-muted md:block">
        <div className="tabular-nums">{formatBytes(file.size)}</div>
        <div className="tabular-nums">{formatDate(file.modifiedAt)}</div>
      </div>

      <span className="badge shrink-0 bg-primary/10 text-primary">{file.drive}:</span>

      <div className="flex shrink-0 items-center gap-1">
        <IconButton title={S.duplicates.open} onClick={openFile}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 3v5h5" />
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          </svg>
        </IconButton>
        <IconButton title={S.duplicates.showInFolder} onClick={showInFolder}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
        </IconButton>
        <IconButton title={S.duplicates.copyPath} onClick={copyPath}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
        </IconButton>
      </div>
    </div>
  )
}

function IconButton({
  title,
  onClick,
  children
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition hover:bg-primary/10 hover:text-primary"
    >
      {children}
    </button>
  )
}
