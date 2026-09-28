import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@renderer/stores/app-store'
import { useScanStore, isScanActive } from '@renderer/stores/scan-store'
import { ScanProgress } from '@renderer/components/ScanProgress'
import { formatBytes, formatNumber } from '@renderer/utils/format'
import { S } from '@renderer/i18n/strings'
import type { FileCategory, SavedLocation, ScanMode } from '@shared/types'

/** صفحة إعداد وتشغيل الفحص — PRD §15 و§18 */
export function ScanPage(): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const pushToast = useAppStore((s) => s.pushToast)
  const phase = useScanStore((s) => s.phase)
  const warnings = useScanStore((s) => s.warnings)
  const start = useScanStore((s) => s.start)
  const done = useScanStore((s) => s.done)

  const [locations, setLocations] = useState<SavedLocation[]>([])
  const [mode, setMode] = useState<ScanMode>('accurate')
  const [category, setCategory] = useState<FileCategory>('all')
  const [minSize, setMinSize] = useState<number>(0)

  // الإعدادات تصل غير متزامنة عبر IPC — تُزامَن مرة واحدة عند وصولها،
  // وإلا بقيت القيم الافتراضية مجمّدة طوال الجلسة (الوضع والحد الأدنى للحجم)
  const settingsSynced = useRef(false)
  useEffect(() => {
    if (settingsSynced.current || !settings) return
    settingsSynced.current = true
    setMode(settings.scanModeDefault)
    setMinSize(settings.minFileSize)
  }, [settings])

  useEffect(() => {
    void window.velofind.listLocations().then(setLocations)
  }, [])

  const active = isScanActive(phase)
  const selectedLocations = locations.filter((l) => l.enabled && !l.excluded)

  const addFolder = async (): Promise<void> => {
    const folders = await window.velofind.pickFolders()
    if (folders.length === 0) return
    const existing = new Set(locations.map((l) => l.path.toLowerCase()))
    const additions = folders
      .filter((f) => !existing.has(f.toLowerCase()))
      .map((path) => ({ path, enabled: true, excluded: false }))
    const next = [...locations, ...additions]
    setLocations(next)
    await window.velofind.saveLocations(next)
  }

  const updateLocation = async (path: string, patch: Partial<SavedLocation>): Promise<void> => {
    const next = locations.map((l) => (l.path === path ? { ...l, ...patch } : l))
    setLocations(next)
    await window.velofind.saveLocations(next)
  }

  const removeLocation = async (path: string): Promise<void> => {
    const next = locations.filter((l) => l.path !== path)
    setLocations(next)
    await window.velofind.saveLocations(next)
  }

  const startScan = async (): Promise<void> => {
    if (selectedLocations.length === 0) {
      pushToast('warning', 'لا توجد مواقع محددة', 'فعّل مجلدًا واحدًا على الأقل')
      return
    }
    try {
      await start({
        locations: selectedLocations.map((l) => l.path),
        excludedFolderNames: settings?.excludedFolders ?? [],
        mode,
        minSize,
        category,
        extensions: [],
        includeHidden: settings?.includeHiddenFiles ?? false,
        excludeSystemFolders: settings?.excludeSystemFolders ?? true,
        incremental: true
      })
    } catch (error) {
      pushToast('error', 'تعذر بدء الفحص', (error as Error).message)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <h2 className="text-lg font-bold text-ink">{S.scan.title}</h2>

      {/* تقدم فحص نشط */}
      {active ? (
        <ScanProgress />
      ) : (
        <>
          {/* مواقع الفحص */}
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">{S.scan.locations}</h3>
              <button className="btn-primary btn-sm" onClick={() => void addFolder()}>
                + {S.scan.addFolder}
              </button>
            </div>

            {locations.length === 0 ? (
              <p className="rounded-xl bg-panel-2 px-4 py-6 text-center text-sm text-muted">{S.scan.noLocations}</p>
            ) : (
              <div className="space-y-1.5">
                {locations.map((loc) => (
                  <div
                    key={loc.path}
                    className="flex items-center gap-3 rounded-xl border border-edge bg-panel-2 px-3 py-2"
                  >
                    <span dir="ltr" className="min-w-0 flex-1 truncate font-mono text-xs text-ink" title={loc.path}>
                      {loc.path}
                    </span>
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted">
                      <input
                        type="checkbox"
                        checked={loc.enabled}
                        onChange={(e) => void updateLocation(loc.path, { enabled: e.target.checked })}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      {S.scan.enabled}
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted">
                      <input
                        type="checkbox"
                        checked={loc.excluded}
                        onChange={(e) => void updateLocation(loc.path, { excluded: e.target.checked })}
                        className="h-3.5 w-3.5 accent-warning"
                      />
                      {S.scan.excluded}
                    </label>
                    <button
                      className="text-muted transition hover:text-danger"
                      title={S.scan.remove}
                      onClick={() => void removeLocation(loc.path)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* وضع الفحص */}
          <section className="card p-5">
            <h3 className="mb-3 text-sm font-bold text-ink">{S.scan.mode}</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <ModeCard
                active={mode === 'quick'}
                title={S.scan.quick}
                desc={S.scan.quickDesc}
                onClick={() => setMode('quick')}
              />
              <ModeCard
                active={mode === 'accurate'}
                title={S.scan.accurate}
                desc={S.scan.accurateDesc}
                onClick={() => setMode('accurate')}
              />
            </div>

            {/* نوع الملفات */}
            <h3 className="mb-2 mt-5 text-sm font-bold text-ink">{S.scan.category}</h3>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ['all', S.scan.all],
                  ['images', S.scan.images],
                  ['video', S.scan.video],
                  ['audio', S.scan.audio],
                  ['documents', S.scan.documents]
                ] as Array<[FileCategory, string]>
              ).map(([key, label]) => (
                <span
                  key={key}
                  onClick={() => setCategory(key)}
                  className={`chip ${category === key ? 'chip-active' : ''}`}
                >
                  {label}
                </span>
              ))}
            </div>

            {/* الحد الأدنى للحجم */}
            <h3 className="mb-2 mt-5 text-sm font-bold text-ink">{S.scan.minSize}</h3>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  [0, 'بدون حد'],
                  [1024, '1 KB'],
                  [1024 ** 2, '1 MB'],
                  [10 * 1024 ** 2, '10 MB']
                ] as Array<[number, string]>
              ).map(([value, label]) => (
                <span key={value} onClick={() => setMinSize(value)} className={`chip ${minSize === value ? 'chip-active' : ''}`}>
                  {label}
                </span>
              ))}
            </div>
          </section>

          {/* زر البدء */}
          <div className="flex items-center gap-3">
            <button className="btn-primary px-6 py-2.5" disabled={selectedLocations.length === 0} onClick={() => void startScan()}>
              ▶ {S.scan.start}
            </button>
            <span className="text-xs text-muted">⚡ {S.scan.incrementalHint}</span>
          </div>

          {/* ملخص آخر فحص مكتمل */}
          {done && !active && (
            <section className="card p-5 text-sm">
              <h3 className="mb-2 font-bold text-ink">ملخص آخر فحص</h3>
              <div className="grid grid-cols-2 gap-2 text-xs lg:grid-cols-4">
                <Summary label={S.scan.summary.added} value={done.summary.added} />
                <Summary label={S.scan.summary.changed} value={done.summary.changed} />
                <Summary label={S.scan.summary.unchanged} value={done.summary.unchanged} />
                <Summary label={S.scan.summary.removed} value={done.summary.removed} />
              </div>
              <p className="mt-3 text-xs text-muted">
                المجموعات: {done.groups.length} — القابلة للاسترداد:{' '}
                <b className="text-accent-600">{formatBytes(done.stats.reclaimableBytes)}</b>
              </p>

              {/* ملفات لم تدخل المقارنة — سببها الوحيد لاختفاء مكرّات يظنّها المستخدم */}
              {warnings.length > 0 && (
                <details className="mt-3 rounded-xl border border-warning/40 bg-warning/5 px-4 py-2 text-xs">
                  <summary className="cursor-pointer font-semibold text-warning-600">
                    ⚠ {warnings.length} ملف لم تُقرأ أو لم تُستثنى من المقارنة — اضغط للعرض
                  </summary>
                  <ul dir="ltr" className="mt-2 max-h-48 space-y-1 overflow-y-auto font-mono text-[10px] text-muted">
                    {warnings.slice(0, 200).map((w, i) => (
                      <li key={`${w.path}-${i}`} className="truncate" title={w.message}>
                        {w.path}
                      </li>
                    ))}
                    {warnings.length > 200 && (
                      <li className="font-sans text-muted">… و{formatNumber(warnings.length - 200)} ملف آخر</li>
                    )}
                  </ul>
                </details>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function ModeCard({
  active,
  title,
  desc,
  onClick
}: {
  active: boolean
  title: string
  desc: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border p-4 text-start transition-all ${
        active ? 'border-primary bg-primary/[0.07] ring-2 ring-primary/25' : 'border-edge bg-panel-2 hover:border-primary/40'
      }`}
    >
      <div className={`text-sm font-bold ${active ? 'text-primary' : 'text-ink'}`}>
        {active ? '◉' : '○'} {title}
      </div>
      <div className="mt-1 text-xs leading-relaxed text-muted">{desc}</div>
    </button>
  )
}

function Summary({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="rounded-xl bg-panel-2 px-3 py-2">
      <div className="text-muted">{label}</div>
      <div className="font-bold text-ink tabular-nums">{value}</div>
    </div>
  )
}
