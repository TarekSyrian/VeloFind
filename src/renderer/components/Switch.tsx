/** مفتاح تبديل صغير للإعدادات */
export function Switch({
  checked,
  onChange,
  disabled
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="switch"
    />
  )
}
