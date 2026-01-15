import { useApp } from '@/state/store'

const tabs = [
  { id: 'home', labels: { en: 'Home', pl: 'Start' } },
  { id: 'samplesMapping', labels: { en: 'Setup', pl: 'Konfiguracja' } },
  { id: 'plots', labels: { en: 'Raw Data', pl: 'Dane surowe' } },
  { id: 'interactive', labels: { en: 'Blank Check', pl: 'Sprawdzenie blanku' } },
  { id: 'compiler', labels: { en: 'Curves Smoothing', pl: 'Wygladzanie krzywych' } },
  { id: 'parameters', labels: { en: 'Parameters', pl: 'Parametry' } },
]

function LogoMark() {
  return (
    <svg
      className="logo-mark"
      viewBox="0 0 256 256"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0f172a" />
          <stop offset="100%" stopColor="#1e293b" />
        </linearGradient>
        <linearGradient id="curveGrad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#22c55e" />
          <stop offset="50%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      <rect x="8" y="8" width="240" height="240" rx="56" fill="url(#bgGrad)" />
      <g stroke="#64748b" strokeWidth="4" strokeLinecap="round">
        <line x1="52" y1="204" x2="212" y2="204" />
        <line x1="52" y1="72" x2="52" y2="204" />
      </g>
      <g stroke="#1f2937" strokeWidth="2" opacity="0.6">
        <line x1="52" y1="172" x2="212" y2="172" />
        <line x1="52" y1="140" x2="212" y2="140" />
        <line x1="52" y1="108" x2="212" y2="108" />
      </g>
      <path
        d="M 56 198 C 80 196, 96 190, 110 178 C 128 162, 140 140, 152 124 C 170 100, 188 92, 212 92"
        fill="none"
        stroke="url(#curveGrad)"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <g fill="#e5e7eb" stroke="#0f172a" strokeWidth="2">
        <circle cx="72" cy="190" r="5" />
        <circle cx="96" cy="182" r="5" />
        <circle cx="120" cy="164" r="5" />
        <circle cx="144" cy="138" r="5" />
        <circle cx="172" cy="112" r="5" />
        <circle cx="200" cy="100" r="5" />
      </g>
      <text
        x="204"
        y="48"
        textAnchor="end"
        fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        fontSize="26"
        fontWeight="600"
        fill="#cbd5f5"
      >
        GCA
      </text>
      <g transform="rotate(-18 64 40)">
        <rect
          x="26"
          y="24"
          rx="10"
          ry="10"
          width="90"
          height="32"
          fill="#b91c1c"
          opacity="0.95"
        />
        <text
          x="71"
          y="46"
          textAnchor="middle"
          fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
          fontSize="18"
          fontWeight="700"
          fill="#ffffff"
        >
          DEMO
        </text>
      </g>
    </svg>
  )
}

export default function NavigationBar() {
  const activeTab = useApp((s) => (s.activeTab === 'logPhase' ? 'parameters' : s.activeTab))
  const setActiveTab = useApp((s) => s.setActiveTab)
  const language = useApp((s) => s.language)
  const setLanguage = useApp((s) => s.setLanguage)
  const theme = useApp((s) => s.theme)
  const toggleTheme = useApp((s) => s.toggleTheme)

  const themeLabel =
    theme === 'light'
      ? language === 'pl'
        ? 'Wlacz tryb nocny'
        : 'Enable night mode'
      : language === 'pl'
        ? 'Wlacz tryb dzienny'
        : 'Enable day mode'

  return (
    <header className="topbar">
      <div className="logo-area">
        <div className="logo-mark-wrap">
          <LogoMark />
        </div>
        <div>
          <div className="logo">Growth Curves Analyser Demo</div>
        </div>
      </div>
      <div className="nav" role="tablist" aria-label="Modules">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={activeTab === t.id ? 'active' : ''}
            onClick={() => setActiveTab(t.id)}
            aria-pressed={activeTab === t.id}
          >
            {t.labels[language]}
          </button>
        ))}
      </div>
      <div className="nav-utilities">
        <div className="language-toggle" role="group" aria-label="Language switch">
          <button
            className={language === 'en' ? 'active' : ''}
            onClick={() => setLanguage('en')}
            aria-pressed={language === 'en'}
          >
            EN
          </button>
          <button
            className={language === 'pl' ? 'active' : ''}
            onClick={() => setLanguage('pl')}
            aria-pressed={language === 'pl'}
          >
            PL
          </button>
        </div>
        <button className="mode-toggle" onClick={toggleTheme} aria-label={themeLabel}>
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
      </div>
    </header>
  )
}
