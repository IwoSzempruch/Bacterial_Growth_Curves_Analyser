import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
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
// spacing removed

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

// --- Chip/legend layout heuristics (scaled only by legendContentScale; spacing removed). ---
const CHIP_HORIZONTAL_PADDING = 8;   // inner L/R padding of a chip at scale=1
const CHIP_VERTICAL_PADDING = 4;     // inner T/B padding of a chip at scale=1
const CHIP_BORDER = 1;               // chip border in px
const CHIP_SWATCH_BASE = 10;         // color swatch size at scale=1
const CHIP_SWATCH_RADIUS_BASE = 3;   // color swatch border radius base
const CHIP_GAP_INNER_BASE = 4;       // swatch-to-label gap (spacing=1 baseline)
const CHIPS_GAP_BETWEEN_BASE = 6;    // gap between replicate tiles within one line (spacing=1 baseline)
const CHIP_LINE_GAP_BASE = 4;        // (kept for completeness; not used when wrapping is disabled)
const APPROX_CHAR_WIDTH_BASE = 7.2;  // average char width estimation at scale=1

// Approximate text width without measuring the DOM.
function estimateTextWidth(text: string, fontScale: number): number {
  return Math.ceil(text.length * APPROX_CHAR_WIDTH_BASE * fontScale);
}

// Width of a single replicate tile: swatch + inner gap + label.
// Spacing removed => use baseline gaps.
function estimateReplicateTileWidth(label: string, fontScale: number): number {
  const sw = Math.max(8, Math.round(CHIP_SWATCH_BASE * fontScale));
  const gapInner = Math.max(2, Math.round(CHIP_GAP_INNER_BASE * 1)); // spacing=1 baseline
  const labelW = estimateTextWidth(label, fontScale);
  return sw + gapInner + labelW;
}

// "Natural" minimal column width for a single chip without wrapping (single line content).
function minimalChipColumnWidth(sampleHeader: string, replicateLabels: string[], fontScale: number): number {
  const headerW = estimateTextWidth(sampleHeader, fontScale);
  const tiles = replicateLabels.map(l => estimateReplicateTileWidth(l, fontScale));
  const between = Math.max(3, Math.round(CHIPS_GAP_BETWEEN_BASE * 1)); // spacing=1 baseline
  const contentW = tiles.length ? tiles.reduce((a, b) => a + b, 0) + between * (tiles.length - 1) : 0;

  const padLR = Math.round(CHIP_HORIZONTAL_PADDING * fontScale);
  const border = CHIP_BORDER * 2;
  const headerGap = Math.max(4, Math.round(6 * 1)); // spacing=1 baseline

  const natural = headerW + (contentW ? headerGap + contentW : 0) + padLR * 2 + border;
  return Math.max(180, Math.min(520, natural));
}

// Greedy wrap (kept for reference/debug); NOT used now (we keep one line per chip).
function wrapReplicates(labels: string[], maxLineWidth: number, fontScale: number) {
  const between = Math.max(3, Math.round(CHIPS_GAP_BETWEEN_BASE * 1));
  const tiles = labels.map(l => ({ label: l, width: estimateReplicateTileWidth(l, fontScale) }));

  const lines: { items: {label: string, width: number}[], lineWidth: number }[] = [];
  let current: { items: {label: string, width: number}[], lineWidth: number } = { items: [], lineWidth: 0 };

  tiles.forEach((t) => {
    const extra = current.items.length ? between : 0;
    if (current.lineWidth + extra + t.width <= maxLineWidth) {
      current.items.push(t);
      current.lineWidth += extra + t.width;
    } else {
      if (current.items.length) lines.push(current);
      current = { items: [t], lineWidth: t.width };
    }
  });
  if (current.items.length) lines.push(current);

  const lineGap = Math.max(2, Math.round(CHIP_LINE_GAP_BASE * 1));
  const maxWidth = lines.reduce((m, l) => Math.max(m, l.lineWidth), 0);

  return { lines, maxWidth, lineGap };
}

