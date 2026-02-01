import { useState, useCallback } from 'react'
import { useApp } from '@/state/store'

export default function FeedbackBubble() {
  const language = useApp((s) => s.language)
  const isPl = language === 'pl'
  const [showFeedback, setShowFeedback] = useState(false)
  const [copyHint, setCopyHint] = useState<string | null>(null)
  const emailAddress = 'growthcurves.analyser@gmail.com'

  const copyToClipboard = useCallback(
    (text: string, label: string) => {
      try {
        if (navigator?.clipboard?.writeText) {
          void navigator.clipboard.writeText(text)
        } else {
          const ta = document.createElement('textarea')
          ta.value = text
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
        }
        setCopyHint(isPl ? `${label} skopiowano` : `${label} copied`)
      } catch (e) {
        setCopyHint(isPl ? 'Nie udało się skopiować' : 'Copy failed')
      } finally {
        setTimeout(() => setCopyHint(null), 2000)
      }
    },
    [isPl]
  )

  return (
    <div className={`feedback-bubble ${showFeedback ? 'open' : ''}`}>
      <button
        type="button"
        className="feedback-bubble__btn"
        aria-label={isPl ? 'Zgłoś uwagi' : 'Send feedback'}
        onClick={() => setShowFeedback((v) => !v)}
      >
        <span className="typing-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>
      {showFeedback && (
        <div className="feedback-bubble__popover">
          <p className="small" style={{ margin: 0 }}>
            {isPl
              ? 'W przypadku błędów, zastrzeżeń lub sugestii wyślij proszę maila na'
              : 'If you spot an error or have suggestions, please email'}
            {' '}
            <button
              type="button"
              className="link-btn"
              onClick={() => copyToClipboard(emailAddress, isPl ? 'Email' : 'Email')}
            >
              {emailAddress}
            </button>
            .
          </p>
          {copyHint && <div className="small" style={{ marginTop: 4 }}>{copyHint}</div>}
        </div>
      )}
    </div>
  )
}
