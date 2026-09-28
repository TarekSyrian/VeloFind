/** شعار VeloFind: عدسة بحث بداخلها ملفان متداخلان وعلامة برق — PRD §30 */
export function Logo({ size = 28 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="vf-g1" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7C82EC" />
          <stop offset="1" stopColor="#5B5FEF" />
        </linearGradient>
      </defs>
      <circle cx="28" cy="28" r="21" stroke="url(#vf-g1)" strokeWidth="5" fill="none" />
      <rect x="17" y="16" width="15" height="19" rx="2.5" fill="#9BA1F2" opacity="0.9" />
      <rect x="23" y="21" width="15" height="19" rx="2.5" fill="#21C7A8" />
      <path d="M38 26 L33 33 H37 L34 41 L42 31 H37.5 L40.5 26 Z" fill="#F0A202" />
      <path d="M43.5 43.5 L54 54" stroke="#474BD6" strokeWidth="6" strokeLinecap="round" />
    </svg>
  )
}
