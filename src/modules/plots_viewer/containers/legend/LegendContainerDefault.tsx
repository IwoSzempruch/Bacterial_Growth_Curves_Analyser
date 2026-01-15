import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, Dispatch, SetStateAction } from 'react'
import { useMeasuredWidth } from '../../hooks/useMeasuredWidth'
import {
  AXIS_HORIZONTAL_PADDING,
  LEGEND_CONTENT_MIN,
  LEGEND_CONTENT_MAX,
  CHIP_HORIZONTAL_PADDING,
  CHIP_VERTICAL_PADDING,
  CHIP_BORDER,
  CHIP_SWATCH_BASE,
  CHIP_SWATCH_RADIUS_BASE,
  CHIP_GAP_INNER_BASE,
  CHIPS_GAP_BETWEEN_BASE,
  BELOW_HARD_MIN,
  APPROX_CHAR_WIDTH_BASE,
} from '../../constants'
import type { LegendBoxSize, LegendPlacement, LegendPosition, LegendSection } from '../../types'

// Default legend container plugged into CombinedPlotsContainerDefault.tsx.
// To add another legend layout, place a component under src/modules/plots_viewer/containers/legend and export it via index.ts.

export type LegendContainerDefaultProps = {
  variant: LegendPlacement
  activePlacement: LegendPlacement
  sections: LegendSection[]
  isVisible: boolean
  legendTitle: string
  legendContentScale: number
  legendOpacity: number
  legendBoxSize: LegendBoxSize
  setLegendBoxSize: Dispatch<SetStateAction<LegendBoxSize>>
  insideLegendPos: LegendPosition
  setInsideLegendPos: Dispatch<SetStateAction<LegendPosition>>
}

function estimateTextWidth(text: string, fontScale: number): number {
  return Math.ceil(text.length * APPROX_CHAR_WIDTH_BASE * fontScale)
}

function estimateReplicateTileWidth(label: string, fontScale: number): number {
  const sw = Math.max(8, Math.round(CHIP_SWATCH_BASE * fontScale))
  const gapInner = Math.max(2, Math.round(CHIP_GAP_INNER_BASE))
  const labelW = estimateTextWidth(label, fontScale)
  return sw + gapInner + labelW
}

