import { useRef, useState, type ReactNode } from 'react'

import { HelpTooltip } from './HelpTooltip'

type PanelWithHelpProps = {
  title: string
  helpContent: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
  actions?: ReactNode
}

export function PanelWithHelp({
  title,
  helpContent,
  children,
  className = '',
  contentClassName = '',
  actions,
}: PanelWithHelpProps) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement | null>(null)

  return (
    <div className={`panel ${className}`.trim()}>
      <div className="panel-heading with-help panel-heading--centered">
        <h3 className="panel-heading__title panel-heading__title--flush">
          {title}
        </h3>
        <div className="panel-heading__actions">
          {actions}
          <button
            ref={anchorRef}
            className="help-btn circle"
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle help"
          >
            ?
          </button>
        </div>
      </div>
      <HelpTooltip anchorRef={anchorRef} open={open}>
        {helpContent}
      </HelpTooltip>
      <div className={contentClassName}>{children}</div>
    </div>
  )
}
