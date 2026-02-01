import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import SimpleLineChart, { type Series, type SeriesPoint } from '@/components/SimpleLineChart'
import { PanelWithHelp } from '@/components/PanelWithHelp'
import { HelpTooltip } from '@/components/HelpTooltip'
import type { AssignmentEntry } from '@/utils/assignments'
import { formatWellA01 } from '@/utils/csv'
import { generateDistinctColors, hexToHsl, hslToHex } from '@/utils/colors'
import { loess, type NumericPoint, type LoessDiagnostics } from '@/utils/loess'
import { downloadBlob, sanitizeFileName, elementToPngBlob } from '@/utils/export'
import { useApp, type SharedSmoothedContext } from '@/state/store'
import type { LogPhaseSelection, SampleCurvesExportRecord, SmoothedCurvesPayload, WellCurveExportRecord } from '@/types'
import { detectLogPhase, LOG_PHASE_DEFAULTS, type LogPhaseDetectionOptions } from '@/utils/logPhase'

interface SampleWellSeries {
  well: string
  replicate: number
  color: string
  points: SeriesPoint[]
}

interface LoessState {
  label: string
  points: NumericPoint[]
  diagnostics?: LoessDiagnostics
}

interface SampleCurveState {
  sample: string
  color: string
  wells: SampleWellSeries[]
  history: LoessState[]
  rawPoints: NumericPoint[]
}

interface BlankedAssignmentsPayload {
  version?: number
  createdAt?: string
  blanked?: boolean
  assignments?: AssignmentEntry[]
}

type LegendEntry = { id: string; label: string; color: string; hidden?: boolean; kind?: 'series' | 'excluded' }

function FieldWithHelp({
  label,
  help,
  children,
  maxWidth = 200,
}: {
  label: string
  help: string
  children: ReactNode
  maxWidth?: number
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  return (
    <label className="field" style={{ maxWidth }}>
      <div className="field-label-row">
        <span>{label}</span>
        <button
          ref={anchorRef}
          type="button"
          className="field-help-btn"
          onClick={() => setOpen((v) => !v)}
          aria-label={`${label} help`}
        >
          ?
        </button>
        <HelpTooltip anchorRef={anchorRef} open={open}>
          {help}
        </HelpTooltip>
      </div>
      {children}
    </label>
  )
}

function PlotControlsSection({
  title,
  helpContent,
  chartTitle,
  onChartTitleChange,
  xLabel,
  onXLabelChange,
  yLabel,
  onYLabelChange,
  fontScale,
  onFontScaleChange,
  legendOpen,
  onToggleLegend,
  legendPanel,
  onExportPng,
  onCopyPng,
  onResetView,
  isPl,
  disabled,
  extraActions,
}: {
  title: string
  helpContent: string
  chartTitle: string
  onChartTitleChange: (value: string) => void
  xLabel: string
  onXLabelChange: (value: string) => void
  yLabel: string
  onYLabelChange: (value: string) => void
  fontScale: number
  onFontScaleChange: (fn: (value: number) => number) => void
  legendOpen: boolean
  onToggleLegend: () => void
  legendPanel?: ReactNode
  onExportPng: () => void
  onCopyPng: () => void
  onResetView: () => void
  isPl: boolean
  disabled?: boolean
  extraActions?: ReactNode
}) {
  return (
    <PanelWithHelp title={title} helpContent={helpContent} className="panel-soft control-panel">
      <div className="control-grid">
        <label className="field">
          <div className="field-label-row">
            <span>{isPl ? 'Tytuł wykresu' : 'Chart title'}</span>
          </div>
          <input
            className="field-input"
            value={chartTitle}
            onChange={(e) => onChartTitleChange(e.target.value)}
            disabled={disabled}
          />
        </label>
        <label className="field">
          <div className="field-label-row">
            <span>{isPl ? 'Oś X' : 'X axis'}</span>
          </div>
          <input
            className="field-input"
            value={xLabel}
            onChange={(e) => onXLabelChange(e.target.value)}
            disabled={disabled}
          />
        </label>
        <label className="field">
          <div className="field-label-row">
            <span>{isPl ? 'Oś Y' : 'Y axis'}</span>
          </div>
          <input
            className="field-input"
            value={yLabel}
            onChange={(e) => onYLabelChange(e.target.value)}
            disabled={disabled}
          />
        </label>
      </div>
      <div className="control-row">
        <div className="btn-pair">
          <button
            className="btn"
            onClick={() => onFontScaleChange((s) => Math.max(0.6, +(s - 0.1).toFixed(1)))}
            disabled={disabled}
            title={isPl ? 'Mniejsza czcionka' : 'Smaller text'}
          >
            A-
          </button>
          <button
            className="btn"
            onClick={() => onFontScaleChange((s) => Math.min(2, +(s + 0.1).toFixed(1)))}
            disabled={disabled}
            title={isPl ? 'Większa czcionka' : 'Larger text'}
          >
            A+
          </button>
        </div>
        <div className="control-actions control-actions--tight">
          <button className="btn" type="button" onClick={onExportPng} disabled={disabled}>
            {isPl ? 'Eksportuj PNG' : 'Export PNG'}
          </button>
          <button className="btn" type="button" onClick={onCopyPng} disabled={disabled}>
            {isPl ? 'Kopiuj PNG' : 'Copy PNG'}
          </button>
          {extraActions}
          <label
            className={`parameters-toggle ${legendOpen ? 'is-on' : ''}`}
            title={
              legendOpen
                ? isPl
                  ? 'Ukryj legendę'
                  : 'Hide legend'
                : isPl
                  ? 'Pokaż legendę'
                  : 'Show legend'
            }
          >
            <input
              type="checkbox"
              checked={legendOpen}
              onChange={onToggleLegend}
              disabled={disabled}
              aria-pressed={legendOpen}
            />
            <span className="parameters-toggle__slider" aria-hidden />
            <span className="parameters-toggle__label">
              {legendOpen ? (isPl ? 'Ukryj legendę' : 'Hide legend') : isPl ? 'Legenda' : 'Legend'}
            </span>
          </label>
          <button
            className="btn basic-btn"
            type="button"
            onClick={onResetView}
            disabled={disabled}
            aria-label={isPl ? 'Reset widoku' : 'Reset view'}
            title={isPl ? 'Reset widoku' : 'Reset view'}
          >
            {isPl ? 'Reset widoku' : 'Reset view'}
          </button>
        </div>
      </div>
      {legendPanel}
    </PanelWithHelp>
  )
}

const DEFAULT_COLOR = '#2563eb'
const DEFAULT_SPAN = '60'
const DEFAULT_SPAN_NUM = Number(DEFAULT_SPAN) || 60

function safeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function getTimeMinutes(row: any): number {
  const direct =
    safeNumber(row.time_min) ??
    safeNumber(row.timeMinutes) ??
    safeNumber(row.time_minutes)
  if (direct != null) return direct
  const seconds =
    safeNumber(row.time_seconds) ??
    safeNumber(row.timeSeconds)
  if (seconds != null) return seconds / 60
  return 0
}

function getCorrectedValue(row: any): number | null {
  const candidates = [
    safeNumber(row.val_od600_blank_corrected),
    safeNumber(row.val_od600),
    safeNumber(row.value),
  ]
  for (const candidate of candidates) {
    if (candidate != null) return candidate
  }
  return null
}

function replicateColor(base: string, replicate: number): string {
  if (replicate <= 1) return base
  const { h, s, l } = hexToHsl(base)
  const idx = (replicate - 1) % 4
  if (idx === 1) return hslToHex(h, Math.min(100, s + 5), Math.min(100, l + 8))
  if (idx === 2) return hslToHex(h, Math.max(0, s - 6), Math.max(0, l - 10))
  return hslToHex((h + 12) % 360, s, l)
}

function buildCurvesFromEntry(entry?: AssignmentEntry | null): SampleCurveState[] {
  if (!entry?.dataset?.rows?.length) return []

  const usableRows = entry.dataset.rows.filter(
    (row: any) => !row?.curation?.excluded,
  )
  if (!usableRows.length) return []

  const mappingSamples = entry.mapping?.samples ?? []
  const fallbackColors = generateDistinctColors(Math.max(mappingSamples.length || 1, 4))
  const colorBySample = new Map<string, string>()
  mappingSamples.forEach((sample, index) => {
    const base = sample.color ?? fallbackColors[index % fallbackColors.length] ?? DEFAULT_COLOR
    colorBySample.set(sample.name, base)
  })

  const replicateByWell: Record<string, number> = {}
  mappingSamples.forEach((sample) => {
    sample.wells?.forEach((well, idx) => {
      const formatted = formatWellA01(well)
      if (!formatted) return
      replicateByWell[formatted] = idx + 1
    })
  })

  const orderIndex = new Map<string, number>()
  mappingSamples.forEach((sample, idx) => orderIndex.set(sample.name, idx))

  const sampleMap = new Map<
    string,
    { sample: string; color: string; wells: SampleWellSeries[] }
  >()

  usableRows.forEach((row: any) => {
    const rawSample = typeof row.sample === 'string' ? row.sample.trim() : ''
    const sampleName = rawSample || formatWellA01(row.well) || 'Unknown'
    const wellRaw = formatWellA01(row.well)
    if (!wellRaw) return
    const timeMin = getTimeMinutes(row)
    const value = getCorrectedValue(row)
    if (value == null) return
    const replicate =
      safeNumber(row.replicate) ?? replicateByWell[wellRaw] ?? 1

    if (!sampleMap.has(sampleName)) {
      const color = colorBySample.get(sampleName) ?? fallbackColors[sampleMap.size % fallbackColors.length] ?? DEFAULT_COLOR
      sampleMap.set(sampleName, { sample: sampleName, color, wells: [] })
    }
    const sampleEntry = sampleMap.get(sampleName)!
    let wellEntry = sampleEntry.wells.find((w) => w.well === wellRaw)
    if (!wellEntry) {
      wellEntry = {
        well: wellRaw,
        replicate: Number(replicate) || 1,
        color: replicateColor(sampleEntry.color, Number(replicate) || 1),
        points: [],
      }
      sampleEntry.wells.push(wellEntry)
    }
    wellEntry.points.push({
      x: timeMin,
      y: value,
      id: `${sampleName}|${wellRaw}|${timeMin.toFixed(6)}|${wellEntry.points.length}`,
      meta: { sample: sampleName, well: wellRaw, replicate: wellEntry.replicate },
    })
  })

  const samples = Array.from(sampleMap.values()).map<SampleCurveState>((entry) => {
    entry.wells.forEach((well) => well.points.sort((a, b) => a.x - b.x))
    const aggregated = entry.wells
      .flatMap((well) => well.points.map((p) => ({ x: p.x, y: p.y })))
      .sort((a, b) => a.x - b.x)
    return {
      sample: entry.sample,
      color: entry.color,
      wells: entry.wells.sort((a, b) => {
        const cmp = a.replicate - b.replicate
        if (cmp !== 0) return cmp
        return a.well.localeCompare(b.well, undefined, { numeric: true })
      }),
      history: [{ label: 'Raw', points: aggregated }],
    rawPoints: aggregated,
  }
})

return samples.sort((a, b) => {
  const orderA = orderIndex.has(a.sample) ? orderIndex.get(a.sample)! : Number.MAX_SAFE_INTEGER
  const orderB = orderIndex.has(b.sample) ? orderIndex.get(b.sample)! : Number.MAX_SAFE_INTEGER
  if (orderA !== orderB) return orderA - orderB
  return a.sample.localeCompare(b.sample, undefined, { numeric: true })
})
}

function buildCurvesFromSmoothed(payload: SmoothedCurvesPayload | null | undefined): SampleCurveState[] {
  if (!payload?.samples?.length) return []
  const wellCurves = Array.isArray(payload.well_curves) ? payload.well_curves : []
  return payload.samples.map((sample) => {
    const wellsFromPayload: Record<string, SampleWellSeries> = {}
    wellCurves
      .filter((entry) => entry.sample === sample.sample)
      .forEach((entry) => {
        const timeRaw = Array.isArray(entry.time_min) ? entry.time_min : []
        const valsRaw =
          (Array.isArray(entry.od600_smoothed) && entry.od600_smoothed) ||
          (Array.isArray(entry.od600_blank_corrected) && entry.od600_blank_corrected) ||
          (Array.isArray(entry.od600_raw) && entry.od600_raw) ||
          []
        const len = Math.min(timeRaw.length, valsRaw.length)
        const pts: NumericPoint[] = []
        for (let i = 0; i < len; i += 1) {
          const t = Number(timeRaw[i] ?? NaN)
          const v = Number(valsRaw[i] ?? NaN)
          if (!Number.isFinite(t) || !Number.isFinite(v)) continue
          pts.push({ x: t, y: v })
        }
        wellsFromPayload[entry.well] = {
          well: entry.well,
          replicate: entry.replicate ?? 1,
          color: sample.color,
          points: pts.sort((a, b) => a.x - b.x),
        }
      })

    let wells: SampleWellSeries[] = []
    if (sample.wells?.length) {
      wells = sample.wells.map<SampleWellSeries>((well) => {
        const found = wellsFromPayload[well.well]
        if (found) return found
        return {
          well: well.well,
          replicate: well.replicate ?? 1,
          color: sample.color,
          points: [],
        }
      })
    } else {
      wells = Object.values(wellsFromPayload)
    }

    const history = (sample.history ?? []).map((state) => ({
      label: state.label,
      points: state.points.map((pt) => ({ x: Number(pt.x ?? 0), y: Number(pt.y ?? 0) })),
    }))
    const rawPoints =
      history?.[0]?.points?.length
        ? history[0].points
        : Object.values(wellsFromPayload)
            .flatMap((well) => well.points)
            .sort((a, b) => a.x - b.x)

    return {
      sample: sample.sample,
      color: sample.color,
      wells,
      history,
      rawPoints: rawPoints ?? [],
    }
  })
}

function buildLogPhaseMap(entries?: LogPhaseSelection[] | null): Record<string, LogPhaseSelection> {
  if (!entries?.length) return {}
  const map: Record<string, LogPhaseSelection> = {}
  entries.forEach((entry) => {
    if (!entry?.sample) return
    map[entry.sample] = entry
  })
  return map
}

function clampRange(range: { start: number; end: number } | null): { start: number; end: number } | null {
  if (!range) return null
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) return null
  if (range.start === range.end) return null
  const start = Math.min(range.start, range.end)
  const end = Math.max(range.start, range.end)
  return { start, end }
}

function countMappedSamples(entry?: AssignmentEntry | null): number {
  if (!entry?.mapping?.samples?.length) return 0
  return entry.mapping.samples.filter((sample) => (sample?.wells?.length ?? 0) > 0).length
}

function buildSmoothedPayload(
  curves: SampleCurveState[],
  meta: AssignmentEntry['dataset']['meta'] | undefined,
  span: string,
  degree: 1 | 2,
  filename: string,
  sampleCurves?: SampleCurvesExportRecord[] | null,
  wellCurves?: WellCurveExportRecord[] | null,
  existingLogPhases?: SmoothedCurvesPayload['logPhases']
): SmoothedCurvesPayload | null {
  if (!curves.length) return null
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: {
      file: meta?.sourceFile ?? filename ?? '',
      runId: meta?.runId ?? '',
      plateId: meta?.plateId ?? '',
    },
    smoothing: {
      span,
      degree,
    },
    sample_curves: sampleCurves ?? undefined,
    well_curves: wellCurves ?? undefined,
    samples: curves.map((curve) => ({
      sample: curve.sample,
      color: curve.color,
      wells: curve.wells.map((well) => ({ well: well.well, replicate: well.replicate })),
      history: curve.history.map((state) => ({
        label: state.label,
        points: state.points.map((point) => ({ x: point.x, y: point.y })),
      })),
    })),
    logPhases: existingLogPhases,
  }
}

