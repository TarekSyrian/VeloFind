import { useEffect, useState } from 'react'
import { APP_NAME, APP_VERSION } from '@shared/constants'
import { Logo } from './Logo'
import { S } from '@renderer/i18n/strings'

/** شريط عنوان مخصص — أزرار التحكم بنمط Windows مع منطقة سحب */
export function TitleBar(): JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const unsubscribe = window.velofind.onWindowState((state) => setMaximized(state.maximized))
    return unsubscribe
  }, [])

  return (
    <header className="drag-region flex h-10 shrink-0 items-center justify-between border-b border-edge bg-panel pr-3">
      <div dir="ltr" className="flex items-center gap-2">
        <Logo size={20} />
        <span className="text-sm font-bold text-ink">{APP_NAME}</span>
        <span className="badge bg-primary/10 text-primary">{APP_VERSION}</span>
      </div>
      <div dir="ltr" className="flex h-full">
        <WindowButton label="—" onClick={() => window.velofind.minimize()} />
        <WindowButton label={maximized ? '❐' : '□'} onClick={() => window.velofind.toggleMaximize()} />
        <WindowButton danger label="✕" onClick={() => window.velofind.closeWindow()} />
      </div>
      <span className="sr-only">{S.app.tagline}</span>
    </header>
  )
}

function WindowButton({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`no-drag flex h-full w-11 items-center justify-center text-sm transition-colors ${
        danger ? 'hover:bg-danger hover:text-white' : 'hover:bg-edge text-muted'
      }`}
    >
      {label}
    </button>
  )
}