// Safe top-level hook to measure container width (with ResizeObserver fallback).
function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState<number>(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      setWidth(Math.max(0, Math.floor(el.getBoundingClientRect().width)));
    };

    let ro: ResizeObserver | null = null;

    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure());
      ro.observe(el);
    } else {
      // Fallback when ResizeObserver is unavailable (tests/legacy webviews/SSR hydration).
      window.addEventListener('resize', measure);
    }

    // First measurement immediately.
    measure();

    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', measure);
    };
  }, []);

  return { ref, width };
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
    Object.entries(datasetMapping).map(([runId, mappingId])=>`${runId}:${mappingId}`).join('\u0001'),
    selectedRunId
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

    const rows = selectedDataset.rows.slice().sort((a,b)=> a.timeSeconds - b.timeSeconds)
    const byKey: Record<string, { x: number, y: number }[]> = {}

    for (const row of rows){
      const sampleName = (selectedMapping?.assignments?.[row.well] ?? '').trim() || row.well
      const replicate = sampleReplicates[sampleName]?.find(x=>x.well===row.well)?.replicate ?? 1
      const key = `${sampleName}|${replicate}`
      if (!selectedKeys.includes(key)) continue
      if (!byKey[key]) byKey[key] = []
      byKey[key].push({ x: row.timeSeconds/60, y: row.value })
    }

    return Object.keys(byKey).map((key)=>{
      const [sampleName, replicateStr] = key.split('|')
      const replicate = Number(replicateStr)
      const baseColor = selectedMapping?.sampleColors?.[sampleName] ?? '#60a5fa'
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
      if (sampleReplicates[name] && !seen.has(name)) {
        seen.add(name)
        order.push(name)
      }
    }
    for (const name of Object.keys(sampleReplicates)) {
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

      const baseColor = sampleColors[sampleName] ?? '#60a5fa'

      return {
        sample: sampleName,
        baseColor,
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
    legendGroups.forEach((group) => {
      group.items.forEach((item) => { map.set(item.seriesName, item.key) })
    })
    return map
  }, [legendGroups])

  // Highlight + legend placement.
  const [highlighted, setHighlighted] = useState<string[]>([])
  const [legendPlacement, setLegendPlacement] = useState<LegendPlacement>('below')

  // Per-sample navigation.
  const [sampleIndex, setSampleIndex] = useState(0)
  useEffect(()=>{ setSampleIndex(0) }, [selectedDataset?.runId, selectedMapping?.id, orderedSamples.length])
  useEffect(()=>{
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setSampleIndex(i => Math.min(orderedSamples.length ? orderedSamples.length-1 : 0, i+1))
      if (e.key === 'ArrowLeft') setSampleIndex(i => Math.max(0, i-1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [orderedSamples.length])

  const currentSample = orderedSamples[sampleIndex]

  // Per-sample series for focused sample.
  const perSampleSeries: Series[] = useMemo(()=>{
    if (!selectedDataset || !selectedMapping || !currentSample) return []

    const wells = sampleReplicates[currentSample] ?? []
    const rows = selectedDataset.rows.slice().sort((a,b)=> a.timeSeconds - b.timeSeconds)
    const baseColor = selectedMapping.sampleColors?.[currentSample] ?? '#60a5fa'

    return wells.map(({ well, replicate }) => ({
      name: `R${replicate} (${well.toUpperCase()})`,
      color: varyReplicateColor(baseColor, replicate),
      points: rows.filter(r=>r.well===well).map(r=>({ x: r.timeSeconds/60, y: r.value })),
    }))
  }, [selectedDataset?.runId, selectedMapping?.id, currentSample, sampleReplicates[currentSample]?.map(x=>x.well).join('\u0001')])

  // Toggle a replicate on/off from legend or selection chips and keep highlight state aligned.
  const toggleLegendKey = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      let next: string[]
      if (prev.includes(key)) {
        next = prev.filter((k) => k !== key)
      } else {
        const set = new Set([...prev, key])
        next = allKeys.filter((k) => set.has(k))
      }

      setHighlighted((current) => current.filter((name) => {
        const mapped = seriesKeyByName.get(name)
        return !mapped || next.includes(mapped)
      }))

      return next
    })
  }, [allKeys, seriesKeyByName])

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
    setHighlighted((prev) => prev.filter((name) => {
      const mapped = seriesKeyByName.get(name)
      return !mapped || selectedKeys.includes(mapped)
    }))
  }, [selectedKeys, seriesKeyByName])

  // Clear highlight on dataset/mapping change.
  useEffect(() => {
    setHighlighted([])
  }, [selectedDataset?.runId, selectedMapping?.id])

  // Legend appearance knobs.
  // spacing removed entirely
  const [legendVisible, setLegendVisible] = useState(true)
  const [legendTitle, setLegendTitle] = useState('Legend')
  const [legendContentScale, setLegendContentScale] = useState(1)

  // Size adjuster only (spacing buttons removed).
  const adjustLegendContentScale = useCallback((delta: number) => {
    setLegendContentScale((prev) => {
      const next = Math.min(LEGEND_CONTENT_MAX, Math.max(LEGEND_CONTENT_MIN, +(prev + delta).toFixed(2)))
      return Math.round(next * 100) / 100
    })
  }, [])

  // Placement options.
  const legendPlacementOptions: { value: LegendPlacement, label: string }[] = [
    { value: 'below', label: 'Below' },
    { value: 'right', label: 'Side' },
    { value: 'inside', label: 'Inside' },
  ]

  // Assemble legend sections based on current visibility.
  const legendSections = useMemo(() => {
    const sections: { sample: string; replicates: { key: string; label: string; color: string }[] }[] = []
    const sampleColors = selectedMapping?.sampleColors ?? {}

    for (const sampleName of orderedSamples) {
      const reps = sampleReplicates[sampleName] ?? []
      if (!reps.length) continue
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
  }, [orderedSamples, sampleReplicates, selectedKeys, selectedMapping?.sampleColors])

  // Precompute chip metrics (natural widths for one-line chips).
  const legendChipMetrics = useMemo(() => {
    const fontScaleLegend = Math.max(LEGEND_CONTENT_MIN, legendContentScale);

    return legendSections.map(section => {
      const header = section.sample;
      const replicateLabels = section.replicates.map(r => r.label);
      const naturalWidth = minimalChipColumnWidth(header, replicateLabels, fontScaleLegend);
      return {
        sample: section.sample,
        header,
        replicateLabels,
        naturalWidth,
      };
    });
  }, [legendSections, legendContentScale]);

  // Legend renderer (below/right/inside).
  const renderLegend = useCallback(
    (placement: LegendPlacement) => {
      if (!legendVisible || !legendSections.length) return null;

      function LegendContent() {
        const { ref, width: containerWidth } = useMeasuredWidth<HTMLDivElement>();

        const fontScaleLegend = Math.max(LEGEND_CONTENT_MIN, legendContentScale);

        const headerFontSize = Math.round(14 * fontScaleLegend);
        const countFontSize = Math.max(10, Math.round(11 * fontScaleLegend));
        const labelFontSize = Math.max(10, Math.round(12 * fontScaleLegend));
        const swatchSize = Math.max(8, Math.round(CHIP_SWATCH_BASE * fontScaleLegend));
        const swatchRadius = Math.max(3, Math.round(CHIP_SWATCH_RADIUS_BASE * fontScaleLegend));
        const headerGap = Math.max(4, Math.round(6 * 1)); // baseline header↔content gap

        // --- Columns computation targeting single-line chips ---
        // We switch to a flexible row-based layout: variable-width chips, wrapping rows.
        // No internal padding/gaps in the legend container.
        const containerPadding = 0; // no inner padding
        const columnGap = 0;        // no grid gaps (we'll overlap chip borders)

        // Classic "negative wrapper margins" trick so chip borders can visually overlap:
        const chipsRowStyle: CSSProperties = {
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'stretch',
          // These negative margins let each chip add a positive 1px margin so adjacent
          // borders visually sit on top of each other (overlap) without inner gutters.
          margin: '-1px 0 0 -1px',
        };

        // Chip paddings (scale only with legendContentScale)
        const padLR = Math.round(CHIP_HORIZONTAL_PADDING * fontScaleLegend);
        const padTB = Math.round(CHIP_VERTICAL_PADDING * fontScaleLegend);
        const border = CHIP_BORDER * 2;

        // Build chips with SINGLE-LINE replicate content and variable width
        const chips = legendSections.map(section => {
          const header = section.sample;
          const repLabels = section.replicates.map(r => r.label);

          const perTileGap = Math.max(3, Math.round(CHIPS_GAP_BETWEEN_BASE * 1));
          const replicatesWidth =
            repLabels.map(l => estimateReplicateTileWidth(l, fontScaleLegend)).reduce((a,b)=>a+b, 0) +
            (repLabels.length > 1 ? perTileGap * (repLabels.length - 1) : 0);

          const chipInner =
            estimateTextWidth(header, fontScaleLegend) +
            (repLabels.length ? headerGap + replicatesWidth : 0);

          // Variable chip width (no fixed columns). Just content + paddings + border.
          const chipWidth = Math.max(0, chipInner + padLR * 2 + border);

          return { section, chipWidth };
        });

        // Container has NO inner padding/gaps.
        const containerStyle: CSSProperties = {
          resize: placement === 'below' ? 'vertical' : placement === 'right' ? 'horizontal' : 'both',
          overflow: 'auto',
          background: 'rgba(255,255,255,0.92)',
          border: '1px solid rgba(0,0,0,0.12)',
          borderRadius: 10,
          padding: containerPadding,
          display: 'flex',
          flexDirection: 'column',
          gap: 0,                         // no vertical gaps inside the legend box
          minWidth: 0,
          minHeight: placement === 'below' ? 70 : 110,
        };


        return (
          <div ref={ref} style={containerStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
              <strong style={{ fontSize: `${headerFontSize}px` }}>{legendTitle.trim() || 'Legend'}</strong>
              <span className="small" style={{ fontSize: `${countFontSize}px` }}>
                {legendSections.reduce((total, section) => total + section.replicates.length, 0)}
              </span>
            </div>

            <div style={chipsRowStyle}>
              {chips.map(({ section }) => (
                <div
                  key={section.sample}
                  // Variable-width chip driven by content; borders can overlap with neighbors.
                  style={{
                    border: '1px solid rgba(0,0,0,0.08)',
                    borderRadius: 6,
                    padding: `${padTB}px ${padLR}px`,
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: headerGap,
                    minWidth: 0,
                    background: 'rgba(255,255,255,0.7)',
                    whiteSpace: 'nowrap',            // keep replicates on a single line
                    // Overlap neighbor borders by 1px horizontally and vertically:
                    margin: '1px 0 0 1px',
                  }}
                >
                  <strong style={{ fontSize: `${labelFontSize}px` }}>
                    {section.sample}
                  </strong>

                  {/* Replicate tiles – single line, variable total width */}
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: Math.max(3, Math.round(CHIPS_GAP_BETWEEN_BASE * 1)), minWidth: 0 }}>
                    {section.replicates.map((entry) => (
                      <span
                        key={entry.key}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: Math.max(2, Math.round(CHIP_GAP_INNER_BASE * 1)), fontSize: `${labelFontSize}px`, whiteSpace: 'nowrap' }}
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
        );
      }

      const wrapperStyleBelow: CSSProperties = { marginTop: 10, display: 'flex', justifyContent: 'center' };
      const wrapperInnerBelow: CSSProperties = { width: '100%', maxWidth: `calc(100% - ${AXIS_HORIZONTAL_PADDING}px)` };

      if (placement === 'inside') return <LegendContent />;
      if (placement === 'right') return <LegendContent />;
      return (
        <div style={wrapperStyleBelow}>
          <div style={wrapperInnerBelow}>
            <LegendContent />
          </div>
        </div>
      );
    },
    [legendSections, legendChipMetrics, legendVisible, legendTitle, legendContentScale],
  );

  // Replicate selection cards.
  const selectionControls = useMemo(() => {
    const sampleColors = selectedMapping?.sampleColors ?? {}
    const panels: JSX.Element[] = []

    for (const sampleName of orderedSamples) {
      const reps = sampleReplicates[sampleName] ?? []
      if (!reps.length) continue
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
  }, [highlighted, orderedSamples, sampleReplicates, selectedKeys, selectedMapping?.sampleColors, setHighlighted, toggleLegendKey])

  // Heuristic widths to keep side/inside placements readable before measurement stabilizes.
  const minNatural = legendChipMetrics.length
    ? Math.min(...legendChipMetrics.map(m => m.naturalWidth))
    : 220;

  const sideLegendWidth = Math.round(Math.min(520, Math.max(220, minNatural + 32)));
  const sideLegendMinWidth = Math.round(Math.max(200, Math.floor(minNatural * 0.9)));
  const insideLegendMinWidth = Math.round(Math.max(160, Math.floor(minNatural * 0.8)));

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
              {/* Chart font scale */}
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

              {/* Spacing controls removed */}
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
                {selectionControls}
              </div>
            </div>
          </div>

          {/* Per-sample detail chart */}
          <div className="panel" style={{ marginTop: 12 }}>
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
