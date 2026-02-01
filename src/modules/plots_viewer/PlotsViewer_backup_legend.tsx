import { useEffect, useMemo, useState, useCallback } from 'react'
import type { CSSProperties } from 'react'
import { useApp } from '@/state/store'
import SimpleLineChart, { type Series } from '@/components/SimpleLineChart'
import { hexToHsl, hslToHex } from '@/utils/colors'

type LegendPlacement = 'below' | 'right' | 'inside'

type LegendGroup = {
  sample: string,
  baseColor: string,
  items: { key: string, label: string, color: string, seriesName: string }[],
}

// Chart layout and legend tuning constants controlling the viewer configuration.
const COMBINED_CHART_ASPECT = 16 / 9
const AXIS_HORIZONTAL_PADDING = 72
const LEGEND_SPACING_MIN = 0.75
const LEGEND_SPACING_MAX = 1.5
const LEGEND_SPACING_STEP = 0.1
const LEGEND_CONTENT_MIN = 0.8
const LEGEND_CONTENT_MAX = 1.6
const LEGEND_CONTENT_STEP = 0.1

// Generates subtle color shifts for replicate curves so lines stay distinguishable.
function varyReplicateColor(base: string, replicate: number): string {
  if (replicate <= 1) return base
  const { h, s, l } = hexToHsl(base)
  const step = ((replicate - 1) % 4)
  if (step === 1) return hslToHex(h, Math.min(100, s + 5), Math.min(100, l + 8))
  if (step === 2) return hslToHex(h, Math.max(0, s - 5), Math.max(0, l - 8))
  return hslToHex((h + 10) % 360, s, l)
}

