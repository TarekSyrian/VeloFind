import { useState } from 'react'
import { useAppStore } from '@renderer/stores/app-store'
import { Switch } from '@renderer/components/Switch'
import { playSound } from '@renderer/utils/sounds'
import { S } from '@renderer/i18n/strings'
import { APP_VERSION, DEFAULT_EXCLUDED_FOLDERS } from '@shared/constants'
import type { AppSettings } from '@shared/types'

/** صفحة الإعدادات — PRD §24 */
export function SettingsPage(): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const pushToast = useAppStore((s) => s.pushToast)
  const stats = useAppStore((s) => s.stats)
  const refreshStats = useAppStore((s) => s.refreshStats)
  const [clearing, setClearing] = useState(false)
  const [newFolder, setNewFolder] = useState('')

  if (!settings) return <div className="p-6 text-muted">…</div>

  const patch = (p: Partial<AppSettings>): void => void updateSettings(p)

  const addExcludedFolder = (): void => {
    const name = newFolder.trim().replace(/[/\\]+/g, '')
    if (!name) return
    const exists = settings.excludedFolders.some((f) => f.toLowerCase() === name.toLowerCase())
    if (exists) {
      pushToast('warning', 'المجلد مستثنى بالفعل', name)
      setNewFolder('')
      return
    }
    patch({ excludedFolders: [...settings.excludedFolders, name] })
    setNewFolder('')
  }

  const removeExcludedFolder = (name: string): void => {
    patch({ excludedFolders: settings.excludedFolders.filter((f) => f !== name) })
  }

  const pickQuarantine = async (): Promise<void> => {
    const folders = await window.velofind.pickFolders()
    if (folders.length > 0) patch({ quarantinePath: folders[0] })
  }

  const clearIndex = async (): Promise<void> => {
    if (!window.confirm(S.settings.clearIndexConfirm)) return
    setClearing(true)
    try {
      await window.velofind.clearIndex()
      await refreshStats()
      pushToast('success', 'تم مسح الفهرس', 'يمكنك بدء فحص جديد في أي وقت')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <h2 className="text-lg font-bold text-ink">{S.settings.title}</h2>

      {/* عام */}
      <Section title={S.settings.general}>
        <Row label={S.settings.theme}>
          <div className="flex gap-1.5">
            {(['light', 'dark', 'system'] as const).map((t) => (
              <span
                key={t}
                onClick={() => patch({ theme: t })}
                className={`chip ${settings.theme === t ? 'chip-active' : ''}`}
              >
                {t === 'light' ? S.settings.light : t === 'dark' ? S.settings.dark : S.settings.system}
              </span>
            ))}
          </div>
        </Row>
        <Row label={S.settings.language}>
          <span className="badge bg-primary/10 text-primary">{S.settings.arabic}</span>
        </Row>
        <Row label={S.settings.confirmOperations}>
          <Switch checked={settings.confirmOperations} onChange={(v) => patch({ confirmOperations: v })} />
        </Row>
        <Row label={S.settings.minimizeToTray}>
          <Switch checked={settings.minimizeToTray} onChange={(v) => patch({ minimizeToTray: v })} />
        </Row>
        <Row label={S.settings.launchOnStartup}>
          <Switch checked={settings.launchOnStartup} onChange={(v) => patch({ launchOnStartup: v })} />
        </Row>
      </Section>

      {/* الفهرسة */}
      <Section title={S.settings.indexing}>
        <Row label={S.settings.autoScanOnStart}>
          <Switch checked={settings.autoScanOnStart} onChange={(v) => patch({ autoScanOnStart: v })} />
        </Row>
        <Row label={S.settings.useUsnJournal} hint={S.settings.usnHint}>
          <Switch checked={settings.useUsnJournal} onChange={(v) => patch({ useUsnJournal: v })} />
        </Row>
        <Row label={S.settings.hashWorkers}>
          <input
            type="number"
            min={0}
            max={16}
            value={settings.hashWorkers}
            onChange={(e) => patch({ hashWorkers: Number(e.target.value) })}
            className="input w-24 text-center tabular-nums"
          />
        </Row>
        <Row label={S.settings.excludeSystemFolders}>
          <Switch checked={settings.excludeSystemFolders} onChange={(v) => patch({ excludeSystemFolders: v })} />
        </Row>
        <Row label={S.settings.includeHiddenFiles}>
          <Switch checked={settings.includeHiddenFiles} onChange={(v) => patch({ includeHiddenFiles: v })} />
        </Row>

        {/* المجلدات المستثناة — حقل قابل للتعديل */}
        <div className="mt-3 rounded-xl border border-edge bg-panel-2 p-4">
          <div className="mb-1 text-sm font-semibold text-ink">{S.settings.excludedFolders}</div>
          <div className="mb-3 text-[11px] leading-relaxed text-muted">{S.settings.excludedFoldersHint}</div>

          <div className="mb-3 flex items-center gap-2">
            <input
              dir="ltr"
              type="text"
              value={newFolder}
              placeholder={S.settings.excludedFoldersPlaceholder}
              onChange={(e) => setNewFolder(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addExcludedFolder()
              }}
              className="input flex-1 font-mono text-xs"
            />
            <button className="btn-primary btn-sm shrink-0" onClick={addExcludedFolder}>
              + {S.settings.excludedFoldersAdd}
            </button>
          </div>

          {settings.excludedFolders.length === 0 ? (
            <p className="rounded-lg bg-panel px-3 py-2.5 text-center text-[11px] text-muted">
              {S.settings.excludedFoldersEmpty}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {settings.excludedFolders.map((folder) => (
                <span
                  key={folder}
                  dir="ltr"
                  className="flex items-center gap-1.5 rounded-lg border border-edge bg-panel px-2.5 py-1 font-mono text-[11px] text-ink"
                >
                  {folder}
                  <button
                    className="text-muted transition hover:text-danger"
                    title={S.scan.remove}
                    onClick={() => removeExcludedFolder(folder)}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          <button
            className="btn-ghost btn-sm mt-3"
            onClick={() => patch({ excludedFolders: [...DEFAULT_EXCLUDED_FOLDERS] })}
          >
            ↺ {S.settings.excludedFoldersRestore}
          </button>
        </div>
      </Section>

      {/* الإشعارات والأصوات */}
      <Section title={S.settings.notifications}>
        <Row label={S.settings.notificationsEnabled} hint={S.settings.notificationsHint}>
          <Switch checked={settings.notificationsEnabled} onChange={(v) => patch({ notificationsEnabled: v })} />
        </Row>
        <Row label={S.settings.notificationSound} hint={S.settings.notificationSoundHint}>
          <div className="flex items-center gap-2">
            <button
              className="btn-ghost btn-sm"
              onClick={() => playSound('scan-done', true)}
              title={S.settings.soundTest}
            >
              ♪ {S.settings.soundTest}
            </button>
            <Switch checked={settings.notificationSound} onChange={(v) => patch({ notificationSound: v })} />
          </div>
        </Row>
      </Section>

      {/* الملفات */}
      <Section title={S.settings.files}>
        <Row label={S.settings.deleteMode}>
          <div className="flex gap-1.5">
            {(
              [
                ['recycle', S.settings.recycle],
                ['quarantine', S.settings.quarantine],
                ['permanent', S.settings.permanent]
              ] as const
            ).map(([key, label]) => (
              <span
                key={key}
                onClick={() => patch({ deleteMode: key })}
                className={`chip ${settings.deleteMode === key ? 'chip-active' : ''}`}
              >
                {label}
              </span>
            ))}
          </div>
        </Row>
        <Row label={S.settings.quarantinePath}>
          <div className="flex items-center gap-2">
            <span dir="ltr" className="max-w-64 truncate font-mono text-[11px] text-muted">
              {settings.quarantinePath || '(افتراضي داخل بيانات التطبيق)'}
            </span>
            <button className="btn-ghost btn-sm" onClick={() => void pickQuarantine()}>
              {S.settings.pickPath}
            </button>
          </div>
        </Row>
        <Row label={S.settings.recheckBeforeDelete}>
          <Switch checked={settings.recheckBeforeDelete} onChange={(v) => patch({ recheckBeforeDelete: v })} />
        </Row>
        <Row label={S.settings.minFileSize}>
          <input
            type="number"
            min={0}
            value={settings.minFileSize}
            onChange={(e) => patch({ minFileSize: Math.max(0, Number(e.target.value)) })}
            className="input w-28 text-center tabular-nums"
          />
        </Row>
      </Section>

      {/* حول */}
      <Section title={S.settings.about}>
        <Row label={S.settings.version}>
          <span className="text-sm font-semibold text-ink tabular-nums">VeloFind {APP_VERSION}</span>
        </Row>
        <Row label={S.settings.indexStore}>
          <span
            className={`badge ${stats?.indexStore === 'json' ? 'bg-warning/10 text-warning' : 'bg-accent/10 text-accent-700'}`}
            title={stats?.indexStore === 'json' ? S.settings.indexStoreJsonHint : undefined}
          >
            {stats?.indexStore === 'json' ? 'JSON ⚠' : 'SQLite'}
          </span>
        </Row>
        {stats?.indexStore === 'json' && (
          <p className="rounded-md bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">{S.settings.indexStoreJsonHint}</p>
        )}
        <Row label={S.settings.clearIndex}>
          <button className="btn-danger-outline btn-sm" disabled={clearing} onClick={() => void clearIndex()}>
            {clearing ? '…' : 'مسح'}
          </button>
        </Row>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="card p-5">
      <h3 className="mb-3 text-sm font-bold text-primary">{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl px-2 py-2.5 transition hover:bg-panel-2">
      <div className="min-w-0">
        <div className="text-sm text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
