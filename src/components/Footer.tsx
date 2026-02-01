import { useMemo } from 'react'
import { useApp } from '@/state/store'

const copy = {
  en: {
    headline: 'End-to-end growth curve workflow.',
    contact: 'Email: growthcurves.analyser@gmail.com',
    version: 'Demo v0.1.0',
    builtBy: 'App created by Iwo Szempruch',
    linkedin: 'LinkedIn',
    portfolio: 'GitHub Portfolio',
  },
  pl: {
    headline: 'Kompletny workflow do krzywych wzrostu.',
    contact: 'Email: growthcurves.analyser@gmail.com',
    version: 'Demo v0.1.0',
    builtBy: 'Aplikacja stworzona przez Iwo Szempruch',
    linkedin: 'LinkedIn',
    portfolio: 'Portfolio GitHub',
  },
}

const social = {
  linkedin: 'https://www.linkedin.com/in/iwoszempruch',
  portfolio: 'https://iwoszempruch.github.io/Portfolio/',
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
      <div className="footer-links">
        <span>{t.builtBy}</span>
        <a href={social.linkedin} target="_blank" rel="noreferrer noopener">
          {t.linkedin}
        </a>
        <a href={social.portfolio} target="_blank" rel="noreferrer noopener">
          {t.portfolio}
        </a>
      </div>
    </footer>
  )
}
