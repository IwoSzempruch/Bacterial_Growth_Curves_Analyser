import { useEffect } from 'react'
import { useApp } from '@/state/store'

const content = {
  en: {
    eyebrow: null,
    title: 'Bacterial Growth Curves Analyser',
    subtitle:
      'While working with growth readers, different labs use varied devices that generate data in multiple file formats. Steps such as blank selection, curve smoothing, and log-phase detection can be done in different ways, and these differences may lead to conflicting conclusions. This program enables preliminary analysis of bacterial growth data from many file formats in line with current literature recommendations. To analyse your data, follow the instructions.',
    primaryCta: 'Start workflow',
    features: [
      {
        id: 'platePrep',
        badge: '01 Import',
        title: 'How to prepare a plate for the reader?',
        description: 'Description coming soon.',
        articleUrl: null,
        tone: 'sunrise',
      },
      {
        id: 'blankChoice',
        badge: '02 Quality',
        title: 'Which data should be used as blank?',
        description: 'Description coming soon.',
        articleUrl: null,
        tone: 'sky',
      },
      {
        id: 'logPhase',
        badge: '03 Smoothing',
        title: 'How to determine the log phase and smooth curves?',
        description: 'Description coming soon.',
        articleUrl: null,
        tone: 'mint',
      },
      {
        id: 'bioParams',
        badge: '04 Parameters',
        title: 'How to calculate biological parameters from growth curves?',
        description: 'Description coming soon.',
        articleUrl: null,
        tone: 'sunrise',
      },
      {
        id: 'literature',
        badge: '05 Outputs',
        title: 'Literature',
        description: 'Links coming soon.',
        articleUrl: null,
        tone: 'amber',
      },
    ],
  },
  pl: {
    eyebrow: null,
    title: 'Analizator krzywych wzrostu',
    subtitle:
      'Podczas pracy z czytnikami wzrostu różne laboratoria używają różnych urządzeń, które wytwarzają dane w różnych formatach plików. Kolejne kroki analizy np. wyznaczenie blank, wygładzenie wykresów, wyznaczenie fazy logarytmicznej mogą być przeprowadzone różnymi sposobami, a różnice w kolejnych krokach postępowania mogą doprowadzić do sprzecznych wniosków. Ten program ma za zadanie umożliwienie wstępnej analizy danych wzrostu bakterii z wielu formatów plików w sposób zgodny z aktualnymi zaleceniami w literaturze.\nAby przeanalizować swoje dane podążaj za instrukcjami.',
    primaryCta: 'Uruchom workflow',
    features: [
      {
        id: 'platePrep',
        badge: '01 Import',
        title: 'Jak przygotować płytkę do czytnika?',
        description: 'Opis w przygotowaniu.',
        articleUrl: null,
        tone: 'sunrise',
      },
      {
        id: 'blankChoice',
        badge: '02 Kontrola',
        title: 'Jakie dane wybrać na blank?',
        description: 'Opis w przygotowaniu.',
        articleUrl: null,
        tone: 'sky',
      },
      {
        id: 'logPhase',
        badge: '03 Wygładzanie',
        title: 'Jak wyznaczyć fazę logarytmiczną i jak wygładzić krzywe wykresów?',
        description: 'Opis w przygotowaniu.',
        articleUrl: null,
        tone: 'mint',
      },
      {
        id: 'bioParams',
        badge: '04 Parametry',
        title: 'Jak obliczyć biologiczne parametry z krzywych wzrostu?',
        description: 'Opis w przygotowaniu.',
        articleUrl: null,
        tone: 'sunrise',
      },
      {
        id: 'literature',
        badge: '05 Wyniki',
        title: 'Literatura',
        description: 'Linki w przygotowaniu.',
        articleUrl: null,
        tone: 'amber',
      },
    ],
  },
}

export default function LandingPage() {
  const setActiveTab = useApp((s) => s.setActiveTab)
  const language = useApp((s) => s.language)
  const t = content[language]

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [])

  return (
    <div className="landing">
      <div className="landing-shell">
        <div className="hero-panel panel">
          <div className="hero-content">
            {t.eyebrow && <p className="eyebrow">{t.eyebrow}</p>}
            <h1>{t.title}</h1>
            <p className="hero-subtitle">{t.subtitle}</p>
          </div>
          <div className="hero-cta-rail">
            <div className="cta-buttons">
              <button className="cta-btn primary" onClick={() => setActiveTab('samplesMapping')}>
                {t.primaryCta}
              </button>
            </div>
          </div>
        </div>

        <div className="feature-grid">
          {t.features.map((feature, idx) => (
            <div key={feature.id} className={`feature-card panel tone-${feature.tone}`}>
              <div className="feature-head">
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
              <button
                className="cta-inline"
                onClick={() => feature.articleUrl && window.open(feature.articleUrl, '_blank')}
                disabled={!feature.articleUrl}
              >
                {language === 'pl'
                  ? feature.articleUrl
                    ? 'Przejdź do artykułu'
                    : 'Artykuł w przygotowaniu'
                  : feature.articleUrl
                    ? 'Open article'
                    : 'Article coming soon'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
