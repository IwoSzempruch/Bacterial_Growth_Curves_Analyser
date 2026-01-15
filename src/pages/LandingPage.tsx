import { useApp } from '@/state/store'

const content = {
  en: {
    eyebrow: 'Laboratory-ready workspace',
    title: 'Bacterial Growth Curves Analyser',
    subtitle:
      'Upload absorbance data, flag blanks, smooth curves, and extract growth metrics without leaving the browser.',
    primaryCta: 'Start workflow',
    secondaryCta: 'See feature panels',
    features: [
      {
        id: 'samplesMapping',
        badge: '01 Import',
        title: 'Samples and metadata',
        description: 'Import spreadsheets, harmonise plate layouts, and color-code replicates for clarity.',
        tab: 'samplesMapping',
        tone: 'sunrise',
      },
      {
        id: 'plots',
        badge: '02 Quality',
        title: 'Raw data quality check',
        description: 'Overlay wells, catch outliers, and lock blank selections with instant visual feedback.',
        tab: 'plots',
        tone: 'sky',
      },
      {
        id: 'compiler',
        badge: '03 Smoothing',
        title: 'Curve smoothing toolkit',
        description: 'Blend rolling windows with Gaussian smoothing before passing values downstream.',
        tab: 'compiler',
        tone: 'mint',
      },
      {
        id: 'parameters',
        badge: '04 Outputs',
        title: 'Growth parameters and exports',
        description: 'Extract log-phase slopes, doubling times, and export tidy CSVs for reporting.',
        tab: 'parameters',
        tone: 'amber',
      },
    ],
    flow: [
      { title: 'Import', text: 'Handle absorbance or luminescence files from plate readers.' },
      { title: 'Assign & map', text: 'Map wells to samples with reusable color palettes.' },
      { title: 'Smooth', text: 'Apply blank correction and smoothing with guardrails.' },
      { title: 'Export', text: 'Deliver clean CSVs to downstream stats or notebooks.' },
    ],
  },
  pl: {
    eyebrow: 'Przestrzeń gotowa do pracy w laboratorium',
    title: 'Analizator krzywych wzrostu',
    subtitle:
      'Wgraj dane absorbancji, zaznacz blanki, wygładź krzywe i wyciągnij parametry wzrostu – bez opuszczania przeglądarki.',
    primaryCta: 'Uruchom workflow',
    secondaryCta: 'Zobacz panele funkcji',
    features: [
      {
        id: 'samplesMapping',
        badge: '01 Import',
        title: 'Próbki i metadane',
        description: 'Importuj arkusze, ustaw układ płytek i nadaj kolory seriom, aby łatwo je śledzić.',
        tab: 'samplesMapping',
        tone: 'sunrise',
      },
      {
        id: 'plots',
        badge: '02 Kontrola',
        title: 'Kontrola jakości surowych danych',
        description: 'Nakładaj wykresy dołków, wychwytuj wartości odstające i zapisuj blanki z podglądem.',
        tab: 'plots',
        tone: 'sky',
      },
      {
        id: 'compiler',
        badge: '03 Wygładzanie',
        title: 'Zestaw do wygładzania krzywych',
        description: 'Łącz okna kroczące z wygładzaniem Gaussa zanim przekażesz dane dalej.',
        tab: 'compiler',
        tone: 'mint',
      },
      {
        id: 'parameters',
        badge: '04 Wyniki',
        title: 'Parametry wzrostu i eksport',
        description: 'Wyciągaj nachylenia fazy log, czasy podwojenia i eksportuj czyste pliki CSV.',
        tab: 'parameters',
        tone: 'amber',
      },
    ],
    flow: [
      { title: 'Import', text: 'Obsługa plików z czytników płytek – absorbancja lub luminescencja.' },
      { title: 'Mapowanie', text: 'Przypisz dołki do próbek i zachowaj mapy do ponownego użycia.' },
      { title: 'Wygładzanie', text: 'Koryguj blanki i stosuj wygładzanie z kontrolą parametrów.' },
      { title: 'Eksport', text: 'Przekaż uporządkowane dane do analizy statystycznej lub notebooków.' },
    ],
  },
}

export default function LandingPage() {
  const setActiveTab = useApp((s) => s.setActiveTab)
  const language = useApp((s) => s.language)
  const t = content[language]

  return (
    <div className="landing">
      <div className="landing-shell">
        <div className="hero-panel panel">
          <p className="eyebrow">{t.eyebrow}</p>
          <h1>{t.title}</h1>
          <p className="hero-subtitle">{t.subtitle}</p>
          <div className="cta-buttons">
            <button className="cta-btn primary" onClick={() => setActiveTab('samplesMapping')}>
              {t.primaryCta}
            </button>
            <button className="cta-btn ghost" onClick={() => setActiveTab('analysis')}>
              {t.secondaryCta}
            </button>
          </div>
          <div className="hero-metrics">
            <div className="metric">
              <span className="metric-label">96-well</span>
              <span className="metric-value">Layouts</span>
            </div>
            <div className="metric">
              <span className="metric-label">QC</span>
              <span className="metric-value">Plots</span>
            </div>
            <div className="metric">
              <span className="metric-label">CSV</span>
              <span className="metric-value">Exports</span>
            </div>
          </div>
        </div>

        <div className="feature-grid">
          {t.features.map((feature, idx) => (
            <div key={feature.id} className={`feature-card panel tone-${feature.tone}`}>
              <div className="feature-head">
                <span className="pill">{feature.badge}</span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </div>
              <div className="feature-visual" aria-hidden="true">
                <div className="bars">
                  {Array.from({ length: 5 }).map((_, barIdx) => (
                    <span
                      key={barIdx}
                      className="bar"
                      style={{ animationDelay: `${(idx + barIdx) * 0.15}s` }}
                    />
                  ))}
                </div>
                <div className="sparkline">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </div>
              </div>
              <button className="cta-inline" onClick={() => setActiveTab(feature.tab)}>
                {language === 'pl' ? 'Przejdź do modułu' : 'Open module'}
              </button>
            </div>
          ))}
        </div>

        <div className="workflow-strip panel">
          {t.flow.map((step, i) => (
            <div key={step.title} className="flow-step">
              <div className="flow-index">0{i + 1}</div>
              <div>
                <div className="flow-title">{step.title}</div>
                <div className="flow-text">{step.text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