function buildSampleCurvesExport(curves: SampleCurveState[]): SampleCurvesExportRecord[] {
  return curves
    .map((curve) => {
      const latest = curve.history?.[curve.history.length - 1]
      if (!latest?.points?.length) return null
      return {
        sample: curve.sample,
        time_min: latest.points.map((point) => Number(point.x ?? 0)),
        od600_smoothed_vals: latest.points.map((point) => Number(point.y ?? 0)),
      }
    })
    .filter((entry): entry is SampleCurvesExportRecord => Boolean(entry))
}

function buildWellCurvesExport(curves: SampleCurveState[]): WellCurveExportRecord[] {
  return curves.flatMap((curve) => {
    return (curve.wells ?? []).map((well) => {
      const time_min = (well.points ?? []).map((p) => Number(p.x ?? 0))
      const od600_blank_corrected = (well.points ?? []).map((p) => Number(p.y ?? 0))
      return {
        sample: curve.sample,
        well: well.well,
        replicate: well.replicate,
        time_min,
        od600_blank_corrected,
      }
    })
  })
}

function cloneLogPhasePoints(points?: LogPhaseSelection['points']): LogPhaseSelection['points'] | undefined {
  if (!points?.length) return undefined
  const sanitized = points
    .map((point) => ({
      t_min: Number(point.t_min),
      od600: Number(point.od600),
    }))
    .filter((point) => Number.isFinite(point.t_min) && Number.isFinite(point.od600))
  return sanitized.length ? sanitized : undefined
}

function cloneLogPhaseEntry(entry: LogPhaseSelection): LogPhaseSelection {
  return {
    ...entry,
    points: cloneLogPhasePoints(entry.points),
  }
}

function collectLogPhasePointsFromIndices(
  points: NumericPoint[],
  indices: number[]
): LogPhaseSelection['points'] | undefined {
  if (!indices?.length) return undefined
  const subset = indices
    .map((idx) => points[idx])
    .filter((point): point is NumericPoint => Boolean(point) && Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({
      t_min: Number(point.x),
      od600: Number(point.y),
    }))
  return subset.length ? subset : undefined
}

function collectLogPhasePointsInRange(
  points: NumericPoint[],
  range: { start: number; end: number }
): LogPhaseSelection['points'] | undefined {
  if (!points?.length || !Number.isFinite(range.start) || !Number.isFinite(range.end)) return undefined
  const start = Math.min(range.start, range.end)
  const end = Math.max(range.start, range.end)
  const subset = points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= start && point.x <= end)
    .map((point) => ({
      t_min: Number(point.x),
      od600: Number(point.y),
    }))
  return subset.length ? subset : undefined
}

function annotateSmoothedSamples(
  payload: SmoothedCurvesPayload,
  logPhases: LogPhaseSelection[]
): SmoothedCurvesPayload {
  if (!logPhases.length) {
    return {
      ...payload,
      logPhases: undefined,
    }
  }
  const phaseMap = new Map(logPhases.map((entry) => [entry.sample, entry]))
  const samplesWithAnnotations = payload.samples.map((sample) => {
    const phase = phaseMap.get(sample.sample)
    if (!phase) return sample
    return {
      ...sample,
      history: sample.history.map((state) => ({
        ...state,
        points: state.points.map((point) => {
          if (
            Number.isFinite(phase.start) &&
            Number.isFinite(phase.end) &&
            point.x >= phase.start &&
            point.x <= phase.end
          ) {
            return { ...point, logPhase: true }
          }
          if ('logPhase' in point && point.logPhase) {
            const clone = { ...point }
            delete clone.logPhase
            return clone
          }
          return point
        }),
      })),
    }
  })
  return {
    ...payload,
    samples: samplesWithAnnotations,
    logPhases: logPhases.map((entry) => cloneLogPhaseEntry(entry)),
  }
}

function parsePositiveNumber(value: string, fallback: number, allowZero = false): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  if (allowZero) {
    return parsed >= 0 ? parsed : fallback
  }
  return parsed > 0 ? parsed : fallback
}

function computeAutoLogPhaseUpdates(
  curves: SampleCurveState[],
  samples: Iterable<string>,
  timestamp: string,
  detectionOptions: LogPhaseDetectionOptions,
  existingLogPhases?: Record<string, LogPhaseSelection>,
  respectManual = true
): Record<string, LogPhaseSelection | null> {
  const targetSet = new Set(samples)
  if (!targetSet.size) return {}
  const updates: Record<string, LogPhaseSelection | null> = {}
  curves.forEach((curve) => {
    if (!targetSet.has(curve.sample)) return
    const existing = existingLogPhases?.[curve.sample]
    if (respectManual && existing?.manual) {
      return
    }
    const latest = curve.history?.[curve.history.length - 1]
    if (!latest?.points?.length) {
      updates[curve.sample] = null
      return
    }
    const detection = detectLogPhase(latest.points, detectionOptions)
    if (!detection.indices.length || detection.startTime == null || detection.endTime == null) {
      updates[curve.sample] = null
      return
    }
    updates[curve.sample] = {
      sample: curve.sample,
      start: detection.startTime,
      end: detection.endTime,
      createdAt: timestamp,
      manual: false,
    }
  })
  return updates
}