export default function PlotsViewer(){
  // Pull shared datasets and mappings from the global Zustand store.
  const datasets = useApp(s=>s.datasets)
  const mappings = useApp(s=>s.mappings)
  const datasetMapping = useApp(s=>s.datasetMapping)
  const plotsSelectedRunId = useApp(s=>s.plotsSelectedRunId)

  // Derived convenience collections for selection dropdowns.
  const datasetList = Object.values(datasets)
  const [selectedRunId, setSelectedRunId] = useState<string>('')

  // Auto-select the first dataset (prefer one with a saved mapping) once data is available.
  useEffect(()=>{
    if (!selectedRunId && datasetList.length){
      const preferred = datasetList.find(d=> !!datasetMapping[d.runId]) ?? datasetList[0]
      setSelectedRunId(preferred.runId)
    }
  }, [
    datasetList.map(d=>d.runId).join('\u0001'),
    Object.entries(datasetMapping).map(([runId, mappingId])=>`${runId}:${mappingId}`).join('\u0001')
  ])

  // Sync selection when other modules request a specific run to be displayed.
  useEffect(()=>{
    if (plotsSelectedRunId) setSelectedRunId(plotsSelectedRunId)
  }, [plotsSelectedRunId])

  // Locate the active dataset whenever the selection or backing store changes.
  const selectedDataset = useMemo(()=> datasetList.find(d=>d.runId===selectedRunId) ?? null, [datasetList, selectedRunId])
  // Pick the mapping tied to the active dataset, falling back to null if none exists.
  const selectedMapping = useMemo(()=>{
    if (!selectedDataset) return null
    const mid = datasetMapping[selectedDataset.runId]
    return mid ? (mappings[mid] ?? null) : null
  }, [selectedDataset?.runId, datasetMapping, mappings])

  // Build a lookup of replicate numbers per sample so we can cluster series and legends consistently.
  const sampleReplicates = useMemo(()=>{
    const out: Record<string, { well: string, replicate: number }[]> = {}
    if (!selectedDataset) return out

    const wells = Array.from(new Set(selectedDataset.rows.map(r=>r.well)))
      .sort((a,b)=> a.localeCompare(b, undefined, {numeric:true}))

    // Determine whether the mapping provides explicit sample labels per well; otherwise rely on raw well IDs.
    const assignmentsSource = selectedMapping?.assignments ?? {}
    const hasAssignments = Object.values(assignmentsSource).some(v=> !!(v && v.trim()))
    const assignments = hasAssignments ? assignmentsSource : Object.fromEntries(wells.map(w=>[w, w]))

    // Group wells by sample so replicate numbering and colouring stay consistent across charts and controls.
    const sampleToWells: Record<string, string[]> = {}
    for (const well of wells){
      const sample = (assignments[well] ?? '').trim()
      if (!sample) continue
      if (!sampleToWells[sample]) sampleToWells[sample] = []
      sampleToWells[sample].push(well)
    }

    for (const [sample, list] of Object.entries(sampleToWells)){
      // Preserve plate ordering (A1, A2, ... H12) so replicate indices match the lab layout.
      list.sort((a,b)=> a.localeCompare(b, undefined, {numeric:true}))
      out[sample] = list.map((well, index)=> ({ well, replicate: index + 1 }))
    }

    return out
  }, [
    selectedDataset?.runId,
    selectedMapping?.id,
    Object.entries(selectedMapping?.assignments ?? {}).map(([well, value])=>`${well}:${value}`).join('\u0001')
  ])

  // Flatten sample/replicate combinations into stable keys used throughout selection and highlighting logic.
  const allKeys = useMemo(()=> Object.entries(sampleReplicates).flatMap(([sample, reps])=> reps.map(({ replicate })=> `${sample}|${replicate}`)), [sampleReplicates])
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  // Reset which series are shown whenever the dataset, mapping or available keys change.
  useEffect(()=>{ setSelectedKeys(allKeys) }, [selectedDataset?.runId, selectedMapping?.id, allKeys.join('\u0001')])

  const [title, setTitle] = useState<string>('')
  const [xLabel, setXLabel] = useState<string>('')
  const [yLabel, setYLabel] = useState<string>('')
  const [fontScale, setFontScale] = useState<number>(1)

  // Populate default chart metadata once a dataset is chosen.
  useEffect(()=>{
    if (selectedDataset){
      setTitle(`${selectedDataset.sourceFile} - Combined`)
      setXLabel('Time (min)')
      setYLabel(selectedDataset.measurementType || 'Value')
    }
  }, [selectedDataset?.runId])

  // Compose combined-chart series by merging every selected replicate into a single array.
  const combinedSeries: Series[] = useMemo(()=>{
    if (!selectedDataset) return []

    // Sort the raw measurements by time before merging them into chart series.
    const rows = selectedDataset.rows.slice().sort((a,b)=> a.timeSeconds - b.timeSeconds)
    const byKey: Record<string, { x: number, y: number }[]> = {}

    for (const row of rows){
      // Resolve the friendly sample name from the mapping, falling back to the well code when none is set.
      const sampleName = (selectedMapping?.assignments?.[row.well] ?? '').trim() || row.well
      const replicate = sampleReplicates[sampleName]?.find(x=>x.well===row.well)?.replicate ?? 1
      const key = `${sampleName}|${replicate}`
      if (!selectedKeys.includes(key)) continue
      if (!byKey[key]) byKey[key] = []
      byKey[key].push({ x: row.timeSeconds/60, y: row.value })
    }

    // Turn each replicate group into a renderable series with a distinct colour.
    return Object.keys(byKey).map((key)=>{
      const [sampleName, replicateStr] = key.split('|')
      const replicate = Number(replicateStr)
      const baseColor = selectedMapping?.sampleColors?.[sampleName] ?? '#60a5fa'
      // Bundle the aggregated data points into the SimpleLineChart series structure.
      return {
        name: `${sampleName} R${replicate}`,
        color: varyReplicateColor(baseColor, replicate),
        points: byKey[key],
      }
    })
  }, [
    selectedDataset?.runId,
    selectedMapping?.id,
    selectedKeys.join('\u0001'),
    Object.entries(selectedMapping?.assignments ?? {}).map(([well, value])=>`${well}:${value}`).join('\u0001'),
    sampleReplicates
  ])

  // Preserve mapping-defined ordering for samples while ensuring any extras still appear.
  const orderedSamples = useMemo(() => {
    const seen = new Set<string>()
    const order: string[] = []
    const mappingOrder = selectedMapping?.samples ?? []
    for (const name of mappingOrder) {
      // Honor the saved sample sequence from the mapping before appending extras discovered in the dataset.
      if (sampleReplicates[name] && !seen.has(name)) {
        seen.add(name)
        order.push(name)
      }
    }
    for (const name of Object.keys(sampleReplicates)) {
      // Append any additional samples that were not listed in the mapping (e.g. imported afterwards).
      if (!seen.has(name)) {
        seen.add(name)
        order.push(name)
      }
    }
    return order
  }, [selectedMapping?.samples, sampleReplicates])

  // Prepare a legend description for each sample, including per-replicate chips.
  const legendGroups = useMemo(()=>{
    const sampleColors = selectedMapping?.sampleColors ?? {}

    return orderedSamples.map((sampleName) => {
      const reps = sampleReplicates[sampleName] ?? []
      if (!reps.length) return null

      // Use the saved sample colour when available; otherwise fall back to the default palette blue.
      const baseColor = sampleColors[sampleName] ?? '#60a5fa'

      // Build the structure consumed by the legend renderer and replicate toggle chips.
      return {
        sample: sampleName,
        baseColor,
        // Record replicate metadata (well origin, colour, display label) for use in legends and selectors.
        items: reps.map((rep) => ({
          key: `${sampleName}|${rep.replicate}`,
          label: `R${rep.replicate} (${rep.well.toUpperCase()})`,
          color: varyReplicateColor(baseColor, rep.replicate),
          seriesName: `${sampleName} R${rep.replicate}`,
        })),
      }
    }).filter((group): group is LegendGroup => !!group)
  }, [orderedSamples, sampleReplicates, selectedMapping?.sampleColors])

  // Map display names back to selection keys so hover/highlight logic stays in sync.
  const seriesKeyByName = useMemo(() => {
    const map = new Map<string, string>()
    // Build a reverse lookup so highlight state can translate display names back to selection keys.
    legendGroups.forEach((group) => {
      group.items.forEach((item) => { map.set(item.seriesName, item.key) })
    })
    return map
  }, [legendGroups])

  // Track which series are temporarily emphasized and where the legend should appear.
  const [highlighted, setHighlighted] = useState<string[]>([])
  const [legendPlacement, setLegendPlacement] = useState<LegendPlacement>('below')

  // Per-sample view uses its own index; reset when dataset or mapping changes.
  const [sampleIndex, setSampleIndex] = useState(0)
  useEffect(()=>{ setSampleIndex(0) }, [selectedDataset?.runId, selectedMapping?.id, orderedSamples.length])
  // Allow arrow-key navigation between samples for quick comparisons.
  useEffect(()=>{
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setSampleIndex(i => Math.min(orderedSamples.length ? orderedSamples.length-1 : 0, i+1))
      if (e.key === 'ArrowLeft') setSampleIndex(i => Math.max(0, i-1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [orderedSamples.length])

  // Currently inspected sample in the per-sample panel.
  const currentSample = orderedSamples[sampleIndex]

  // Build individual-series view for the focused sample so replicates can be compared in isolation.
  const perSampleSeries: Series[] = useMemo(()=>{
    if (!selectedDataset || !selectedMapping || !currentSample) return []

    const wells = sampleReplicates[currentSample] ?? []
    // Sort the raw measurements by time before merging them into chart series.
    const rows = selectedDataset.rows.slice().sort((a,b)=> a.timeSeconds - b.timeSeconds)
    // Align per-sample replicate colours with the combined chart so users can cross-reference easily.
    const baseColor = selectedMapping.sampleColors?.[currentSample] ?? '#60a5fa'

    // Rebuild series objects for each replicate of the focused sample using the filtered set of wells.
    return wells.map(({ well, replicate }) => ({
      name: `R${replicate} (${well.toUpperCase()})`,
      color: varyReplicateColor(baseColor, replicate),
      points: rows.filter(r=>r.well===well).map(r=>({ x: r.timeSeconds/60, y: r.value })),
    }))
  }, [selectedDataset?.runId, selectedMapping?.id, currentSample, sampleReplicates[currentSample]?.map(x=>x.well).join('\u0001')])

  // Toggle a replicate on/off from the legend or selection chips and keep highlight state aligned.
  const toggleLegendKey = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      let next: string[]
      // Remove a replicate when it is already selected to hide it from every chart.
      if (prev.includes(key)) {
        next = prev.filter((k) => k !== key)
      } else {
        // Otherwise add the replicate while preserving the ordering captured in allKeys.
        const set = new Set([...prev, key])
        next = allKeys.filter((k) => set.has(k))
      }

      // Keep highlight state aligned with whichever replicates remain visible.
      setHighlighted((current) => current.filter((name) => {
        const mapped = seriesKeyByName.get(name)
        return !mapped || next.includes(mapped)
      }))

      return next
    })
  }, [allKeys, seriesKeyByName])

  // Quick helper to show or hide every replicate at once.
  const handleToggleAll = useCallback(() => {
    setSelectedKeys((prev) => {
      if (prev.length === allKeys.length) {
        setHighlighted([])
        return []
      }
      setHighlighted([])
      return allKeys
    })
  }, [allKeys])

  // Drop highlight entries when their backing series has been deselected.
  useEffect(() => {
  // Drop highlight markers whose backing series is no longer selected.
    setHighlighted((prev) => prev.filter((name) => {
      const mapped = seriesKeyByName.get(name)
      return !mapped || selectedKeys.includes(mapped)
    }))
  }, [selectedKeys, seriesKeyByName])

  // Clear temporary emphasis when switching to a different dataset or mapping.
  useEffect(() => {
    setHighlighted([])
  }, [selectedDataset?.runId, selectedMapping?.id])

  // Legend appearance knobs that are exposed via the UI controls.
  const [legendSpacing, setLegendSpacing] = useState(1)
  const [legendVisible, setLegendVisible] = useState(true)
  const [legendTitle, setLegendTitle] = useState('Legend')
  const [legendContentScale, setLegendContentScale] = useState(1)

  // Button handlers clamp spacing/content-scale adjustments to sensible ranges.
  const adjustLegendSpacing = useCallback((delta: number) => {
    setLegendSpacing((prev) => {
      const next = Math.min(LEGEND_SPACING_MAX, Math.max(LEGEND_SPACING_MIN, +(prev + delta).toFixed(2)))
      return Math.round(next * 100) / 100
    })
  }, [])

  const adjustLegendContentScale = useCallback((delta: number) => {
    setLegendContentScale((prev) => {
      const next = Math.min(LEGEND_CONTENT_MAX, Math.max(LEGEND_CONTENT_MIN, +(prev + delta).toFixed(2)))
      return Math.round(next * 100) / 100
    })
  }, [])

  // Options fed into the legend placement toggle buttons.
  const legendPlacementOptions: { value: LegendPlacement, label: string }[] = [
    { value: 'below', label: 'Below' },
    { value: 'right', label: 'Side' },
    { value: 'inside', label: 'Inside' },
  ]


  // Assemble legend rows filtered by the current replicate visibility.
  const legendSections = useMemo(() => {
      const sections: { sample: string; replicates: { key: string; label: string; color: string }[] }[] = []
      const sampleColors = selectedMapping?.sampleColors ?? {}

      for (const sampleName of orderedSamples) {
        const reps = sampleReplicates[sampleName] ?? []
        if (!reps.length) continue
      // Use the saved sample colour when available; otherwise fall back to the default palette blue.
        const baseColor = sampleColors[sampleName] ?? '#60a5fa'
        const replicates = reps
          .filter((rep) => selectedKeys.includes(`${sampleName}|${rep.replicate}`))
          .map((rep) => ({
            key: `${sampleName}|${rep.replicate}`,
            label: `R${rep.replicate} (${rep.well.toUpperCase()})`,
            color: varyReplicateColor(baseColor, rep.replicate),
          }))
        if (replicates.length) {
          sections.push({ sample: sampleName, replicates })
        }
      }

      return sections
    }, [orderedSamples, sampleReplicates, selectedKeys, selectedMapping?.sampleColors]);

  // Translate spacing/content-scale knobs into concrete layout measurements for the legend renderer.
  const legendLayout = useMemo(() => {
      // Clamp spacing and scale inputs so the legend never collapses or stretches excessively.
      //Scale
      const spacing = Math.max(LEGEND_SPACING_MIN, Math.min(LEGEND_SPACING_MAX, legendSpacing))
      const fontScale = Math.max(LEGEND_CONTENT_MIN, legendContentScale)
      //Elements
      const rowGap = Math.max(4, Math.round(10 * spacing))
      const entryGap = Math.max(3, Math.round(6 * spacing))
      const swatchSize = Math.max(8, Math.round(10 * fontScale))
      const swatchRadius = Math.max(3, Math.round(3 * fontScale))
      // Rough character width estimate used to size columns without measuring the DOM.
      const approxCharWidth = 7.2 * fontScale

      if (!legendSections.length) {
        const columnWidth = Math.max(200, Math.round(approxCharWidth * 20))
        return {
          columnWidth,
          containerMinWidth: Math.max(160, Math.round(columnWidth * 0.8)),
          rowGap,
          entryGap,
          fontScale,
          headerFontSize: Math.round(14 * fontScale),
          countFontSize: Math.max(10, Math.round(11 * fontScale)),
          labelFontSize: Math.max(10, Math.round(12 * fontScale)),
          swatchSize,
          swatchRadius,
        }
      }

      let columnWidth = 180
      for (const section of legendSections) {
        // Width contribution from the sample header (for example "Sample A").
        const sampleWidth = section.sample.length * approxCharWidth
        const replicatesWidth = section.replicates.reduce((total, entry) => {
          // Each replicate chip contributes its colour swatch, label width and configured entry gap.
          return total + swatchSize + entry.label.length * approxCharWidth + entryGap
        }, section.replicates.length ? entryGap : 0)
        const estimatedWidth = sampleWidth + entryGap + replicatesWidth + 36
        columnWidth = Math.max(columnWidth, estimatedWidth)
      }
      columnWidth = Math.min(520, Math.max(180, Math.round(columnWidth)))
      const containerMinWidth = Math.max(160, Math.round(columnWidth * 0.85))
      // Return the computed legend layout metrics so the renderer can size and space content appropriately.
      return {
        columnWidth,
        containerMinWidth,
        rowGap,
        entryGap,
        fontScale,
        headerFontSize: Math.round(14 * fontScale),
        countFontSize: Math.max(10, Math.round(11 * fontScale)),
        labelFontSize: Math.max(10, Math.round(12 * fontScale)),
        swatchSize,
        swatchRadius,
      }
    }, [legendContentScale, legendSections, legendSpacing]);

  // Shared renderer that prints the legend either below, beside or inside the chart based on placement.
  const renderLegend = useCallback(
    (placement: LegendPlacement) => {
      if (!legendVisible || !legendSections.length) return null

      const resizeMode: CSSProperties['resize'] =
        placement === 'below' ? 'vertical' : placement === 'right' ? 'horizontal' : 'both'
      // Increase padding as the legend font grows so content retains breathing room.
      const containerPadding = Math.round(12 + legendLayout.fontScale * 4)

      const containerStyle: CSSProperties = {
        resize: resizeMode,
        overflow: 'auto',
        background: 'rgba(255,255,255,0.92)',
        border: '1px solid rgba(0,0,0,0.12)',
        borderRadius: 10,
        padding: containerPadding,
        display: 'flex',
        flexDirection: 'column',
        gap: legendLayout.rowGap,
        minWidth: legendLayout.containerMinWidth,
        minHeight: placement === 'below' ? 70 : 110,
      }

      const gridStyle: CSSProperties = {
        display: 'grid',
        rowGap: legendLayout.rowGap,
        columnGap: legendLayout.rowGap,
        // Auto-fit keeps legend columns responsive and wraps them when the container becomes narrow.
        gridTemplateColumns: `repeat(auto-fit, minmax(${legendLayout.columnWidth}px, max-content))`,
        alignItems: 'center',
        justifyContent: placement === 'below' ? 'center' : 'flex-start',
      }

      return (
        <div style={containerStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: legendLayout.rowGap }}>
            <strong style={{ fontSize: `${legendLayout.headerFontSize}px` }}>{legendTitle.trim() || 'Legend'}</strong>
            <span className="small" style={{ fontSize: `${legendLayout.countFontSize}px` }}>
              {/* Display a quick count of how many replicate entries are currently visible in the legend. */}
              {legendSections.reduce((total, section) => total + section.replicates.length, 0)}
            </span>
          </div>
          <div style={gridStyle}>
            {legendSections.map((section) => (
              <div
                key={section.sample}
                style={{ display: 'flex', alignItems: 'center', gap: legendLayout.entryGap, flexWrap: 'nowrap', overflowX: 'auto' }}
              >
                <strong style={{ fontSize: `${legendLayout.labelFontSize}px` }}>{section.sample}</strong>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: legendLayout.entryGap, flexWrap: 'nowrap' }}>
                  {section.replicates.map((entry) => (
                    <span
                      key={entry.key}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: legendLayout.entryGap, fontSize: `${legendLayout.labelFontSize}px` }}
                    >
                      <span style={{ width: legendLayout.swatchSize, height: legendLayout.swatchSize, borderRadius: legendLayout.swatchRadius, background: entry.color }} />
                      <span>{entry.label}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    },
    [legendLayout, legendSections, legendTitle, legendVisible],
  );

  // Cards shown under "Replicate selection" let users toggle individual replicates with matching colors.
  const selectionControls = useMemo(() => {
    const sampleColors = selectedMapping?.sampleColors ?? {}
    const panels: JSX.Element[] = []

    for (const sampleName of orderedSamples) {
      const reps = sampleReplicates[sampleName] ?? []
      if (!reps.length) continue
      // Use the saved sample colour when available; otherwise fall back to the default palette blue.
      const baseColor = sampleColors[sampleName] ?? '#60a5fa'

      panels.push(
        <div
          key={sampleName}
          style={{
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 6,
            padding: '6px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            minWidth: 0,
          }}
        >
          <strong style={{ fontSize: '12px', lineHeight: 1 }}>{sampleName}</strong>
          <div
            style={{
              display: 'flex',
              gap: 4,
              flexWrap: 'nowrap',
              overflowX: 'auto',
              paddingBottom: 2,
              alignItems: 'center',
            }}
          >
            {reps.map((rep) => {
              const key = `${sampleName}|${rep.replicate}`
              const active = selectedKeys.includes(key)
              const highlightedMatch = highlighted.includes(`${sampleName} R${rep.replicate}`)
              const replicateLabel = `R${rep.replicate} (${rep.well.toUpperCase()})`
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleLegendKey(key)}
                  onMouseEnter={() => active && setHighlighted([`${sampleName} R${rep.replicate}`])}
                  onFocus={() => active && setHighlighted([`${sampleName} R${rep.replicate}`])}
                  onMouseLeave={() => setHighlighted([])}
                  onBlur={() => setHighlighted([])}
                  aria-pressed={active}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '1px 5px',
                    borderRadius: 5,
                    border: active || highlightedMatch ? '1px solid rgba(0,0,0,0.45)' : '1px solid rgba(0,0,0,0.2)',
                    background: active ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.7)',
                    opacity: active ? 1 : 0.45,
                    cursor: 'pointer',
                    fontSize: '11px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: varyReplicateColor(baseColor, rep.replicate) }} />
                  <span>{replicateLabel}</span>
                </button>
              )
            })}
          </div>
        </div>,
      )
    }

    if (!panels.length) {
      panels.push(<div key="empty" className="small">No replicates assigned.</div>)
    }

    return panels
  }, [highlighted, orderedSamples, sampleReplicates, selectedKeys, selectedMapping?.sampleColors, setHighlighted, toggleLegendKey]);

  // Derived widths keep the legend readable across placements without crushing the charts.
  const sideLegendWidth = Math.round(Math.min(520, Math.max(220, legendLayout.columnWidth + 64)))
  const sideLegendMinWidth = Math.round(Math.max(200, legendLayout.containerMinWidth))
  const insideLegendMinWidth = Math.round(Math.max(160, Math.round(legendLayout.containerMinWidth * 0.9)))


  return (
    <div className="panel">
      <h2>Plots Viewer</h2>

      {/* Dataset and mapping selectors */}
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="col" style={{ minWidth: 280 }}>
          <label>Dataset</label>
          {/* Dataset dropdown lists every processed run so the user can swap the chart source. */}
          <select value={selectedRunId} onChange={e=>setSelectedRunId(e.target.value)}>
            <option value="">(select)</option>
            {datasetList.map(dataset => (
              <option key={dataset.runId} value={dataset.runId}>
                {dataset.sourceFile} - {dataset.measurementType}
              </option>
            ))}
          </select>
          {!selectedDataset && <div className="small">Add files and save assignments in Setup to enable plots.</div>}
        </div>

        <div className="col" style={{ minWidth: 280 }}>
          <label>Mapping</label>
          <input type="text" readOnly value={selectedMapping?.name ?? '(no saved mapping)'} />
          {!selectedMapping && <div className="small">Use Setup &gt; Convert + Assign &gt; Save assignments.</div>}
        </div>
      </div>

      {selectedDataset && selectedMapping && (
        <>
          {/* Combined chart and legend controls */}
          <div className="panel" style={{ marginTop: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
              {/* Font scaling controls shrink or enlarge every chart label in real time. */}
              <div className="row" style={{ gap: 6 }}>
                <button className="btn" onClick={()=> setFontScale(s=>Math.max(0.6, +(s-0.1).toFixed(1)))} title="Smaller text">A-</button>
                <button className="btn" onClick={()=> setFontScale(s=>Math.min(2.0, +(s+0.1).toFixed(1)))} title="Larger text">A+</button>
              </div>

              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <div className="col"><label>Chart title</label><input value={title} onChange={e=>setTitle(e.target.value)} /></div>
                <div className="col"><label>X axis</label><input value={xLabel} onChange={e=>setXLabel(e.target.value)} /></div>
                <div className="col"><label>Y axis</label><input value={yLabel} onChange={e=>setYLabel(e.target.value)} /></div>
              </div>
            </div>

            <div className="row" style={{ justifyContent: 'space-between', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <label className="small" style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <input type="checkbox" checked={legendVisible} onChange={e=>setLegendVisible(e.target.checked)} />
                  Legend
                </label>
                <div className="row" style={{ gap: 6, alignItems:'center' }}>
                  <span className="small">Title:</span>
                  <input
                    value={legendTitle}
                    onChange={e=>setLegendTitle(e.target.value)}
                    placeholder="Legend title"
                    disabled={!legendVisible}
                    style={{ minWidth: 160 }}
                  />
                </div>
              </div>

              <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="small">Legend placement:</span>
                {/* Render placement preview buttons; clicking them re-renders the legend below. */}
                {legendPlacementOptions.map((option) => {
                  const active = option.value === legendPlacement
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className="btn"
                      onClick={()=> setLegendPlacement(option.value)}
                      aria-pressed={active}
                      disabled={!legendVisible}
                      style={active ? { fontWeight: 600 } : undefined}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>

              <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="small">Legend spacing:</span>
                <button
                  type="button"
                  className="btn"
                  onClick={()=> adjustLegendSpacing(-LEGEND_SPACING_STEP)}
                  disabled={!legendVisible || legendSpacing <= LEGEND_SPACING_MIN + 1e-6}
                >
                  Spacing-
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={()=> adjustLegendSpacing(LEGEND_SPACING_STEP)}
                  disabled={!legendVisible || legendSpacing >= LEGEND_SPACING_MAX - 1e-6}
                >
                  Spacing+
                </button>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="small">Legend content size:</span>
                <button
                  type="button"
                  className="btn"
                  onClick={()=> adjustLegendContentScale(-LEGEND_CONTENT_STEP)}
                  disabled={!legendVisible || legendContentScale <= LEGEND_CONTENT_MIN + 1e-6}
                >
                  Size-
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={()=> adjustLegendContentScale(LEGEND_CONTENT_STEP)}
                  disabled={!legendVisible || legendContentScale >= LEGEND_CONTENT_MAX - 1e-6}
                >
                  Size+
                </button>
              </div>

            </div>

            <div style={{ marginTop: 12 }}>
              <div style={legendPlacement === 'right' && legendVisible ? { display:'flex', gap:12, alignItems:'stretch', flexWrap:'wrap' } : undefined}>
                <div style={legendPlacement === 'right' && legendVisible ? { flex:'1 1 0', minWidth:320, position:'relative' } : { position:'relative' }}>
                  <SimpleLineChart
                    series={combinedSeries}
                    title={title}
                    xLabel={xLabel}
                    yLabel={yLabel}
                    height={360}
                    aspect={COMBINED_CHART_ASPECT}
                    minHeight={320}
                    maxHeight={640}
                    fontScale={fontScale}
                    legendMode="none"
                    highlightedNames={highlighted}
                  />

                  {/* Inside placement overlays the legend in the chart corner for compact exports. */}
                  {legendPlacement === 'inside' && legendVisible && (
                    <div style={{ position:'absolute', top:16, right:16, maxWidth:'40%', minWidth:insideLegendMinWidth }}>
                      {renderLegend('inside')}
                    </div>
                  )}
                </div>

                {/* Side placement reserves a fixed-width column so the chart and legend remain readable. */}
                {legendPlacement === 'right' && legendVisible && (
                  <div style={{ flex:`0 0 ${sideLegendWidth}px`, maxWidth:'35%', minWidth:sideLegendMinWidth }}>
                    {renderLegend('right')}
                  </div>
                )}
              </div>

              {/* Below placement spans the full chart width while respecting left/right axis padding. */}
              {legendPlacement === 'below' && legendVisible && (
                <div style={{ marginTop: 10, display:'flex', justifyContent:'center' }}>
                  <div style={{ width:'100%', maxWidth:`calc(100% - ${AXIS_HORIZONTAL_PADDING}px)` }}>
                    {renderLegend('below')}
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 16 }}>
              <div className="row" style={{ justifyContent:'space-between', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                <strong>Replicate selection</strong>
                <button className="btn" onClick={handleToggleAll} disabled={!allKeys.length}>Select / Deselect All</button>
              </div>
              <div style={{ marginTop: 8, display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:8 }}>
                {/* Render replicate toggle cards derived from selectionControls. */}
                {selectionControls}
              </div>
            </div>
          </div>

          {/* Per-sample detail chart */}
          <div className="panel" style={{ marginTop: 12 }}>
            {/* Per-sample navigation buttons step through orderedSamples. */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
              <button className="btn" onClick={()=> setSampleIndex(i=>Math.max(0, i-1))} disabled={sampleIndex<=0} aria-label="Previous sample">?</button>
              <div className="badge">{orderedSamples.length ? `${sampleIndex+1} / ${orderedSamples.length}` : '0 / 0'}</div>
              <button className="btn" onClick={()=> setSampleIndex(i=>Math.min(orderedSamples.length-1, i+1))} disabled={sampleIndex>=orderedSamples.length-1} aria-label="Next sample">?</button>
            </div>

            <div style={{ marginTop: 8 }}>
              <SimpleLineChart
                series={perSampleSeries}
                title={currentSample ? `${currentSample} - ${selectedDataset.sourceFile}` : ''}
                xLabel={'Time (min)'}
                yLabel={selectedDataset.measurementType || 'Value'}
                height={380}
                aspect={COMBINED_CHART_ASPECT}
                minHeight={320}
                maxHeight={640}
                fontScale={fontScale}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
