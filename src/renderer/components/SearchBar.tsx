import { useAppStore } from '@renderer/stores/app-store'
import { formatBytes, formatNumber, fileKindLabel } from '@renderer/utils/format'
import { S } from '@renderer/i18n/strings'

/**
 * مربع البحث الرئيسي — PRD §19
 * يدعم: نص حر، ext:، size:>N، path:، name:، modified:، duplicate، *.jpg
 */
export function SearchBar(): JSX.Element {
  const { query, results, total, tookMs, searching } = useAppStore((s) => s.search)
  const runSearch = useAppStore((s) => s.runSearch)
  const clearSearch = useAppStore((s) => s.clearSearch)
  const setPage = useAppStore((s) => s.setPage)

  return (
    <div className="relative">
      <div className="relative flex items-center">
        <span className="pointer-events-none absolute inset-y-0 start-4 flex items-center text-muted">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </span>
        <input
          value={query}
          onChange={(e) => runSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') clearSearch()
          }}
          placeholder={S.home.searchPlaceholder}
          className="input !rounded-2xl !py-3.5 !ps-12 !pe-10 text-[15px] shadow-card"
          spellCheck={false}
        />
        {query && (
          <button
            onClick={clearSearch}
            className="absolute inset-y-0 end-3 my-auto flex h-7 w-7 items-center justify-center rounded-lg text-muted transition hover:bg-edge hover:text-ink"
          >
            ✕
          </button>
        )}
      </div>

      {(searching || (results && results.length > 0) || (query && !searching && results?.length === 0)) && (
        <div className="card absolute inset-x-0 top-full z-30 mt-2 max-h-[420px] overflow-y-auto p-2 shadow-pop animate-fade-up">
          {searching && <div className="px-3 py-2 text-xs text-muted">{S.home.searching}</div>}

          {!searching && results?.length === 0 && (
            <div className="px-3 py-3 text-sm text-muted">{S.home.noResults}</div>
          )}

          {results?.map((file) => (
            <button
              key={file.id}
              onClick={() => void window.velofind.openFile(file.path)}
              className="group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start transition hover:bg-panel-2"
            >
              <span className="badge shrink-0 bg-primary/10 text-primary">{fileKindLabel(file.extension)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{file.name}</span>
                <span dir="ltr" className="block truncate font-mono text-[11px] text-muted">
                  {file.path}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted tabular-nums">
                {formatBytes(file.size)}
                {file.inDuplicateGroup && (
                  <span className="badge ms-2 bg-warning/15 text-warning-600">مكرر</span>
                )}
              </span>
            </button>
          ))}

          {!searching && results && results.length > 0 && (
            <div className="flex items-center justify-between border-t border-edge px-3 pt-2 mt-1 text-[11px] text-muted">
              <span>
                {formatNumber(total)} نتيجة · {formatNumber(tookMs)} م.ث
              </span>
              <button
                className="font-semibold text-primary hover:underline"
                onClick={() => setPage('duplicates')}
              >
                عرض المكررات ←
              </button>
            </div>
          )}
        </div>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        أمثلة: <span className="kbd">invoice</span> <span className="kbd">*.jpg</span>{' '}
        <span className="kbd">ext:mp4</span> <span className="kbd">size:&gt;100MB</span>{' '}
        <span className="kbd">path:C:\Users</span> <span className="kbd">duplicate</span>
      </p>
    </div>
  )
}
