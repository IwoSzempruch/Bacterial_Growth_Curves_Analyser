import { useLayoutEffect, useRef, useState, useEffect, useMemo, useCallback } from 'react'

const DEFAULT_SELECTION_COLOR = '#000000'
const DEFAULT_SELECTION_HALO_OPACITY = 0.25

export interface SeriesPoint {
  x: number
  y: number
  id?: string
  meta?: Record<string, any>
}

export interface Series {
  name: string
  color: string
  points: SeriesPoint[]
}

type LegendEntry = {
  id: string
  label: string
  color: string
  hidden?: boolean
  kind?: 'series' | 'excluded'
}

export default function SimpleLineChart({
  series,
  bands,
  xBands,
  title,
  xLabel,
  yLabel,
  height = 320,
  fontScale = 1,
  legendMode = 'inline-top',
  highlightedNames = [],
  emphasizeSeriesNames = [],
  emphasizeStrokeWidth = 3.2,
  onLegendItemEnter,
  onLegendItemLeave,
  onLegendItemClick,
  titlePosition = 'top',
  aspect,
  minHeight = 320,
  maxHeight = 700,
  maxVh = 0.65,
  groupOrder,
  stdMode = 'area',
  enableZoom = true,
  onRequestTitleEdit,
  onRequestXLabelEdit,
  onRequestYLabelEdit,
  onSvgRef,
  pointMarkers = 'none',
  selectedPointIds,
  onPointClick,
  pointMarkerRadius = 4,
  pointFill = 'solid',
  defaultViewX,
  defaultViewY,
  minYLimit,
  maxYLimit,
  enablePan = true,
  pointSelectionMode = 'modifier',
  onPointSelection,
  mode = 'line',
  scatterSeries = [],
  scatterPointRadius,
  scatterOpacity = 0.9,
  minPanX,
  minPanY,
  resetViewKey,
  enableDoubleClickReset = true,
  legendEntries = [],
  showLegend = false,
  legendTitle,
  legendScale = 1,
}: {
  series: Series[]
  // Optional uncertainty bands per series (matched by name)
  bands?: { name: string; color: string; points: { x: number; low: number; high: number }[]; mode?: 'area' | 'errorbars' }[]
  // Optional background x-interval bands across full y-span
  xBands?: { start: number, end: number, color: string, opacity?: number, sample?: string, phase?: number }[]
  title?: string
  xLabel?: string
  yLabel?: string
  height?: number
  fontScale?: number
  // 'inline-top' replicates previous behavior; 'table-below' renders a grid under the chart; 'none' hides legend
  legendMode?: 'inline-top' | 'table-below' | 'none'
  highlightedNames?: string[]
  emphasizeSeriesNames?: string[]
  emphasizeStrokeWidth?: number
  onLegendItemEnter?: (name: string) => void
  onLegendItemLeave?: () => void
  onLegendItemClick?: (name: string) => void
  titlePosition?: 'top' | 'bottom' | 'hidden'
  // If provided, the chart height follows container width using width/aspect
  aspect?: number
  minHeight?: number
  maxHeight?: number
  // Max fraction of viewport height the chart can take
  maxVh?: number
  // Preferred order of grouped samples (legend)
  groupOrder?: string[]
  // How to render std: shaded area, errorbars or none
  stdMode?: 'area' | 'errorbars' | 'none'
  // Enable Shift + mouse wheel zoom (both axes)
  enableZoom?: boolean
  onRequestTitleEdit?: () => void
  onRequestXLabelEdit?: () => void
  onRequestYLabelEdit?: () => void
  onSvgRef?: (el: SVGSVGElement | null) => void
  pointMarkers?: 'none' | 'all'
  selectedPointIds?: string[]
  onPointClick?: (payload: {
    seriesName: string
    seriesIndex: number
    pointIndex: number
    point: SeriesPoint
    event: React.MouseEvent<SVGCircleElement, MouseEvent>
  }) => void
  pointMarkerRadius?: number
  pointFill?: 'solid' | 'outline'
  defaultViewX?: [number, number]
  defaultViewY?: [number, number]
  minYLimit?: number
  maxYLimit?: number
  enablePan?: boolean
  pointSelectionMode?: 'modifier' | 'immediate'
  onPointSelection?: (payload: {
    points: { seriesName: string; seriesIndex: number; pointIndex: number; point: SeriesPoint }[]
    event: React.MouseEvent<SVGSVGElement, MouseEvent>
  }) => void
  mode?: 'line' | 'scatter'
  scatterSeries?: Series[]
  scatterPointRadius?: number
  scatterOpacity?: number
  minPanX?: number
  minPanY?: number
  resetViewKey?: string | number
  enableDoubleClickReset?: boolean
  legendEntries?: LegendEntry[]
  showLegend?: boolean
  legendTitle?: string
  legendScale?: number
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({ width: 800, height: 800 })
  const [vh, setVh] = useState<number>(typeof window !== 'undefined' ? window.innerHeight : 800)
  const svgRef = useRef<SVGSVGElement | null>(null)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const updateSize = () => {
      setContainerSize({
        width: el.clientWidth || 800,
        height: el.clientHeight || 800,
      })
    }
    const ro = new ResizeObserver(updateSize)
    ro.observe(el)
    updateSize()
    const onResize = () => {
      setVh(window.innerHeight)
      updateSize()
    }
    window.addEventListener('resize', onResize)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [])

  // Extra top padding for title; legend (if below) is outside the SVG
  const width = containerSize.width
  const canvasPaddingAllowance = 8 // small buffer so SVG fits inside its container
  const availableHeight =
    containerSize.height > 0
      ? containerSize.height
      : Number.POSITIVE_INFINITY
  const byAspect = aspect ? Math.round(width / aspect) : height
  const byViewport = Math.round(vh * maxVh)
  const hasAvailableHeight = Number.isFinite(availableHeight) && availableHeight > 0
  const fallbackHeight = Math.max(minHeight, Math.min(maxHeight, Math.min(byAspect, byViewport)))
  // Use the container's measured height directly so the SVG never overflows and hides axes inside scrollable cards.
  // Fall back to the previous heuristic only when no reliable measurement is available.
  const computedH = hasAvailableHeight
    ? Math.min(maxHeight, availableHeight)
    : fallbackHeight
  const pad = { top: (titlePosition==='top' ? 44 : 24) * fontScale, right: 16, bottom: (titlePosition==='bottom' ? 56 : 44) * fontScale, left: Math.max(56, 56 * fontScale) }
  const innerW = Math.max(10, width - pad.left - pad.right)
  const innerH = Math.max(10, computedH - pad.top - pad.bottom)

  const scatterX = scatterSeries.flatMap(s => s.points.map(p => p.x))
  const scatterY = scatterSeries.flatMap(s => s.points.map(p => p.y))
  const allX = [
    ...series.flatMap(s => s.points.map(p => p.x)),
    ...scatterX,
  ]
  const allY = [
    ...series.flatMap(s => s.points.map(p => p.y)),
    ...scatterY,
    ...(bands?.flatMap(b => b.points.flatMap(p => [p.low, p.high])) ?? [])
  ]
  const dataMinX = allX.length ? Math.min(...allX) : 0
  const dataMaxX = allX.length ? Math.max(...allX) : 1
  const xClampMin = Math.min(minPanX ?? dataMinX, dataMinX)
  const spanX = Math.max(1, dataMaxX - dataMinX)
  const rightPad =
    Number.isFinite(dataMinX - xClampMin) && dataMinX - xClampMin > 0
      ? dataMinX - xClampMin
      : spanX * 0.25
  const xClampMax = dataMaxX + rightPad
  let dataMinY = allY.length ? Math.min(...allY) : 0
  let dataMaxY = allY.length ? Math.max(...allY) : 1
  if (allY.length) {
    const spanY = dataMaxY - dataMinY
    const padFactor = 0.12
    const padY = spanY > 0 ? spanY * padFactor : Math.max(Math.abs(dataMaxY), Math.abs(dataMinY), 1) * padFactor
    dataMaxY += padY
    if (spanY === 0) {
      dataMinY -= padY * 0.25
    }
  }

  // Viewport ranges (zoom window)
  const [viewX, setViewX] = useState<[number, number]>([dataMinX, dataMaxX])
  const [viewY, setViewY] = useState<[number, number]>([dataMinY, dataMaxY])
  const selectedPointSet = useMemo(() => {
    if (!selectedPointIds || !selectedPointIds.length) return new Set<string>()
    return new Set(selectedPointIds)
  }, [selectedPointIds ? selectedPointIds.join('\u0001') : ''])

  const desiredMinY = minYLimit ?? dataMinY
  let clampMinY = Math.min(minPanY ?? desiredMinY, desiredMinY)
  let clampMaxY = maxYLimit ?? dataMaxY
  if (!(clampMinY < clampMaxY)) clampMaxY = clampMinY + 1e-6

  // Reset viewport when data range changes significantly
  const defaultViewXKey = defaultViewX ? defaultViewX.join('|') : ''
  const defaultViewYKey = defaultViewY ? defaultViewY.join('|') : ''

  const resetViewKeyRef = useRef<unknown>(Symbol('init'))
  useEffect(()=>{
    const controlled = typeof resetViewKey !== 'undefined'
    if (controlled) {
      if (resetViewKeyRef.current === resetViewKey) return
      resetViewKeyRef.current = resetViewKey
    }
    const clampRange = (range: [number, number], minBound: number, maxBound: number): [number, number] => {
      const start = Math.min(Math.max(minBound, range[0]), maxBound)
      const endRaw = range[1] ?? range[0]
      const end = Math.min(Math.max(start, endRaw), maxBound)
      return start === end ? [start, end + 1e-6] : [start, end]
    }
    const xRange: [number, number] = defaultViewX
      ? clampRange(defaultViewX, xClampMin, xClampMax)
      : [dataMinX, dataMaxX]
    const yRange: [number, number] = defaultViewY
      ? clampRange(defaultViewY, clampMinY, clampMaxY)
      : [dataMinY, dataMaxY]
    setViewX(xRange)
    setViewY(yRange)
  }, [
    resetViewKey,
    dataMinX,
    dataMaxX,
    dataMinY,
    dataMaxY,
    series.length,
    defaultViewXKey,
    defaultViewYKey,
    clampMinY,
    clampMaxY,
    xClampMin,
    xClampMax,
  ])

  const minX = viewX[0]
  const maxX = viewX[1]
  const minY = viewY[0]
  const maxY = viewY[1]
  const dx = (maxX - minX) || 1
  const dy = (maxY - minY) || 1
  const activeLegendEntries = showLegend ? (legendEntries ?? []).filter((entry) => !entry.hidden) : []
  const [legendBox, setLegendBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const legendDragRef = useRef<null | { mode: 'drag' | 'resize'; startX: number; startY: number; box: { x: number; y: number; width: number; height: number } }>(null)
  const legendScaleFactor = Math.max(0.5, legendScale || 1) * fontScale
  const legendMinWidth = 180 * legendScaleFactor
  const legendMaxWidth = Math.max(legendMinWidth, innerW)
  const legendHeaderHeight = legendTitle ? 18 * legendScaleFactor : 0
  const legendHeaderGap = legendTitle ? 18 * legendScaleFactor : 0
  const legendPadding = 12 * legendScaleFactor
  const naturalLegendWidth = Math.min(360 * legendScaleFactor, Math.max(200 * legendScaleFactor, innerW * 0.4))
  const legendContentWidth = Math.max(
    60 * legendScaleFactor,
    (legendBox?.width ?? naturalLegendWidth) - legendPadding * 2 - 36 * legendScaleFactor,
  )
  const approxCharWidth = 7 * legendScaleFactor
  const legendItemHeights = useMemo(
    () =>
      activeLegendEntries.map((entry) => {
        const len = (entry.label?.length ?? 1) || 1
        const lines = Math.max(
          1,
          Math.ceil((len * approxCharWidth) / Math.max(80 * legendScaleFactor, legendContentWidth)),
        )
        return Math.max(18 * legendScaleFactor, lines * 14 * legendScaleFactor + 4 * legendScaleFactor)
      }),
    [activeLegendEntries, approxCharWidth, legendContentWidth, legendScaleFactor],
  )
  const legendItemsTotalHeight = useMemo(
    () => legendItemHeights.reduce((sum, h) => sum + h, 0),
    [legendItemHeights],
  )
  const naturalLegendHeight = legendPadding * 2 + legendHeaderHeight + legendHeaderGap + legendItemsTotalHeight
  const clampLegendBox = useCallback(
    (box: { x: number; y: number; width: number; height: number }) => {
      const minW = legendMinWidth
      const maxW = legendMaxWidth
      const width = Math.min(Math.max(minW, box.width), maxW)
      const minH = Math.max(60 * fontScale, naturalLegendHeight || 60 * fontScale)
      const maxH = Math.max(minH, innerH)
      const height = Math.min(Math.max(minH, box.height), maxH)
      const minX = pad.left + 4
      const minY = pad.top + 4
      const maxX = pad.left + innerW - width - 4
      const maxY = pad.top + innerH - height - 4
      return {
        x: Math.min(Math.max(minX, box.x), maxX),
        y: Math.min(Math.max(minY, box.y), maxY),
        width,
        height,
      }
    },
    [innerH, innerW, legendMaxWidth, legendMinWidth, naturalLegendHeight, pad.left, pad.top, fontScale],
  )
  useEffect(() => {
    if (!showLegend || activeLegendEntries.length === 0) {
      setLegendBox((prev) => (prev ? null : prev))
      return
    }
    const nextBox = clampLegendBox({
      x: pad.left + innerW - naturalLegendWidth - 12,
      y: pad.top + 12,
      width: naturalLegendWidth,
      height: naturalLegendHeight,
    })
    setLegendBox((prev) => {
      if (prev && prev.x === nextBox.x && prev.y === nextBox.y && prev.width === nextBox.width && prev.height === nextBox.height) {
        return prev
      }
      return nextBox
    })
  }, [showLegend, activeLegendEntries.length, clampLegendBox, innerW, pad.left, pad.top, naturalLegendWidth, naturalLegendHeight])

  const sx = (x: number) => pad.left + ((x - minX) / dx) * innerW
  const sy = (y: number) => pad.top + innerH - ((y - minY) / dy) * innerH

  function renderPath(points: { x: number; y: number }[]) {
    if (!points.length) return ''
    const d = points.map((p, i) => `${i ? 'L' : 'M'} ${sx(p.x).toFixed(2)} ${sy(p.y).toFixed(2)}`).join(' ')
    return d
  }
  function renderBand(points: { x: number; low: number; high: number }[]) {
    if (!points.length) return ''
    const upper = points.map((p, i) => `${i ? 'L' : 'M'} ${sx(p.x).toFixed(2)} ${sy(p.high).toFixed(2)}`).join(' ')
    const lower = points.slice().reverse().map((p, i) => `${i ? 'L' : ''} ${sx(p.x).toFixed(2)} ${sy(p.low).toFixed(2)}`).join(' ')
    return `${upper} ${lower} Z`
  }

  // Simple ticks: 5 on each axis
  const xticks = Array.from({ length: 6 }, (_, i) => minX + (dx * i) / 5)
  const yticks = Array.from({ length: 6 }, (_, i) => minY + (dy * i) / 5)

  function computeTickPrecision(span: number){
    if (!Number.isFinite(span) || span <= 0) return 0
    const step = Math.max(Math.abs(span) / 5, Number.EPSILON)
    const decimals = Math.max(0, Math.ceil(-Math.log10(step)))
    return Math.min(decimals, 6)
  }

  const formatTickValue = (value: number, decimals: number) => {
    if (!Number.isFinite(value)) return ''
    const clamped = Math.min(Math.max(decimals, 0), 8)
    return value.toFixed(clamped)
  }

  const xTickPrecision = computeTickPrecision(dx)
  const yTickPrecision = computeTickPrecision(dy)

  function unscaleX(px: number){ return minX + ((px - pad.left) / innerW) * dx }
  function unscaleY(py: number){ return maxY - ((py - pad.top) / innerH) * dy }

  // Native non-passive wheel handler to fully capture scroll inside plot
  useEffect(()=>{
    if (!enableZoom) return
    const handler = (ev: WheelEvent) => {
      const rect = svgRef.current?.getBoundingClientRect?.() as DOMRect | undefined
      if (!rect) return
      const mx = ev.clientX - rect.left
      const my = ev.clientY - rect.top
      const inside = mx >= pad.left && mx <= pad.left + innerW && my >= pad.top && my <= pad.top + innerH
      if (!inside) return
      ev.preventDefault()
      ev.stopPropagation()
      // Mirror React handler
      const cx = unscaleX(mx)
      const cy = unscaleY(my)
      const clamp = (v:number, lo:number, hi:number)=> Math.max(lo, Math.min(hi, v))
      // CtrlKey is emitted by browsers for pinch/trackpad zoom gestures; treat as zoom.
      const isPan = ev.shiftKey && !ev.ctrlKey
      if (!isPan){
        const factor = Math.exp(ev.deltaY * 0.0015)
        // Minimal zoom span set to 1e-6 of full range
        const newDx = Math.max((dataMaxX - dataMinX) / 1e6, Math.min((dataMaxX - dataMinX) * 1.1, dx * factor))
        const newDy = Math.max((dataMaxY - dataMinY) / 1e6, Math.min((dataMaxY - dataMinY) * 1.1, dy * factor))
        const nx0 = cx - (cx - minX) * (newDx / dx)
        const nx1 = cx + (maxX - cx) * (newDx / dx)
      const ny0 = cy - (cy - minY) * (newDy / dy)
      const ny1 = cy + (maxY - cy) * (newDy / dy)
      let rx0 = clamp(nx0, xClampMin, xClampMax - 1e-12)
      let rx1 = clamp(nx1, rx0 + 1e-12, xClampMax)
      let ry0 = clamp(ny0, clampMinY, clampMaxY - 1e-12)
      let ry1 = clamp(ny1, ry0 + 1e-12, clampMaxY)
        setViewX([rx0, rx1])
        setViewY([ry0, ry1])
      } else {
        const pan = ev.deltaY * dx * 0.0015
        let rx0 = clamp(minX + pan, xClampMin, xClampMax - dx)
        let rx1 = rx0 + dx
        setViewX([rx0, rx1])
      }
    }
    // Use capture so preventDefault blocks browser page zoom (Ctrl+wheel pinch) before it bubbles.
    const opts: AddEventListenerOptions = { passive: false, capture: true }
    const c = containerRef.current
    const s = svgRef.current
    c?.addEventListener('wheel', handler, opts)
    s?.addEventListener('wheel', handler, opts)
    return ()=>{
      c?.removeEventListener('wheel', handler as any, opts)
      s?.removeEventListener('wheel', handler as any, opts)
    }
  }, [enableZoom, pad.left, pad.top, innerW, innerH, dx, dy, minX, maxX, minY, maxY, dataMinX, dataMaxX, dataMinY, dataMaxY, xClampMin, xClampMax, clampMinY, clampMaxY])

  function onDoubleClick(){
    // Reset zoom
    setViewX([dataMinX, dataMaxX])
    setViewY([dataMinY, dataMaxY])
  }

  // Drag-to-pan
  const dragRef = useRef<null | {sx:number, sy:number, vx:[number,number], vy:[number,number]}>(null)
  const [panning, setPanning] = useState(false)
  const selectionModeRef = useRef<'none' | 'pan' | 'select' | 'axis-scale-x' | 'axis-scale-y'>('none')
  const selectionStartRef = useRef<{ px: number; py: number } | null>(null)
  const [selectionRect, setSelectionRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const selectionThreshold = 4
  const axisScaleRef = useRef<null | { axis: 'x' | 'y'; startClientX: number; startClientY: number; range: [number, number] }>(null)
  const axisHandleThickness = 28
  const clampToPlot = (mx: number, my: number) => ({
    x: Math.max(pad.left, Math.min(pad.left + innerW, mx)),
    y: Math.max(pad.top, Math.min(pad.top + innerH, my)),
  })

  const startAxisScale = (axis: 'x' | 'y', clientX: number, clientY: number) => {
    selectionModeRef.current = axis === 'x' ? 'axis-scale-x' : 'axis-scale-y'
    axisScaleRef.current = {
      axis,
      startClientX: clientX,
      startClientY: clientY,
      range: axis === 'x' ? [minX, maxX] : [minY, maxY],
    }
  }

  function onMouseDown(e: React.MouseEvent<SVGSVGElement>){
    const rect = (svgRef.current?.getBoundingClientRect?.() as DOMRect | undefined)
    if (!rect) return
    const rawX = e.clientX - rect.left
    const rawY = e.clientY - rect.top
    const insidePlot = rawX >= pad.left && rawX <= pad.left + innerW && rawY >= pad.top && rawY <= pad.top + innerH
    const inXAxisHandle = rawX >= pad.left && rawX <= pad.left + innerW && rawY >= pad.top + innerH && rawY <= pad.top + innerH + axisHandleThickness
    const inYAxisHandle = rawY >= pad.top && rawY <= pad.top + innerH && rawX >= pad.left - axisHandleThickness && rawX <= pad.left
    if (inXAxisHandle){
      startAxisScale('x', e.clientX, e.clientY)
      e.preventDefault()
      return
    }
    if (inYAxisHandle){
      startAxisScale('y', e.clientX, e.clientY)
      e.preventDefault()
      return
    }
    if (!insidePlot) return
    const { x: mx, y: my } = clampToPlot(rawX, rawY)
    const modifierPressed = e.metaKey || e.ctrlKey || e.altKey || e.shiftKey
    const selectionAllowed = !!onPointSelection && (pointSelectionMode === 'immediate' || modifierPressed)
    if (selectionAllowed){
      selectionModeRef.current = 'select'
      selectionStartRef.current = { px: mx, py: my }
      setSelectionRect({ x0: mx, y0: my, x1: mx, y1: my })
      e.preventDefault()
      return
    }
    if (!enablePan) return
    selectionModeRef.current = 'pan'
    dragRef.current = { sx: e.clientX, sy: e.clientY, vx: [minX, maxX], vy: [minY, maxY] }
    setPanning(true)
    e.preventDefault()
  }
  function onMouseMove(e: React.MouseEvent<SVGSVGElement>){
    const rect = (svgRef.current?.getBoundingClientRect?.() as DOMRect | undefined)
    if (!rect) return
    const rawX = e.clientX - rect.left
    const rawY = e.clientY - rect.top
    if (legendDragRef.current && legendBox) {
      const { mode, startX, startY, box } = legendDragRef.current
      const dxp = e.clientX - startX
      const dyp = e.clientY - startY
      if (mode === 'drag') {
        setLegendBox(clampLegendBox({ ...box, x: box.x + dxp, y: box.y + dyp }))
      } else {
        setLegendBox(
          clampLegendBox({
            ...box,
            width: box.width + dxp,
            height: box.height + dyp,
          }),
        )
      }
      e.preventDefault()
      return
    }
    if ((selectionModeRef.current === 'axis-scale-x' || selectionModeRef.current === 'axis-scale-y') && axisScaleRef.current){
      const axis = axisScaleRef.current.axis
      const spanBounds = axis === 'x'
        ? { min: xClampMin, max: xClampMax, fullSpan: Math.max(1e-6, dataMaxX - dataMinX) }
        : { min: clampMinY, max: clampMaxY, fullSpan: Math.max(1e-6, dataMaxY - dataMinY) }
      const dimension = axis === 'x' ? innerW : innerH
      if (dimension <= 0) return
      const deltaRaw = axis === 'x'
        ? e.clientX - axisScaleRef.current.startClientX
        : axisScaleRef.current.startClientY - e.clientY
      const normalized = deltaRaw / Math.max(dimension, 24)
      const factor = Math.exp(normalized)
      const startRange = axisScaleRef.current.range
      const startSpan = Math.max(1e-6, startRange[1] - startRange[0])
      let nextSpan = startSpan * factor
      const minSpan = Math.max(spanBounds.fullSpan / 1e6, 1e-6)
      const maxSpan = Math.max(minSpan, spanBounds.max - spanBounds.min)
      nextSpan = Math.min(Math.max(nextSpan, minSpan), maxSpan)
      const center = (startRange[0] + startRange[1]) / 2
      let nextMin = center - nextSpan / 2
      let nextMax = center + nextSpan / 2
      if (nextMin < spanBounds.min){
        const diff = spanBounds.min - nextMin
        nextMin += diff
        nextMax += diff
      }
      if (nextMax > spanBounds.max){
        const diff = nextMax - spanBounds.max
        nextMin -= diff
        nextMax -= diff
      }
      nextMin = Math.max(spanBounds.min, nextMin)
      nextMax = Math.min(spanBounds.max, nextMax)
      if (!(nextMax > nextMin)) nextMax = nextMin + minSpan
      if (axis === 'x'){
        setViewX([nextMin, nextMax])
      } else {
        setViewY([nextMin, nextMax])
      }
      e.preventDefault()
      return
    }
    if (selectionModeRef.current === 'select'){
      if (!selectionStartRef.current) return
      const { x, y } = clampToPlot(rawX, rawY)
      setSelectionRect({ x0: selectionStartRef.current.px, y0: selectionStartRef.current.py, x1: x, y1: y })
      e.preventDefault()
      return
    }
    if (selectionModeRef.current === 'pan' && dragRef.current){
      const dxp = e.clientX - dragRef.current.sx
      const dyp = e.clientY - dragRef.current.sy
      const spanX = dragRef.current.vx[1] - dragRef.current.vx[0]
      const spanY = dragRef.current.vy[1] - dragRef.current.vy[0]
      const shiftX = -(dxp / innerW) * spanX
      const shiftY = (dyp / innerH) * spanY
      const clamp = (v:number, lo:number, hi:number)=> Math.max(lo, Math.min(hi, v))
      let nx0 = clamp(dragRef.current.vx[0] + shiftX, xClampMin, xClampMax - spanX)
      let nx1 = nx0 + spanX
      let ny0 = clamp(dragRef.current.vy[0] + shiftY, clampMinY, clampMaxY - spanY)
      let ny1 = ny0 + spanY
      setViewX([nx0, nx1])
      setViewY([ny0, ny1])
    }
  }
  function finalizeSelection(e?: React.MouseEvent<SVGSVGElement>){
    if (!selectionRect){
      selectionStartRef.current = null
      setSelectionRect(null)
      selectionModeRef.current = 'none'
      return
    }
    const xMin = Math.max(pad.left, Math.min(selectionRect.x0, selectionRect.x1))
    const xMax = Math.min(pad.left + innerW, Math.max(selectionRect.x0, selectionRect.x1))
    const yMin = Math.max(pad.top, Math.min(selectionRect.y0, selectionRect.y1))
    const yMax = Math.min(pad.top + innerH, Math.max(selectionRect.y0, selectionRect.y1))
    const width = Math.abs(xMax - xMin)
    const height = Math.abs(yMax - yMin)
    selectionStartRef.current = null
    setSelectionRect(null)
    selectionModeRef.current = 'none'
    if (width < selectionThreshold && height < selectionThreshold) return
    const hits: { seriesName: string; seriesIndex: number; pointIndex: number; point: SeriesPoint }[] = []
    series.forEach((s, si) => {
      s.points.forEach((p, pi) => {
        const px = sx(p.x)
        const py = sy(p.y)
        if (px >= xMin && px <= xMax && py >= yMin && py <= yMax){
          hits.push({ seriesName: s.name, seriesIndex: si, pointIndex: pi, point: p })
        }
      })
    })
    if (hits.length) {
      const evt = e ?? ({
        clientX: 0,
        clientY: 0,
      } as React.MouseEvent<SVGSVGElement, MouseEvent>)
      onPointSelection?.({ points: hits, event: evt })
    }
  }
  function cancelSelection(){
    legendDragRef.current = null
    selectionStartRef.current = null
    setSelectionRect(null)
    axisScaleRef.current = null
    selectionModeRef.current = 'none'
  }
  function onMouseUp(e?: React.MouseEvent<SVGSVGElement>){
    legendDragRef.current = null
    if (selectionModeRef.current === 'select'){
      finalizeSelection(e)
    } else if (selectionModeRef.current === 'pan'){
      dragRef.current = null
      setPanning(false)
      selectionModeRef.current = 'none'
    } else if (selectionModeRef.current === 'axis-scale-x' || selectionModeRef.current === 'axis-scale-y'){
      axisScaleRef.current = null
      selectionModeRef.current = 'none'
    }
  }

  // Hover label (sample name)
  const formatHoverValue = (value: number | undefined) => {
    if (!Number.isFinite(value)) return ''
    const abs = Math.abs(value as number)
    if (abs >= 1000) return (value as number).toFixed(0)
    if (abs >= 10) return (value as number).toFixed(2)
    return (value as number).toFixed(3)
  }
  const [hover, setHover] = useState<{x:number,y:number,lines:string[]}|null>(null)
  function updateHover(eClientX: number, eClientY: number){
    const rect = (svgRef.current?.getBoundingClientRect?.() as DOMRect | undefined)
    if (!rect) return setHover(null)
    const mx = eClientX - rect.left
    const my = eClientY - rect.top
    if (mx < pad.left || mx > pad.left + innerW || my < pad.top || my > pad.top + innerH){ setHover(null); return }
    let best: {d:number, label:string, point?: SeriesPoint} | null = null
    for (const s of series){
      for (const p of s.points){
        const px = sx(p.x); const py = sy(p.y)
        const d = Math.hypot(px - mx, py - my)
        if (!best || d < best.d){ best = { d, label: s.name, point: p } }
      }
    }
    const withinSnap = best && best.d < 32
    const linesOut: string[] = []
    if (withinSnap && best?.label) linesOut.push(best.label)
    if (xBands && xBands.length){
      const xVal = unscaleX(mx)
      const covering = xBands.filter(b=> xVal >= Math.min(b.start,b.end) && xVal <= Math.max(b.start,b.end))
      if (covering.length === 1){
        const b = covering[0]
        const phaseStr = (b.phase!==undefined) ? String(b.phase) : undefined
        if (phaseStr){ linesOut.push(`phase ${phaseStr}`) }
      }
    }
    if (withinSnap && best?.point){
      const px = formatHoverValue(best.point.x)
      const py = formatHoverValue(best.point.y)
      const xName = xLabel || 'X'
      const yName = yLabel || 'Y'
      linesOut.push(`${xName}: ${px}`)
      linesOut.push(`${yName}: ${py}`)
    }
    if (linesOut.length){ setHover({ x: eClientX, y: eClientY, lines: linesOut }) } else setHover(null)
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        maxWidth: '100%',
        overflow: 'hidden',
        overscrollBehavior: 'none',
      }}
    >
      <svg width={width} height={computedH} role="img" ref={(el)=>{ svgRef.current = el; onSvgRef && onSvgRef(el) }} onDoubleClick={enableDoubleClickReset ? onDoubleClick : undefined} onMouseDown={onMouseDown} onMouseMove={(e)=>{ onMouseMove(e); updateHover(e.clientX, e.clientY); }} onMouseUp={onMouseUp} onMouseLeave={()=>{ cancelSelection(); setHover(null); dragRef.current = null; setPanning(false); selectionModeRef.current = 'none'; }}>
        <defs>
          <marker id="axis-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 Z" fill="#555" />
          </marker>
          <clipPath id="plot-clip">
            <rect x={pad.left} y={pad.top} width={innerW} height={innerH} />
          </clipPath>
      </defs>
        {/* Background x-bands (phases) */}
        {xBands && xBands.length>0 && (
          <g clipPath="url(#plot-clip)">
            {xBands.map((b, i)=>{
              const x0 = sx(b.start)
              const x1 = sx(b.end)
              const w = Math.max(0, x1 - x0)
              return <rect key={i} x={Math.min(x0,x1)} y={pad.top} width={w} height={innerH} fill={b.color} opacity={b.opacity ?? 0.12} />
            })}
          </g>
        )}
        {/* Title (top) */}
        {title && titlePosition==='top' && (
          <text x={width / 2} y={22 * fontScale} textAnchor="middle" fontSize={15 * fontScale} fontWeight={600} fill="#111" style={{cursor:'text'}} onDoubleClick={onRequestTitleEdit}>
            {title}
          </text>
        )}

        {/* Axes */}
        <line x1={pad.left} y1={pad.top + innerH} x2={pad.left} y2={pad.top} stroke="#555" markerEnd="url(#axis-arrow)" />
        <line x1={pad.left} y1={pad.top + innerH} x2={pad.left + innerW} y2={pad.top + innerH} stroke="#555" markerEnd="url(#axis-arrow)" />

        {/* Grid + ticks */}
        {xticks.map((t, i) => {
          const isFirst = i === 0
          const isLast = i === xticks.length - 1
          const labelAnchor = isLast ? 'end' : isFirst ? 'start' : 'middle'
          const labelDx = isLast ? -4 * fontScale : isFirst ? 4 * fontScale : 0
          return (
            <g key={i}>
              <line x1={sx(t)} y1={pad.top} x2={sx(t)} y2={pad.top + innerH} stroke="#999" strokeDasharray="3,4" />
              <text x={sx(t)} y={pad.top + innerH + 14 * fontScale} textAnchor={labelAnchor} fontSize={11 * fontScale} fill="#111" dx={labelDx}>
                {formatTickValue(t, xTickPrecision)}
              </text>
            </g>
          )
        })}
        {yticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.left} y1={sy(t)} x2={pad.left + innerW} y2={sy(t)} stroke="#999" strokeDasharray="3,4" />
            <text x={pad.left - 8} y={sy(t) + 4} textAnchor="end" fontSize={11 * fontScale} fill="#111">
              {formatTickValue(t, yTickPrecision)}
            </text>
          </g>
        ))}

        {/* Std bands or error bars (behind lines) */}
        <g clipPath="url(#plot-clip)">
        {mode === 'line' && bands && bands.map((b, idx) => {
          if (!b.points.length) return null
          const baseMode = stdMode === 'none' ? (b.mode ?? 'none') : (b.mode ?? stdMode)
          if (baseMode === 'none') return null
          const base = b.color
          if (baseMode === 'area') {
            return (
              <path key={`band-${idx}`} d={renderBand(b.points)} fill={base} stroke="none" opacity={0.35} />
            )
          }
          return (
            <g key={`err-${idx}`} stroke={base} strokeWidth={1} opacity={0.6}>
              {b.points.map((p, i)=> (
                <g key={i}>
                  <line x1={sx(p.x)} y1={sy(p.low)} x2={sx(p.x)} y2={sy(p.high)} />
                  <line x1={sx(p.x)-4} y1={sy(p.low)} x2={sx(p.x)+4} y2={sy(p.low)} />
                  <line x1={sx(p.x)-4} y1={sy(p.high)} x2={sx(p.x)+4} y2={sy(p.high)} />
                </g>
              ))}
            </g>
          )
        })}

        {/* Lines */}
        {mode === 'line' &&
          series.map((s, idx) => {
            const isHighlighted = highlightedNames.length ? highlightedNames.includes(s.name) : true
            const dimmed = highlightedNames.length > 0 && !isHighlighted
            const emphasized = emphasizeSeriesNames.includes(s.name)
            const width = emphasized ? emphasizeStrokeWidth : (isHighlighted ? 2.6 : 2)
            return (
              <path key={idx} d={renderPath(s.points)} fill="none" stroke={s.color} strokeWidth={width} opacity={dimmed ? 0.25 : 1} />
            )
          })}
        </g>

        {(mode === 'scatter' || pointMarkers !== 'none') && (
          <g clipPath="url(#plot-clip)">
            {series.map((s, si) =>
              s.points.map((p, pi) => {
                if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null
                const id = p.id ?? `${s.name}-${pi}`
                const selected = selectedPointSet.has(id)
                const radius = Math.max(1.5, selected ? pointMarkerRadius + 1.5 : pointMarkerRadius)
                const baseColor = s.color ?? '#2563eb'
                const meta = (p.meta ?? {}) as any
                const isExcluded = Boolean(meta.excluded)
                const baseStrokeColor = typeof meta.strokeColor === 'string' ? meta.strokeColor : baseColor
                const baseStrokeWidth = typeof meta.strokeWidth === 'number' ? meta.strokeWidth : 1
                const baseFillColor =
                  typeof meta.fillColor === 'string'
                    ? meta.fillColor
                    : (pointFill === 'outline' ? '#fff' : baseColor)
                const baseFillOpacity = typeof meta.fillOpacity === 'number' ? meta.fillOpacity : 1
                const selectionStrokeColor =
                  typeof meta.selectionStrokeColor === 'string' ? meta.selectionStrokeColor : DEFAULT_SELECTION_COLOR
                const selectionFillColor =
                  typeof meta.selectionFillColor === 'string' ? meta.selectionFillColor : '#fff'
                const selectionHaloColor =
                  typeof meta.selectionHaloColor === 'string' ? meta.selectionHaloColor : selectionStrokeColor
                const selectionHaloOpacity =
                  typeof meta.selectionHaloOpacity === 'number' ? meta.selectionHaloOpacity : DEFAULT_SELECTION_HALO_OPACITY
                const strokeColor = selected ? selectionStrokeColor : baseStrokeColor
                const fillColor = selected ? selectionFillColor : baseFillColor
                const fillOpacity = selected ? 1 : baseFillOpacity
                const strokeWidth = selected ? baseStrokeWidth + 1 : baseStrokeWidth
                const excludedHaloColor = '#9ca3af'
                const haloRadius = Math.max(radius + 3, radius * 1.8)
                return (
                  <g key={`pt-${si}-${pi}`}>
                    {selected && (
                      <circle
                        cx={sx(p.x)}
                        cy={sy(p.y)}
                        r={haloRadius}
                        fill={selectionHaloColor}
                        fillOpacity={selectionHaloOpacity}
                        stroke={selectionHaloColor}
                        strokeOpacity={Math.min(1, selectionHaloOpacity + 0.2)}
                        strokeWidth={1}
                        pointerEvents="none"
                      />
                    )}
                    {isExcluded && (
                      <circle
                        cx={sx(p.x)}
                        cy={sy(p.y)}
                        r={radius + 2}
                        fill="none"
                        stroke={excludedHaloColor}
                        strokeWidth={2}
                        opacity={0.8}
                        pointerEvents="none"
                      />
                    )}
                    <circle
                      cx={sx(p.x)}
                      cy={sy(p.y)}
                      r={radius}
                      fill={fillColor}
                      fillOpacity={fillOpacity}
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      onClick={(event)=>{ event.stopPropagation(); onPointClick?.({ seriesName: s.name, seriesIndex: si, pointIndex: pi, point: p, event }) }}
                      style={{ cursor: onPointClick ? 'pointer' : 'default' }}
                    />
                    {isExcluded && (
                      <g>
                        <line
                          x1={sx(p.x) - 4.5}
                          y1={sy(p.y) - 4.5}
                          x2={sx(p.x) + 4.5}
                          y2={sy(p.y) + 4.5}
                          stroke={selectionStrokeColor}
                          strokeWidth={1.6}
                          pointerEvents="none"
                        />
                        <line
                          x1={sx(p.x) + 4.5}
                          y1={sy(p.y) - 4.5}
                          x2={sx(p.x) - 4.5}
                          y2={sy(p.y) + 4.5}
                          stroke={selectionStrokeColor}
                          strokeWidth={1.6}
                          pointerEvents="none"
                        />
                      </g>
                    )}
                  </g>
                )
              })
            )}
          </g>
        )}
        {scatterSeries.length > 0 && (
          <g clipPath="url(#plot-clip)">
            {scatterSeries.map((s, si) =>
              s.points.map((p, pi) => {
                if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null
                const id = p.id ?? `${s.name}-scatter-${pi}`
                const selected = selectedPointSet.has(id)
                const radius = Math.max(1.2, selected ? (scatterPointRadius ?? pointMarkerRadius) + 1.2 : (scatterPointRadius ?? pointMarkerRadius))
                const baseColor = s.color ?? '#2563eb'
                const meta = (p.meta ?? {}) as any
                const shape = meta.shape ?? 'circle'
                const baseStrokeColor = typeof meta.strokeColor === 'string' ? meta.strokeColor : baseColor
                const baseStrokeWidth = typeof meta.strokeWidth === 'number' ? meta.strokeWidth : 0.8
                const baseFillColor =
                  typeof meta.fillColor === 'string'
                    ? meta.fillColor
                    : (pointFill === 'outline' ? '#fff' : baseColor)
                const baseFillOpacity =
                  typeof meta.fillOpacity === 'number'
                    ? meta.fillOpacity
                    : scatterOpacity
                const selectionStrokeColor =
                  typeof meta.selectionStrokeColor === 'string' ? meta.selectionStrokeColor : DEFAULT_SELECTION_COLOR
                const selectionFillColor =
                  typeof meta.selectionFillColor === 'string' ? meta.selectionFillColor : '#fff'
                const selectionHaloColor =
                  typeof meta.selectionHaloColor === 'string' ? meta.selectionHaloColor : selectionStrokeColor
                const selectionHaloOpacity =
                  typeof meta.selectionHaloOpacity === 'number' ? meta.selectionHaloOpacity : DEFAULT_SELECTION_HALO_OPACITY
                const strokeColor = selected ? selectionStrokeColor : baseStrokeColor
                const fillColor = selected ? selectionFillColor : baseFillColor
                const fillOpacity = selected ? 1 : baseFillOpacity
                const strokeWidth = selected ? baseStrokeWidth + 0.8 : baseStrokeWidth
                const haloRadius = Math.max(radius + 2.4, radius * 1.6)
                const dashHalf = typeof meta.dashHalfWidth === 'number' ? meta.dashHalfWidth : 6
                return (
                  <g key={`scatter-${si}-${pi}`}>
                    {shape === 'dash' ? (
                      <>
                        {selected && (
                          <line
                            x1={sx(p.x) - dashHalf - 2}
                            x2={sx(p.x) + dashHalf + 2}
                            y1={sy(p.y)}
                            y2={sy(p.y)}
                            stroke={selectionHaloColor}
                            strokeWidth={strokeWidth + 2.4}
                            strokeOpacity={selectionHaloOpacity}
                            pointerEvents="none"
                          />
                        )}
                        <line
                          x1={sx(p.x) - dashHalf}
                          x2={sx(p.x) + dashHalf}
                          y1={sy(p.y)}
                          y2={sy(p.y)}
                          stroke={strokeColor}
                          strokeWidth={strokeWidth + 1}
                          strokeLinecap="round"
                          onClick={
                            onPointClick
                              ? (event) =>
                                  onPointClick({
                                    seriesName: s.name,
                                    seriesIndex: series.length + si,
                                    pointIndex: pi,
                                    point: p,
                                    event: event as any,
                                  })
                              : undefined
                          }
                        />
                      </>
                    ) : (
                      <>
                        {selected && (
                          <circle
                            cx={sx(p.x)}
                            cy={sy(p.y)}
                            r={haloRadius}
                            fill={selectionHaloColor}
                            fillOpacity={selectionHaloOpacity}
                            stroke={selectionHaloColor}
                            strokeOpacity={Math.min(1, selectionHaloOpacity + 0.2)}
                            strokeWidth={0.9}
                            pointerEvents="none"
                          />
                        )}
                        <circle
                          cx={sx(p.x)}
                          cy={sy(p.y)}
                          r={radius}
                          fill={fillColor}
                          fillOpacity={fillOpacity}
                          stroke={strokeColor}
                          strokeWidth={strokeWidth}
                          onClick={
                            onPointClick
                              ? (event) =>
                                  onPointClick({
                                    seriesName: s.name,
                                    seriesIndex: series.length + si,
                                    pointIndex: pi,
                                    point: p,
                                    event,
                                  })
                              : undefined
                          }
                        />
                      </>
                    )}
                  </g>
                )
              })
            )}
          </g>
        )}
        {activeLegendEntries.length > 0 && legendBox && (() => {
          const textColor = '#0f172a'
          const width = legendBox.width
          const height = legendBox.height
          const contentTop = legendPadding + legendHeaderHeight + legendHeaderGap
          return (
            <g key="legend-overlay" transform={`translate(${legendBox.x}, ${legendBox.y})`}>
              <rect
                x={0}
                y={0}
                width={width}
                height={height}
                rx={10 * fontScale}
                fill="rgba(248,250,252,0.94)"
                stroke="rgba(148,163,184,0.9)"
                strokeWidth={1}
                cursor="move"
                onMouseDown={(e)=>{ e.preventDefault(); e.stopPropagation(); legendDragRef.current = { mode:'drag', startX:e.clientX, startY:e.clientY, box: legendBox }; selectionModeRef.current='none'; }}
              />
              {legendTitle && (
                <text
                  x={legendPadding}
                  y={legendPadding + legendHeaderHeight - 4 * legendScaleFactor}
                  fontSize={13 * legendScaleFactor}
                  fontWeight={700}
                  fill={textColor}
                >
                  {legendTitle}
                </text>
              )}
              {(() => {
                let offsetY = contentTop
                return activeLegendEntries.map((entry, i) => {
                  const legendItemHeight = legendItemHeights[i] ?? 18 * legendScaleFactor
                  const height = legendItemHeight
                  const iconX = legendPadding
                  const iconY = offsetY + height / 2 - 4 * legendScaleFactor
                  const labelX = iconX + 28 * legendScaleFactor
                  const labelY = offsetY
                  const labelWidth = Math.max(60, width - labelX - legendPadding)
                  offsetY += height
                  return (
                    <g key={entry.id}>
                    {entry.kind === 'excluded' ? (
                      <g>
                        <circle
                          cx={iconX + 10 * legendScaleFactor}
                          cy={iconY}
                          r={8 * legendScaleFactor}
                          fill="#fff"
                          stroke="#111"
                          strokeWidth={1.8 * legendScaleFactor}
                        />
                        <circle
                          cx={iconX + 10 * legendScaleFactor}
                          cy={iconY}
                          r={11 * legendScaleFactor}
                          fill="none"
                          stroke="#9ca3af"
                          strokeWidth={2 * legendScaleFactor}
                          opacity={0.8}
                        />
                        <line
                          x1={iconX + 4 * legendScaleFactor}
                          y1={iconY - 6 * legendScaleFactor}
                          x2={iconX + 16 * legendScaleFactor}
                          y2={iconY + 6 * legendScaleFactor}
                          stroke="#111"
                          strokeWidth={2 * legendScaleFactor}
                        />
                        <line
                          x1={iconX + 16 * legendScaleFactor}
                          y1={iconY - 6 * legendScaleFactor}
                          x2={iconX + 4 * legendScaleFactor}
                          y2={iconY + 6 * legendScaleFactor}
                          stroke="#111"
                          strokeWidth={2 * legendScaleFactor}
                        />
                      </g>
                    ) : (
                      <g>
                        <line
                          x1={iconX}
                          y1={iconY}
                          x2={iconX + 20 * legendScaleFactor}
                          y2={iconY}
                          stroke={entry.color}
                          strokeWidth={2.4 * legendScaleFactor}
                        />
                        <circle
                          cx={iconX + 10 * legendScaleFactor}
                          cy={iconY}
                          r={4.4 * legendScaleFactor}
                          fill={entry.color}
                          stroke="rgba(15,23,42,0.7)"
                          strokeWidth={0.8 * legendScaleFactor}
                        />
                      </g>
                    )}
                    <foreignObject
                      x={labelX}
                      y={labelY}
                      width={labelWidth}
                      height={height}
                    >
                      <div
                        style={{
                          fontSize: `${12 * legendScaleFactor}px`,
                          fontWeight: 600,
                          color: textColor,
                          lineHeight: 1.2,
                          wordBreak: 'break-word',
                          whiteSpace: 'normal',
                        }}
                      >
                        {entry.label}
                      </div>
                    </foreignObject>
                  </g>
                  )
                })
              })()}
              <rect
                x={width - 16 * fontScale}
                y={height - 16 * fontScale}
                width={14 * fontScale}
                height={14 * fontScale}
                fill="rgba(0,0,0,0.08)"
                stroke="rgba(0,0,0,0.25)"
                strokeWidth={0.8 * fontScale}
                rx={3 * fontScale}
                cursor="nwse-resize"
                onMouseDown={(e)=>{ e.preventDefault(); e.stopPropagation(); legendDragRef.current = { mode:'resize', startX:e.clientX, startY:e.clientY, box: legendBox }; selectionModeRef.current='none'; }}
              />
            </g>
          )
        })()}
        {selectionRect && (() => {
          const xMin = Math.max(pad.left, Math.min(selectionRect.x0, selectionRect.x1))
          const xMax = Math.min(pad.left + innerW, Math.max(selectionRect.x0, selectionRect.x1))
          const yMin = Math.max(pad.top, Math.min(selectionRect.y0, selectionRect.y1))
          const yMax = Math.min(pad.top + innerH, Math.max(selectionRect.y0, selectionRect.y1))
          const width = Math.max(0, xMax - xMin)
          const height = Math.max(0, yMax - yMin)
          if (width <= 0 || height <= 0) return null
          return (
            <rect
              x={xMin}
              y={yMin}
              width={width}
              height={height}
              fill="rgba(59,130,246,0.15)"
              stroke="#2563eb"
              strokeDasharray="4 2"
            />
          )
        })()}

        {/* Axis labels */}
        {xLabel && (
            <text x={pad.left + innerW / 2} y={pad.top + innerH + 32 * fontScale} textAnchor="middle" fontSize={12 * fontScale} fill="#111" style={{cursor:'text'}} onDoubleClick={onRequestXLabelEdit}>
            {xLabel}
          </text>
        )}
        {yLabel && (
          <text
            x={16}
            y={pad.top + innerH / 2}
            transform={`rotate(-90, 16, ${pad.top + innerH / 2})`}
            textAnchor="middle"
            fontSize={12 * fontScale}
            fill="#111"
            style={{cursor:'text'}}
            onDoubleClick={onRequestYLabelEdit}
          >
            {yLabel}
          </text>
        )}

        {/* Title (bottom) */}
        {title && titlePosition==='bottom' && (
          <text x={pad.left + innerW / 2} y={pad.top + innerH + 40 * fontScale} textAnchor="middle" fontSize={15 * fontScale} fontWeight={600} fill="#111" style={{cursor:'text'}} onDoubleClick={onRequestTitleEdit}>
            {title}
          </text>
        )}

        {/* Inline legend (top) */}
        {legendMode === 'inline-top' && series.length > 0 && (
          <g>
            {series.slice(0, 8).map((s, i) => (
              <g key={i}>
                <rect x={pad.left + i * (110 * fontScale)} y={pad.top - 16 * fontScale} width={10 * fontScale} height={10 * fontScale} fill={s.color} />
                <text x={pad.left + 14 * fontScale + i * (110 * fontScale)} y={pad.top - 8 * fontScale} fontSize={11 * fontScale} fill="#111">
                  {s.name}
                </text>
              </g>
            ))}
          </g>
        )}
      </svg>
      {hover && (
        <div style={{ position:'fixed', left:hover.x + 10, top:hover.y + 10, background:'rgba(0,0,0,.75)', color:'#fff', padding:'2px 6px', borderRadius:4, fontSize:12, pointerEvents:'none', whiteSpace:'pre' }}>
          {hover.lines.map((line, idx) => <div key={idx}>{line}</div>)}
        </div>
      )}

      {/* Table legend below the chart — grouped by sample name */}
      {legendMode === 'table-below' && series.length > 0 && (() => {
        const groups = new Map<string, {sample: string, items: {name:string, color:string, rep:string}[] }>()
        for (const s of series){
          const m = s.name.match(/^(.*?)\s+(r\d+.*)$/i)
          const sample = (m ? m[1] : s.name).trim()
          const rep = (m ? m[2] : '')
          if (!groups.has(sample)) groups.set(sample, { sample, items: [] })
          groups.get(sample)!.items.push({ name: s.name, color: s.color, rep: rep || s.name })
        }
        let ordered = Array.from(groups.values())
        if (groupOrder && groupOrder.length){
          const idx = new Map(groupOrder.map((s,i)=>[s,i]))
          ordered.sort((a,b)=> (idx.get(a.sample) ?? 1e9) - (idx.get(b.sample) ?? 1e9) || a.sample.localeCompare(b.sample, undefined, {numeric:true}))
        } else {
          ordered.sort((a,b)=> a.sample.localeCompare(b.sample, undefined, {numeric:true}))
        }
        // Grid of columns where each column is one sample; replicate chips stay close together in a row per sample
        let longestSampleName = 0
        let longestRepLabel = 0
        let maxRepCount = 0
        for (const g of ordered) {
          longestSampleName = Math.max(longestSampleName, g.sample.length)
          maxRepCount = Math.max(maxRepCount, g.items.length)
          for (const item of g.items) {
            longestRepLabel = Math.max(longestRepLabel, item.rep.length)
          }
        }
        const approxCharWidth = 8.5 * fontScale
        const estimatedNameWidth = longestSampleName ? (longestSampleName + 4) * approxCharWidth : 0
        const estimatedRepWidth = longestRepLabel ? (longestRepLabel + 4) * approxCharWidth : 0
        const estimatedRepButtonsWidth = maxRepCount ? maxRepCount * 46 * fontScale : 0
        const minBound = 130 * fontScale
        const maxBound = 360 * fontScale
        const baseWidth = Math.max(estimatedNameWidth, estimatedRepWidth, estimatedRepButtonsWidth)
        const colMin = Math.round(Math.max(minBound, Math.min(maxBound, baseWidth || minBound)))
        return (
          <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${colMin}px, 1fr))`, gap: 10, width:'100%' }}>
            {ordered.map((g, gi)=> (
              <div key={gi} style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap: 6 }}>
                <strong style={{ fontSize: `${12*fontScale}px` }}>{g.sample}</strong>
                <div style={{ display:'flex', gap: 8, flexWrap:'wrap' }}>
                  {g.items.sort((a,b)=> a.rep.localeCompare(b.rep, undefined, {numeric:true})).map((it, ii)=>{
                    const active = highlightedNames.includes(it.name)
                    return (
                      <button
                        key={ii}
                        onMouseEnter={()=> onLegendItemEnter && onLegendItemEnter(it.name)}
                        onMouseLeave={()=> onLegendItemLeave && onLegendItemLeave()}
                        onClick={()=> onLegendItemClick && onLegendItemClick(it.name)}
                        style={{ display:'inline-flex', alignItems:'center', gap:6, border:'1px solid rgba(0,0,0,.15)', background: active? 'rgba(0,0,0,.06)':'white', borderRadius:6, padding:'2px 6px', cursor:'pointer' }}
                        title={it.name}
                      >
                        <span style={{ width: 12, height: 12, background: it.color, display: 'inline-block', borderRadius: 2 }} />
                        <span style={{ fontSize: `${11*fontScale}px` }}>{it.rep}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      })()}
    </div>
  )
}
