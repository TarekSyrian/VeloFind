import { useMemo } from 'react'
import { useDuplicateStore } from '@renderer/stores/duplicate-store'
import { formatBytes } from '@renderer/utils/format'
import { S } from '@renderer/i18n/strings'

/** لوحة تصفية النتائج — PRD §18-19 */
export function FilterPanel({ drives, extensions }: { drives: string[]; extensions: string[] }): JSX.Element {
  const filters = useDuplicateStore((s) => s.filters)
  const setFilters = useDuplicateStore((s) => s.setFilters)
  const groups = useDuplicateStore((s) => s.groups)

  const topExts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const group of groups) {
      const ext = group.files[0]?.extension ?? ''
      counts.set(ext, (counts.get(ext) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([ext]) => ext)
      .filter(Boolean)
  }, [groups])

  return (
    <div className="card flex flex-wrap items-center gap-2.5 p-3">
      <input
        value={filters.text}
        onChange={(e) => setFilters({ text: e.target.value })}
        placeholder={S.duplicates.filter}
        className="input max-w-56 flex-1"
        spellCheck={false}
      />

      {topExts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {topExts.map((ext) => (
            <span
              key={ext}
              onClick={() =>
                setFilters({
                  text: filters.text === `ext:${ext}` ? '' : `ext:${ext}`
                })
              }
              className={`chip ${filters.text === `ext:${ext}` ? 'chip-active' : ''}`}
            >
              .{ext}
            </span>
          ))}
        </div>
      )}

      <select
        value={filters.drive}
        onChange={(e) => setFilters({ drive: e.target.value })}
        className="select w-auto min-w-24"
      >
        <option value="">{S.duplicates.allDrives}</option>
        {drives.map((drive) => (
          <option key={drive} value={drive}>
            {S.duplicates.drive} {drive}
          </option>
        ))}
      </select>

      <button
        onClick={() => setFilters({ crossDriveOnly: !filters.crossDriveOnly })}
        className={`chip ${filters.crossDriveOnly ? 'chip-active' : ''}`}
        title={S.duplicates.crossDriveHint}
      >
        ⇄ {S.duplicates.crossDriveOnly}
      </button>

      <select
        value={filters.minSize ?? ''}
        onChange={(e) => setFilters({ minSize: e.target.value === '' ? null : Number(e.target.value) })}
        className="select w-auto min-w-32"
      >
        <option value="">كل الأحجام</option>
        <option value={1024}>أكبر من 1 KB</option>
        <option value={1024 ** 2}>أكبر من 1 MB</option>
        <option value={10 * 1024 ** 2}>أكبر من 10 MB</option>
        <option value={100 * 1024 ** 2}>أكبر من 100 MB</option>
      </select>

      <select
        value={filters.sortKey}
        onChange={(e) => setFilters({ sortKey: e.target.value as typeof filters.sortKey })}
        className="select w-auto min-w-40"
      >
        <option value="reclaimed">{S.duplicates.sort.reclaimed}</option>
        <option value="size">{S.duplicates.sort.size}</option>
        <option value="count">{S.duplicates.sort.count}</option>
        <option value="path">{S.duplicates.sort.path}</option>
      </select>

      <button
        onClick={() => setFilters({ sortDir: filters.sortDir === 'desc' ? 'asc' : 'desc' })}
        className="btn-ghost btn-sm"
        title="اتجاه الترتيب"
      >
        {filters.sortDir === 'desc' ? '↓ تنازلي' : '↑ تصاعدي'}
      </button>

      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={filters.onlySelected}
          onChange={(e) => setFilters({ onlySelected: e.target.checked })}
          className="h-3.5 w-3.5 accent-primary"
        />
        {S.duplicates.onlySelected}
      </label>

      <span className="ms-auto text-xs text-muted tabular-nums">
        إجمالي الاسترداد المعروض:{' '}
        <b className="text-accent-600">
          {formatBytes(
            useDuplicateStore
              .getState()
              .filteredGroups()
              .reduce((sum, g) => sum + g.reclaimedBytes, 0)
          )}
        </b>
      </span>

      {/* امتدادات إضافية */}
      {extensions.length > 8 && <span className="hidden text-[10px] text-muted">+{extensions.length - 8}</span>}
    </div>
  )
}