export function LegendContainerDefault({
  variant,
  activePlacement,
  sections,
  isVisible,
  legendTitle,
  legendContentScale,
  legendOpacity,
  legendBoxSize,
  setLegendBoxSize,
  insideLegendPos,
  setInsideLegendPos,
}: LegendContainerDefaultProps) {
  const legendPlacement = activePlacement

  const preparedSections = useMemo(() => sections, [sections])

  if (!isVisible || !preparedSections.length) return null

  function LegendContent() {
    const { ref } = useMeasuredWidth<HTMLDivElement>()
    const contentRef = useRef<HTMLDivElement | null>(null)
    const [fitScale, setFitScale] = useState(legendContentScale)

    useEffect(() => { setFitScale(legendContentScale) }, [legendContentScale])

    const minAllowedBelowHeightRef = useRef<number>(10)

    useLayoutEffect(() => {
      const el = contentRef.current
      if (!el) return

      const neededW = Math.ceil(el.scrollWidth)
      const neededH = Math.ceil(el.scrollHeight)

      setLegendBoxSize(prev => {
        if (legendPlacement === 'right') {
          const cur = prev.right
          const w = Math.max(cur.w, neededW)
          return w !== cur.w ? { ...prev, right: { w, h: cur.h } } : prev
        }
        if (legendPlacement === 'below') {
          return prev
        }
        const cur = prev.inside
        const w = Math.max(cur.w, neededW)
        const h = Math.max(cur.h, neededH)
        return (w !== cur.w || h !== cur.h) ? { ...prev, inside: { w, h } } : prev
      })
    }, [preparedSections, legendContentScale, legendTitle, legendPlacement, setLegendBoxSize])

    const fontScaleLegend = Math.max(LEGEND_CONTENT_MIN, Math.min(LEGEND_CONTENT_MAX, fitScale))

    const headerFontSize = Math.round(14 * fontScaleLegend)
    const countFontSize = Math.max(8, Math.round(11 * fontScaleLegend))
    const labelFontSize = Math.max(8, Math.round(12 * fontScaleLegend))
    const swatchSize = Math.max(6, Math.round(CHIP_SWATCH_BASE * fontScaleLegend))
    const swatchRadius = Math.max(1, Math.round(CHIP_SWATCH_RADIUS_BASE * fontScaleLegend))
    const headerGap = Math.max(4, Math.round(6))

    const chipsRowStyle: CSSProperties = {
      display: 'flex',
      justifyContent: 'space-evenly',
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignContent: 'space-evenly',
      gap: 8,
    }

    const padLR = Math.round(CHIP_HORIZONTAL_PADDING * fontScaleLegend)
    const padTB = Math.round(CHIP_VERTICAL_PADDING * fontScaleLegend)

    const chips = preparedSections.map(section => {
      const header = section.sample
      const repLabels = section.replicates.map(r => r.label)

      const perTileGap = Math.max(2, Math.round(CHIPS_GAP_BETWEEN_BASE))
      const replicatesWidth =
        repLabels.map(l => estimateReplicateTileWidth(l, fontScaleLegend)).reduce((a, b) => a + b, 0) +
        (repLabels.length > 1 ? perTileGap * (repLabels.length - 1) : 0)

      const chipInner =
        estimateTextWidth(header, fontScaleLegend) +
        (repLabels.length ? headerGap + replicatesWidth : 0)

      const chipWidth = Math.max(0, chipInner + padLR * 2 + (CHIP_BORDER * 2))

      return { section, chipWidth }
    })

    const containerStyle: CSSProperties = {
      resize: 'none',
      overflow: 'visible',
      background: `rgba(255,255,255,${legendOpacity})`,
      border: '1px solid rgba(0,0,0,0.12)',
      borderRadius: 10,
      padding: 8,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      minWidth: 0,
      position: 'relative',
    }

    const boxSize = legendPlacement === 'right'
      ? legendBoxSize.right
      : legendPlacement === 'below'
      ? legendBoxSize.below
      : legendBoxSize.inside

    const setBoxSizeLocal = (next: { w?: number; h?: number }) => {
      setLegendBoxSize(prev => {
        const cur = legendPlacement === 'right' ? prev.right : legendPlacement === 'below' ? prev.below : prev.inside
        const w = Math.max(160, next.w ?? cur.w)
        const h = Math.max(50, next.h ?? cur.h)
        if (legendPlacement === 'right') return { ...prev, right: { w, h } }
        if (legendPlacement === 'below') {
          const clampH = Math.max(minAllowedBelowHeightRef.current, h)
          return { ...prev, below: { w, h: clampH } }
        }
        return { ...prev, inside: { w, h } }
      })
    }

    const onResizeRightMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      const startX = e.clientX
      const startW = boxSize.w
      const onMove = (ev: MouseEvent) => setBoxSizeLocal({ w: startW + (ev.clientX - startX) })
      const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }

    const onResizeBottomMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      const startY = e.clientY
      const startH = boxSize.h
      const onMove = (ev: MouseEvent) => {
        const rawH = startH + (ev.clientY - startY)
        const h = Math.max(BELOW_HARD_MIN, minAllowedBelowHeightRef.current, rawH)
        setBoxSizeLocal({ h })
      }
      const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }

    const onMouseDownDrag = (e: React.MouseEvent<HTMLDivElement>) => {
      if (legendPlacement !== 'inside') return
      e.preventDefault()
      const start = { x: e.clientX, y: e.clientY }
      const startPos = { ...insideLegendPos }
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - start.x
        const dy = ev.clientY - start.y
        setInsideLegendPos({ x: Math.max(0, startPos.x + dx), y: Math.max(0, startPos.y + dy) })
      }
      const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }

    useLayoutEffect(() => {
      const boxEl = ref.current as HTMLDivElement | null
      const el = contentRef.current
      if (!boxEl || !el) return

      if (legendPlacement === 'below') {
        const minAllowedEst = Math.ceil(
          el.scrollHeight * (LEGEND_CONTENT_MIN / Math.max(1e-6, fontScaleLegend))
        )
        minAllowedBelowHeightRef.current = Math.max(BELOW_HARD_MIN, minAllowedEst)
      }

      const availW = legendPlacement === 'right' ? boxSize.w : boxEl.clientWidth
      const availH = legendPlacement === 'below'
        ? legendBoxSize.below.h
        : legendPlacement === 'inside'
        ? legendBoxSize.inside.h
        : Number.POSITIVE_INFINITY

      let scale = Math.min(LEGEND_CONTENT_MAX, fitScale)

      for (let i = 0; i < 16; i++) {
        const needW = el.scrollWidth
        const needH = el.scrollHeight
        const overW = needW > availW + 0.5
        const overH = needH > availH + 0.5
        if (!overW && !overH) break
        const kW = overW ? availW / Math.max(1, needW) : 1
        const kH = overH ? availH / Math.max(1, needH) : 1
        const k = Math.min(kW, kH) * 0.98
        const next = Math.max(LEGEND_CONTENT_MIN, scale * k)
        if (Math.abs(next - scale) < 0.01) { scale = next; break }
        scale = next
      }

      if (scale !== fitScale) setFitScale(scale)
    }, [
      preparedSections,
      legendPlacement,
      legendBoxSize.right.w,
      legendBoxSize.below.h,
      legendBoxSize.inside.w,
      legendBoxSize.inside.h,
      fitScale,
      fontScaleLegend,
      setLegendBoxSize,
    ])

    return (
      <div
        ref={ref}
        style={{
          ...containerStyle,
          width: legendPlacement === 'right' ? boxSize.w : '100%',
          height: legendPlacement === 'below' ? boxSize.h : 'auto',
          overflow: legendPlacement === 'below' ? 'hidden' : 'visible',
        }}
      >
        <div
          onMouseDown={onMouseDownDrag}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: legendPlacement === 'inside' ? 'grab' : 'default', userSelect: 'none' }}
        >
          <strong style={{ fontSize: `${headerFontSize}px` }}>{legendTitle.trim() || 'Legend'}</strong>
          <span className='small' style={{ fontSize: `${countFontSize}px` }}>
            {preparedSections.reduce((total, section) => total + section.replicates.length, 0)}
          </span>
        </div>

        {(legendPlacement === 'right' || legendPlacement === 'inside') && (
          <div
            onMouseDown={onResizeRightMouseDown}
            style={{ position:'absolute', right:0, top:0, bottom:0, width:6, cursor:'ew-resize' }}
          />
        )}

        {(legendPlacement === 'below' || legendPlacement === 'inside') && (
          <div
            onMouseDown={onResizeBottomMouseDown}
            style={{ position:'absolute', left:0, right:0, bottom:0, height:6, cursor:'ns-resize' }}
          />
        )}

        <div ref={contentRef} style={chipsRowStyle}>
          {chips.map(({ section, chipWidth }) => (
            <div
              key={section.sample}
              style={{
                border: '1px solid rgba(0,0,0,0.08)',
                borderRadius: 8,
                padding: `${padTB}px ${padLR}px`,
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: headerGap,
                minWidth: Math.max(96, Math.round(140 * fontScaleLegend)),
                background: 'rgba(255,255,255,0.7)',
                whiteSpace: 'nowrap',
                flex: `0 1 ${Math.max(110, Math.min(560, chipWidth))}px`,
              }}
            >
              <strong style={{ fontSize: `${labelFontSize}px` }}>
                {section.sample}
              </strong>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: Math.max(3, Math.round(CHIPS_GAP_BETWEEN_BASE)), minWidth: 0 }}>
                {section.replicates.map((entry) => (
                  <span
                    key={entry.key}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: Math.max(2, Math.round(CHIP_GAP_INNER_BASE)), fontSize: `${labelFontSize}px`, whiteSpace: 'nowrap' }}
                  >
                    <span style={{ width: swatchSize, height: swatchSize, borderRadius: swatchRadius, background: entry.color }} />
                    <span>{entry.label}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const wrapperStyleBelow: CSSProperties = { marginTop: 10, display: 'flex', justifyContent: 'center' }
  const wrapperInnerBelow: CSSProperties = { width: '100%', maxWidth: `calc(100% - ${AXIS_HORIZONTAL_PADDING}px)` }

  if (variant === 'inside') return <LegendContent />
  if (variant === 'right') return <LegendContent />
  return (
    <div style={wrapperStyleBelow}>
      <div style={wrapperInnerBelow}>
        <LegendContent />
      </div>
    </div>
  )
}
