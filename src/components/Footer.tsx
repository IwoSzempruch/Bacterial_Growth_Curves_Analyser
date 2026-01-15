import { useMemo } from 'react'
import { useApp } from '@/state/store'

const copy = {
  en: {
    headline: 'End-to-end growth curve workflow.',
    contact: 'Support: microbiology@labtools.dev',
    version: 'Build crafted for repeatable lab runs.',
  },
  pl: {
    headline: 'Kompletny workflow do krzywych wzrostu.',
    contact: 'Wsparcie: microbiology@labtools.dev',
    version: 'Wersja przygotowana do powtarzalnych analiz.',
  },
}

export default function Footer() {
  const language = useApp((s) => s.language)
  const year = useMemo(() => new Date().getFullYear(), [])
  const t = copy[language]

  return (
    <footer className="footer">
      <div className="footer-brand">
        <div className="logo">Bacterial Growth Curves</div>
        <p>{t.headline}</p>
      </div>
      <div className="footer-meta">
        <span>{t.version}</span>
        <span>{t.contact}</span>
        <span>&copy; {year}</span>
      </div>
    </footer>
  )
}