export default function CurvesSmoothing() {
  const autoAssignments = useApp((s) => s.curvesSmoothingAssignments)
  const sharedSmoothed = useApp((s) => s.curvesSmoothingSmoothed)
  const setSharedSmoothed = useApp((s) => s.setCurvesSmoothingSmoothed)
  const setActiveTab = useApp((s) => s.setActiveTab)
  const autoRun = useApp((s) => s.autoRun)
  const setAutoRun = useApp((s) => s.setAutoRun)
  const isPl = useApp((s) => s.language === 'pl')
  const [assignments, setAssignments] = useState<AssignmentEntry[]>([])
  const [activeEntryIndex, setActiveEntryIndex] = useState(0)
  const [curves, setCurves] = useState<SampleCurveState[]>([])
  const [selectedSamples, setSelectedSamples] = useState<string[]>([])
  const [spanInput, setSpanInput] = useState<string>(DEFAULT_SPAN)
  const [degree, setDegree] = useState<1 | 2>(1)
  const [robustPasses, setRobustPasses] = useState<number>(3)
  const [combinedUncertainty, setCombinedUncertainty] = useState<'none' | 'pointwise' | 'simultaneous'>('pointwise')
  const [maxRefinements, setMaxRefinements] = useState<number>(3)
  const [convergenceTol, setConvergenceTol] = useState<number>(0.0001)
  const [status, setStatus] = useState<string>('')
  const [filename, setFilename] = useState<string>('')
  const [combinedShowPoints, setCombinedShowPoints] = useState<boolean>(true)
  const [logShowPoints, setLogShowPoints] = useState<boolean>(true)
  const [chartResetKey, setChartResetKey] = useState<number>(0)
  const [logChartResetKey, setLogChartResetKey] = useState<number>(0)
  const [combinedTitle, setCombinedTitle] = useState<string>('Curves smoothing')
  const [combinedXLabel, setCombinedXLabel] = useState<string>('Time (min)')
  const [combinedYLabel, setCombinedYLabel] = useState<string>('OD600 (blank-corrected)')
  const [combinedFontScale, setCombinedFontScale] = useState<number>(1)
  const [logTitle, setLogTitle] = useState<string>('Log phase preview')
  const [logXLabel, setLogXLabel] = useState<string>('Time (min)')
  const [logYLabel, setLogYLabel] = useState<string>('ln(OD600)')
  const [logFontScale, setLogFontScale] = useState<number>(1)
  const [chartFullscreen, setChartFullscreen] = useState<'combined' | 'log' | null>(null)
  const [showPlotControls, setShowPlotControls] = useState(true)
  const [showSamplePanel, setShowSamplePanel] = useState(false)
  const [showInfoHelp, setShowInfoHelp] = useState(false)
  const [combinedLegendVisible, setCombinedLegendVisible] = useState(false)
  const [logLegendVisible, setLogLegendVisible] = useState(false)
  const [combinedLegendEntries, setCombinedLegendEntries] = useState<LegendEntry[]>([])
  const [logLegendEntries, setLogLegendEntries] = useState<LegendEntry[]>([])
  const [combinedLegendScale, setCombinedLegendScale] = useState<number>(1)
  const [logLegendScale, setLogLegendScale] = useState<number>(1)
  const [combinedLegendTitle, setCombinedLegendTitle] = useState<string>('Legenda')
  const [logLegendTitle, setLogLegendTitle] = useState<string>('Legenda')
  const combinedChartRef = useRef<HTMLDivElement | null>(null)
  const logChartRef = useRef<HTMLDivElement | null>(null)
  const [samplePanelMaxHeight, setSamplePanelMaxHeight] = useState<number | undefined>(undefined)
  const samplePanelRef = useRef<HTMLDivElement | null>(null)
  const logPanelRef = useRef<HTMLDivElement | null>(null)
  const samplePanelRafRef = useRef<number | null>(null)
  const infoHelpAnchorRef = useRef<HTMLButtonElement | null>(null)
  const [logPhases, setLogPhases] = useState<Record<string, LogPhaseSelection>>(
    () => buildLogPhaseMap(sharedSmoothed?.smoothed?.logPhases),
  )
  const [pendingLogRange, setPendingLogRange] = useState<{ start: number; end: number } | null>(null)
  const [pendingLogRangeDirty, setPendingLogRangeDirty] = useState(false)
  const [smoothedPayload, setSmoothedPayload] = useState<SmoothedCurvesPayload | null>(
    sharedSmoothed?.smoothed ?? null,
  )
  const [blankedInfo, setBlankedInfo] = useState<{ version?: number; createdAt?: string; blanked?: boolean } | null>(
    null,
  )
  const [loessProgress, setLoessProgress] = useState<number | null>(null)
  const [autoWindowSize, setAutoWindowSize] = useState<string>(String(LOG_PHASE_DEFAULTS.windowSize))
  const [autoR2Min, setAutoR2Min] = useState<string>(String(LOG_PHASE_DEFAULTS.r2Min))
  const [autoOdMin, setAutoOdMin] = useState<string>(String(LOG_PHASE_DEFAULTS.odMin))
  const [autoFracKMax, setAutoFracKMax] = useState<string>(String(LOG_PHASE_DEFAULTS.fracKMax))
  const [autoMuRelMin, setAutoMuRelMin] = useState<string>(String(LOG_PHASE_DEFAULTS.muRelMin))
  const [autoMuRelMax, setAutoMuRelMax] = useState<string>(String(LOG_PHASE_DEFAULTS.muRelMax))
  const [activeSample, setActiveSample] = useState<string | null>(null)
  const [isLoessRunning, setIsLoessRunning] = useState<boolean>(false)
  const sampleHelpAnchorRef = useRef<HTMLButtonElement | null>(null)
  const [showSampleHelp, setShowSampleHelp] = useState(false)
  const sampleHelpBanner = isPl
    ? 'Kliknij na próbę lub użyj strzalek góra/dół na klawiaturze, aby nawigować. Możesz wybrać fazę log ręcznie używając Shift.'
    : 'Click a sample or use Up/Down arrows to navigate. You can select the log phase manually using Shift.'
  const updateSamplePanelHeight = useCallback(() => {
    if (samplePanelRafRef.current !== null) {
      cancelAnimationFrame(samplePanelRafRef.current)
    }
    samplePanelRafRef.current = requestAnimationFrame(() => {
      const samplePanelEl = samplePanelRef.current
      const logPanelEl = logPanelRef.current
      if (!samplePanelEl || !logPanelEl) {
        setSamplePanelMaxHeight(undefined)
        samplePanelRafRef.current = null
        return
      }
      const panelTop = samplePanelEl.getBoundingClientRect().top + window.scrollY
      const logBottom = logPanelEl.getBoundingClientRect().bottom + window.scrollY
      if (!Number.isFinite(panelTop) || !Number.isFinite(logBottom) || logBottom <= panelTop) {
        setSamplePanelMaxHeight(undefined)
        samplePanelRafRef.current = null
        return
      }
      const nextHeight = Math.max(logBottom - panelTop, 240)
      const rounded = Math.round(nextHeight)
      setSamplePanelMaxHeight((prev) => (prev === rounded ? prev : rounded))
      samplePanelRafRef.current = null
    })
  }, [])

  useEffect(
    () => () => {
      if (samplePanelRafRef.current !== null) {
        cancelAnimationFrame(samplePanelRafRef.current)
        samplePanelRafRef.current = null
      }
    },
    [],
  )

  const applyLogPhaseUpdates = useCallback((updates: Record<string, LogPhaseSelection | null>) => {
    const entries = Object.entries(updates)
    if (!entries.length) return
    setLogPhases((prev) => {
      let mutated = false
      const next = { ...prev }
      entries.forEach(([sample, selection]) => {
        if (selection) {
          next[sample] = selection
          mutated = true
        } else if (next[sample]) {
          delete next[sample]
          mutated = true
        }
      })
      return mutated ? next : prev
    })
  }, [setLogPhases])

  const activeEntry = assignments[activeEntryIndex] ?? null
  const chartDatasetKey = useMemo(() => {
    if (!activeEntry) return 'none'
    const meta = activeEntry.dataset?.meta
    const rows = activeEntry.dataset?.rows?.length ?? 0
    return `${meta?.runId ?? ''}|${meta?.sourceFile ?? ''}|${meta?.createdAt ?? ''}|${rows}`
  }, [activeEntry])
  useEffect(() => {
    setChartResetKey((key) => key + 1)
  }, [chartDatasetKey])
  useEffect(() => {
    if (!chartFullscreen) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setChartFullscreen(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [chartFullscreen])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      if (tag && ['input', 'textarea', 'select'].includes(tag)) return
      if (target?.isContentEditable) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'r' || event.key === 'R') {
        event.preventDefault()
        setChartResetKey((k) => k + 1)
        setLogChartResetKey((k) => k + 1)
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler as any, { capture: true } as any)
  }, [])

  useEffect(() => {
    if (!chartFullscreen) return
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      if (tag && ['input', 'textarea', 'select'].includes(tag)) return
      if (target?.isContentEditable) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'r' || event.key === 'R') {
        event.preventDefault()
        setChartResetKey((k) => k + 1)
        setLogChartResetKey((k) => k + 1)
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler as any, { capture: true } as any)
  }, [chartFullscreen])

  const makeSafeName = useCallback((raw: string, fallback: string) => {
    const safe = sanitizeFileName(raw || fallback)
    return safe || sanitizeFileName(fallback) || 'chart'
  }, [])

  const buildPngBlob = useCallback(
    async (ref: MutableRefObject<HTMLDivElement | null>): Promise<Blob | null> => {
      if (typeof window === 'undefined') return null
      const node = ref.current
      if (!node) return null
      try {
        const svgNode = node.querySelector('svg') as SVGSVGElement | null
        const target = svgNode ?? node
        return await elementToPngBlob(target, { scale: Math.min(3, Math.max(1.5, window.devicePixelRatio || 2)) })
      } catch (error) {
        console.error('PNG export error', error)
        setStatus('[ERR] Eksport PNG nie powiodl sie.')
        return null
      }
    },
    [setStatus],
  )

  const exportPng = useCallback(
    async (ref: MutableRefObject<HTMLDivElement | null>, baseName: string) => {
      const blob = await buildPngBlob(ref)
      if (!blob) {
        setStatus('[ERR] Nie udalo sie przygotowac PNG (sprobuj ponownie).')
        return
      }
      const name = `${makeSafeName(baseName, 'chart')}.png`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    },
    [buildPngBlob, makeSafeName, setStatus],
  )

  const copyPng = useCallback(
    async (ref: MutableRefObject<HTMLDivElement | null>, baseName: string) => {
      const blob = await buildPngBlob(ref)
      if (!blob) {
        setStatus('[ERR] Nie udalo sie skopiowac PNG (sprobuj ponownie).')
        return
      }
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard && 'write' in navigator.clipboard) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          return
        } catch {
          // fallback to download
        }
      }
      const name = `${makeSafeName(baseName, 'chart')}.png`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    },
    [buildPngBlob, makeSafeName, setStatus],
  )
  const autoAssignmentsKey = useMemo(() => {
    if (!autoAssignments || !autoAssignments.length) return ''
    return autoAssignments
      .map(
        (entry) =>
          `${entry?.dataset?.meta?.runId ?? 'na'}|${entry?.dataset?.rows?.length ?? 0}|${
            countMappedSamples(entry) ?? 0
          }`
      )
      .join('||')
  }, [autoAssignments])
  const mappingSamples = activeEntry?.mapping?.samples ?? []
  const sharedLogPhases = sharedSmoothed?.smoothed?.logPhases ?? []
  const sharedLogKey = sharedLogPhases.length
    ? sharedLogPhases.map((entry) => `${entry.sample}:${entry.start}:${entry.end}`).join('|')
    : ''
  const activeMeta = activeEntry?.dataset?.meta
  const activeMetaKey = `${activeMeta?.runId ?? ''}|${activeMeta?.sourceFile ?? ''}|${activeMeta?.plateId ?? ''}`
  const logPhasesKey = useMemo(
    () =>
      Object.entries(logPhases)
        .map(([sample, entry]) => `${sample}:${entry.start}:${entry.end}`)
        .sort()
        .join('|'),
    [logPhases],
  )
  const logPhaseList = useMemo(() => Object.values(logPhases), [logPhasesKey])
  const sampleCurvesExport = useMemo(() => buildSampleCurvesExport(curves), [curves])
  const wellCurvesExport = useMemo(() => buildWellCurvesExport(curves), [curves])
  const buildSharedContext = useCallback(
    (payload: SmoothedCurvesPayload | null): SharedSmoothedContext | null => {
      if (!payload) return null
      const sharedLogPhases = payload.logPhases?.length ? payload.logPhases.map((entry) => cloneLogPhaseEntry(entry)) : undefined
      const assignmentForShare =
        activeEntry && activeEntry.dataset
          ? {
              ...activeEntry,
              dataset: {
                ...activeEntry.dataset,
                sample_curves: sampleCurvesExport,
                well_curves: wellCurvesExport,
                log_phases: sharedLogPhases,
              },
            }
          : null
      const assignmentsWithCurves =
        assignments.length && (sampleCurvesExport.length || wellCurvesExport.length || (sharedLogPhases?.length ?? 0))
          ? assignments.map((entry, index) => {
              if (!entry?.dataset) return entry
              if (index !== activeEntryIndex) return entry
              return {
                ...entry,
                dataset: {
                  ...entry.dataset,
                  sample_curves: sampleCurvesExport,
                  well_curves: wellCurvesExport,
                  log_phases: sharedLogPhases,
                },
              }
            })
          : assignments
      const sharedRawPayload: any =
        assignmentsWithCurves.length
          ? {
              version: blankedInfo?.version ?? 5,
              createdAt: blankedInfo?.createdAt ?? new Date().toISOString(),
              blanked: blankedInfo?.blanked ?? true,
              assignments: assignmentsWithCurves,
            }
          : payload
      return {
        smoothed: payload,
        assignment: assignmentForShare,
        rawPayload: sharedRawPayload,
        blankedInfo: blankedInfo ?? undefined,
        filename,
      }
    },
    [activeEntry, activeEntryIndex, assignments, blankedInfo, filename, sampleCurvesExport, wellCurvesExport],
  )

  useEffect(() => {
    if (!curves.length) {
      setSmoothedPayload(null)
      setSharedSmoothed(null)
      return
    }
    const payload = buildSmoothedPayload(
      curves,
      activeMeta,
      spanInput,
      degree,
      filename,
      sampleCurvesExport,
      wellCurvesExport,
      logPhaseList.length ? logPhaseList : undefined,
    )
    if (!payload) {
      setSmoothedPayload(null)
      setSharedSmoothed(null)
      return
    }
    setSmoothedPayload(payload)
    const shared = buildSharedContext(payload)
    setSharedSmoothed(shared)
  }, [
    activeEntry,
    activeEntryIndex,
    activeMeta,
    assignments,
    blankedInfo,
    curves,
    degree,
    filename,
      logPhaseList,
      buildSharedContext,
    sampleCurvesExport,
    wellCurvesExport,
    setSharedSmoothed,
    spanInput,
  ])

  const mappingSampleKey = useMemo(
    () =>
      mappingSamples
        .map((sample) => `${sample?.name ?? ''}|${sample?.wells?.length ?? 0}`)
        .join('\u0001'),
    [mappingSamples]
  )
  const selectedSamplesKey = useMemo(
    () => selectedSamples.join('\u0001'),
    [selectedSamples],
  )
  const logDetectionOptions = useMemo<LogPhaseDetectionOptions>(() => {
    const windowSize = Math.max(2, Math.round(parsePositiveNumber(autoWindowSize, LOG_PHASE_DEFAULTS.windowSize)))
    const r2MinRaw = parsePositiveNumber(autoR2Min, LOG_PHASE_DEFAULTS.r2Min, true)
    const odMin = parsePositiveNumber(autoOdMin, LOG_PHASE_DEFAULTS.odMin)
    const fracKMaxRaw = parsePositiveNumber(autoFracKMax, LOG_PHASE_DEFAULTS.fracKMax, true)
    const muRelMinRaw = parsePositiveNumber(autoMuRelMin, LOG_PHASE_DEFAULTS.muRelMin)
    const muRelMaxRaw = parsePositiveNumber(autoMuRelMax, LOG_PHASE_DEFAULTS.muRelMax)
    const r2Min = Math.min(0.9999, Math.max(0.1, r2MinRaw))
    const fracKMax = Math.min(0.95, Math.max(0.05, fracKMaxRaw))
    const muRelMin = Math.max(0.1, muRelMinRaw)
    const muRelMax = Math.max(muRelMin + 1e-3, muRelMaxRaw)
    return {
      windowSize,
      r2Min,
      odMin,
      fracKMax,
      muRelMin,
      muRelMax,
    }
  }, [autoWindowSize, autoR2Min, autoOdMin, autoFracKMax, autoMuRelMin, autoMuRelMax])
  const primaryLogSample = useMemo(() => {
    if (!selectedSamples.length) return ''
    const available = new Set(curves.map((curve) => curve.sample))
    const match = selectedSamples.find((sample) => available.has(sample))
    return match ?? ''
  }, [curves, selectedSamplesKey])

  useEffect(() => {
    if (!sharedSmoothed) {
      setLogPhases({})
      return
    }
    setLogPhases(buildLogPhaseMap(sharedLogPhases))
  }, [sharedLogKey])

  useEffect(() => {
    if (!primaryLogSample) {
      setPendingLogRange(null)
      setPendingLogRangeDirty(false)
      return
    }
    const entry = logPhases[primaryLogSample]
    if (entry) {
      setPendingLogRange({ start: entry.start, end: entry.end })
      setPendingLogRangeDirty(false)
    } else {
      setPendingLogRange(null)
      setPendingLogRangeDirty(false)
    }
  }, [primaryLogSample, logPhasesKey])

  // Automatycznie zapisuj recznie zaznaczony zakres dla aktywnej prï¿½by
  // (zeby nie ginal przy zmianie prï¿½by / powrocie).
  useEffect(() => {
    if (!primaryLogSample) return
    if (!pendingLogRangeDirty) return
    const normalized = clampRange(pendingLogRange)
    if (!normalized) return
    setLogPhases((prev) => {
      const existing = prev[primaryLogSample]
      const same =
        existing &&
        Math.abs(existing.start - normalized.start) < 1e-9 &&
        Math.abs(existing.end - normalized.end) < 1e-9 &&
        existing.manual
      if (same) return prev
      return {
        ...prev,
        [primaryLogSample]: {
          sample: primaryLogSample,
          start: normalized.start,
          end: normalized.end,
          createdAt: existing?.createdAt ?? new Date().toISOString(),
          manual: true,
        },
      }
    })
    setPendingLogRangeDirty(false)
  }, [pendingLogRange, pendingLogRangeDirty, primaryLogSample, setLogPhases])

  const activeLogCurve = useMemo(
    () => curves.find((curve) => curve.sample === primaryLogSample) ?? null,
    [curves, primaryLogSample]
  )
  const latestLogHistory = activeLogCurve?.history?.[activeLogCurve.history.length - 1] ?? null
  const hasSmoothedLogHistory = (activeLogCurve?.history?.length ?? 0) > 1
  const highlightRange = clampRange(
    pendingLogRange ?? (primaryLogSample ? logPhases[primaryLogSample] ?? null : null)
  )
  const highlightBands = highlightRange
    ? [
        {
          start: highlightRange.start,
          end: highlightRange.end,
          color: '#facc15',
          opacity: 0.2,
        },
      ]
    : undefined
  const logLineSeries = useMemo<Series[]>(
    () => {
      if (!activeLogCurve || !latestLogHistory || !hasSmoothedLogHistory) return []
      return [
        {
          name: `${activeLogCurve.sample} LOESS`,
          color: activeLogCurve.color,
          points: latestLogHistory.points.map((point, index) => ({
            x: point.x,
            y: Math.log(Math.max(1e-6, point.y)),
            id: `${activeLogCurve.sample}|loess|${index}`,
          })),
        },
      ]
    },
    [activeLogCurve, latestLogHistory, hasSmoothedLogHistory]
  )
  const logScatterSeries = useMemo<Series[]>(
    () => {
      if (!activeLogCurve) return []
      return [
        {
          name: `${activeLogCurve.sample} raw`,
          color: activeLogCurve.color,
          points: activeLogCurve.rawPoints.map((point, index) => ({
            x: point.x,
            y: Math.log(Math.max(1e-6, point.y)),
            id: `${activeLogCurve.sample}|raw|${index}`,
          })),
        },
      ]
    },
    [activeLogCurve]
  )
  const logLegendSource = useMemo(
    () => [...logLineSeries, ...logScatterSeries],
    [logLineSeries, logScatterSeries],
  )
  const logLegendSignature = useMemo(
    () => logLegendSource.map((s) => `${s.name}:${s.color}`).join('|'),
    [logLegendSource],
  )
  const logPhasesCount = useMemo(() => Object.keys(logPhases ?? {}).length, [logPhases])
  useEffect(() => {
    setLogLegendEntries((prev) => {
      const prevMap = new Map(prev.map((entry) => [entry.id, entry]))
      return logLegendSource.map((series) => {
        const existing = prevMap.get(series.name)
        return {
          id: series.name,
          label: existing?.label ?? series.name,
          color: series.color,
          hidden: existing?.hidden ?? false,
          kind: 'series',
        }
      })
    })
  }, [logLegendSignature, logLegendSource])
  const handleLogLegendLabelChange = useCallback((id: string, label: string) => {
    setLogLegendEntries((prev) => prev.map((entry) => (entry.id === id ? { ...entry, label } : entry)))
  }, [])
  const handleLogLegendToggle = useCallback((id: string) => {
    setLogLegendEntries((prev) => prev.map((entry) => (entry.id === id ? { ...entry, hidden: !entry.hidden } : entry)))
  }, [])
  const logHiddenIds = useMemo(
    () => new Set(logLegendEntries.filter((entry) => entry.hidden).map((entry) => entry.id)),
    [logLegendEntries],
  )
  const visibleLogLineSeries = useMemo(
    () => logLineSeries.filter((series) => !logHiddenIds.has(series.name)),
    [logLineSeries, logHiddenIds],
  )
  const visibleLogScatterSeries = useMemo(
    () => (logShowPoints ? logScatterSeries.filter((series) => !logHiddenIds.has(series.name)) : []),
    [logScatterSeries, logShowPoints, logHiddenIds],
  )
  const handleLogSelection = useCallback(
    ({ points }: { points: { point: SeriesPoint }[] }) => {
      if (!points?.length) return
      const xs = points
        .map((entry) => entry.point?.x)
        .filter((value): value is number => Number.isFinite(value))
      if (!xs.length) return
      setPendingLogRange({ start: Math.min(...xs), end: Math.max(...xs) })
      setPendingLogRangeDirty(true)
    },
    []
  )


  const handleApplyLogPhase = useCallback(() => {
    if (!primaryLogSample) return
    const normalized = clampRange(pendingLogRange)
    if (!normalized) return
    setLogPhases((prev) => ({
      ...prev,
      [primaryLogSample]: {
        sample: primaryLogSample,
        start: normalized.start,
        end: normalized.end,
        createdAt: new Date().toISOString(),
        manual: true,
      },
    }))
    setPendingLogRangeDirty(false)
  }, [pendingLogRange, primaryLogSample])

  const handleClearLogPhase = useCallback(() => {
    if (!primaryLogSample) return
    setLogPhases((prev) => {
      if (!prev[primaryLogSample]) return prev
      const next = { ...prev }
      delete next[primaryLogSample]
      return next
    })
    setPendingLogRange(null)
    setPendingLogRangeDirty(false)
  }, [primaryLogSample])

  const canSaveLogPhase = Boolean(primaryLogSample && clampRange(pendingLogRange))
  const hasStoredLogPhase = Boolean(primaryLogSample && logPhases[primaryLogSample])
  const handleManualDetect = useCallback(() => {
    if (!curves.length) {
      setStatus('[WARN] Brak danych do ponownego wykrycia fazy log.')
      return
    }
    const timestamp = new Date().toISOString()
    const updates = computeAutoLogPhaseUpdates(
      curves,
      curves.map((curve) => curve.sample),
      timestamp,
      logDetectionOptions,
      logPhases,
      false // allow overwrite when user explicitly triggers re-detection
    )
    applyLogPhaseUpdates(updates)
    setPendingLogRangeDirty(false)
    const detectedCount = Object.values(updates).filter(Boolean).length
    setStatus(`[OK] Przeliczono fazÄ™ log dla ${detectedCount}/${curves.length} prób.`)
  }, [applyLogPhaseUpdates, curves, logDetectionOptions, logPhases])
  const handleExportLogPhases = useCallback(() => {
    if (!smoothedPayload) {
      setStatus('[WARN] Brak danych smoothed do eksportu.')
      return
    }
    if (!activeEntry?.dataset) {
      setStatus('[WARN] Brak danych blankowanych do eksportu fazy log.')
      return
    }
    const baseSource =
      smoothedPayload.source?.file ||
      smoothedPayload.source?.runId ||
      filename ||
      'curves'
    const safeBase = sanitizeFileName(baseSource.replace(/\.[^/.]+$/, '') || 'curves')
    const exportName = `${safeBase}-log-phases.json`
    const logPhasesWithPoints = logPhaseList.map((entry) => {
      const sample = smoothedPayload.samples.find((item) => item.sample === entry.sample)
      const latest = sample?.history?.[sample.history.length - 1]
      const start = Math.min(entry.start, entry.end)
      const end = Math.max(entry.start, entry.end)
      const points =
        latest?.points
          ?.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= start && point.x <= end)
          .map((point) => ({
            t_min: Number(point.x),
            od600: Number(point.y),
          })) ?? []
      return points.length ? { ...entry, points } : { ...entry, points: undefined }
    })

    const sanitizedRows =
      activeEntry.dataset.rows?.map((row: any) => {
        if (!row?.curation?.excluded) return row
        const clone = { ...row }
        if (Object.prototype.hasOwnProperty.call(clone, 'val_od600_blank_corrected')) {
          delete clone.val_od600_blank_corrected
        }
        return clone
      }) ?? activeEntry.dataset.rows

    const datasetWithCurves = {
      ...activeEntry.dataset,
      rows: sanitizedRows,
      sample_curves: sampleCurvesExport,
      log_phases: logPhasesWithPoints.length ? logPhasesWithPoints.map((entry) => ({ ...entry })) : undefined,
    }
    const exportAssignments = assignments.map((entry, index) => {
      if (!entry) return entry
      if (index !== activeEntryIndex) return entry
      return {
        ...entry,
        dataset: datasetWithCurves,
      }
    })
    const annotatedPayload: BlankedAssignmentsPayload & { logPhases?: typeof logPhasesWithPoints } = {
      version: blankedInfo?.version ?? 5,
      createdAt: blankedInfo?.createdAt ?? new Date().toISOString(),
      blanked: blankedInfo?.blanked ?? true,
      assignments: exportAssignments,
      logPhases: logPhasesWithPoints.length ? logPhasesWithPoints : undefined,
    }
    const blob = new Blob([JSON.stringify(annotatedPayload, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    downloadBlob(blob, exportName)
    setStatus(`[FILE] Wyeksportowano ${exportName}`)
  }, [activeEntry, activeEntryIndex, assignments, blankedInfo, filename, logPhaseList, logPhases, sampleCurvesExport, smoothedPayload])

  const handleSendToParameters = useCallback(() => {
    const shared = buildSharedContext(smoothedPayload)
    if (!shared) {
      setStatus('[WARN] Brak wygładzonych danych do przesłania do Parameters.')
      return
    }
    setSharedSmoothed(shared)
    setActiveTab('parameters')
    const count = Array.isArray(shared.rawPayload?.assignments) ? shared.rawPayload.assignments.length : 0
    setStatus(`[OK] Przekazano dane do Parameters (${count} assignment).`)
  }, [buildSharedContext, setActiveTab, setSharedSmoothed, smoothedPayload])

  const handleFileChange = useCallback(async (fileList: FileList | null) => {
    if (!fileList?.length) return
    const file = fileList[0]
    try {
      const text = await file.text()
      const payload = JSON.parse(text) as BlankedAssignmentsPayload
      if (!payload.assignments?.length) {
        setAssignments([])
        setCurves([])
        setSelectedSamples([])
        setStatus('[WARN] Wskazany plik nie zawiera danych blankowanych.')
        setFilename(file.name)
        setBlankedInfo(null)
        return
      }
      setBlankedInfo({
        version: payload.version,
        createdAt: payload.createdAt,
        blanked: payload.blanked ?? true,
      })
      setAssignments(payload.assignments)
      setActiveEntryIndex(0)
      setFilename(file.name)
      const nextCurves = buildCurvesFromEntry(payload.assignments[0])
      setCurves(nextCurves)
      const firstSample = nextCurves[0]?.sample ?? null
      setSelectedSamples(firstSample ? [firstSample] : [])
      setActiveSample(firstSample)
      setLogPhases({})
      setPendingLogRange(null)
      const expectedCount = countMappedSamples(payload.assignments[0])
      setStatus(
        `[OK] Wczytano ${file.name} (${payload.assignments.length} assignment${
          payload.assignments.length > 1 ? 's' : ''
        }). Pr\u00f3by z danymi: ${nextCurves.length}/${expectedCount}.`
      )
    } catch (error: any) {
      console.error(error)
      setStatus(`[ERR] Nie udaÅ‚o siÄ™ wczytaÄ‡ pliku: ${error?.message ?? String(error)}`)
    }
  }, [])

  useEffect(() => {
    if (!autoAssignments || !autoAssignments.length) return
    setAssignments(autoAssignments)
    setActiveEntryIndex(0)
    const nextCurves = buildCurvesFromEntry(autoAssignments[0])
    setCurves(nextCurves)
    const firstSample = nextCurves[0]?.sample ?? null
    setSelectedSamples(firstSample ? [firstSample] : [])
    setActiveSample(firstSample)
    setLogPhases(buildLogPhaseMap(sharedLogPhases))
    setPendingLogRange(null)
    setBlankedInfo(null)
    const meta = autoAssignments[0]?.dataset?.meta
    const baseName = meta?.sourceFile || meta?.runId || 'assignment'
    setFilename(`[auto] ${baseName}`)
    const expectedCount = countMappedSamples(autoAssignments[0])
    setStatus(
      isPl
        ? `[AUTO] Dane z Blank Correction (${nextCurves.length}/${expectedCount || nextCurves.length} pr\u00f3b).`
        : `[AUTO] Data from Blank Correction (${nextCurves.length}/${expectedCount || nextCurves.length} samples).`
    )
  }, [autoAssignmentsKey])

  useEffect(() => {
    if (curves.length || !sharedSmoothed?.smoothed?.samples?.length) return
    const restored = buildCurvesFromSmoothed(sharedSmoothed.smoothed)
    if (!restored.length) return
    setCurves(restored)
    const firstSample = restored[0]?.sample ?? null
    setSelectedSamples(firstSample ? [firstSample] : [])
    setActiveSample(firstSample)
    setLogPhases(buildLogPhaseMap(sharedSmoothed.smoothed.logPhases))
    setPendingLogRange(null)
    setSpanInput(String(sharedSmoothed.smoothed.smoothing?.span ?? spanInput))
    setDegree((sharedSmoothed.smoothed.smoothing?.degree as 1 | 2) ?? degree)
    const base = sharedSmoothed.filename || sharedSmoothed.smoothed.source.file || sharedSmoothed.smoothed.source.runId
    if (base) setFilename(base)
  }, [curves.length, sharedSmoothed, spanInput, degree])

  const handleEntryChange = useCallback(
    (index: number) => {
      if (!assignments[index]) return
      setActiveEntryIndex(index)
      const nextCurves = buildCurvesFromEntry(assignments[index])
      setCurves(nextCurves)
      const firstSample = nextCurves[0]?.sample ?? null
      setSelectedSamples(firstSample ? [firstSample] : [])
      setActiveSample(firstSample)
    },
    [assignments]
  )

  const toggleSample = useCallback(
    (sample: string) => {
      setSelectedSamples((prev) => {
        const isSame = prev.length === 1 && prev[0] === sample
        return isSame ? [] : [sample]
      })
      setActiveSample((prev) => (prev === sample ? null : sample))
      setChartResetKey((k) => k + 1)
      setLogChartResetKey((k) => k + 1)
    },
    []
  )

  const selectOnly = useCallback(
    (sample: string) => {
      if (!sample) return
      setSelectedSamples([sample])
      setActiveSample(sample)
      setChartResetKey((k) => k + 1)
      setLogChartResetKey((k) => k + 1)
    },
    []
  )

  const selectedCurves = useMemo(
    () => curves.filter((curve) => selectedSamples.includes(curve.sample)),
    [curves, selectedSamples]
  )
  const sampleColorMap = useMemo(() => new Map(curves.map((curve) => [curve.sample, curve.color])), [curves])

  const orderedSampleNames = useMemo(() => curves.map((curve) => curve.sample), [curves])

  const handleSampleNavigate = useCallback(
    (direction: 1 | -1) => {
      if (!orderedSampleNames.length) return
      const fallback =
        (selectedSamples[0] && orderedSampleNames.includes(selectedSamples[0])
          ? selectedSamples[0]
          : orderedSampleNames[0]) ?? orderedSampleNames[0]
      const current =
        (activeSample && orderedSampleNames.includes(activeSample) ? activeSample : fallback) ??
        orderedSampleNames[0]
      const currentIndex = Math.max(0, orderedSampleNames.indexOf(current))
      const nextIndex = (currentIndex + direction + orderedSampleNames.length) % orderedSampleNames.length
      const nextSample = orderedSampleNames[nextIndex]
      selectOnly(nextSample)
    },
    [activeSample, orderedSampleNames, selectOnly, selectedSamples]
  )

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        handleSampleNavigate(event.key === 'ArrowDown' ? 1 : -1)
        return
      }
    }
    window.addEventListener('keydown', handler as any, { capture: true })
    return () => window.removeEventListener('keydown', handler as any, { capture: true } as any)
  }, [handleSampleNavigate])

  useEffect(() => {
    if (!curves.length) {
      setActiveSample(null)
      return
    }
    if (!activeSample || !orderedSampleNames.includes(activeSample)) {
      setActiveSample(orderedSampleNames[0] ?? null)
    }
  }, [activeSample, orderedSampleNames])

  const loessSeries: Series[] = useMemo(
    () =>
      selectedCurves.flatMap((curve) => {
        if (curve.history.length <= 1) return []
        const current = curve.history[curve.history.length - 1]
        return [
          {
            name: `${curve.sample} â€¢ ${current.label}`,
            color: curve.color,
            points: current.points.map((pt) => ({ x: pt.x, y: pt.y })),
          },
        ]
      }),
    [selectedCurves]
  )

  const scatterSeries: Series[] = useMemo(
    () =>
      selectedCurves.flatMap((curve) =>
        curve.wells.map((well) => ({
          name: `${curve.sample} ${well.well}`,
          color: well.color,
          points: well.points,
        }))
      ),
    [selectedCurves]
  )

  // Utrzymuj co najmniej jedna widoczna prï¿½be, aby LOESS nie znikal
  useEffect(() => {
    if (!activeSample) return
    if (selectedSamples.includes(activeSample)) return
    setSelectedSamples([activeSample])
    setChartResetKey((k) => k + 1)
    setLogChartResetKey((k) => k + 1)
  }, [activeSample, selectedSamples, setSelectedSamples])

  const combinedLegendSource = useMemo(() => {
    const entries = [...loessSeries]
    if (combinedShowPoints) {
      scatterSeries.forEach((series) => entries.push(series))
    }
    return entries
  }, [combinedShowPoints, loessSeries, scatterSeries])
  const combinedLegendSignature = useMemo(
    () => combinedLegendSource.map((s) => `${s.name}:${s.color}`).join('|'),
    [combinedLegendSource],
  )
  useEffect(() => {
    setCombinedLegendEntries((prev) => {
      const prevMap = new Map(prev.map((entry) => [entry.id, entry]))
      return combinedLegendSource.map((series) => {
        const existing = prevMap.get(series.name)
        return {
          id: series.name,
          label: existing?.label ?? series.name,
          color: series.color,
          hidden: existing?.hidden ?? false,
          kind: 'series',
        }
      })
    })
  }, [combinedLegendSignature, combinedLegendSource])
  const handleCombinedLegendLabelChange = useCallback((id: string, label: string) => {
    setCombinedLegendEntries((prev) => prev.map((entry) => (entry.id === id ? { ...entry, label } : entry)))
  }, [])
  const handleCombinedLegendToggle = useCallback((id: string) => {
    setCombinedLegendEntries((prev) => prev.map((entry) => (entry.id === id ? { ...entry, hidden: !entry.hidden } : entry)))
  }, [])
  const combinedHiddenIds = useMemo(
    () => new Set(combinedLegendEntries.filter((entry) => entry.hidden).map((entry) => entry.id)),
    [combinedLegendEntries],
  )
  const visibleLoessSeries = useMemo(
    () => loessSeries.filter((series) => !combinedHiddenIds.has(series.name)),
    [loessSeries, combinedHiddenIds],
  )
  const visibleScatterSeries = useMemo(
    () => (combinedShowPoints ? scatterSeries.filter((series) => !combinedHiddenIds.has(series.name)) : []),
    [scatterSeries, combinedShowPoints, combinedHiddenIds],
  )


  const hasCurves = curves.length > 0
  const canApplyToSelected = selectedSamples.length > 0 && hasCurves
  const canApplyBack = selectedCurves.some((curve) => curve.history.length > 1)
  useLayoutEffect(() => {
    updateSamplePanelHeight()
  }, [
    updateSamplePanelHeight,
    hasCurves,
    activeLogCurve,
    chartFullscreen,
    showPlotControls,
    curves.length,
    orderedSampleNames.length,
    combinedLegendVisible,
    logLegendVisible,
    combinedFontScale,
    logFontScale,
  ])

  useEffect(() => {
    const handleResize = () => updateSamplePanelHeight()
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [updateSamplePanelHeight])

  useEffect(() => {
    const logPanelEl = logPanelRef.current
    if (!logPanelEl || typeof ResizeObserver === 'undefined') {
      updateSamplePanelHeight()
      return
    }
    const observer = new ResizeObserver(() => updateSamplePanelHeight())
    observer.observe(logPanelEl)
    updateSamplePanelHeight()
    return () => observer.disconnect()
  }, [updateSamplePanelHeight, hasCurves, activeLogCurve])


  const missingSamples = useMemo(() => {
    const expected = mappingSamples
      .filter((sample) => (sample?.wells?.length ?? 0) > 0)
      .map((sample) => sample?.name?.trim())
      .filter((name): name is string => !!name)
    if (!expected.length) return []
    const loaded = new Set(curves.map((curve) => curve.sample))
    return expected.filter((name) => !loaded.has(name))
  }, [curves, mappingSampleKey])

  const runLoessRefinement = useCallback(
    (points: NumericPoint[], span: number) => {
      if (!points?.length) return null
      const loops = Math.max(1, maxRefinements)
      const robust = Math.max(1, Math.round(robustPasses))
      let previous: NumericPoint[] | null = null
      let lastResult: ReturnType<typeof loess> | null = null
      for (let loop = 0; loop < loops; loop += 1) {
        const result = loess(points, {
          span,
          degree,
          robustIters: robust,
        })
        lastResult = result
        if (previous && result.points.length === previous.length) {
          const maxDiff = result.points.reduce((acc, pt, idx) => {
            const prev = previous ? previous[idx] : null
            if (!prev) return acc
            return Math.max(acc, Math.abs(pt.y - prev.y))
          }, 0)
          if (maxDiff <= convergenceTol) {
            return { result, loops: loop + 1, converged: true }
          }
        }
        previous = result.points.map((pt) => ({ x: pt.x, y: pt.y }))
      }
      if (!lastResult) return null
      return { result: lastResult, loops, converged: false }
    },
    [convergenceTol, degree, maxRefinements, robustPasses]
  )

  const combinedBands = useMemo(() => {
    if (combinedUncertainty === 'none') return []

    const factorial = (n: number): number => {
      if (n <= 1) return 1
      let out = 1
      for (let i = 2; i <= n; i += 1) out *= i
      return out
    }

    const enumerateCounts = (n: number): Array<{ counts: number[]; weight: number }> => {
      if (!Number.isFinite(n) || n <= 0) return []
      const countsList: number[][] = []
      const helper = (idx: number, remaining: number, acc: number[]) => {
        if (idx === n - 1) {
          countsList.push([...acc, remaining])
          return
        }
        for (let k = 0; k <= remaining; k += 1) {
          helper(idx + 1, remaining - k, [...acc, k])
        }
      }
      helper(0, n, [])
      const norm = Math.pow(n, n)
      return countsList.map((counts) => {
        const denom = counts?.reduce?.((acc, c) => acc * factorial(c), 1) ?? 1
        const weight = (factorial(n) / denom) / norm
        return { counts, weight }
      })
    }

    const weightedPercentile = (values: number[], weights: number[], p: number): number => {
      if (!values.length) return NaN
      const paired = values
        .map((v, i) => ({ v, w: weights[i] ?? 0 }))
        .filter((item) => Number.isFinite(item.v) && item.w > 0)
        .sort((a, b) => a.v - b.v)
      if (!paired.length) return NaN
      const total = paired.reduce((acc, item) => acc + item.w, 0)
      if (!(total > 0)) return paired[Math.floor((p / 100) * paired.length)]?.v ?? NaN
      const target = (p / 100) * total
      let acc = 0
      for (const item of paired) {
        acc += item.w
        if (acc >= target) return item.v
      }
      return paired[paired.length - 1].v
    }

    const evaluate = (points: NumericPoint[], xs: number[]): number[] => {
      if (!points.length) return xs.map(() => NaN)
      const sorted = [...points].sort((a, b) => a.x - b.x)
      return xs.map((x) => {
        if (x <= sorted[0].x) return sorted[0].y
        if (x >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y
        for (let i = 0; i < sorted.length - 1; i += 1) {
          const a = sorted[i]
          const b = sorted[i + 1]
          if (x >= a.x && x <= b.x) {
            const t = (x - a.x) / (b.x - a.x)
            return a.y * (1 - t) + b.y * t
          }
        }
        return sorted[sorted.length - 1].y
      })
    }

    const spanValue = Number(spanInput) || DEFAULT_SPAN_NUM
    const results = selectedCurves.map((curve) => {
      const wells = curve.wells ?? []
      const wellCount = wells.length
      if (wellCount < 2) return null
      const grid = Array.from(
        new Set(
          wells.flatMap((w) => w.points.map((p) => Number(p.x ?? 0))).filter((v) => Number.isFinite(v)),
        ),
      ).sort((a, b) => a - b)
      if (!grid.length) return null

      const main = runLoessRefinement(curve.rawPoints, spanValue)
      if (!main?.result?.points?.length) return null
      const mainPred = evaluate(main.result.points, grid)
      const resamples = enumerateCounts(wellCount)
      if (!resamples.length) return null

      const valuesByT = grid.map(() => [] as number[])
      const weightsByT = grid.map(() => [] as number[])
      const diffValues: number[] = []
      const diffWeights: number[] = []

      resamples.forEach(({ counts, weight }) => {
        if (!(weight > 0)) return
        const safeCounts = Array.isArray(counts) ? [...counts] : []
        while (safeCounts.length < wellCount) safeCounts.push(0)
        if (!safeCounts.length || safeCounts.every((c) => !c)) return
        const pts: NumericPoint[] = []
        safeCounts.forEach((rep, idx) => {
          const wellPts = wells[idx]?.points ?? []
          const copies = Math.max(0, Number(rep) || 0)
          for (let k = 0; k < copies; k += 1) {
            wellPts.forEach((p) => {
              pts.push({ x: Number(p.x ?? 0), y: Number(p.y ?? 0) })
            })
          }
        })
        if (!pts.length) return
        const resLoess = runLoessRefinement(pts, spanValue)
        if (!resLoess?.result?.points?.length) return
        const preds = evaluate(resLoess.result.points, grid)
        preds.forEach((val, i) => {
          valuesByT[i].push(val)
          weightsByT[i].push(weight)
        })
        const maxDiff = preds.reduce((acc, val, i) => Math.max(acc, Math.abs(val - (mainPred[i] ?? 0))), 0)
        diffValues.push(maxDiff)
        diffWeights.push(weight)
      })

      let bandPoints: { x: number; low: number; high: number }[] = []
      if (combinedUncertainty === 'pointwise') {
        bandPoints = grid.map((x, idx) => {
          const vals = valuesByT[idx]
          const w = weightsByT[idx]
          if (!vals.length) return { x, low: mainPred[idx] ?? NaN, high: mainPred[idx] ?? NaN }
          const low = weightedPercentile(vals, w, 2.5)
          const high = weightedPercentile(vals, w, 97.5)
          return { x, low, high }
        })
      } else {
        const c = weightedPercentile(diffValues, diffWeights, 95)
        bandPoints = grid.map((x, idx) => ({
          x,
          low: (mainPred[idx] ?? 0) - c,
          high: (mainPred[idx] ?? 0) + c,
        }))
      }

      let filtered = bandPoints.filter(
        (p) => Number.isFinite(p.low) && Number.isFinite(p.high) && Number.isFinite(p.x),
      )

      // Fallback: jeÅ›li bootstrap nie daÅ‚ nic sensownego, zrÃ³b proste SD po wellach na gridzie
      if (!filtered.length) {
        const perWellPreds = wells.map((well) => evaluate(well.points ?? [], grid))
        if (perWellPreds.length >= 2) {
          filtered = grid
            .map((x, idx) => {
              const values = perWellPreds
                .map((row) => row?.[idx])
                .filter((v) => Number.isFinite(v)) as number[]
              if (values.length < 2) return null
              const mean = values.reduce((acc, v) => acc + v, 0) / values.length
              const variance =
                values.length > 1
                  ? values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1)
                  : 0
              const sd = Math.sqrt(Math.max(0, variance))
              return {
                x,
                low: mean - sd,
                high: mean + sd,
              }
            })
            .filter((p): p is { x: number; low: number; high: number } => Boolean(p))
        }
      }

      // Ostateczny fallback: pasmo z samej krzywej gÅ‚Ã³wnej (zero width), aby coÅ› pokazaÄ‡
      if (!filtered.length) {
        filtered = grid
          .map((x, idx) => {
            const base = mainPred[idx]
            if (!Number.isFinite(base)) return null
            return { x, low: base, high: base }
          })
          .filter((p): p is { x: number; low: number; high: number } => Boolean(p))
      }

      if (!filtered.length) return null
      return {
        name: curve.sample,
        color: curve.color,
        points: filtered,
      }
    })

    return results.filter((b): b is { name: string; color: string; points: { x: number; low: number; high: number }[] } => Boolean(b))
  }, [combinedUncertainty, selectedCurves, runLoessRefinement, spanInput])

  const combinedBandWarning = useMemo(() => {
    if (combinedUncertainty === 'none') return ''
    if (!hasCurves) return ''
    const hasMultiWell = selectedCurves.some((curve) => (curve.wells?.length ?? 0) >= 2)
    if (!hasMultiWell) return 'Pasma wymagają dołków/replikatów w próbie.'
    if (!combinedBands.length) return 'Brak danych do pasma (sprawdź punkty lub span). Jeżeli pasmo się nie pojawia, używam fallbacku SD.'
    return ''
  }, [combinedUncertainty, hasCurves, selectedCurves, combinedBands.length])

const applyLoess = useCallback(
  async (mode: 'selected' | 'all') => {
    setIsLoessRunning(true)
    setLoessProgress(0)
    try {
      await new Promise((resolve) => setTimeout(resolve, 16))
      if (!curves.length) {
        setStatus('[WARN] Wczytaj najpierw plik .blanked.json.')
        return
      }
      const targetSamples = mode === 'all' ? curves.map((c) => c.sample) : selectedSamples
      if (!targetSamples.length) {
        setStatus('[WARN] Zaznacz co najmniej jedna probe.')
        return
      }
      const parsedSpan = Number(spanInput)
      if (!Number.isFinite(parsedSpan) || parsedSpan <= 0) {
        setStatus('[ERR] Podaj poprawny rozmiar okna (liczba dodatnia).')
        return
      }
      let changed = 0
      let totalLoops = 0
      const targetSet = new Set(targetSamples)
      const changedSamples = new Set<string>()
      const detectionTimestamp = new Date().toISOString()
      const totalTargets = targetSamples.length || 1
      const nextCurves: typeof curves = []
      for (const curve of curves) {
        if (!targetSet.has(curve.sample)) {
          nextCurves.push(curve)
          continue
        }
        const basePoints = curve.rawPoints?.length ? curve.rawPoints : curve.history[0]?.points ?? []
        if (!basePoints.length) {
          nextCurves.push(curve)
          continue
        }
        const refinement = runLoessRefinement(basePoints, parsedSpan)
        if (!refinement) {
          nextCurves.push(curve)
          continue
        }
        const result = refinement.result
        changed += 1
        changedSamples.add(curve.sample)
        totalLoops += refinement.loops
        const labelSuffix =
          refinement.loops > 1 ? ` (passes: ${refinement.loops}${refinement.converged ? ' âœ”' : ''})` : ''
        const newState: LoessState = {
          label: `LOESS span ${parsedSpan}${labelSuffix}`,
          points: result.points.map((pt) => ({ x: pt.x, y: pt.y })),
          diagnostics: result.diagnostics,
        }
        // Zachowujemy cala historie krzywych dla danej prï¿½bki, zeby wynik LOESS
        // pozostal dostepny do czasu kolejnego przeliczenia (zgloszone gubienie krzywych).
        const baseHistory = curve.history.length ? [...curve.history] : curve.history
        nextCurves.push({
          ...curve,
          history: [...baseHistory, newState],
        })
        setLoessProgress(Math.min(100, Math.round((changed / totalTargets) * 100)))
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      if (!changed) {
        setStatus('[INFO] Brak punktów do wygładzania (za mało danych?).')
        return
      }
      const detectionUpdates = computeAutoLogPhaseUpdates(
        nextCurves,
        changedSamples,
        detectionTimestamp,
        logDetectionOptions,
        logPhases,
        true
      )
      setCurves(nextCurves)
      applyLogPhaseUpdates(detectionUpdates)
      const avgLoops = (totalLoops / Math.max(1, changed)).toFixed(2)
      const detectedCount = Object.values(detectionUpdates).filter(Boolean).length
      const detectionSuffix = changedSamples.size
        ? isPl
          ? ` Auto faza log: ${detectedCount}/${changedSamples.size} próbek.`
          : ` Auto log phase: ${detectedCount}/${changedSamples.size} samples.`
        : ''
      setStatus(
        isPl
          ? `[OK] Zastosowano LOESS dla ${changed} prób (średnio ${avgLoops} przejść).${detectionSuffix}`
          : `[OK] Applied LOESS for ${changed} samples (avg ${avgLoops} passes).${detectionSuffix}`
      )
      setLoessProgress(100)
    } finally {
      setIsLoessRunning(false)
      setTimeout(() => setLoessProgress(null), 500)
    }
  },
  [applyLogPhaseUpdates, curves, isPl, logDetectionOptions, logPhases, runLoessRefinement, selectedSamples, spanInput]
)

  useEffect(() => {
    if (isLoessRunning) return
    if (!hasCurves) return
    const hasSmoothed = curves.some((curve) => (curve.history?.length ?? 0) > 1)
    if (hasSmoothed) return
    void applyLoess('all')
  }, [applyLoess, curves, hasCurves, isLoessRunning])

const stepBack = useCallback(() => {
    if (!selectedSamples.length) {
      setStatus('[WARN] Wybierz próbę, aby cofnąć wygładzanie.')
      return
    }
    let changed = 0
    const targetSet = new Set(selectedSamples)
    const changedSamples = new Set<string>()
    const detectionTimestamp = new Date().toISOString()
    const nextCurves = curves.map((curve) => {
      if (!targetSet.has(curve.sample) || curve.history.length <= 1) return curve
      changed += 1
      changedSamples.add(curve.sample)
      return {
        ...curve,
        history: curve.history.slice(0, -1),
      }
    })
    if (!changed) {
      setStatus('[INFO] Brak wczeÅ›niejszej wersji krzywej dla wybranych prób.')
      return
    }
    const detectionUpdates = computeAutoLogPhaseUpdates(
      nextCurves,
      changedSamples,
      detectionTimestamp,
      logDetectionOptions,
      logPhases,
      true
    )
    setCurves(nextCurves)
    applyLogPhaseUpdates(detectionUpdates)
    const detectedCount = Object.values(detectionUpdates).filter(Boolean).length
    const detectionSuffix = changedSamples.size
      ? ` Auto log phase: ${detectedCount}/${changedSamples.size} samples.`
      : ''
    setStatus(`[OK] PrzywrÃ³cono poprzedni stan dla ${changed} prób.${detectionSuffix}`)
  }, [applyLogPhaseUpdates, curves, logDetectionOptions, logPhases, selectedSamples])

  useEffect(() => {
    if (!autoRun || autoRun.stage !== 'loessQueued') return
    if (!assignments.length || !curves.length || isLoessRunning) return
    void (async () => {
      await applyLoess('all')
    })()
  }, [applyLoess, assignments.length, autoRun, curves.length, isLoessRunning])

  useEffect(() => {
    // Move to "waitingParameters" only after LOESS finished and log phases are available,
    // so Parameters receives logStart/logEnd.
    if (!autoRun || autoRun.stage !== 'loessQueued') return
    if (isLoessRunning) return
    if (logPhasesCount === 0) return
    setAutoRun({ stage: 'waitingParameters', error: null })
  }, [autoRun, isLoessRunning, logPhasesCount, setAutoRun])

  useEffect(() => {
    if (!autoRun || autoRun.stage !== 'waitingParameters') return
    if (isLoessRunning || !smoothedPayload) return
    // Also ensure smoothedPayload carries logPhases (not just curves)
    const hasLogPhases =
      !!(smoothedPayload?.logPhases && Object.keys(smoothedPayload.logPhases).length) ||
      logPhasesCount > 0
    if (!hasLogPhases) return
    handleSendToParameters()
    setAutoRun({ stage: 'done', error: null })
  }, [autoRun, handleSendToParameters, isLoessRunning, setAutoRun, smoothedPayload, logPhasesCount])

  const handleExportCurves = useCallback(() => {
    if (!activeEntry?.dataset) {
      setStatus('[WARN] Brak danych blankowanych do eksportu.')
      return
    }
    if (!sampleCurvesExport.length) {
      setStatus('[WARN] Brak wygładzonych krzywych do eksportu.')
      return
    }
    const sanitizedRows =
      activeEntry.dataset.rows?.map((row: any) => {
        if (!row?.curation?.excluded) return row
        const clone = { ...row }
        if (Object.prototype.hasOwnProperty.call(clone, 'val_od600_blank_corrected')) {
          delete clone.val_od600_blank_corrected
        }
        return clone
      }) ?? activeEntry.dataset.rows
    const datasetWithCurves = {
      ...activeEntry.dataset,
      rows: sanitizedRows,
      sample_curves: sampleCurvesExport,
      well_curves: wellCurvesExport,
    }
    const exportAssignments = assignments.map((entry, index) => {
      if (!entry) return entry
      if (index !== activeEntryIndex) return entry
      return {
        ...entry,
        dataset: datasetWithCurves,
      }
    })
    const exportPayload: BlankedAssignmentsPayload = {
      version: blankedInfo?.version ?? 5,
      createdAt: blankedInfo?.createdAt ?? new Date().toISOString(),
      blanked: blankedInfo?.blanked ?? true,
      assignments: exportAssignments,
    }
    const baseSource =
      activeEntry.dataset.meta?.sourceFile ||
      activeEntry.dataset.meta?.runId ||
      filename ||
      'assignment'
    const safeBase = sanitizeFileName(baseSource.replace(/\.[^/.]+$/, '') || 'assignment')
    const fileName = `${safeBase}-smoothed.json`
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    downloadBlob(blob, fileName)
    setStatus(`[FILE] Wyeksportowano ${fileName}`)
  }, [activeEntry, activeEntryIndex, assignments, blankedInfo, filename, sampleCurvesExport, wellCurvesExport])

  const infoHelp = isPl
    ? 'W przyszłości zostanie dodanych więcej algorytmów wygładzania. Ten etap jest kluczowy dla uzyskania niektórych z biologicznych parametrów wzrostu, do których będziesz miał dostęp w następnej karcie.'
    : 'More smoothing algorithms will be added in the future. This step is crucial for obtaining some of the biological growth parameters that you will have access to in the next tab.'
  const smoothingHelp = isPl
    ? 'W różnych okolicznościach inne algorytmy wygładzania mogą być bardziej odpowiednie. Inne algorytmy oraz zalecenia ich użycia zostaną dodane w przyszłości. Dla dobrego dopasowania polecam zmniejszyć wielkość okna (span) i zwiększyć liczbę iteracji odpornych na odchylenia (robust). Lokalny model liniowy zdaje się działać lepiej niż paraboliczny dla krzywych, które sprawdzałem.'
    : 'In different circumstances, other smoothing algorithms may be more appropriate. Other algorithms and recommendations for their use will be added in the future. For a good fit, I recommend decreasing the window size (span) and increasing the number of robust iterations. The local linear model seems to work better than the parabolic one for the curves I have tested.'
  const plotControlsHelp = isPl
    ? 'Steruj tytulem, osiami i skala czcionki. Reset przywraca domyslny zoom/pan.'
    : 'Control title, axes, and font scale. Reset restores the default zoom/pan.'
  const combinedChartHelp = isPl
    ? 'Wykres wygładzonych krzywych z zoom/pan, legenda i eksportem PNG. Pelny ekran daje więcej miejsca na analize.'
    : 'Smoothed curves chart with zoom/pan, legend, and PNG export. Fullscreen gives more room to analyze.'
  const logChartHelp = isPl
    ? 'Podgląd fazy log aktywnej próby; zaznacz zakres, używaj legendy i eksportu, by udostępniać widok.'
    : 'Log-phase preview of the active sample; mark the range, use legend and export to share the view.'
  const logIdHelp = isPl
    ? 'Automatyczne wykrywanie fazy log dla niektórych krzywych może być trudne. Upewnij się, że twoje krzywe mają fazę lag — wykresy nie zaczynają się od trwającej już fazy logarytmicznej. Sprawdź wykres i oceń, czy faza log w ogóle może zostać wyodrębniona. Jeżeli algorytm nie wykrywa fazy log tam, gdzie ją widzisz, możesz ręcznie zaznaczyć zakres na wykresach poniżej.'
    : 'Automatic log-phase detection for some curves can be challenging. Ensure that your curves have a lag phase - the plots do not start in an ongoing logarithmic phase. Check the chart and assess whether the log phase can be extracted at all. If the algorithm does not detect the log phase where you see it, you can manually mark the range on the charts below.'
  const sampleHelp = isPl
    ? 'Sprawdź czy wygładzona krzywa jest dobrze dopasowana do danych i czy fazy log są poprawnie wykryte.'
    : 'Check if the smoothed curve is well-fitted to the data and if log phases are correctly detected.'
  const spanHelp = isPl
    ? 'Wartość pomiędzy 0-1 oznacza procent punktów w oknie; liczba całkowita to długosc okna w punktach.'
    : 'A value between 0-1 is the fraction of points in the window; an integer is the window length in points.'
  const modelHelp = isPl
    ? 'Stopien lokalnego wielomianu: 1 = linia, 2 = parabola.'
    : 'Degree of the local polynomial: 1 = line, 2 = parabola.'
  const robustHelp = isPl
    ? 'Liczba iteracji odpornych na odchylenia w trakcie wygładzania.'
    : 'Number of robust iterations during smoothing.'
  const rerunHelp = isPl
    ? 'Maksymalna liczba kolejnych przebiegów wygładzania.'
    : 'Maximum number of successive smoothing re-runs.'
  const convHelp = isPl
    ? 'Próg zatrzymania: maksymalne |dy| pomiedzy przebiegami.'
    : 'Stop threshold: maximum |dy| between iterations.'
  const logWindowHelp = isPl
    ? 'Liczba punktów w oknie regresji liniowej podczas automatycznego wykrywania.'
    : 'Number of points in the linear regression window used for auto-detection.'
  const logR2Help = isPl
    ? 'Minimalny współczynnik R² wymagany dla dopasowania okna.'
    : 'Minimum R² required for the window fit.'
  const logOdMinHelp = isPl
    ? 'Dolny próg OD; poniżej niego punkty są pomijane przy wykrywaniu fazy log.'
    : 'Lower OD threshold; points below are skipped during log-phase detection.'
  const logPlateauHelp = isPl
    ? 'Maksymalny udział fragmentów plateau; odcina wartości powyżej tego progu.'
    : 'Maximum share of plateau segments; cuts off values above this threshold.'
  const logMuRelMinHelp = isPl
    ? 'Dolna granica μ/μmax (tempo wzrostu) akceptowalna dla fazy log.'
    : 'Lower bound of μ/μmax (growth rate) acceptable for log phase.'
  const logMuRelMaxHelp = isPl
    ? 'Górna granica μ/μmax; odcina fragmenty o nachyleniu wyższym niż podane — w większości krzywych możesz pominąć.'
    : 'Upper bound of μ/μmax; cuts off segments with a slope higher than given; can be skipped for most curves.'
  const combinedLegendPanel = combinedLegendVisible ? (
    <div className="legend-editor panel-soft">
      <div className="legend-editor__header">
        <div>
          <div className="legend-editor__title">{combinedLegendTitle || 'Legenda'}</div>
          <div className="legend-editor__subtitle">
            Ukryj lub zmień nazwy elementów legendy. Ukrycie nie usuwa serii z wykresu.
          </div>
          <label className="field" style={{ marginTop: 6 }}>
            <div className="field-label-row">
              <span>Tytuł legendy</span>
            </div>
            <input
              className="field-input"
              value={combinedLegendTitle}
              onChange={(e) => setCombinedLegendTitle(e.target.value)}
              placeholder="Legenda"
            />
          </label>
        </div>
        <div className="legend-editor__font">
          <span>Rozmiar legendy</span>
          <div className="btn-pair">
            <button
              type="button"
              className="btn"
              onClick={() => setCombinedLegendScale((s) => Math.max(0.6, +(s - 0.1).toFixed(1)))}
            >
              A-
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setCombinedLegendScale((s) => Math.min(2, +(s + 0.1).toFixed(1)))}
            >
              A+
            </button>
          </div>
        </div>
      </div>
      <div className="legend-editor__list">
        {combinedLegendEntries.map((entry) => (
          <div key={entry.id} className="legend-editor__row">
            <label className="legend-editor__checkbox">
              <input type="checkbox" checked={!entry.hidden} onChange={() => handleCombinedLegendToggle(entry.id)} />
              <span>Pokaż</span>
            </label>
            <div className="legend-editor__swatch" style={{ background: entry.color, borderColor: 'transparent' }} />
            <input
              className="legend-editor__input"
              value={entry.label}
              onChange={(e) => handleCombinedLegendLabelChange(entry.id, e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  ) : null
  const logLegendPanel = logLegendVisible ? (
    <div className="legend-editor panel-soft">
      <div className="legend-editor__header">
        <div>
          <div className="legend-editor__title">{logLegendTitle || 'Legenda'}</div>
          <div className="legend-editor__subtitle">
            Ukryj lub zmień nazwy elementów legendy. Ukrycie nie usuwa serii z wykresu.
          </div>
          <label className="field" style={{ marginTop: 6 }}>
            <div className="field-label-row">
              <span>Tytuł legendy</span>
            </div>
            <input
              className="field-input"
              value={logLegendTitle}
              onChange={(e) => setLogLegendTitle(e.target.value)}
              placeholder="Legenda"
            />
          </label>
        </div>
        <div className="legend-editor__font">
          <span>Rozmiar legendy</span>
          <div className="btn-pair">
            <button type="button" className="btn" onClick={() => setLogLegendScale((s) => Math.max(0.6, +(s - 0.1).toFixed(1)))}>
              A-
            </button>
            <button type="button" className="btn" onClick={() => setLogLegendScale((s) => Math.min(2, +(s + 0.1).toFixed(1)))}>
              A+
            </button>
          </div>
        </div>
      </div>
      <div className="legend-editor__list">
        {logLegendEntries.map((entry) => (
          <div key={entry.id} className="legend-editor__row">
            <label className="legend-editor__checkbox">
              <input type="checkbox" checked={!entry.hidden} onChange={() => handleLogLegendToggle(entry.id)} />
              <span>Pokaż</span>
            </label>
            <div className="legend-editor__swatch" style={{ background: entry.color, borderColor: 'transparent' }} />
            <input
              className="legend-editor__input"
              value={entry.label}
              onChange={(e) => handleLogLegendLabelChange(entry.id, e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  ) : null
  const renderCombinedPlotControls = useCallback(
    () => (
      <PlotControlsSection
        title={isPl ? 'Sterowanie wykresem w skali OD600' : 'Plot Controls (OD600 Scale)'}
        helpContent={plotControlsHelp}
        chartTitle={combinedTitle}
        onChartTitleChange={setCombinedTitle}
        xLabel={combinedXLabel}
        onXLabelChange={setCombinedXLabel}
        yLabel={combinedYLabel}
        onYLabelChange={setCombinedYLabel}
        fontScale={combinedFontScale}
        onFontScaleChange={setCombinedFontScale}
        legendOpen={combinedLegendVisible}
        onToggleLegend={() => setCombinedLegendVisible((v) => !v)}
        legendPanel={combinedLegendPanel}
        onExportPng={() => exportPng(combinedChartRef, combinedTitle || 'curves-smoothing')}
        onCopyPng={() => copyPng(combinedChartRef, combinedTitle || 'curves-smoothing')}
        onResetView={() => setChartResetKey((key) => key + 1)}
        isPl={isPl}
        disabled={!hasCurves}
        extraActions={
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <label
              className={`parameters-toggle ${combinedShowPoints ? 'is-on' : ''}`}
              title={isPl ? 'Przełącz punkty danych' : 'Toggle data points'}
            >
              <input
                type="checkbox"
                checked={combinedShowPoints}
                onChange={() => setCombinedShowPoints((prev) => !prev)}
                disabled={!hasCurves}
              />
              <span className="parameters-toggle__slider" aria-hidden />
              <span className="parameters-toggle__label">
                {isPl ? 'Punkty danych' : 'Data points'}
              </span>
            </label>
            <label className={`parameters-toggle ${combinedUncertainty !== 'none' ? 'is-on' : ''}`}>
              <input
                type="checkbox"
                checked={combinedUncertainty !== 'none'}
                onChange={(e) => setCombinedUncertainty(e.target.checked ? 'pointwise' : 'none')}
                disabled={!hasCurves}
              />
              <span className="parameters-toggle__slider" aria-hidden />
              <span className="parameters-toggle__label">{isPl ? 'Przedział ufności' : 'Bands'}</span>
            </label>
            <div className="field small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <label className="small">{isPl ? 'Typ' : 'Type'}</label>
              <select
                value={combinedUncertainty}
                onChange={(e) => setCombinedUncertainty(e.target.value as any)}
                disabled={!hasCurves || combinedUncertainty === 'none'}
              >
                <option value="pointwise">{isPl ? 'Punktowy 95% CI' : 'Pointwise 95% CI'}</option>
                <option value="simultaneous">{isPl ? '95% CI dla krzywej' : 'Simultaneous 95% band'}</option>
              </select>
            </div>
          </div>
        }
      />
    ),
    [
      combinedLegendPanel,
      combinedLegendVisible,
      combinedTitle,
      combinedXLabel,
      combinedYLabel,
      combinedChartRef,
      combinedShowPoints,
      combinedUncertainty,
      copyPng,
      exportPng,
      hasCurves,
      plotControlsHelp,
      setChartResetKey,
      setCombinedFontScale,
      setCombinedLegendVisible,
      setCombinedShowPoints,
      setCombinedUncertainty,
      setCombinedTitle,
      setCombinedXLabel,
      setCombinedYLabel,
    ],
  )
  const renderLogPlotControls = useCallback(
    () => (
      <PlotControlsSection
        title={isPl ? 'Sterowanie wykresem w skali logarytmicznej' : 'Plot Controls (Log Scale)'}
        helpContent={plotControlsHelp}
        chartTitle={logTitle}
        onChartTitleChange={setLogTitle}
        xLabel={logXLabel}
        onXLabelChange={setLogXLabel}
        yLabel={logYLabel}
        onYLabelChange={setLogYLabel}
        fontScale={logFontScale}
        onFontScaleChange={setLogFontScale}
        legendOpen={logLegendVisible}
        onToggleLegend={() => setLogLegendVisible((v) => !v)}
        legendPanel={logLegendPanel}
        onExportPng={() => exportPng(logChartRef, logTitle || 'log-phase')}
        onCopyPng={() => copyPng(logChartRef, logTitle || 'log-phase')}
        onResetView={() => setLogChartResetKey((key) => key + 1)}
        isPl={isPl}
        disabled={!activeLogCurve}
        extraActions={
          <label
            className={`parameters-toggle ${logShowPoints ? 'is-on' : ''}`}
            title={isPl ? 'Przełącz punkty danych' : 'Toggle data points'}
          >
            <input
              type="checkbox"
              checked={logShowPoints}
              onChange={() => setLogShowPoints((prev) => !prev)}
              disabled={!activeLogCurve}
            />
            <span className="parameters-toggle__slider" aria-hidden />
            <span className="parameters-toggle__label">
              {isPl ? 'Punkty danych' : 'Data points'}
            </span>
          </label>
        }
      />
    ),
    [
      activeLogCurve,
      copyPng,
      exportPng,
      logChartRef,
      logLegendPanel,
      logLegendVisible,
      logShowPoints,
      logTitle,
      logXLabel,
      logYLabel,
      plotControlsHelp,
      setLogChartResetKey,
      setLogFontScale,
      setLogLegendVisible,
      setLogShowPoints,
      setLogTitle,
      setLogXLabel,
      setLogYLabel,
    ],
  )
  const renderSamplePanel = useCallback(
    (usePanelRef: boolean, containerStyle?: CSSProperties) => (
      <div
        ref={usePanelRef ? samplePanelRef : null}
        className="replicate-panel replicate-panel--single-toggle"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignSelf: 'stretch',
          minHeight: 0,
          maxHeight: usePanelRef ? samplePanelMaxHeight : undefined,
          ...containerStyle,
        }}
        tabIndex={0}
      >
        <button
          ref={sampleHelpAnchorRef}
          type="button"
          className="help-btn circle replicate-panel__help-btn"
          aria-expanded={showSampleHelp}
          aria-label={isPl ? 'Pokaż pomoc' : 'Toggle help'}
          onClick={() => setShowSampleHelp((prev) => !prev)}
        >
          ?
        </button>
        <div className="replicate-panel__header">
          <div>
            <h3 className="replicate-panel__title">{isPl ? 'Próby' : 'Samples'}</h3>
            <p className="replicate-panel__description">{sampleHelp}</p>
          </div>
          <div className="replicate-panel__actions" />
        </div>
        <HelpTooltip anchorRef={sampleHelpAnchorRef} open={showSampleHelp}>
          {sampleHelpBanner}
        </HelpTooltip>

        <div className="replicate-panel__legend">
          <span className="replicate-panel__legend-label">{isPl ? 'Próba' : 'Sample'}</span>
          <div className="replicate-panel__legend-pills">
            <span>{isPl ? 'Dołki' : 'Wells'}</span>
            <span>{isPl ? 'Aktywna' : 'Active'}</span>
          </div>
        </div>

        <div className="replicate-panel__list" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {hasCurves ? (
            orderedSampleNames.map((sampleName) => {
              const curve = curves.find((c) => c.sample === sampleName)
              if (!curve) return null
              const selected = selectedSamples.includes(curve.sample)
              const isActive = activeSample === curve.sample
              return (
                <div
                  key={curve.sample}
                  className={`replicate-card replicate-row--single-toggle ${isActive ? 'is-focused' : ''}`}
                  onClick={() => {
                    toggleSample(curve.sample)
                    setActiveSample(curve.sample)
                  }}
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      toggleSample(curve.sample)
                      setActiveSample(curve.sample)
                    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault()
                      handleSampleNavigate(event.key === 'ArrowDown' ? 1 : -1)
                    }
                  }}
                >
                  <div className="replicate-card__top">
                    <div className="replicate-card__identity">
                      <span className="replicate-card__dot" style={{ background: curve.color }} />
                      <div>
                        <div className="replicate-card__name">{curve.sample}</div>
                        <div className="replicate-card__meta">
                          {isPl ? 'Dolki' : 'Wells'}: {curve.wells.map((well) => well.well.toUpperCase()).join(', ')}
                        </div>
                      </div>
                    </div>
                    <div className="replicate-card__toggles">
                      <button
                        type="button"
                        className={`state-pill state-pill--plot ${selected ? 'is-on' : ''}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleSample(curve.sample)
                          setActiveSample(curve.sample)
                        }}
                        aria-pressed={selected}
                        aria-label={selected ? 'Ukryj próbę na wykresie' : 'Pokaż próbę na wykresie'}
                      >
                        {selected ? '✓' : '×'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })
          ) : (
            <div className="small" style={{ color: 'var(--text-muted)' }}>
              Brak danych - wczytaj plik <code>.blanked.json</code>.
            </div>
          )}
        </div>
      </div>
    ),
    [
      activeSample,
      curves,
      handleSampleNavigate,
      hasCurves,
      isPl,
      orderedSampleNames,
      sampleHelp,
      sampleHelpBanner,
      samplePanelMaxHeight,
      selectedSamples,
      setActiveSample,
      setShowSampleHelp,
      showSampleHelp,
      toggleSample,
    ],
  )
  const fullscreenSidePanelOpen = !!chartFullscreen && (showPlotControls || showSamplePanel)
  const combinedChartClassName = `chart-card ${chartFullscreen === 'combined' ? 'chart-card--fullscreen' : ''} ${
    chartFullscreen === 'combined' && fullscreenSidePanelOpen ? 'chart-card--with-controls' : ''
  }`.trim()
  const logChartClassName = `chart-card ${chartFullscreen === 'log' ? 'chart-card--fullscreen' : ''} ${
    chartFullscreen === 'log' && fullscreenSidePanelOpen ? 'chart-card--with-controls' : ''
  }`.trim()

  return (
    <div className="smoothing-page" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel panel-landing blank-info smoothing-info">
        <div className="panel-heading with-help panel-heading--centered">
          <div>
            <div className="eyebrow">{isPl ? 'Wygładzanie krzywych' : 'Curves Smoothing'}</div>
            <h2 className="info-card__title">
              {isPl ? 'Przeprowadzenie wygładzania krzywych' : 'Performing Curves Smoothing'}
            </h2>
          </div>
          <button
            ref={infoHelpAnchorRef}
            className="help-btn circle"
            type="button"
            onClick={() => setShowInfoHelp((v) => !v)}
            aria-label={isPl ? 'Pomoc: Curves Smoothing' : 'Help: Curves Smoothing'}
          >
            ?
          </button>
        </div>
        <HelpTooltip anchorRef={infoHelpAnchorRef} open={showInfoHelp}>
          {infoHelp}
        </HelpTooltip>
        <div className="blank-info__body">
          <p className="small info-card__description">
            {isPl
              ? 'Istnieje wiele sposobów na wygładzanie krzywych wzrostu bakterii. W tym programie wykorzystywany jest algorytm LOESS. Plik po korekcie blank jest automatycznie wczytany do tej karty, ale mozesz tez wgrać inny plik po korekcie blank.'
              : 'There are many ways to smooth bacterial growth curves. This app uses the LOESS algorithm. The blank-corrected file is loaded into this card automatically, but you can also upload a different blank-corrected file.'}
          </p>
          <p className="small info-card__description">
            {isPl
              ? 'Poniżej znajdziesz domyślne parametry, wg których program wygładzi krzywe i wyznaczy logarytmiczne fazy wzrostu dla każdej próby. Aby przeprowadzić wygładzanie i wyznaczanie fazy log kliknij przycisk LOESS. Możesz zmienić parametry i ponownie uruchomić wygładzanie, jeśli nie jesteś zadowolony z wyników. Możesz też ręcznie zaznaczać fazę log na wykresach. Po wygładzeniu i oznaczeniu faz log kliknij Dalej, aby przejść do ostatecznych krzywych wzrostu i parametrów biologicznych.'
              : 'Below you will find the default parameters according to which the app will smooth the curves and determine the logarithmic growth phases for each sample. To perform smoothing and log-phase detection, click the LOESS button. You can change the parameters and rerun the smoothing if you are not satisfied with the results. You can also manually mark the log phase on the charts. After smoothing and marking the log phases, click Next to proceed to the final growth curves and biological parameters.'}
          </p>
          <p className="small info-card__description">
            {isPl
              ? 'Dopasuj parametry wygładzania tak, żeby krzywe były jak najlepiej dopasowane do przebiegu samych punktów pomiarów, zwłaszcza na początku wygładzone krzywe nie powinny odstawać od punktów na wykresie. Kiedy już dopasujesz parametry wygładzania, dopasuj parametry wykrywania fazy logarytmicznej.'
              : 'Adjust the smoothing parameters so that the curves fit the course of the measurement points from the replicates as well as possible, especially at the beginning the smoothed curves should not deviate from the points on the chart. Once you have adjusted the smoothing parameters, adjust the logarithmic phase detection parameters.'}
          </p>
        </div>
      </div>

      <div className="panel panel-soft blank-loader smoothing-loader">
        <div className="panel-heading">
          <div>
            <h3>{isPl ? 'Wybór pliku' : 'File Selection'}</h3>
            <p className="small">
              {isPl ? (
                <>
                  <strong>Ten krok jest opcjonalny.</strong> Plik po korekcie blank jest automatycznie wczytany z poprzedniego etapu, ale
                  mozesz tez wgrać inny plik po korekcie blank lub zaimportować przygotowany <code>.blanked.json</code>.
                </>
              ) : (
                <>
                  <strong>This step is optional.</strong> The blank-corrected file is pulled from the previous step, but
                  you can pick another file or import a prepared <code>.blanked.json</code>.
                </>
              )}
            </p>
          </div>
        </div>

        {missingSamples.length > 0 && (
          <div
            className="small"
            style={{
              marginTop: 8,
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid #fbbf24',
              background: '#fef3c7',
              color: '#854d0e',
            }}
          >
            {isPl ? (
              <>
                W pliku znaleziono {curves.length} z{' '}
                {mappingSamples.filter((sample) => (sample?.wells?.length ?? 0) > 0).length} prï¿½b z danymi. Brakujace
                prï¿½bki (sekcja <code>dataset.rows</code>): {missingSamples.slice(0, 6).join(', ')}
                {missingSamples.length > 6 ? ` + ${missingSamples.length - 6} kolejnych` : ''}. Wyeksportuj ponownie
                kompletne <code>.blanked.json</code> albo uzyj pliku <code>.assignment.json</code>.
              </>
            ) : (
              <>
                Found {curves.length} of{' '}
                {mappingSamples.filter((sample) => (sample?.wells?.length ?? 0) > 0).length} samples with data. Missing
                samples (the <code>dataset.rows</code> section): {missingSamples.slice(0, 6).join(', ')}
                {missingSamples.length > 6 ? ` + ${missingSamples.length - 6} more` : ''}. Re-export a complete{' '}
                <code>.blanked.json</code> or use an <code>.assignment.json</code> file.
              </>
            )}
          </div>
        )}

        <div className="blank-loader__grid">
          <div>
            <label className="field">
              <div className="field-label-row">
                <span>{isPl ? 'Importuj (opcjonalnie)' : 'Import (optional)'}</span>
              </div>
              <div className="file-upload">
                <input
                  id="smoothing-file-input"
                  className="file-upload__input"
                  type="file"
                  accept=".json"
                  onChange={(event) => {
                    handleFileChange(event.target.files)
                    if (event.target) event.target.value = ''
                  }}
                  aria-label={isPl ? 'Wybierz plik po korekcie blank' : 'Choose a blank-corrected file'}
                />
                <label className="btn" htmlFor="smoothing-file-input">
                  {isPl ? 'Wybierz plik' : 'Choose file'}
                </label>
                <span className="file-upload__name">
                  {filename ? (
                    <>
                      {isPl ? 'Wczytano: ' : 'Loaded: '}<strong>{filename}</strong>
                    </>
                  ) : (
                    isPl ? 'Nie wybrano pliku' : 'No file chosen'
                  )}
                </span>
              </div>
            </label>
          </div>

          <div>
            <label className="field">
              <div className="field-label-row">
                <span>{isPl ? 'Na bazie pliku:' : 'Based on file:'}</span>
              </div>
              <select
                value={activeEntryIndex}
                onChange={(event) => handleEntryChange(Number(event.target.value))}
                disabled={!assignments.length}
              >
                {!assignments.length && <option value={0}>{isPl ? '(brak danych)' : '(no data loaded)'}</option>}
                {assignments.map((entry, index) => {
                  const meta = entry.dataset?.meta
                  const label = meta?.sourceFile || meta?.runId || `assignment-${index + 1}`
                  return (
                    <option key={index} value={index}>
                      {index + 1}. {label}
                    </option>
                  )
                })}
              </select>
              <div className="small field-note">
                {isPl
                  ? 'Dane z poprzedniego kroku ładują się automatycznie; możesz tez wczytać inny zapisany plik.'
                  : 'Data from the previous step loads automatically; you can also load a saved file.'}
              </div>
            </label>
          </div>
        </div>
        {status && <div className="small blank-loader__status">{status}</div>}
      </div>

      <PanelWithHelp
        title={isPl ? 'Parametry wygładzania' : 'Smoothing Controls'}
        helpContent={smoothingHelp}
        className="panel-soft control-panel smoothing-controls"
      >
        <p className="small info-card__description" style={{ marginTop: 0 }}>
          {isPl ? (
            <>
              Program wybiera <strong>okno</strong> o danej wielkości punktów (span) i dopasowuje lokalnie albo linię,
              albo parabolę (<strong>model lokalny</strong>), a następnie przesuwa okno. Program iteruje ten proces, aby
              zminimalizować różnice między oryginalnymi i wygładzonymi punktami. Dodatkowo, w każdym przebiegu punkty
              odstające otrzymują mniejsze wagi (<strong>przejścia robust</strong>), co zwiększa odporność na szumy.
              Program może przeprowadzić wygładzanie <strong>wielokrotnie</strong>, aby osiągnąć najlepsze wyniki.
              Kolejne iteracje są uznane za stabilne, jeżeli różnica pomiędzy nimi jest mniejsza niż ustawiona
              <strong> tolerancja</strong>. Użyj przycisku LOESS, aby wygładzić wszystkie krzywe.
            </>
          ) : (
            <>
              The app picks a <strong>window</strong> of a given point size (span) and locally fits either a line or a
              parabola (<strong>local model</strong>), then slides the window. The app iterates this process to minimize
              the difference between original and smoothed points. Additionally, in each pass, outlier points get lower
              weights (<strong>robust passes</strong>), increasing noise resistance. The app can perform smoothing
              <strong> multiple times</strong> to achieve the best results. Subsequent iterations are considered stable
              if the difference between them is less than the set <strong>tolerance</strong>. Use the LOESS button to
              smooth all curves.
            </>
          )}
        </p>
        <p className="small info-card__description" style={{ marginTop: 0 }}>
          {isPl
            ? 'Jeżeli zależy Ci jedynie na przeglądaniu krzywych wzrostu, bez obliczania parametrów biologicznych, po prostu przejdź dalej. Jeżeli jednak planujesz analizę parametrów wzrostu, sprawdź jeszcze, czy fazy logarytmicznego wzrostu zostały dobrze wykryte.'
            : 'If you only care about browsing growth curves without calculating biological parameters, just proceed. However, if you plan to analyze growth parameters, double-check that the logarithmic growth phases have been well detected.'}
        </p>        <div className="control-grid control-grid--tight smoothing-controls__grid">
          <FieldWithHelp label={isPl ? 'Okno / span' : 'Sliding window / span'} help={spanHelp} maxWidth={240}>
            <input
              className="field-input"
              type="text"
              value={spanInput}
              onChange={(event) => setSpanInput(event.target.value)}
              placeholder={isPl ? '0.4 lub np. 15' : '0.4 or e.g. 15'}
            />
          </FieldWithHelp>
          <FieldWithHelp label={isPl ? 'Model lokalny' : 'Local model'} help={modelHelp} maxWidth={240}>
            <select
              className="field-input"
              value={degree}
              onChange={(event) => setDegree(Number(event.target.value) === 2 ? 2 : 1)}
            >
              <option value={1}>{isPl ? 'Linia (stopien 1)' : 'Line (degree 1)'}</option>
              <option value={2}>{isPl ? 'Parabola (stopien 2)' : 'Parabola (degree 2)'}</option>
            </select>
          </FieldWithHelp>
          <FieldWithHelp label={isPl ? 'Przejscia robust' : 'Robust passes'} help={robustHelp} maxWidth={240}>
            <input
              className="field-input"
              type="number"
              min={1}
              value={robustPasses}
              onChange={(event) => {
                const value = Number(event.target.value)
                setRobustPasses(Number.isFinite(value) && value >= 1 ? Math.round(value) : 1)
              }}
            />
          </FieldWithHelp>
          <FieldWithHelp label={isPl ? 'Maks. powtórzeń' : 'Max re-runs'} help={rerunHelp} maxWidth={240}>
            <input
              className="field-input"
              type="number"
              min={1}
              value={maxRefinements}
              onChange={(event) => {
                const value = Number(event.target.value)
                setMaxRefinements(Number.isFinite(value) && value >= 1 ? Math.round(value) : 1)
              }}
            />
          </FieldWithHelp>
          <FieldWithHelp label={isPl ? 'Tolerancja zbieznosci' : 'Convergence tol.'} help={convHelp} maxWidth={240}>
            <input
              className="field-input"
              type="number"
              min={0}
              step={0.0001}
              value={convergenceTol}
              onChange={(event) => {
                const value = Number(event.target.value)
                setConvergenceTol(Number.isFinite(value) && value > 0 ? value : 0.0001)
              }}
            />
          </FieldWithHelp>
        </div>
        <div className="control-row smoothing-controls__row">
          <div className="control-actions control-actions--inline smoothing-controls__actions">
            <button className="btn primary" disabled={!curves.length || isLoessRunning} onClick={() => applyLoess('all')}>
              {isPl ? 'LOESS' : 'LOESS'}
            </button>
            <button className="btn" disabled={!canApplyBack || isLoessRunning} onClick={stepBack}>
              {isPl ? 'Cofnij' : 'Back'}
            </button>
            <button className="btn" disabled={!curves.length} onClick={handleExportCurves}>
              {isPl ? 'Eksportuj wygladzone krzywe' : 'Export smoothed curves'}
            </button>
            <button className="btn primary" disabled={!smoothedPayload} onClick={handleSendToParameters}>
              {isPl ? 'Dalej' : 'Next'}
            </button>
          </div>
          {isLoessRunning && (
            <div className="loess-progress loess-progress--inline" aria-label="LOESS in progress">
              <div className="loess-progress__bar">
                <div
                  className="loess-progress__fill"
                  style={{ width: `${Math.min(100, Math.max(0, loessProgress ?? 0))}%` }}
                />
              </div>
              <span className="small" style={{ color: 'var(--text-secondary)' }}>
                {isPl ? 'Licze LOESS...' : 'Running LOESS...'} {Math.min(100, Math.max(0, loessProgress ?? 0))}%
              </span>
            </div>
          )}
        </div>
      </PanelWithHelp>

      {hasCurves && activeLogCurve && (
        <PanelWithHelp
          title={isPl ? 'Identyfikacja fazy logarytmicznej' : 'Log identification controls'}
          helpContent={logIdHelp}
          className="panel-soft control-panel smoothing-controls log-controls"
        >
        <p className="small info-card__description" style={{ marginTop: 0 }}>
          {isPl
            ? 'Ustaw parametry automatycznego wykrywania fazy logarytmicznej, jeśli nie jesteś zadowolony z wyników dla ustawień domyślnych. Użyj przycisków poniżej, aby wymusić ponowne wykrycie fazy logarytmicznej. Możesz też ręcznie zaznaczyć zakres fazy log na wykresie i zapisać go. Jeśli potrzebujesz, wyeksportuj zapisane fazy logarytmiczne do pliku .json.'
            : 'Adjust the automatic log-phase detection parameters if you are not satisfied with the results for the default settings. Use the buttons below to force re-detection of the log phase. You can also manually mark the log-phase range on the chart and save it. If needed, export the saved log phases to a .json file.'}
        </p>
        <p className="small info-card__description" style={{ marginTop: 0 }}>
          {isPl ? (
            <>
              Program szuka fazy logarytmicznej w przedziale OD od wskazanej <strong>wartości minimalnej</strong> do
                znalezionej wartości maksymalnej. W tym zakresie, w skali ln(OD), przesuwa <strong>okno</strong> zadanej
                wielkości i liczy regresję liniową. Odsiewane są także punkty zbyt bliskie <strong>plateau</strong>.
                Zapamiętuje okna o dodatnim nachyleniu i znajduje okno o największym nachyleniu. Przedział zawęża tak,
                aby stosunek nachylenia okna do nachylenia maksymalnego mieścił się między <strong>μ/μmax min</strong> a
                <strong> μ/μmax max</strong>. Punkty fazy log wybierane są tylko z okien o współczynniku determinacji R
                <sup>2</sup> nie mniejszym niż podane <strong>R</strong>
                <sup>2</sup> <strong>min</strong>.
            </>
          ) : (
            <>
              The app looks for the log phase in the OD range from the specified <strong>minimum value</strong> to the
                detected maximum. Within that range, in ln(OD) scale, it slides a <strong>window</strong> of the chosen
                size and fits a linear regression. Points too close to the <strong>plateau</strong> are discarded. It
                keeps windows with positive slope and finds the steepest one. The candidate range is then limited to
                windows whose slope ratio falls between <strong>μ/μmax min</strong> and <strong>μ/μmax max</strong>.
                Log-phase points are selected only from windows whose determination coefficient R
                <sup>2</sup> is at least the specified <strong>R</strong>
                <sup>2</sup> <strong>min</strong>.
            </>
          )}
          </p>
          <div className="control-grid control-grid--tight smoothing-controls__grid log-id-grid log-id-grid--params">
            <FieldWithHelp label={isPl ? 'OD min' : 'OD min'} help={logOdMinHelp}>
              <input
                className="field-input"
                type="number"
                min={0}
                step={0.001}
                value={autoOdMin}
                onChange={(event) => setAutoOdMin(event.target.value)}
              />
            </FieldWithHelp>
            <FieldWithHelp label={isPl ? 'Okno (punkty)' : 'Window (points)'} help={logWindowHelp}>
              <input
                className="field-input"
                type="number"
                min={3}
                step={1}
                value={autoWindowSize}
                onChange={(event) => setAutoWindowSize(event.target.value)}
              />
            </FieldWithHelp>
            <FieldWithHelp
              label={isPl ? 'Maks. udział plateau' : 'Plateau frac. max'}
              help={logPlateauHelp}
            >
              <input
                className="field-input"
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={autoFracKMax}
                onChange={(event) => setAutoFracKMax(event.target.value)}
              />
            </FieldWithHelp>
            <FieldWithHelp label="μ / μmax min" help={logMuRelMinHelp}>
              <input
                className="field-input"
                type="number"
                min={0}
                step={0.01}
                value={autoMuRelMin}
                onChange={(event) => setAutoMuRelMin(event.target.value)}
              />
            </FieldWithHelp>
            <FieldWithHelp label="μ / μmax max" help={logMuRelMaxHelp}>
              <input
                className="field-input"
                type="number"
                min={0}
                step={0.01}
                value={autoMuRelMax}
                onChange={(event) => setAutoMuRelMax(event.target.value)}
              />
            </FieldWithHelp>
            <FieldWithHelp label="R² min" help={logR2Help}>
              <input
                className="field-input"
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={autoR2Min}
                onChange={(event) => setAutoR2Min(event.target.value)}
              />
            </FieldWithHelp>
          </div>
          <div className="control-row smoothing-controls__row log-id-actions">
            <div className="control-actions control-actions--inline smoothing-controls__actions log-id-actions__buttons">
              <button
                className="btn small"
                type="button"
                onClick={handleClearLogPhase}
                disabled={!primaryLogSample || (!hasStoredLogPhase && !pendingLogRange)}
              >
                {isPl ? 'Wyczyść zaznaczenie' : 'Clear selection'}
              </button>
              <button className="btn small" type="button" onClick={handleManualDetect} disabled={!hasCurves}>
                {isPl ? 'Przelicz fazę log teraz' : 'Recalculate log phase now'}
              </button>
              <button className="btn small" type="button" onClick={handleExportLogPhases} disabled={!logPhaseList.length}>
                {isPl ? 'Eksportuj fazy log (.json)' : 'Export log phases (.json)'}
              </button>
              <button className="btn primary" onClick={handleApplyLogPhase} disabled={!canSaveLogPhase}>
                {isPl ? 'Zapisz fazę log' : 'Save log phase'}
              </button>
            </div>
            <div className="small log-id-hint">
              {isPl
                ? 'Parametry wpływają na automatyczne wykrywanie fazy log przy każdym wygładzaniu (oraz cofnięciu).'
                : 'Parameters influence automatic log-phase detection after each smoothing (and undo).'}
            </div>
          </div>
        </PanelWithHelp>
      )}

      <div className="smoothing-grid">
        {!chartFullscreen && (
          <div className="smoothing-grid__left">{renderSamplePanel(true)}</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {chartFullscreen === 'combined' && (showPlotControls || showSamplePanel) && (
            <div className="plot-controls-float">
              <div className="plot-controls-float__body">
                {showPlotControls && renderCombinedPlotControls()}
                {showSamplePanel && (
                  <div className="plot-controls-float__replicates">
                    {renderSamplePanel(false, { maxHeight: 'calc(100vh - 48px)' })}
                  </div>
                )}
              </div>
            </div>
          )}

          {chartFullscreen !== 'combined' && renderCombinedPlotControls()}

          <PanelWithHelp
            title={isPl ? 'Wygładzone Krzywe' : 'Smoothed Curves'}
            helpContent={combinedChartHelp}
            className={combinedChartClassName}
            contentClassName="chart-card__body"
            actions={
              <div className="btn-pair btn-pair--wrap">
                {chartFullscreen === 'combined' && (
                  <>
                    <button
                      type="button"
                      className="btn basic-btn"
                      onClick={() => setShowPlotControls((v) => !v)}
                      aria-pressed={showPlotControls}
                    >
                      {showPlotControls
                        ? isPl
                          ? 'Ukryj sterowanie wykresem'
                          : 'Hide Plot Controls'
                        : isPl
                          ? 'Pokaż sterowanie wykresem'
                          : 'Show Plot Controls'}
                    </button>
                    <button
                      type="button"
                      className="btn basic-btn"
                      onClick={() => setShowSamplePanel((v) => !v)}
                      aria-pressed={showSamplePanel}
                    >
                      {showSamplePanel
                        ? isPl
                          ? 'Ukryj Panel Prób i replikatów'
                          : 'Hide Samples & Replicates'
                        : isPl
                          ? 'Pokaż Panel Prób i replikatów'
                          : 'Show Samples & Replicates'}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className={`btn ${chartFullscreen === 'combined' ? 'primary' : ''}`}
                  onClick={() => setChartFullscreen((prev) => (prev === 'combined' ? null : 'combined'))}
                >
                  {chartFullscreen === 'combined'
                    ? isPl
                      ? 'Zamknij pełny ekran'
                      : 'Exit fullscreen'
                    : isPl
                      ? 'Pełny ekran'
                      : 'Fullscreen'}
                </button>
              </div>
            }
          >
            {combinedBandWarning && (
              <div className="small" style={{ margin: '6px 0', color: '#92400e', background: '#fef3c7', border: '1px solid #f59e0b', padding: '6px 8px', borderRadius: 6 }}>
                {combinedBandWarning}
              </div>
            )}
            <div ref={combinedChartRef} className="chart-card__canvas">
              {hasCurves ? (
                <SimpleLineChart
                  series={visibleLoessSeries}
                  scatterSeries={visibleScatterSeries}
                  scatterPointRadius={3.2}
                  scatterOpacity={0.8}
                  pointMarkers="none"
                  title={combinedTitle}
                  xLabel={combinedXLabel}
                  yLabel={combinedYLabel}
                  legendMode="none"
                  mode="line"
                  bands={combinedBands}
                  stdMode="area"
                  xBands={highlightBands}
                  resetViewKey={chartResetKey}
                  fontScale={combinedFontScale}
                  legendEntries={combinedLegendEntries}
                  showLegend={combinedLegendVisible}
                  legendTitle={combinedLegendTitle || 'Legenda'}
                  legendScale={combinedLegendScale}
                  minPanX={Number.NEGATIVE_INFINITY}
                  minPanY={Number.NEGATIVE_INFINITY}
                  onPointSelection={handleLogSelection}
                  pointSelectionMode="modifier"
                  height={chartFullscreen === 'combined' ? 620 : 380}
                />
              ) : (
                <div className="empty-state" style={{ minHeight: 220 }}>
                  Brak danych. Wczytaj plik .blanked.json z wartościami <code>val_od600_blank_corrected</code>.
                </div>
              )}
            </div>
          </PanelWithHelp>

          {hasCurves && activeLogCurve && (
            <>
              {chartFullscreen === 'log' && (showPlotControls || showSamplePanel) && (
                <div className="plot-controls-float">
                  <div className="plot-controls-float__body">
                    {showPlotControls && renderLogPlotControls()}
                    {showSamplePanel && (
                      <div className="plot-controls-float__replicates">
                        {renderSamplePanel(false, { maxHeight: 'calc(100vh - 48px)' })}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {chartFullscreen !== 'log' && renderLogPlotControls()}

              <div ref={logPanelRef}>
                <PanelWithHelp
                  title="Log phase chart"
                  helpContent={logChartHelp}
                  className={logChartClassName}
                  contentClassName="chart-card__body"
                  actions={
                    <div className="btn-pair btn-pair--wrap">
                      {chartFullscreen === 'log' && (
                        <>
                          <button
                            type="button"
                            className="btn basic-btn"
                          onClick={() => setShowPlotControls((v) => !v)}
                          aria-pressed={showPlotControls}
                        >
                          {showPlotControls
                            ? isPl
                              ? 'Ukryj sterowanie wykresem'
                              : 'Hide Plot Controls'
                            : isPl
                              ? 'Pokaż sterowanie wykresem'
                              : 'Show Plot Controls'}
                        </button>
                          <button
                            type="button"
                            className="btn basic-btn"
                            onClick={() => setShowSamplePanel((v) => !v)}
                            aria-pressed={showSamplePanel}
                          >
                            {showSamplePanel
                              ? isPl
                                ? 'Ukryj Panel Prób i replikatów'
                                : 'Hide Samples & Replicates'
                              : isPl
                                ? 'Pokaż Panel Prób i replikatów'
                                : 'Show Samples & Replicates'}
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className={`btn ${chartFullscreen === 'log' ? 'primary' : ''}`}
                        onClick={() => setChartFullscreen((prev) => (prev === 'log' ? null : 'log'))}
                      >
                        {chartFullscreen === 'log'
                          ? isPl
                            ? 'Zamknij pełny ekran'
                            : 'Exit fullscreen'
                          : isPl
                            ? 'Pełny ekran'
                            : 'Fullscreen'}
                      </button>
                    </div>
                  }
                >
                  <div ref={logChartRef} className="chart-card__canvas">
                    <SimpleLineChart
                      series={visibleLogLineSeries}
                      scatterSeries={visibleLogScatterSeries}
                      scatterPointRadius={3}
                      scatterOpacity={0.9}
                      title={logTitle}
                      xLabel={logXLabel}
                      yLabel={logYLabel}
                      legendMode="none"
                      xBands={highlightBands}
                      pointMarkers="none"
                      onPointSelection={handleLogSelection}
                      pointSelectionMode="modifier"
                      enableZoom
                      enablePan
                      fontScale={logFontScale}
                      resetViewKey={logChartResetKey}
                      legendEntries={logLegendEntries}
                      showLegend={logLegendVisible}
                      legendTitle={logLegendTitle || 'Legenda'}
                      legendScale={logLegendScale}
                      minPanX={Number.NEGATIVE_INFINITY}
                      minPanY={Number.NEGATIVE_INFINITY}
                      height={chartFullscreen === 'log' ? 620 : 380}
                    />
                  </div>
                  <div className="small" style={{ marginTop: 4 }}>
                    Przytrzymaj klawisz Shift lub Alt i przeciagnij, aby wyznaczyc faze log dla zaznaczonej proby.
                  </div>
                </PanelWithHelp>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}


