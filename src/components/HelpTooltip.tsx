import { useLayoutEffect, useRef, useState, useEffect, ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Pos = { top: number; left: number }

function pickPosition(anchor: DOMRect, tip: DOMRect, margin = 8): Pos {
  const vw = window.innerWidth
  const vh = window.innerHeight

  const clamp = (val: number, max: number) => Math.max(margin, Math.min(val, max - margin))

  const candidates: Pos[] = [
    { top: anchor.bottom + margin, left: clamp(anchor.left, vw - tip.width) }, // below
    { top: anchor.top - tip.height - margin, left: clamp(anchor.left, vw - tip.width) }, // above
    { top: clamp(anchor.top, vh - tip.height), left: anchor.right + margin }, // right
    { top: clamp(anchor.top, vh - tip.height), left: anchor.left - tip.width - margin }, // left
  ]

  const fits = (p: Pos) =>
    p.left >= margin &&
    p.top >= margin &&
    p.left + tip.width <= vw - margin &&
    p.top + tip.height <= vh - margin

  for (const pos of candidates) {
    if (fits(pos)) return pos
  }

  // fallback: clamp below
  return {
    top: clamp(anchor.bottom + margin, vh - tip.height),
    left: clamp(anchor.left, vw - tip.width),
  }
}

export function HelpTooltip({
  anchorRef,
  open,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement>
  open: boolean
  children: ReactNode
}) {
  const tipRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<Pos | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const anchor = anchorRef.current
    const tip = tipRef.current
    if (!anchor || !tip) return
    const anchorRect = anchor.getBoundingClientRect()
    const tipRect = tip.getBoundingClientRect()
    setPos(pickPosition(anchorRect, tipRect))
  }, [open, anchorRef])

  useEffect(() => {
    if (!open) return
    const onResize = () => {
      const anchor = anchorRef.current
      const tip = tipRef.current
      if (!anchor || !tip) return
      setPos(pickPosition(anchor.getBoundingClientRect(), tip.getBoundingClientRect()))
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, true)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize, true)
    }
  }, [open, anchorRef])

  if (!open) return null

  return createPortal(
    <div
      ref={tipRef}
      className="help-tooltip"
      style={{
        position: 'fixed',
        top: pos ? pos.top : -9999,
        left: pos ? pos.left : -9999,
        opacity: pos ? 1 : 0,
        pointerEvents: pos ? 'auto' : 'none',
        zIndex: 2000,
      }}
    >
      {children}
    </div>,
    document.body
  )
}
