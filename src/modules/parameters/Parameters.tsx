import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HelpTooltip } from '@/components/HelpTooltip'
import { PanelWithHelp } from '@/components/PanelWithHelp'
import SimpleLineChart, { type Series, type SeriesPoint } from '@/components/SimpleLineChart'
import { useApp } from '@/state/store'
import type { AssignmentEntry } from '@/utils/assignments'
import { downloadBlob, sanitizeFileName, elementToPngBlob } from '@/utils/export'
import { generateDistinctColors } from '@/utils/colors'
import type { NumericPoint } from '@/utils/loess'
import {
  computeParameters,
  DEFAULT_STATS_CONFIG,
  type ParameterResult,
  type WellParameterResult,
  type ParameterSpread,
  type SampleStatsEntry,
  type StatsComputationConfig,
} from '@/utils/parameters'

type ParamConfig = {
  id: string
  label: string
  unit?: string
  getter: (row: ParameterResult) => number | null | undefined
}

type ChartSettings = {
  title: string
  xLabel: string
  yLabel: string
  yMax?: number | ''
  fontScale: number
  legendFontScale: number
  sort: 'none' | 'asc' | 'desc'
  showValues: boolean
  showSamples: boolean
  legendVisible: boolean
  sampleAngle?: number
  valueAngle?: number
  sampleLabels?: Record<string, string>
  legendTitle?: string
  showSd?: boolean
  showCi?: boolean
  showReplicates?: boolean
}

type ParameterPoint = {
  sample: string
  value: number | null | undefined
  spread?: ParameterSpread
  replicates?: Array<{ value: number; well?: string; replicate?: number }>
}

type LoessChartSettings = {
  title: string
  xLabel: string
  yLabel: string
  fontScale: number
  legendVisible: boolean
  legendScale: number
  showMean: boolean
  showMedian: boolean
  showSd: boolean
  showCi: boolean
}

type SmoothedCurveSeries = {
  sample: string
  well: string
  replicate?: number
  points: NumericPoint[]
}

type LoessBand = { name: string; color: string; points: { x: number; low: number; high: number }[] }

type LoessChartData = {
  series: Series[]
  ciBands: LoessBand[]
  sdBands: LoessBand[]
  medianScatter: Series[]
  meanScatter: Series[]
  warnings: string[]
  selectionEmpty: boolean
  hasReplicates: boolean
}

const DETECTION_THRESHOLDS = [0.05, 0.1]

const TEXT_CANVAS = typeof document !== 'undefined' ? document.createElement('canvas') : null
const TEXT_CTX = TEXT_CANVAS?.getContext('2d') ?? null
const FONT_FAMILY = '"Inter", "Segoe UI", system-ui, sans-serif'

const DEFAULT_LOESS_SETTINGS: LoessChartSettings = {
  title: 'Krzywe LOESS (smoothed)',
  xLabel: 'Czas [min]',
  yLabel: 'OD600 (wygladzona)',
  fontScale: 1,
  legendVisible: true,
  legendScale: 1,
  showMean: false,
  showMedian: false,
  showSd: false,
  showCi: true,
}

function formatNumber(value: number | null | undefined, digits = 3): string {
  if (value == null || Number.isNaN(value)) return '-'
  if (!Number.isFinite(value)) return 'inf'
  return Number(value).toFixed(digits)
}

function detectionKey(threshold: number): string {
  return threshold.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function getSpreadForParam(row: ParameterResult, paramId: string): ParameterSpread | undefined {
  if (!row?.stats) return undefined
  const stats = row.stats as any
  if (paramId.startsWith('det-')) {
    const key = paramId.replace('det-', '')
    return stats?.detection?.[key]
  }
  const map: Record<string, string> = {
    muMax: 'muMax',
    td: 'td',
    lambda: 'lambda',
    kHat: 'kHat',
    odMax: 'odMax',
    tInflection: 'tInflection',
    tMid: 'tMid',
    slopeInf: 'slopeAtInflection',
    auc: 'auc',
    logStart: 'logStart',
    logEnd: 'logEnd',
    tLogDuration: 'tLogDuration',
  }
  const key = map[paramId] ?? paramId
  return stats?.[key]
}

function measureTextSize(text: string, fontSize: number, fontWeight = 700, fontFamily = FONT_FAMILY) {
  if (!text) return { width: 0, height: fontSize }
  if (!TEXT_CTX) {
    return { width: text.length * fontSize * 0.6, height: fontSize * 1.2 }
  }
  TEXT_CTX.font = `${fontWeight} ${fontSize}px ${fontFamily}`
  const metrics = TEXT_CTX.measureText(text)
  const height =
    (metrics.actualBoundingBoxAscent ?? fontSize * 0.7) +
    (metrics.actualBoundingBoxDescent ?? fontSize * 0.3)
  return { width: metrics.width, height }
}

function labelsOverlap(centers: number[], widths: number[], padding = 4): boolean {
  if (!centers.length || !widths.length) return false
  let prevRight = -Infinity
  for (let i = 0; i < centers.length; i += 1) {
    const half = (widths[i] ?? 0) / 2
    const left = centers[i] - half
    const right = centers[i] + half
    if (left - padding < prevRight) return true
    prevRight = Math.max(prevRight, right + padding)
  }
  return false
}

function ensureArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

const T_CRITICAL_975: Record<number, number> = {
  1: 12.706,
  2: 4.303,
  3: 3.182,
  4: 2.776,
  5: 2.571,
  6: 2.447,
  7: 2.365,
  8: 2.306,
  9: 2.262,
  10: 2.228,
  11: 2.201,
  12: 2.179,
  13: 2.16,
  14: 2.145,
  15: 2.131,
  16: 2.12,
  17: 2.11,
  18: 2.101,
  19: 2.093,
  20: 2.086,
  21: 2.08,
  22: 2.074,
  23: 2.069,
  24: 2.064,
  25: 2.06,
  26: 2.056,
  27: 2.052,
  28: 2.048,
  29: 2.045,
  30: 2.042,
}

function tCritical95(df: number): number {
  if (df <= 0 || Number.isNaN(df)) return 0
  if (df >= 30) return 1.96
  return T_CRITICAL_975[Math.round(df) as keyof typeof T_CRITICAL_975] ?? 1.96
}

function interpolateSorted(points: NumericPoint[], x: number): number {
  if (!points.length) return NaN
  if (x <= points[0].x) return points[0].y
  if (x >= points[points.length - 1].x) return points[points.length - 1].y
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]
    const b = points[i + 1]
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / Math.max(1e-9, b.x - a.x)
      return a.y * (1 - t) + b.y * t
    }
  }
  return points[points.length - 1].y
}

function evaluateOnGrid(points: NumericPoint[], grid: number[]): number[] {
  const sorted = [...points].sort((a, b) => a.x - b.x)
  return grid.map((x) => interpolateSorted(sorted, x))
}

function normalizeSmoothedCurves(entry: AssignmentEntry | null): { curves: SmoothedCurveSeries[]; warnings: string[] } {
  const warnings: string[] = []
  if (!entry?.dataset) return { curves: [], warnings }
  const dataset: any = entry.dataset
  const wellCurves = Array.isArray(dataset?.well_curves) ? dataset.well_curves : []
  const sampleCurves = Array.isArray(dataset?.sample_curves) ? dataset.sample_curves : []
  const source = wellCurves.length ? wellCurves : sampleCurves
  const usingWellCurves = wellCurves.length > 0
  if (!source.length) {
    warnings.push('Brak krzywych (well_curves / sample_curves) w pliku assignment.')
    return { curves: [], warnings }
  }

  const curves: SmoothedCurveSeries[] = []
  source.forEach((curve: any, index: number) => {
    const sample = typeof curve?.sample === 'string' ? curve.sample.trim() : ''
    if (!sample) {
      warnings.push(`Pomijam krzywa nr ${index + 1} (brak nazwy probki).`)
      return
    }
    const well =
      typeof curve?.well === 'string'
        ? curve.well.trim()
        : usingWellCurves
        ? `${sample}-well-${index + 1}`
        : sample
    const replicate =
      curve?.replicate != null && !Number.isNaN(Number(curve.replicate))
        ? Number(curve.replicate)
        : undefined
    const timeRaw = Array.isArray(curve?.time_min) ? curve.time_min : []
    const valsRaw =
      (Array.isArray(curve?.od600_smoothed) && curve.od600_smoothed) ||
      (Array.isArray(curve?.od600_smoothed_vals) && curve.od600_smoothed_vals) ||
      (Array.isArray(curve?.od600_blank_corrected) && curve.od600_blank_corrected) ||
      (Array.isArray(curve?.od600_raw) && curve.od600_raw) ||
      []
    const len = Math.min(timeRaw.length, valsRaw.length)
    if (!len) {
      warnings.push(`Pomijam ${sample}/${well} - brak punktow do wykresu.`)
      return
    }
    const points: NumericPoint[] = []
    for (let i = 0; i < len; i += 1) {
      const t = Number(timeRaw[i])
      const v = Number(valsRaw[i])
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue
      points.push({ x: t, y: v })
    }
    if (points.length < 2) {
      warnings.push(`Pomijam ${sample}/${well} - za malo punktow (min 2).`)
      return
    }
    points.sort((a, b) => a.x - b.x)
    curves.push({ sample, well, replicate, points })
  })

  return { curves, warnings }
}

function deriveAssignments(payload: any): AssignmentEntry[] {
  if (Array.isArray(payload?.assignments)) {
    return payload.assignments
  }
  if (payload?.dataset?.rows && payload?.mapping) {
    return [payload as AssignmentEntry]
  }
  if (Array.isArray(payload?.rows)) {
    const dataset: AssignmentEntry['dataset'] = {
      meta: payload.meta ?? payload.dataset?.meta ?? payload?.dataset?.meta ?? {},
      rows: payload.rows,
      sample_curves: payload.sample_curves,
      well_curves: payload.well_curves,
      log_phases: payload.log_phases ?? payload.logPhases,
      blankCorrection: payload.blankCorrection,
      blankedAt: payload.blankedAt,
    } as any
    const sampleNames = new Set<string>()
    payload.rows.forEach((row: any) => {
      const name = typeof row?.sample === 'string' ? row.sample.trim() : ''
      if (name) sampleNames.add(name)
    })
    ensureArray(payload.sample_curves).forEach((curve: any) => {
      if (curve?.sample) sampleNames.add(curve.sample)
    })
    ensureArray(payload.well_curves).forEach((curve: any) => {
      if (curve?.sample) sampleNames.add(curve.sample)
    })
    const orderedSamples = Array.from(sampleNames).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    )
    const mapping: AssignmentEntry['mapping'] = {
      type: 'mapping',
      version: 1,
      id: payload.mapping?.id ?? 'auto-mapping',
      name: payload.mapping?.name ?? 'Auto mapping',
      createdAt: payload.mapping?.createdAt ?? new Date().toISOString(),
      notes: payload.mapping?.notes,
      samples: orderedSamples.map((name, index) => ({
        name,
        order: index,
        color: null,
        saturation: null,
        wells: [],
      })),
    }
    return [{ mapping, dataset }]
  }
  return []
}

function hasLogPhaseInfo(entry: AssignmentEntry | null | undefined): boolean {
  if (!entry?.dataset) return false
  const logPhases = (entry.dataset as any)?.log_phases ?? (entry.dataset as any)?.logPhases
  if (Array.isArray(logPhases) && logPhases.length) return true
  const curves = (entry.dataset as any)?.sample_curves
  if (Array.isArray(curves) && curves.some((c: any) => c?.logPhase || c?.log_phase || (c?.logPhases?.length))) {
    return true
  }
  const wellCurves = (entry.dataset as any)?.well_curves
  if (Array.isArray(wellCurves) && wellCurves.length) return true
  return false
}

function defaultChartSettings(param: ParamConfig): ChartSettings {
  return {
    title: param.label,
    xLabel: 'Samples',
    yLabel: param.unit ? `${param.label} (${param.unit})` : param.label,
    yMax: '',
    fontScale: 1,
    legendFontScale: 1,
    sort: 'desc',
    showValues: false,
    showSamples: true,
    legendVisible: false,
    sampleAngle: 0,
  valueAngle: 0,
  sampleLabels: {},
  legendTitle: '',
  showSd: true,
  showCi: false,
  showReplicates: true,
  }
}

function sortChartData(data: ParameterPoint[], sort: ChartSettings['sort']): ParameterPoint[] {
  if (sort === 'none') return data
  const clone = [...data]
  clone.sort((a, b) => {
    const aVal = Number.isFinite(a.value as number) ? Number(a.value) : null
    const bVal = Number.isFinite(b.value as number) ? Number(b.value) : null
    if (aVal == null && bVal == null) return 0
    if (aVal == null) return 1
    if (bVal == null) return -1
    return sort === 'asc' ? aVal - bVal : bVal - aVal
  })
  return clone
}

function SamplesPanel({
  results,
  selectedSamples,
  onToggle,
  onSelectAll,
  onClear,
  sampleColors,
}: {
  results: ParameterResult[]
  selectedSamples: string[]
  onToggle: (sample: string) => void
  onSelectAll: () => void
  onClear: () => void
  sampleColors: Map<string, string>
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const selectedSet = useMemo(() => new Set(selectedSamples), [selectedSamples])

  return (
    <div className="replicate-panel parameters-samples-panel" id="parameters-samples">
      <button
        ref={anchorRef}
        type="button"
        className="help-btn circle replicate-panel__help-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Samples help"
      >
        ?
      </button>
      <HelpTooltip anchorRef={anchorRef} open={open}>
        Wybierz, ktore proby maja byc widoczne na wszystkich wykresach parametrow.
        Zmiany dzialaja globalnie dla tej karty.
      </HelpTooltip>

      <div className="replicate-panel__header">
        <div>
          <h3 className="replicate-panel__title">Samples</h3>
          <p className="replicate-panel__description">
            Panel dotyczy wszystkich wykresow. Uzyj go, aby szybko wlaczac/wylaczac probki.
          </p>
        </div>
        <div className="replicate-panel__actions">
          <button className="btn" onClick={onSelectAll} disabled={!results.length}>
            Select all
          </button>
          <button className="btn" onClick={onClear} disabled={!results.length}>
            Clear
          </button>
        </div>
      </div>

      <div className="replicate-panel__legend">
        <span className="replicate-panel__legend-label">Proby</span>
        <div className="replicate-panel__legend-pills">
          <span>Widoczna</span>
        </div>
      </div>

      <div className="replicate-panel__list" onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        event.preventDefault()
      }}>
        {results.map((row) => {
          const active = selectedSet.has(row.sample)
          const color = sampleColors.get(row.sample) ?? '#2563eb'
          return (
            <div
              key={row.sample}
              className={`replicate-card replicate-row--single-toggle ${active ? 'is-focused' : ''}`}
              onClick={() => onToggle(row.sample)}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onToggle(row.sample)
                }
              }}
            >
              <div className="replicate-card__top">
                <div className="replicate-card__identity">
                  <span className="replicate-card__dot" style={{ background: color }} />
                  <div>
                    <div className="replicate-card__name">{row.sample}</div>
                  </div>
                </div>
                <div className="replicate-card__toggles">
                  <button
                    type="button"
                    className={`state-pill state-pill--plot ${active ? 'is-on' : ''}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onToggle(row.sample)
                    }}
                    aria-pressed={active}
                    aria-label={active ? 'Ukryj probe na wykresach parametrow' : 'Pokaz probe na wykresach parametrow'}
                  >
                    {active ? '?' : '?'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
        {!results.length && (
          <div className="small" style={{ color: 'var(--text-muted)' }}>
            Brak danych do wyboru.
          </div>
        )}
      </div>
    </div>
  )
}

function LoessPlotControls({
  settings,
  onChange,
  onReset,
  onResetView,
  onExport,
  onCopy,
  legendVisible,
  onToggleLegend,
  showMean,
  showMedian,
  showSd,
  showCi,
  disabled,
}: {
  settings: LoessChartSettings
  onChange: (next: LoessChartSettings) => void
  onReset: () => void
  onResetView: () => void
  onExport: () => void
  onCopy: () => void
  legendVisible: boolean
  onToggleLegend: () => void
  showMean: boolean
  showMedian: boolean
  showSd: boolean
  showCi: boolean
  disabled?: boolean
}) {
  return (
    <PanelWithHelp
      title="LOESS - Sterowanie wykresem"
      helpContent="Steruj tytułem i osiami dla zbiorczych krzywych LOESS. Legenda dotyczy próbek, a pasmo to 95% CI z replik."
      className="panel-soft control-panel parameters-controls"
    >
      <div className="control-grid control-grid--tight">
        <label className="field">
          <div className="field-label-row">
            <span>Tytuł</span>
          </div>
          <input
            className="field-input"
            value={settings.title}
            onChange={(e) => onChange({ ...settings, title: e.target.value })}
            disabled={disabled}
          />
        </label>
        <label className="field">
          <div className="field-label-row">
            <span>Oś X</span>
          </div>
          <input
            className="field-input"
            value={settings.xLabel}
            onChange={(e) => onChange({ ...settings, xLabel: e.target.value })}
            disabled={disabled}
          />
        </label>
        <label className="field">
          <div className="field-label-row">
            <span>Oś Y</span>
          </div>
          <input
            className="field-input"
            value={settings.yLabel}
            onChange={(e) => onChange({ ...settings, yLabel: e.target.value })}
            disabled={disabled}
          />
        </label>
      </div>
      <div className="control-row control-row--tight plot-controls__row">
        <div className="btn-pair">
          <button
            className="btn"
            onClick={() =>
              onChange({
                ...settings,
                fontScale: Math.max(0.6, +(settings.fontScale - 0.1).toFixed(1)),
              })
            }
            disabled={disabled}
            title="Mniejsza czcionka"
          >
            A-
          </button>
          <button
            className="btn"
            onClick={() =>
              onChange({
                ...settings,
                fontScale: Math.min(2, +(settings.fontScale + 0.1).toFixed(1)),
              })
            }
            disabled={disabled}
            title="Większa czcionka"
          >
            A+
          </button>
        </div>
        <label className={`parameters-toggle ${legendVisible ? 'is-on' : ''}`} title="Pokaż/ukryj legendę">
          <input type="checkbox" checked={legendVisible} onChange={onToggleLegend} disabled={disabled} />
          <span className="parameters-toggle__slider" aria-hidden />
          <span className="parameters-toggle__label">Legenda</span>
        </label>
        {legendVisible && (
          <div className="legend-editor__font" style={{ whiteSpace: 'nowrap' }}>
            <span>Rozmiar legendy</span>
            <div className="btn-pair">
              <button
                className="btn"
                type="button"
                onClick={() =>
                  onChange({
                    ...settings,
                    legendScale: Math.max(0.6, +(settings.legendScale - 0.1).toFixed(1)),
                  })
                }
                disabled={disabled}
              >
                A-
              </button>
              <button
                className="btn"
                type="button"
                onClick={() =>
                  onChange({
                    ...settings,
                    legendScale: Math.min(2, +(settings.legendScale + 0.1).toFixed(1)),
                  })
                }
                disabled={disabled}
              >
                A+
              </button>
            </div>
          </div>
        )}
        <div className="btn-pair">
          <button className="btn" type="button" onClick={onExport} disabled={disabled}>
            Export PNG
          </button>
          <button className="btn" type="button" onClick={onCopy} disabled={disabled}>
            Kopiuj PNG
          </button>
        </div>
        <button className="btn basic-btn" type="button" onClick={onResetView} disabled={disabled}>
          Reset widoku
        </button>
        <button className="btn" type="button" onClick={onReset} disabled={disabled}>
          Reset ustawien
        </button>
      </div>
      <div className="control-row control-row--tight plot-controls__row">
        <label className={`parameters-toggle ${showMean ? 'is-on' : ''}`}>
          <input
            type="checkbox"
            checked={showMean}
            onChange={(e) => onChange({ ...settings, showMean: e.target.checked })}
            disabled={disabled}
          />
          <span className="parameters-toggle__slider" aria-hidden />
          <span className="parameters-toggle__label">Pokaż średnie (punkty)</span>
        </label>
        <label className={`parameters-toggle ${showMedian ? 'is-on' : ''}`}>
          <input
            type="checkbox"
            checked={showMedian}
            onChange={(e) => onChange({ ...settings, showMedian: e.target.checked })}
            disabled={disabled}
          />
          <span className="parameters-toggle__slider" aria-hidden />
          <span className="parameters-toggle__label">Pokaż medianę (linia)</span>
        </label>
        <label className={`parameters-toggle ${showSd ? 'is-on' : ''}`}>
          <input
            type="checkbox"
            checked={showSd}
            onChange={(e) => onChange({ ...settings, showSd: e.target.checked })}
            disabled={disabled}
          />
          <span className="parameters-toggle__slider" aria-hidden />
          <span className="parameters-toggle__label">Errorbary SD</span>
        </label>
        <label className={`parameters-toggle ${showCi ? 'is-on' : ''}`}>
          <input
            type="checkbox"
            checked={showCi}
            onChange={(e) => onChange({ ...settings, showCi: e.target.checked })}
            disabled={disabled}
          />
          <span className="parameters-toggle__slider" aria-hidden />
          <span className="parameters-toggle__label">Pasmo CI</span>
        </label>
      </div>
    </PanelWithHelp>
  )
}

function ParameterPlotControls({
  param,
  settings,
  onChange,
  onReset,
  onExport,
  onCopy,
  legendVisible,
  onToggleLegend,
  samples,
  sampleColors,
  disabled,
}: {
  param: ParamConfig
  settings: ChartSettings
  onChange: (next: ChartSettings) => void
  onReset: () => void
  onExport: () => void
  onCopy: () => void
  legendVisible: boolean
  onToggleLegend: () => void
  samples: string[]
  sampleColors: Map<string, string>
  disabled?: boolean
}) {
  const safeSamples = samples ?? []
  const safeSampleColors = sampleColors ?? new Map<string, string>()
  const legendFontScale = settings.legendFontScale ?? settings.fontScale ?? 1
  return (
    <PanelWithHelp
      title={`${param.label} - Sterowanie wykresem`}
      helpContent="Tytuł, etykiety osi oraz kolejność słupków są niezależne dla każdego wykresu. Zmiany nie wpływają na obliczone dane."
      className="panel-soft control-panel parameters-controls"
    >
      <div className="control-grid control-grid--tight">
        <label className="field">
          <div className="field-label-row">
            <span>Tytuł</span>
          </div>
          <input
            className="field-input"
            value={settings.title}
            onChange={(e) => onChange({ ...settings, title: e.target.value })}
            disabled={disabled}
          />
        </label>

        <label className="field checkbox-field">
          <div className="field-label-row">
            <span>Pokaż SD</span>
          </div>
          <label className={`parameters-toggle ${settings.showSd ? 'is-on' : ''}`}>
            <input
              type="checkbox"
              checked={!!settings.showSd}
              onChange={(e) => onChange({ ...settings, showSd: e.target.checked })}
              disabled={disabled}
            />
            <span className="parameters-toggle__slider" aria-hidden />
            <span className="parameters-toggle__label">SD bands</span>
          </label>
        </label>

        <label className="field checkbox-field">
          <div className="field-label-row">
            <span>Pokaż 95% CI</span>
          </div>
          <label className={`parameters-toggle ${settings.showCi ? 'is-on' : ''}`}>
            <input
              type="checkbox"
              checked={!!settings.showCi}
              onChange={(e) => onChange({ ...settings, showCi: e.target.checked })}
              disabled={disabled}
            />
            <span className="parameters-toggle__slider" aria-hidden />
            <span className="parameters-toggle__label">CI whiskers</span>
          </label>
        </label>

        <label className="field checkbox-field">
          <div className="field-label-row">
            <span>Pokaż replikaty</span>
          </div>
          <label className={`parameters-toggle ${settings.showReplicates ? 'is-on' : ''}`}>
            <input
              type="checkbox"
              checked={!!settings.showReplicates}
              onChange={(e) => onChange({ ...settings, showReplicates: e.target.checked })}
              disabled={disabled}
            />
            <span className="parameters-toggle__slider" aria-hidden />
            <span className="parameters-toggle__label">Punkty replikatów</span>
          </label>
        </label>
        <label className="field">
          <div className="field-label-row">
            <span>Oś X</span>
          </div>
          <input
            className="field-input"
            value={settings.xLabel}
            onChange={(e) => onChange({ ...settings, xLabel: e.target.value })}
            disabled={disabled}
          />
        </label>
        <label className="field">
          <div className="field-label-row">
            <span>Oś Y</span>
          </div>
          <input
            className="field-input"
            value={settings.yLabel}
            onChange={(e) => onChange({ ...settings, yLabel: e.target.value })}
            disabled={disabled}
          />
        </label>
        <label className="field">
          <div className="field-label-row">
            <span>Max Y (opcjonalnie)</span>
          </div>
          <input
            className="field-input"
            type="number"
            placeholder="auto"
            value={settings.yMax ?? ''}
            onChange={(e) =>
              onChange({
                ...settings,
                yMax: e.target.value === '' ? '' : Number(e.target.value),
              })
            }
            disabled={disabled}
          />
        </label>
        <label className="field">
          <div className="field-label-row">
            <span>Sortowanie</span>
          </div>
          <select
            value={settings.sort}
            onChange={(e) => onChange({ ...settings, sort: e.target.value as ChartSettings['sort'] })}
            disabled={disabled}
          >
            <option value="desc">Malejaco</option>
            <option value="asc">Rosnaco</option>
            <option value="none">Kolejnosc prob</option>
          </select>
        </label>
      </div>

      <div className="control-row control-row--tight plot-controls__row">
        <div className="btn-pair">
          <button
            className="btn"
            onClick={() =>
              onChange({ ...settings, fontScale: Math.max(0.6, +(settings.fontScale - 0.1).toFixed(1)) })
            }
            disabled={disabled}
            title="Mniejsza czcionka"
          >
            A-
          </button>
          <button
            className="btn"
            onClick={() =>
              onChange({ ...settings, fontScale: Math.min(2, +(settings.fontScale + 0.1).toFixed(1)) })
            }
            disabled={disabled}
            title="Większa czcionka"
          >
            A+
          </button>
        </div>
        <div className="control-actions control-actions--inline parameters-controls__actions">
          <label
            className={`parameters-toggle ${settings.showValues ? 'is-on' : ''}`}
            title="Pokaż wartości nad słupkami"
          >
            <input
              type="checkbox"
              checked={settings.showValues}
              onChange={(e) => onChange({ ...settings, showValues: e.target.checked })}
              disabled={disabled}
            />
            <span className="parameters-toggle__slider" aria-hidden />
            <span className="parameters-toggle__label">Wartości nad słupkami</span>
          </label>
          {settings.showValues && (
            <label className={`parameters-toggle parameters-toggle--range ${disabled ? 'is-disabled' : ''}`}>
              <div className="parameters-toggle__label">
                <div style={{ fontWeight: 700 }}>Kąt wartości (0-90 deg)</div>
                <div className="small" style={{ color: 'var(--text-muted)' }}>{Math.round(settings.valueAngle ?? 0)} deg</div>
              </div>
              <input
                className="parameters-toggle__range"
                type="range"
                min={0}
                max={90}
                step={1}
                value={settings.valueAngle ?? 0}
                onChange={(e) => onChange({ ...settings, valueAngle: Number(e.target.value) })}
                disabled={disabled}
              />
            </label>
          )}
          <label
            className={`parameters-toggle ${settings.showSamples ? 'is-on' : ''}`}
            title="Pokaż nazwy prób pod słupkami"
          >
            <input
              type="checkbox"
              checked={settings.showSamples}
              onChange={(e) => onChange({ ...settings, showSamples: e.target.checked })}
              disabled={disabled}
            />
            <span className="parameters-toggle__slider" aria-hidden />
            <span className="parameters-toggle__label">Nazwy prób</span>
          </label>
          {settings.showSamples && (
            <label className={`parameters-toggle parameters-toggle--range ${disabled ? 'is-disabled' : ''}`}>
              <div className="parameters-toggle__label">
                <div style={{ fontWeight: 700 }}>Kąt nazw prób (0-90 deg)</div>
                <div className="small" style={{ color: 'var(--text-muted)' }}>{Math.round(settings.sampleAngle ?? 0)} deg</div>
              </div>
              <input
                className="parameters-toggle__range"
                type="range"
                min={0}
                max={90}
                step={1}
                value={settings.sampleAngle ?? 0}
                onChange={(e) => onChange({ ...settings, sampleAngle: Number(e.target.value) })}
                disabled={disabled}
              />
            </label>
          )}
          <div className="btn-pair">
            <button
              className={`btn legend-toggle ${legendVisible ? 'primary is-active' : ''}`}
              type="button"
              onClick={onToggleLegend}
              disabled={disabled}
            >
              {legendVisible ? 'Ukryj legendę' : 'Legenda'}
            </button>
            <button className="btn" type="button" onClick={onExport} disabled={disabled}>
              Export PNG
            </button>
            <button className="btn" type="button" onClick={onCopy} disabled={disabled}>
              Kopiuj PNG
            </button>
          </div>
          <button className="btn" type="button" onClick={onReset} disabled={disabled}>
            Reset
          </button>
        </div>
      </div>

      {(settings.showSamples || settings.legendVisible) && safeSamples.length > 0 && (
        <div className="legend-editor legend-editor--compact" role="group" aria-label="Nazwy na wykresie i w legendzie">
          <div className="legend-editor__header">
            <div>
              <div className="legend-editor__title">Nazwy wykresu i legendy</div>
              <div className="legend-editor__subtitle">Zmiana etykiety dziala tylko wizualnie.</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 160 }}>
                <div className="legend-editor__subtitle" style={{ marginBottom: 4 }}>Tytuł legendy</div>
                <input
                  className="legend-editor__input"
                  placeholder="Legenda"
                  value={settings.legendTitle ?? ''}
                  onChange={(e) => onChange({ ...settings, legendTitle: e.target.value })}
                  disabled={disabled}
                />
              </div>
              {settings.legendVisible && (
                <div className="legend-editor__font" style={{ whiteSpace: 'nowrap' }}>
                  <span>Rozmiar legendy</span>
                  <div className="btn-pair">
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        onChange({
                          ...settings,
                          legendFontScale: Math.max(0.6, +((legendFontScale) - 0.1).toFixed(1)),
                        })
                      }
                      disabled={disabled}
                    >
                      A-
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        onChange({
                          ...settings,
                          legendFontScale: Math.min(2, +((legendFontScale) + 0.1).toFixed(1)),
                        })
                      }
                      disabled={disabled}
                    >
                      A+
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="legend-editor__list">
            {safeSamples.map((sample) => {
              const value = settings.sampleLabels?.[sample] ?? ''
              const color = safeSampleColors.get(sample) ?? '#2563eb'
              return (
                <div key={sample} className="legend-editor__row">
                  <div className="legend-editor__swatch" aria-hidden style={{ background: color }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', textShadow: '0 0 2px rgba(0,0,0,0.45)' }}>#</span>
                  </div>
                  <div className="legend-editor__checkbox" aria-hidden>
                    <span>{sample}</span>
                  </div>
                  <input
                    className="legend-editor__input"
                    placeholder={sample}
                    value={value}
                    onChange={(e) =>
                      onChange({
                        ...settings,
                        sampleLabels: { ...(settings.sampleLabels ?? {}), [sample]: e.target.value },
                      })
                    }
                    disabled={disabled}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}

    </PanelWithHelp>
  )
}

function ParameterChartCard({
  param,
  data,
  settings,
  sampleColors,
  chartId,
  chartRef,
  fullscreen,
  onToggleFullscreen,
  showControls,
  onToggleControls,
}: {
  param: ParamConfig
  data: ParameterPoint[]
  settings: ChartSettings
  sampleColors: Map<string, string>
  chartId: string
  chartRef: (node: HTMLDivElement | null) => void
  fullscreen: boolean
  onToggleFullscreen: () => void
  showControls: boolean
  onToggleControls: () => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const numericValues = data.flatMap((entry) => {
    const vals: number[] = []
    if (entry.value != null && Number.isFinite(Number(entry.value))) vals.push(Number(entry.value))
    if (entry.spread?.sd != null && entry.value != null) {
      vals.push(Math.max(0, Number(entry.value) - entry.spread.sd), Number(entry.value) + entry.spread.sd)
    }
    ;(entry.replicates ?? []).forEach((rep) => {
      if (rep?.value != null && Number.isFinite(rep.value)) vals.push(Number(rep.value))
    })
    return vals
  })
  const domainMinRaw = numericValues.length ? Math.min(0, ...numericValues) : 0
  const domainMaxRaw = numericValues.length ? Math.max(...numericValues) : 1
  const spanRaw = Math.max(1e-6, domainMaxRaw - domainMinRaw)
  const axisMin = 0
  const axisMaxUser = typeof settings.yMax === 'number' && Number.isFinite(settings.yMax) ? settings.yMax : null
  const autoHeadroom = domainMaxRaw > 0 ? Math.max(domainMaxRaw * 0.08, spanRaw * 0.08) : 0
  const axisMaxBase = axisMaxUser != null ? axisMaxUser : domainMaxRaw + autoHeadroom
  const axisMax = Math.max(axisMaxBase, domainMaxRaw || 1)
  const axisSpan = Math.max(1e-6, axisMax - axisMin)
  const tickCount = 6
  const tickStep = axisSpan / tickCount
  const niceMin = axisMin
  const niceMax = axisMin + tickStep * tickCount
  const domainSpan = Math.max(1e-6, niceMax - niceMin)

  const ticks = useMemo(() => {
    const list: number[] = []
    for (let i = 0; i <= tickCount; i += 1) {
      const value = axisMin + tickStep * i
      list.push(Number(value.toPrecision(6)))
    }
    return list
  }, [axisMin, tickCount, tickStep])

  const displayNames = data.map((entry) => (settings.sampleLabels?.[entry.sample]?.trim() || entry.sample))
  const legendEntries = useMemo(
    () =>
      data.map((entry, idx) => ({
        id: entry.sample,
        label: displayNames[idx] ?? entry.sample,
        color: sampleColors.get(entry.sample) ?? '#2563eb',
      })),
    [data, displayNames, sampleColors],
  )
  const barCount = Math.max(data.length, 1)

  const [legendBox, setLegendBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const legendDragRef = useRef<null | { mode: 'drag' | 'resize'; startX: number; startY: number; box: { x: number; y: number; width: number; height: number } }>(
    null,
  )
  const titleId = `${chartId}-title`
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 960, height: 520 })

  useEffect(() => {
    if (!settings.legendVisible) return
    if (legendBox) return
    const rect = containerRef.current?.getBoundingClientRect()
    const baseW = rect?.width ?? 640
    const width = Math.min(360, Math.max(220, baseW * 0.42))
    const height = 160
    const maxX = Math.max(0, (rect?.width ?? width) - width - 8)
    const maxY = Math.max(0, (rect?.height ?? height) - height - 8)
    setLegendBox({
      x: Math.max(8, Math.min(baseW - width - 12, maxX)),
      y: Math.max(8, Math.min(18, maxY)),
      width,
      height,
    })
  }, [legendBox, settings.legendVisible])

  const attachLegendListeners = useCallback((mode: 'drag' | 'resize', box: { x: number; y: number; width: number; height: number }, startX: number, startY: number) => {
    const handleMove = (event: MouseEvent) => {
      const current = legendDragRef.current
      if (!current) return
      const dx = event.clientX - current.startX
      const dy = event.clientY - current.startY
      const containerRect = containerRef.current?.getBoundingClientRect()
      const maxW = Math.max(160, containerRect?.width ?? box.width)
      const maxH = Math.max(120, containerRect?.height ?? box.height)
      const maxX = Math.max(0, (containerRect?.width ?? box.width) - (current.box.width ?? box.width) - 8)
      const maxY = Math.max(0, (containerRect?.height ?? box.height) - (current.box.height ?? box.height) - 8)
      if (mode === 'drag') {
        const nextX = Math.min(Math.max(8, current.box.x + dx), maxX)
        const nextY = Math.min(Math.max(8, current.box.y + dy), maxY)
        setLegendBox((prev) => ({ ...(prev ?? current.box), x: nextX, y: nextY }))
      } else {
        const nextW = Math.min(Math.max(140, current.box.width + dx), maxW)
        const nextH = Math.min(Math.max(100, current.box.height + dy), maxH)
        setLegendBox((prev) => ({ ...(prev ?? current.box), width: nextW, height: nextH }))
      }
    }
    const handleUp = () => {
      legendDragRef.current = null
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
    legendDragRef.current = { mode, startX, startY, box }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [])

  const startLegendDrag = useCallback(
    (mode: 'drag' | 'resize') => (event: React.MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const rect = containerRef.current?.getBoundingClientRect()
      const fallbackBox = legendBox ?? {
        x: 12,
        y: 12,
        width: Math.min(360, Math.max(220, (rect?.width ?? 640) * 0.42)),
        height: 160,
      }
      setLegendBox((prev) => prev ?? fallbackBox)
      attachLegendListeners(mode, fallbackBox, event.clientX, event.clientY)
    },
    [attachLegendListeners, legendBox],
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      setSize({
        width: Math.max(320, rect.width),
        height: Math.max(360, rect.height),
      })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [data.length])

  const width = Math.max(size.width, 320)
  const baseHeight = Math.max(size.height, 360)
  const titleFontSize = Math.max(13, 14 * settings.fontScale)
  const labelFontSize = Math.max(11, 12 * settings.fontScale)
  const valueFontSize = Math.max(11, 12 * settings.fontScale)
  const axisFontSize = Math.max(10, 11 * settings.fontScale)
  const yLabelFontSize = Math.max(12, 13 * settings.fontScale)
  const tickLabels = ticks.map((tick) => formatNumber(tick, 2))
  const maxTickWidth = Math.max(26, ...tickLabels.map((text) => measureTextSize(text, axisFontSize).width))
  const yLabelText = settings.yLabel || param.label
  const yLabelSize = settings.yLabel ? measureTextSize(yLabelText, yLabelFontSize) : { width: 0, height: 0 }
  const baseLeft = maxTickWidth + 28
  const yLabelSpace = settings.yLabel ? yLabelSize.height + 10 : 0
  const paddingLeft = Math.max(70, baseLeft + yLabelSpace)
  const paddingRight = 26
  const usableWidth = Math.max(120, width - paddingLeft - paddingRight)
  const gap = barCount > 1 ? Math.min(22, Math.max(8, (usableWidth / barCount) * 0.18)) : 12
  const barWidth = Math.max(12, Math.min(160, (usableWidth - gap * (barCount - 1)) / barCount))
  const barsTotalWidth = barWidth * barCount + gap * Math.max(0, barCount - 1)
  const barsStart = paddingLeft + Math.max(0, (usableWidth - barsTotalWidth) / 2)
  const centers = data.map((_, idx) => barsStart + idx * (barWidth + gap) + barWidth / 2)
  const sampleWidths = settings.showSamples
    ? displayNames.map((label) => measureTextSize(label, labelFontSize).width)
    : []
  const sampleHeight = settings.showSamples ? measureTextSize('Hg', labelFontSize).height : 0
  const valueTexts = data.map((entry) => formatNumber(entry.value))
  const valueWidths = settings.showValues ? valueTexts.map((text) => measureTextSize(text, valueFontSize).width) : []
  const valueHeight = measureTextSize('Hg', valueFontSize).height
  const maxValueWidth = valueWidths.length ? Math.max(...valueWidths) : 0
  const requestedAngle = Math.min(90, Math.max(0, settings.sampleAngle ?? 0))
  const autoVertical = requestedAngle === 0 && settings.showSamples && labelsOverlap(centers, sampleWidths, 6)
  const sampleAngle = requestedAngle === 0 ? (autoVertical ? 90 : 0) : requestedAngle
  const angleRad = (sampleAngle * Math.PI) / 180
  const sampleYSpans =
    settings.showSamples && sampleWidths.length
      ? sampleWidths.map((width) => width * Math.sin(angleRad) + sampleHeight * Math.cos(angleRad))
      : []
  const requestedValueAngle = Math.min(90, Math.max(0, settings.valueAngle ?? 0))
  const shouldAutoValueAngle =
    requestedValueAngle === 0 && settings.showValues && labelsOverlap(centers, valueWidths, 6)
  const valueAngle = shouldAutoValueAngle ? 90 : requestedValueAngle
  const valueAngleRad = (valueAngle * Math.PI) / 180
  const valueYSpans =
    settings.showValues && valueWidths.length
      ? valueWidths.map((width) => width * Math.sin(valueAngleRad) + valueHeight * Math.cos(valueAngleRad))
      : []
  const valueRotated = settings.showValues && valueAngle > 0
  const xLabelSpace = settings.xLabel ? Math.max(18, 14 * settings.fontScale + 8) : 14
  const maxSampleBlock =
    settings.showSamples && sampleYSpans.length ? Math.max(...sampleYSpans, sampleHeight * 1.3) : 0
  const maxValueBlock = settings.showValues
    ? valueRotated
      ? valueYSpans.length
        ? Math.max(...valueYSpans, valueHeight * 1.2)
        : valueHeight * 1.2
      : valueFontSize * 1.6
    : 0
  const paddingTop = 16 + titleFontSize * 1.6 + maxValueBlock
  const paddingBottom = 18 + maxSampleBlock + xLabelSpace
  const height = Math.max(baseHeight, paddingTop + paddingBottom + 160)
  const plotHeight = Math.max(120, height - paddingTop - paddingBottom)
  const plotLeft = paddingLeft
  const plotRight = width - paddingRight
  const plotWidth = plotRight - plotLeft
  const xAxisY = paddingTop + plotHeight
  const titleY = Math.max(titleFontSize + 6, 18)
  const xLabelY = height - 10
  const yLabelX = Math.max(10, paddingLeft - baseLeft - 6)
  const legendScale = Math.max(0.6, Math.min(2, settings.legendFontScale ?? settings.fontScale ?? 1))
  const legendTitle = (settings.legendTitle ?? '').trim() || 'Legenda'
  const legendPadding = 2
  const legendTitleFontSize = Math.max(11.5, 12 * legendScale)
  const legendLabelFontSize = Math.max(10, 11 * legendScale)
  const legendHeaderHeight = legendTitle ? legendTitleFontSize + 1 : 0
  const legendRowHeight = Math.max(11, legendLabelFontSize + 2)
  const legendMinWidth = 4
  const legendMaxWidth = Math.max(legendMinWidth, size.width - 16)
  const longestLegendLabel = legendEntries.length
    ? Math.max(...legendEntries.map((entry) => measureTextSize(entry.label ?? '', legendLabelFontSize).width))
    : 0
  const targetColWidth = Math.max(52, longestLegendLabel + 22)
  const autoCols = Math.max(
    1,
    Math.floor((legendMaxWidth - legendPadding * 2) / targetColWidth) || 1,
  )
  const desiredCols = Math.min(autoCols, Math.max(1, legendEntries.length))
  const naturalLegendWidth = legendPadding * 2 + desiredCols * targetColWidth
  const baseLegendWidth = legendBox?.width ?? naturalLegendWidth
  const legendWidth = Math.max(
    legendMinWidth,
    Math.min(legendMaxWidth, baseLegendWidth),
  )
  const legendCols = Math.max(
    1,
    Math.floor((legendWidth - legendPadding * 2) / targetColWidth) || 1,
  )
  const legendRows = Math.max(1, Math.ceil(legendEntries.length / legendCols))
  const legendResizeGuard = 12
  const requiredLegendHeight =
    legendPadding * 2 + legendHeaderHeight + legendRows * legendRowHeight + legendResizeGuard
  const storedLegendHeight = legendBox?.height
  const baseLegendHeight =
    storedLegendHeight && storedLegendHeight > requiredLegendHeight
      ? requiredLegendHeight
      : storedLegendHeight ?? requiredLegendHeight
  const legendHeight = Math.max(requiredLegendHeight, baseLegendHeight)
  const legendLeft = Math.max(8, Math.min(legendBox?.x ?? 12, Math.max(0, size.width - legendWidth - 8)))
  const legendTop = Math.max(8, Math.min(legendBox?.y ?? 12, Math.max(0, size.height - legendHeight - 8)))

  const valueToY = (value: number) => {
    const ratio = (value - niceMin) / (domainSpan || 1)
    const clamped = Math.max(0, Math.min(1, ratio))
    return xAxisY - clamped * plotHeight
  }

  const bars = data.map((entry, idx) => {
    const sampleLabel = displayNames[idx] ?? entry.sample
    const color = sampleColors.get(entry.sample) ?? '#2563eb'
    const numeric = entry.value != null && Number.isFinite(entry.value) ? Number(entry.value) : null
    const x = barsStart + idx * (barWidth + gap)
    const spread = entry.spread
    const sdLow = spread?.sd != null && numeric != null ? valueToY(Math.max(niceMin, numeric - spread.sd)) : null
    const sdHigh = spread?.sd != null && numeric != null ? valueToY(numeric + spread.sd) : null
    const ciLow = spread?.ci?.low != null ? valueToY(Math.max(niceMin, spread.ci.low)) : spread?.ciLow != null ? valueToY(Math.max(niceMin, spread.ciLow)) : null
    const ciHigh = spread?.ci?.high != null ? valueToY(spread.ci.high) : spread?.ciHigh != null ? valueToY(spread.ciHigh) : null
    const replicates = (entry.replicates ?? []).filter((rep) => rep.value != null && Number.isFinite(rep.value))
    const jitterSpan = Math.min(barWidth * 0.6, 24)
    const replicateDots = replicates.map((rep, repIdx) => {
      const jitter =
        replicates.length > 1
          ? ((repIdx - (replicates.length - 1) / 2) / Math.max(1, replicates.length - 1)) * jitterSpan
          : 0
      return { x: x + barWidth / 2 + jitter, y: valueToY(Number(rep.value)), well: rep.well, replicate: rep.replicate }
    })
    const meanY = numeric != null ? valueToY(numeric) : null
    return {
      entry,
      sampleLabel,
      color,
      numeric,
      valueText: valueTexts[idx],
      x,
      center: x + barWidth / 2,
      spread,
      sdLow,
      sdHigh,
      ciLow,
      ciHigh,
      replicates: replicateDots,
      meanY,
    }
  })

  return (
    <PanelWithHelp
      title={settings.title || param.label}
      helpContent="Wykres kropkowy: punkty to replikaty, gruba kropka to srednia, a kreski pokazuja SD (opcjonalnie CI)."
      className={`chart-card parameter-chart-card ${fullscreen ? 'chart-card--fullscreen' : ''} ${
        fullscreen && showControls ? 'chart-card--with-controls' : ''
      }`}
      contentClassName="chart-card__body"
      actions={
        <div className="btn-pair" style={{ flexWrap: 'wrap' }}>
          {fullscreen && (
            <label
              className={`parameters-toggle ${showControls ? 'is-on' : ''}`}
              title={showControls ? 'Ukryj sterowanie wykresem' : 'Pokaż sterowanie wykresem'}
              style={{ marginRight: 8 }}
            >
              <input
                type="checkbox"
                checked={showControls}
                onChange={onToggleControls}
              />
              <span className="parameters-toggle__slider" aria-hidden />
              <span className="parameters-toggle__label">
                {showControls ? 'Ukryj sterowanie wykresem' : 'Pokaż sterowanie wykresem'}
              </span>
            </label>
          )}
          <button
            type="button"
            className={`btn ${fullscreen ? 'primary' : ''}`}
            onClick={onToggleFullscreen}
          >
            {fullscreen ? 'Zamknij pełny ekran' : 'Fullscreen'}
          </button>
        </div>
      }
    >
      <div
        id={chartId}
        className="chart-card__canvas parameter-chart__canvas"
        ref={chartRef}
        data-chart-id={chartId}
      >
        {data.length ? (
          <div
            className="parameter-chart"
            style={{ ['--param-font-scale' as any]: settings.fontScale }}
            aria-label={`${param.label} dot plot`}
            ref={containerRef}
          >
            <svg
              className="parameter-chart__svg"
              role="img"
              aria-labelledby={titleId}
              viewBox={`0 0 ${width} ${height}`}
            >
              <title id={titleId}>{settings.title || param.label}</title>
              <text
                className="parameter-chart__title"
                x={width / 2}
                y={titleY}
                textAnchor="middle"
                fontSize={titleFontSize}
                fontWeight={800}
              >
                {settings.title || param.label}
              </text>

              {ticks.map((tick) => {
                const pos = xAxisY - ((tick - niceMin) / (domainSpan || 1)) * plotHeight
                return (
                  <g key={tick}>
                    <line
                      className="parameter-chart__grid-line"
                      x1={plotLeft}
                      x2={plotLeft + plotWidth}
                      y1={pos}
                      y2={pos}
                    />
                    <text
                      className="parameter-chart__tick-label"
                      x={paddingLeft - 12}
                      y={pos + 4}
                      textAnchor="end"
                      fontSize={axisFontSize}
                      fontWeight={700}
                    >
                      {formatNumber(tick, 2)}
                    </text>
                  </g>
                )
              })}

              <line className="parameter-chart__axis" x1={plotLeft} x2={plotLeft} y1={xAxisY} y2={paddingTop - 8} />
              <polygon
                className="parameter-chart__axis-arrow"
                points={`${plotLeft},${paddingTop - 10} ${plotLeft - 6},${paddingTop} ${plotLeft + 6},${paddingTop}`}
              />
              <line className="parameter-chart__axis" x1={plotLeft} x2={plotLeft + plotWidth} y1={xAxisY} y2={xAxisY} />
              {settings.yLabel && (
                <text
                  className="parameter-chart__y-label"
                  x={yLabelX}
                  y={paddingTop + plotHeight / 2}
                  textAnchor="middle"
                  transform={`rotate(-90 ${yLabelX} ${paddingTop + plotHeight / 2})`}
                  fontSize={yLabelFontSize}
                  fontWeight={700}
                >
                  {settings.yLabel}
                </text>
              )}

              {bars.map((bar) => (
                <g key={bar.entry.sample}>
                  <title>{`${bar.sampleLabel}: ${bar.valueText}`}</title>
                  {bar.sdLow != null && bar.sdHigh != null && (
                    <g stroke={bar.color} strokeWidth={2.5} opacity={0.9}>
                      <line x1={bar.center} y1={bar.sdLow} x2={bar.center} y2={bar.sdHigh} />
                      <line x1={bar.center - barWidth * 0.18} y1={bar.sdLow} x2={bar.center + barWidth * 0.18} y2={bar.sdLow} />
                      <line x1={bar.center - barWidth * 0.18} y1={bar.sdHigh} x2={bar.center + barWidth * 0.18} y2={bar.sdHigh} />
                    </g>
                  )}
                  {settings.showCi && bar.ciLow != null && bar.ciHigh != null && (
                    <g stroke={bar.color} strokeWidth={2} opacity={0.6}>
                      <line x1={bar.center} y1={bar.ciLow} x2={bar.center} y2={bar.ciHigh} strokeDasharray="4 4" />
                    </g>
                  )}
                  {bar.replicates?.length ? (
                    <g fill={bar.color} opacity={0.85}>
                      {bar.replicates.map((rep, idx) => (
                        <circle
                          key={`${bar.entry.sample}-rep-${idx}`}
                          cx={rep.x}
                          cy={rep.y}
                          r={Math.max(3, barWidth * 0.05)}
                          stroke="#fff"
                          strokeWidth={1}
                        >
                          <title>{`${bar.entry.sample} | ${rep.well ?? 'well?'} | R${rep.replicate ?? idx + 1}`}</title>
                        </circle>
                      ))}
                    </g>
                  ) : null}
                  {bar.meanY != null && (
                    <line
                      x1={bar.center - barWidth * 0.25}
                      x2={bar.center + barWidth * 0.25}
                      y1={bar.meanY}
                      y2={bar.meanY}
                      stroke={bar.color}
                      strokeWidth={3}
                      strokeLinecap="round"
                    />
                  )}
                  {settings.showValues && bar.meanY != null && (
                    valueRotated ? (
                      <text
                        className="parameter-chart__value"
                        fontSize={valueFontSize}
                        fontWeight={700}
                        transform={`translate(${bar.center} ${Math.max(titleFontSize + 4, bar.meanY - 10)}) rotate(${valueAngle})`}
                        textAnchor="end"
                        dominantBaseline="central"
                      >
                        {bar.valueText}
                      </text>
                    ) : (
                      <text
                        className="parameter-chart__value"
                        x={bar.center}
                        y={Math.max(titleFontSize + 4, bar.meanY - 10)}
                        textAnchor="middle"
                        dominantBaseline="auto"
                        fontSize={valueFontSize}
                        fontWeight={700}
                      >
                        {bar.valueText}
                      </text>
                    )
                  )}
                  {settings.showSamples && (
                    sampleAngle > 0 ? (
                      <text
                        className="parameter-chart__sample"
                        fontSize={labelFontSize}
                        fontWeight={700}
                        transform={`translate(${bar.center} ${xAxisY + 6}) rotate(${sampleAngle})`}
                        textAnchor="start"
                        dominantBaseline="hanging"
                      >
                        {bar.sampleLabel}
                      </text>
                    ) : (
                      <text
                        className="parameter-chart__sample"
                        x={bar.center}
                        y={xAxisY + labelFontSize + 6}
                        textAnchor="middle"
                        dominantBaseline="hanging"
                        fontSize={labelFontSize}
                        fontWeight={700}
                      >
                        {bar.sampleLabel}
                      </text>
                    )
                  )}
                </g>
              ))}

              {settings.xLabel && (
                <text
                  className="parameter-chart__x-label"
                  x={plotLeft + plotWidth / 2}
                  y={xLabelY}
                  textAnchor="middle"
                  fontSize={Math.max(12, 13 * settings.fontScale)}
                  fontWeight={700}
                >
                  {settings.xLabel || 'Samples'}
                </text>
              )}
            {settings.legendVisible && legendEntries.length > 0 && (
              <g
                className="parameter-chart__legend-svg"
                transform={`translate(${legendLeft}, ${legendTop})`}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <rect
                  className="parameter-chart__legend-rect"
                  width={legendWidth}
                  height={legendHeight}
                  rx={10}
                  onMouseDown={startLegendDrag('drag')}
                />
                <text
                  className="parameter-chart__legend-title"
                  x={legendPadding + 4}
                  y={legendPadding + legendTitleFontSize}
                  fontSize={legendTitleFontSize}
                  fontWeight={800}
                >
                  {legendTitle}
                </text>
                {(() => {
                  const pad = legendPadding
                  const top = legendPadding + legendHeaderHeight
                  const colW = Math.max(52, (legendWidth - pad * 2) / legendCols)
                  const rowH = legendRowHeight
                  return legendEntries.map((entry, idx) => {
                    const col = idx % legendCols
                    const row = Math.floor(idx / legendCols)
                    const x = pad + col * colW
                    const y = top + row * rowH
                    return (
                      <g key={entry.id} transform={`translate(${x}, ${y})`}>
                        <rect
                          className="parameter-chart__legend-swatch"
                          x={0}
                          y={3}
                          width={8}
                          height={8}
                          rx={3}
                          style={{ fill: entry.color }}
                        />
                        <text
                          className="parameter-chart__legend-label"
                          x={14}
                          y={Math.max(legendLabelFontSize + 1, 11)}
                          fontSize={legendLabelFontSize}
                          fontWeight={700}
                        >
                          {entry.label}
                        </text>
                      </g>
                    )
                  })
                })()}
                <rect
                  className="parameter-chart__legend-resize parameter-chart__legend-resize--svg"
                  x={legendWidth - 14}
                  y={legendHeight - 14}
                  width={12}
                  height={12}
                  rx={3}
                  onMouseDown={startLegendDrag('resize')}
                />
                </g>
              )}
            </svg>
          </div>
        ) : (
          <div className="empty-state" style={{ width: '100%', minHeight: 160 }}>
            Brak danych dla zaznaczonych probek.
          </div>
        )}
      </div>
    </PanelWithHelp>
  )
}

export default function Parameters() {
  const sharedSmoothed = useApp((s) => s.curvesSmoothingSmoothed)
  const activeTab = useApp((s) => s.activeTab)
  const [assignments, setAssignments] = useState<AssignmentEntry[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [results, setResults] = useState<ParameterResult[]>([])
  const [wellResults, setWellResults] = useState<WellParameterResult[]>([])
  const [sampleStats, setSampleStats] = useState<SampleStatsEntry[]>([])
  const [statsConfig, setStatsConfig] = useState<StatsComputationConfig>(DEFAULT_STATS_CONFIG)
  const [warnings, setWarnings] = useState<string[]>([])
  const [status, setStatus] = useState<string>('')
  const [filename, setFilename] = useState<string>('')
  const [sourceLabel, setSourceLabel] = useState<string>('dataset')
  const [hasEligibleSource, setHasEligibleSource] = useState<boolean>(false)
  const [selectedSamples, setSelectedSamples] = useState<string[]>([])
  const [chartSettings, setChartSettings] = useState<Record<string, ChartSettings>>({})
  const [loessSettings, setLoessSettings] = useState<LoessChartSettings>({ ...DEFAULT_LOESS_SETTINGS })
  const [loessResetKey, setLoessResetKey] = useState<number>(0)
  const [navOpen, setNavOpen] = useState<boolean>(false)
  const chartRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [chartFullscreen, setChartFullscreen] = useState<string | null>(null)
  const [fullscreenControlsVisible, setFullscreenControlsVisible] = useState<boolean>(true)

  const activeEntry = assignments[activeIndex] ?? null

  const sampleColors = useMemo(() => {
    const map = new Map<string, string>()
    const mappingSamples = activeEntry?.mapping?.samples ?? []
    if (mappingSamples.length) {
      const fallback = generateDistinctColors(Math.max(mappingSamples.length, 1))
      mappingSamples.forEach((sample, index) => {
        if (!sample?.name) return
        const color =
          typeof sample.color === 'string' && sample.color
            ? sample.color
            : fallback[index % fallback.length]
        if (color) map.set(sample.name, color)
      })
    }
    if (!map.size && results.length) {
      const fallback = generateDistinctColors(Math.max(results.length, 1))
      results.forEach((row, index) => {
        map.set(row.sample, fallback[index % fallback.length])
      })
    }
    return map
  }, [activeEntry, results])

  // Keep a stable ordering of samples for keyboard navigation (unique, in results order).
  const orderedSamples = useMemo(() => {
    const seen = new Set<string>()
    const list: string[] = []
    results.forEach((row) => {
      if (!seen.has(row.sample)) {
        seen.add(row.sample)
        list.push(row.sample)
      }
    })
    return list
  }, [results])

  const orderedSamplesKey = useMemo(() => orderedSamples.join('\u0001'), [orderedSamples])

  // Arrow navigation pivot
  const navPivotRef = useRef<string | null>(null)

  const params: ParamConfig[] = useMemo(() => {
    const base: ParamConfig[] = [
      { id: 'muMax', label: 'muMax', unit: '1/h', getter: (row) => row.muMax },
      { id: 'td', label: 'Td (doubling time)', unit: 'h', getter: (row) => row.td },
      { id: 'lambda', label: '? (lag time)', unit: 'h', getter: (row) => row.lambda },
      { id: 'kHat', label: 'K (nosnosc)', unit: 'OD', getter: (row) => row.kHat },
      { id: 'odMax', label: 'OD max', unit: 'OD', getter: (row) => row.odMax },
      { id: 'tInflection', label: 't_inf (przegiecie)', unit: 'h', getter: (row) => row.tInflection },
      { id: 'tMid', label: 't_mid (K/2)', unit: 'h', getter: (row) => row.tMid },
      { id: 'slopeInf', label: 'Nachylenie w przegieciu', unit: '1/h', getter: (row) => row.slopeAtInflection },
      { id: 'auc', label: 'AUC', unit: 'OD*h', getter: (row) => row.auc },
    ]
    DETECTION_THRESHOLDS.forEach((thr) => {
      const key = detectionKey(thr)
      base.push({
        id: `det-${key}`,
        label: `Detection @${key}`,
        unit: 'h',
        getter: (row) => row.detection[key],
      })
    })
    return base
  }, [])

  const registerChartRef = useCallback(
    (id: string) => (node: HTMLDivElement | null) => {
      chartRefs.current[id] = node
    },
    [],
  )

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (chartFullscreen) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = prev
      }
    }
    return
  }, [chartFullscreen])

  useEffect(() => {
    if (!chartFullscreen) setFullscreenControlsVisible(true)
  }, [chartFullscreen])

  // Global reset with "R" for LOESS and parameter charts
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
      if (event.key !== 'r' && event.key !== 'R') return
      // reset LOESS view
      setLoessResetKey((k) => k + 1)
      // reset all parameter charts
      setChartSettings((prev) => {
        const next: typeof prev = {}
        Object.entries(prev).forEach(([id, cfg]) => {
          next[id] = { ...cfg }
        })
        // bump a synthetic key per chart (SimpleLineChart consumes resetViewKey)
        return next
      })
    }
    window.addEventListener('keydown', handler as any, { capture: true })
    return () => window.removeEventListener('keydown', handler as any, { capture: true } as any)
  }, [])

  const buildChartPng = useCallback(
    async (chartId: string): Promise<Blob | null> => {
      if (typeof window === 'undefined') return null
      const root = chartRefs.current[chartId]
      if (!root) return null
      try {
        const svgNode = root.querySelector('.parameter-chart__svg') as SVGSVGElement | null
        const target = svgNode ?? root
        return await elementToPngBlob(target, {
          scale: Math.min(3, Math.max(1.5, window.devicePixelRatio || 2)),
          background: '#ffffff',
        })
      } catch (error) {
        console.error('PNG export error', error)
        setStatus('[ERR] Eksport PNG nie powiodl sie.')
        return null
      }
    },
    [setStatus],
  )

  const exportChartPng = useCallback(
    async (chartId: string, baseName: string) => {
      const blob = await buildChartPng(chartId)
      if (!blob) {
        setStatus('[ERR] Nie udalo sie przygotowac PNG (sprobuj ponownie).')
        return
      }
      const safe = sanitizeFileName(baseName || 'parameter-chart')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${safe}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    },
    [buildChartPng, setStatus],
  )

  const copyChartPng = useCallback(
    async (chartId: string, baseName: string) => {
      const blob = await buildChartPng(chartId)
      if (!blob) {
        setStatus('[ERR] Nie udalo sie przygotowac PNG (sprobuj ponownie).')
        return
      }
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard && 'write' in navigator.clipboard) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          return
        } catch {
          // fallback below
        }
      }
      const safe = sanitizeFileName(baseName || 'parameter-chart')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${safe}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    },
    [buildChartPng, setStatus],
  )

  const resultsKey = useMemo(
    () => results.map((r) => r.sample).join('|'),
    [results],
  )

  useEffect(() => {
    if (!results.length) {
      setSelectedSamples([])
      return
    }
    setSelectedSamples((prev) => {
      const samples = results.map((r) => r.sample)
      if (!prev.length) return [...samples]
      const filtered = prev.filter((s) => samples.includes(s))
      return filtered.length ? filtered : [...samples]
    })
  }, [resultsKey, results])

  useEffect(() => {
    setChartSettings((prev) => {
      let changed = false
      const next: Record<string, ChartSettings> = { ...prev }
      params.forEach((param) => {
        if (!next[param.id]) {
          next[param.id] = defaultChartSettings(param)
          changed = true
        }
      })
      Object.keys(next).forEach((id) => {
        if (!params.find((p) => p.id === id)) {
          delete next[id]
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [params])

  const applyComputation = useCallback(
    (entry: AssignmentEntry | null, label: string) => {
      if (!entry) {
        setResults([])
        setWellResults([])
        setSampleStats([])
        setStatsConfig(DEFAULT_STATS_CONFIG)
        setWarnings([])
        setStatus('')
        return
      }
      const {
        results: computed,
        warnings: warns,
        sourceLabel: source,
        wellResults: perWell,
        paramsByReplicate,
        statsBySample,
        statsConfig: statsInfo,
      } = computeParameters(
        entry,
        DETECTION_THRESHOLDS,
      )
      setResults(computed)
      setWellResults(paramsByReplicate || perWell || [])
      setSampleStats(statsBySample || [])
      setStatsConfig(statsInfo || DEFAULT_STATS_CONFIG)
      setWarnings(warns)
      setSourceLabel(source || label)
      setStatus(
        computed.length
          ? `[OK] Przeliczono parametry dla ${computed.length} probek.`
          : `[WARN] Brak wynikow do wyswietlenia.`,
      )
    },
    [],
  )

  useEffect(() => {
    if (!activeEntry) {
      setResults([])
      setWellResults([])
      setSampleStats([])
      setStatsConfig(DEFAULT_STATS_CONFIG)
      setWarnings([])
      setStatus('')
      return
    }
    applyComputation(activeEntry, filename || 'dataset')
  }, [activeEntry, filename, applyComputation])

  useEffect(() => {
    const autoAssignments = sharedSmoothed?.rawPayload?.assignments
    if (!autoAssignments || !Array.isArray(autoAssignments) || !autoAssignments.length) {
      setHasEligibleSource(false)
      return
    }
    const eligible = autoAssignments.some((entry) => hasLogPhaseInfo(entry))
    setHasEligibleSource(eligible)
    if (!eligible) return
    setAssignments(autoAssignments)
    setActiveIndex(0)
    setFilename(sharedSmoothed?.filename ? `[auto] ${sharedSmoothed.filename}` : '[auto] smoothing')
    setStatus('[AUTO] Dane z Curves Smoothing zostaly zaladowane (z log phase).')
  }, [sharedSmoothed])

  const handleFileChange = useCallback(async (files: FileList | null) => {
    if (!files?.length) return
    const file = files[0]
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const derived = deriveAssignments(parsed)
      if (!derived.length) {
        setAssignments([])
        setActiveIndex(0)
        setResults([])
        setWellResults([])
        setSampleStats([])
        setStatsConfig(DEFAULT_STATS_CONFIG)
        setWarnings([`[WARN] Plik ${file.name} nie zawiera danych assignment.`])
        setStatus(`[WARN] Nie udalo sie odczytac assignmentow z ${file.name}.`)
        return
      }
      const eligible = derived.some((entry) => hasLogPhaseInfo(entry))
      setHasEligibleSource(eligible)
      if (!eligible) {
        setAssignments([])
        setActiveIndex(0)
        setResults([])
        setWellResults([])
        setSampleStats([])
        setStatsConfig(DEFAULT_STATS_CONFIG)
        setWarnings([`[WARN] Plik ${file.name} nie zawiera danych z log phase/smoothing.`])
        setStatus(`[WARN] Brak wygladzonych danych z identyfikacja fazy log w ${file.name}.`)
        return
      }
      setAssignments(derived)
      setActiveIndex(0)
      setFilename(file.name)
      setStatus(`[OK] Wczytano ${file.name} (${derived.length} assignment).`)
    } catch (error: any) {
      console.error(error)
      setSampleStats([])
      setStatsConfig(DEFAULT_STATS_CONFIG)
      setStatus(`[ERR] Nie udalo sie odczytac pliku: ${error?.message ?? String(error)}`)
    }
  }, [])

  const handleExport = useCallback(
    (format: 'json' | 'csv') => {
      if (!results.length) return
      const base = sanitizeFileName((filename || sourceLabel || 'dataset').replace(/\.[^.]+$/, ''))
      if (format === 'json') {
        const ciInfo = {
          alpha: statsConfig?.alpha ?? DEFAULT_STATS_CONFIG.alpha,
          method: 't' as const,
          bootstrapIterations: statsConfig?.bootstrapIterations ?? DEFAULT_STATS_CONFIG.bootstrapIterations,
          bootstrapMethod: 'percentile' as const,
        }
        const payload = {
          generatedAt: new Date().toISOString(),
          source: filename || sourceLabel || 'dataset',
          thresholds: DETECTION_THRESHOLDS,
          results,
          wellResults,
          paramsByReplicate: wellResults,
          params_by_replicate: wellResults,
          statsBySample: sampleStats,
          stats_by_sample: sampleStats,
          ci: ciInfo,
          statsConfig: ciInfo,
        }
        const blob = new Blob([JSON.stringify(payload, null, 2)], {
          type: 'application/json;charset=utf-8',
        })
        downloadBlob(blob, `${base}.results.json`)
        setStatus(`[FILE] Zapisano ${base}.results.json`)
        return
      }
      const formatCsvNumber = (value: number | null | undefined) =>
        value == null || Number.isNaN(value) ? '' : Number(value).toFixed(6)
      const statKeys = [
        'muMax',
        'td',
        'lambda',
        'kHat',
        'odMax',
        'tInflection',
        'tMid',
        'slopeAtInflection',
        'auc',
        'logStart',
        'logEnd',
        'tLogDuration',
      ] as const
      const headers = [
        'sample',
        'replicates',
        'replicates_total',
        ...statKeys.flatMap((key) => [
          `${key}`,
          `${key}_median`,
          `${key}_sd`,
          `${key}_sem`,
          `${key}_ciLow`,
          `${key}_ciHigh`,
          `${key}_ciBootLow`,
          `${key}_ciBootHigh`,
        ]),
        ...DETECTION_THRESHOLDS.flatMap((thr) => {
          const key = detectionKey(thr)
          return [
            `det_${key}`,
            `det_${key}_median`,
            `det_${key}_sd`,
            `det_${key}_sem`,
            `det_${key}_ciLow`,
            `det_${key}_ciHigh`,
            `det_${key}_ciBootLow`,
            `det_${key}_ciBootHigh`,
          ]
        }),
      ]
      const allHeaders = [...headers, 'lambdaMethod']
      const lines = [allHeaders.join(',')]
      results.forEach((row) => {
        const fields: Array<string | number> = [row.sample, row.replicates ?? '', row.replicatesTotal ?? row.replicates ?? '']
        statKeys.forEach((key) => {
          const statEntry = (row.stats as any)?.[key] as any
          const value = (row as any)[key] as number | null | undefined
          fields.push(formatCsvNumber(value))
          fields.push(formatCsvNumber(statEntry?.median))
          fields.push(formatCsvNumber(statEntry?.sd))
          fields.push(formatCsvNumber(statEntry?.sem))
          fields.push(formatCsvNumber(statEntry?.ciLow))
          fields.push(formatCsvNumber(statEntry?.ciHigh))
          fields.push(formatCsvNumber(statEntry?.ciBootstrap?.low ?? statEntry?.ci95Bootstrap?.[0]))
          fields.push(formatCsvNumber(statEntry?.ciBootstrap?.high ?? statEntry?.ci95Bootstrap?.[1]))
        })
        DETECTION_THRESHOLDS.forEach((thr) => {
          const key = detectionKey(thr)
          const detStat = row.stats?.detection?.[key]
          const detVal = row.detection[key]
          fields.push(formatCsvNumber(detVal))
          fields.push(formatCsvNumber(detStat?.median))
          fields.push(formatCsvNumber(detStat?.sd))
          fields.push(formatCsvNumber(detStat?.sem))
          fields.push(formatCsvNumber(detStat?.ciLow))
          fields.push(formatCsvNumber(detStat?.ciHigh))
          fields.push(formatCsvNumber(detStat?.ciBootstrap?.low ?? detStat?.ci95Bootstrap?.[0]))
          fields.push(formatCsvNumber(detStat?.ciBootstrap?.high ?? detStat?.ci95Bootstrap?.[1]))
        })
        fields.push(row.lambdaMethod ?? '')
        lines.push(fields.map((field) => String(field)).join(','))
      })
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
      downloadBlob(blob, `${base}.results.csv`)
      setStatus(`[FILE] Zapisano ${base}.results.csv`)
    },
    [results, wellResults, filename, sourceLabel],
  )

  const toggleSample = useCallback((sample: string) => {
    setSelectedSamples((prev) => {
      const next = new Set(prev)
      if (next.has(sample)) next.delete(sample)
      else next.add(sample)
      return Array.from(next)
    })
  }, [])

  const selectAllSamples = useCallback(() => {
    setSelectedSamples(results.map((row) => row.sample))
  }, [results])

  const clearSamples = useCallback(() => setSelectedSamples([]), [])

  // Keep pivot in sync with selection changes
  useEffect(() => {
    if (selectedSamples.length === 1) {
      navPivotRef.current = selectedSamples[0] ?? null
    }
  }, [selectedSamples])

  const findNextSample = useCallback(
    (current: string | null, direction: 1 | -1) => {
      if (!orderedSamples.length) return null
      const idx = current ? orderedSamples.indexOf(current) : -1
      const base = idx === -1 ? (direction === 1 ? -1 : 0) : idx
      const nextIdx = (base + direction + orderedSamples.length) % orderedSamples.length
      return orderedSamples[nextIdx] ?? null
    },
    [orderedSamplesKey],
  )

  const handleArrowNav = useCallback(
    (direction: 1 | -1) => {
      const pivot = navPivotRef.current ?? selectedSamples[0] ?? orderedSamples[0] ?? null
      if (!pivot) return
      const next = findNextSample(pivot, direction)
      if (!next) return
      setSelectedSamples([next])
      navPivotRef.current = next
    },
    [findNextSample, orderedSamplesKey, selectedSamples],
  )

  // Global keyboard listener (like other cards): Up/Down selects next sample without requiring prior click.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      if (activeTab !== 'parameters') return;
      event.preventDefault();
      handleArrowNav(event.key === 'ArrowDown' ? 1 : -1);
    };
    window.addEventListener('keydown', handler as any, { capture: true });
    return () => window.removeEventListener('keydown', handler as any, { capture: true } as any);
  }, [activeTab, handleArrowNav]);

  const visibleResults = useMemo(() => {
    if (!selectedSamples.length) return []
    const selectedSet = new Set(selectedSamples)
    return results.filter((row) => selectedSet.has(row.sample))
  }, [results, selectedSamples])

  const loessData = useMemo<LoessChartData>(() => {
    const selectionEmpty = selectedSamples.length === 0
    const warnings: string[] = []
    if (!activeEntry) {
      return { series: [], ciBands: [], sdBands: [], medianScatter: [], meanScatter: [], warnings, selectionEmpty, hasReplicates: false }
    }
    const { curves, warnings: curveWarnings } = normalizeSmoothedCurves(activeEntry)
    warnings.push(...curveWarnings)
    if (selectionEmpty) {
      return { series: [], ciBands: [], sdBands: [], medianScatter: [], meanScatter: [], warnings, selectionEmpty: true, hasReplicates: false }
    }
    if (!curves.length) {
      warnings.push('Brak danych do narysowania LOESS.')
      return { series: [], ciBands: [], sdBands: [], medianScatter: [], meanScatter: [], warnings, selectionEmpty: false, hasReplicates: false }
    }
    const selectedSet = new Set(selectedSamples)
    const filtered = curves.filter((curve) => selectedSet.has(curve.sample))
    if (!filtered.length) {
      warnings.push('Brak krzywych LOESS dla zaznaczonych probek.')
      return { series: [], ciBands: [], sdBands: [], medianScatter: [], meanScatter: [], warnings, selectionEmpty: false, hasReplicates: false }
    }

    const grouped = new Map<string, SmoothedCurveSeries[]>()
    filtered.forEach((curve) => {
      const list = grouped.get(curve.sample) ?? []
      list.push(curve)
      grouped.set(curve.sample, list)
    })

    const fallbackColors = generateDistinctColors(Math.max(grouped.size, filtered.length, 1))
    let fallbackIdx = 0
    const series: Series[] = []
    const ciBands: LoessBand[] = []
    const sdBands: LoessBand[] = []
    const medianScatter: Series[] = []
    const meanScatter: Series[] = []
    let hasReplicates = false

    grouped.forEach((list, sample) => {
      if (!list.length) return
      if (list.length >= 2) hasReplicates = true
      const grid = Array.from(new Set(list.flatMap((c) => c.points.map((p) => p.x)))).sort((a, b) => a - b)
      if (!grid.length) return
      const predictions = list.map((curve) => evaluateOnGrid(curve.points, grid))
      const meanPoints: SeriesPoint[] = []
      const medianPoints: SeriesPoint[] = []
      const sdBandPoints: LoessBand['points'] = []
      const bandPoints: LoessBand['points'] = []
      grid.forEach((x, idx) => {
        const vals = predictions.map((row) => row[idx]).filter((v) => Number.isFinite(v)) as number[]
        if (!vals.length) return
        const mean = vals.reduce((acc, v) => acc + v, 0) / vals.length
        const sorted = [...vals].sort((a, b) => a - b)
        const mid = Math.floor(sorted.length / 2)
        const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
        const sd =
          vals.length > 1
            ? Math.sqrt(vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (vals.length - 1))
            : 0
        const margin = vals.length > 1 ? tCritical95(vals.length - 1) * (sd / Math.sqrt(vals.length)) : 0
        meanPoints.push({ x, y: mean })
        medianPoints.push({ x, y: median })
        sdBandPoints.push({ x, low: mean - sd, high: mean + sd })
        bandPoints.push({ x, low: mean - margin, high: mean + margin })
      })
      if (!meanPoints.length) return
      const color = sampleColors.get(sample) ?? fallbackColors[fallbackIdx % fallbackColors.length]
      fallbackIdx += 1
      series.push({ name: sample, color, points: meanPoints })
      if (medianPoints.length)
        medianScatter.push({
          name: `${sample} (median)`,
          color,
          points: medianPoints.map((pt, idx) => ({ ...pt, id: `${sample}-median-${idx}`, meta: { shape: 'dash' } })),
        })
      meanScatter.push({
        name: `${sample} (mean)`,
        color,
        points: meanPoints.map((pt, idx) => ({ ...pt, id: `${sample}-mean-${idx}`, meta: { shape: 'dash' } })),
      })
      if (bandPoints.length) {
        ciBands.push({ name: sample, color, points: bandPoints })
        sdBands.push({ name: sample, color, points: sdBandPoints })
      } else if (list.length < 2) {
        warnings.push(`Tylko jedna krzywa dla ${sample} - pasmo CI = linia.`)
        const flatBand = meanPoints.map((pt) => ({ x: pt.x, low: pt.y, high: pt.y }))
        ciBands.push({
          name: sample,
          color,
          points: flatBand,
        })
        sdBands.push({
          name: sample,
          color,
          points: flatBand,
        })
      }
    })

    const uniqWarnings = Array.from(new Set(warnings))
    return { series, ciBands, sdBands, medianScatter, meanScatter, warnings: uniqWarnings, selectionEmpty: false, hasReplicates }
  }, [activeEntry, selectedSamples, sampleColors])

  const navItems = useMemo(
    () => [
      { id: 'parameters-summary', label: 'Podsumowanie' },
      { id: 'parameters-loess', label: 'Krzywe LOESS' },
      ...params.map((param) => ({ id: `param-${param.id}`, label: param.label })),
    ],
    [params],
  )

  const loessSectionId = 'parameters-loess'
  const loessChartId = 'parameters-loess-chart'

  const handleJump = useCallback((targetId: string) => {
    const el = document.getElementById(targetId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setNavOpen(false)
    }
  }, [])

  const showGate = !hasEligibleSource
  const isLoessFullscreen = chartFullscreen === loessChartId
  const loessControlsDisabled = loessData.selectionEmpty || loessData.series.length === 0
  const loessBands = useMemo(() => {
    const bands: Array<{ name: string; color: string; points: { x: number; low: number; high: number }[]; mode?: 'area' | 'errorbars' }> = []
    if (loessSettings.showCi) {
      bands.push(
        ...loessData.ciBands.map((b) => ({ ...b, mode: 'area' as const })),
      )
    }
    if (loessSettings.showSd) {
      bands.push(
        ...loessData.sdBands.map((b) => ({ ...b, mode: 'errorbars' as const })),
      )
    }
    return bands
  }, [loessSettings.showCi, loessSettings.showSd, loessData.ciBands, loessData.sdBands])

  return (
    <div
      className="panel parameters-page"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
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
        event.preventDefault()
        handleArrowNav(event.key === 'ArrowDown' ? 1 : -1)
      }}
      tabIndex={0}
    >
      <h2>Parameters</h2>
      <div className="small">
        Parametry dostepne tylko po wygladzaniu i identyfikacji fazy log. Wczytaj plik <code>.smoothed.json</code> z log phases lub uzyj Curves Smoothing.
      </div>

      {showGate && (
        <div className="empty-state" style={{ marginTop: 12 }}>
          Najpierw wykonaj Curves Smoothing + Log Phase Identification (albo wgraj plik smoothed z log phase).
        </div>
      )}

      <div className="row" style={{ gap: 12, marginTop: 12, flexWrap: 'wrap', opacity: showGate ? 0.5 : 1, pointerEvents: showGate ? 'none' as any : 'auto' }}>
        <div className="col" style={{ minWidth: 240 }}>
          <label className="small">Plik zrodlowy</label>
          <input type="file" accept=".json" onChange={(event) => handleFileChange(event.target.files)} />
          {filename && (
            <div className="small" style={{ marginTop: 4 }}>
              Aktywny plik: {filename}
            </div>
          )}
        </div>
        <div className="col" style={{ minWidth: 220 }}>
          <label className="small">Assignment</label>
          <select
            value={activeIndex}
            onChange={(event) => setActiveIndex(Number(event.target.value))}
            disabled={!assignments.length}
          >
            {!assignments.length && <option>(brak danych)</option>}
            {assignments.map((entry, index) => {
              const meta = entry?.dataset?.meta
              const label = meta?.sourceFile || meta?.runId || `assignment-${index + 1}`
              return (
                <option key={label} value={index}>
                  {index + 1}. {label}
                </option>
              )
            })}
          </select>
        </div>
        <div className="col" style={{ minWidth: 220 }}>
          <label className="small">&nbsp;</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => applyComputation(activeEntry, filename)} disabled={!activeEntry}>
              Przelicz parametry
            </button>
            <button className="btn" onClick={() => handleExport('json')} disabled={!results.length}>
              Export .results.json
            </button>
            <button className="btn" onClick={() => handleExport('csv')} disabled={!results.length}>
              Export .results.csv
            </button>
          </div>
        </div>
      </div>

      {status && <div className="small" style={{ marginTop: 8 }}>{status}</div>}
      {warnings.length > 0 && (
        <div className="small" style={{ marginTop: 8, color: '#92400e', background: '#fef3c7', border: '1px solid #f59e0b', padding: '8px 10px', borderRadius: 6 }}>
          {warnings.map((w, idx) => (
            <div key={idx}>{w}</div>
          ))}
        </div>
      )}

      {!results.length && (
        <div className="empty-state" style={{ marginTop: 16 }}>
          Wczytaj dane, aby zobaczyc parametry.
        </div>
      )}

      {results.length > 0 && (
        <>
          <div className="panel" style={{ marginTop: 16 }} id="parameters-summary">
            <h3>Podsumowanie</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Sample</th>
                  <th>Rep</th>
                  <th>muMax [1/h]</th>
                  <th>Td [h]</th>
                  <th>? [h]</th>
                  <th>K (95%)</th>
                  <th>OD max</th>
                  <th>t_inf [h]</th>
                  <th>AUC</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => (
                  <tr key={row.sample}>
                    <td>{row.sample}</td>
                    <td>{row.replicates ?? '-'}</td>
                    <td>{formatNumber(row.muMax)}</td>
                    <td>{formatNumber(row.td)}</td>
                    <td>{formatNumber(row.lambda)}</td>
                    <td>{formatNumber(row.kHat)}</td>
                    <td>{formatNumber(row.odMax)}</td>
                    <td>{formatNumber(row.tInflection)}</td>
                    <td>{formatNumber(row.auc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="parameters-layout">
            <div className="parameters-left">
              <SamplesPanel
                results={results}
                selectedSamples={selectedSamples}
                onToggle={toggleSample}
                onSelectAll={selectAllSamples}
                onClear={clearSamples}
                sampleColors={sampleColors}
              />
            </div>

            <div className="parameters-main">
              <div className="parameter-section" id={loessSectionId}>
                {!isLoessFullscreen && (
                  <LoessPlotControls
                    settings={loessSettings}
                    onChange={(next) => setLoessSettings(next)}
                    onReset={() => {
                      setLoessSettings({ ...DEFAULT_LOESS_SETTINGS })
                      setLoessResetKey((key) => key + 1)
                    }}
                    onResetView={() => setLoessResetKey((key) => key + 1)}
                    onExport={() => exportChartPng(loessChartId, loessSettings.title || 'loess-curves')}
                    onCopy={() => copyChartPng(loessChartId, loessSettings.title || 'loess-curves')}
                    legendVisible={!!loessSettings.legendVisible}
                    onToggleLegend={() => setLoessSettings((prev) => ({ ...prev, legendVisible: !prev.legendVisible }))}
                    showMean={!!loessSettings.showMean}
                    showMedian={!!loessSettings.showMedian}
                    showSd={!!loessSettings.showSd}
                    showCi={!!loessSettings.showCi}
                    disabled={loessControlsDisabled}
                  />
                )}
                {isLoessFullscreen && fullscreenControlsVisible && (
                  <div className="plot-controls-float">
                    <LoessPlotControls
                      settings={loessSettings}
                      onChange={(next) => setLoessSettings(next)}
                      onReset={() => {
                        setLoessSettings({ ...DEFAULT_LOESS_SETTINGS })
                        setLoessResetKey((key) => key + 1)
                      }}
                      onResetView={() => setLoessResetKey((key) => key + 1)}
                      onExport={() => exportChartPng(loessChartId, loessSettings.title || 'loess-curves')}
                      onCopy={() => copyChartPng(loessChartId, loessSettings.title || 'loess-curves')}
                      legendVisible={!!loessSettings.legendVisible}
                      onToggleLegend={() => setLoessSettings((prev) => ({ ...prev, legendVisible: !prev.legendVisible }))}
                      showMean={!!loessSettings.showMean}
                      showMedian={!!loessSettings.showMedian}
                      showSd={!!loessSettings.showSd}
                      showCi={!!loessSettings.showCi}
                      disabled={loessControlsDisabled}
                    />
                  </div>
                )}
                <PanelWithHelp
                  title="Krzywe LOESS (smoothed)"
                  helpContent="Krzywe LOESS po wygladzaniu wraz z 95% CI liczonym z replik. Uzyj panelu Samples (po lewej), aby filtrowac probki."
                  className={`chart-card parameter-chart-card ${isLoessFullscreen ? 'chart-card--fullscreen' : ''} ${isLoessFullscreen && fullscreenControlsVisible ? 'chart-card--with-controls' : ''}`}
                  contentClassName="chart-card__body"
                  actions={
                    <div className="btn-pair" style={{ flexWrap: 'wrap' }}>
                      {isLoessFullscreen && (
                        <label
                          className={`parameters-toggle ${fullscreenControlsVisible ? 'is-on' : ''}`}
                          title={fullscreenControlsVisible ? 'Ukryj sterowanie wykresem' : 'Pokaż sterowanie wykresem'}
                          style={{ marginRight: 8 }}
                        >
                          <input
                            type="checkbox"
                            checked={fullscreenControlsVisible}
                            onChange={() => setFullscreenControlsVisible((v) => !v)}
                          />
                          <span className="parameters-toggle__slider" aria-hidden />
                          <span className="parameters-toggle__label">
                            {fullscreenControlsVisible ? 'Ukryj sterowanie wykresem' : 'Pokaż sterowanie wykresem'}
                          </span>
                        </label>
                      )}
                      <button
                        type="button"
                        className={`btn ${isLoessFullscreen ? 'primary' : ''}`}
                        onClick={() => setChartFullscreen((prev) => (prev === loessChartId ? null : loessChartId))}
                      >
                        {isLoessFullscreen ? 'Zamknij pełny ekran' : 'Fullscreen'}
                      </button>
                    </div>
                  }
                >
                  {loessData.warnings.length > 0 && (
                    <div className="small" style={{ marginBottom: 8, color: '#92400e' }}>
                      {loessData.warnings.map((w, idx) => (
                        <div key={idx}>{w}</div>
                      ))}
                    </div>
                  )}
                  {!loessData.hasReplicates && !loessControlsDisabled && (
                    <div className="small" style={{ marginBottom: 8, color: '#92400e' }}>
                      Pasmo CI bazuje na pojedynczej krzywej - dodaj wiecej replik, aby uzyskac pelny przedzial.
                    </div>
                  )}
                  <div
                    id={loessChartId}
                    className="chart-card__canvas"
                    ref={registerChartRef(loessChartId)}
                    data-chart-id={loessChartId}
                  >
                    {loessData.selectionEmpty ? (
                      <div className="empty-state" style={{ minHeight: 220 }}>
                        Zaznacz probki w panelu Samples, aby narysowac LOESS.
                      </div>
                    ) : loessData.series.length ? (
                      <SimpleLineChart
                        series={loessData.series}
                        bands={loessBands}
                        scatterSeries={[
                          ...(loessSettings.showMean ? loessData.meanScatter : []),
                          ...(loessSettings.showMedian ? loessData.medianScatter : []),
                        ]}
                        title={loessSettings.title}
                        xLabel={loessSettings.xLabel}
                        yLabel={loessSettings.yLabel}
                        fontScale={loessSettings.fontScale}
                        legendMode="table-below"
                        showLegend={loessSettings.legendVisible}
                        legendScale={loessSettings.legendScale}
                        aspect={1.8}
                        stdMode="none"
                        resetViewKey={loessResetKey}
                        minPanX={Number.NEGATIVE_INFINITY}
                        minPanY={Number.NEGATIVE_INFINITY}
                        height={isLoessFullscreen ? 620 : 420}
                        mode="line"
                        pointMarkers="none"
                      />
                    ) : (
                      <div className="empty-state" style={{ minHeight: 220 }}>
                        Brak krzywych LOESS do wyswietlenia.
                      </div>
                    )}
                  </div>
                </PanelWithHelp>
              </div>
              {params.map((param) => {
                const settings = { ...defaultChartSettings(param), ...(chartSettings[param.id] ?? {}) }
                const sortedData = sortChartData(
                  visibleResults.map<ParameterPoint>((row) => ({
                    sample: row.sample,
                    value: param.getter(row),
                    spread: getSpreadForParam(row, param.id),
                    replicates: wellResults
                      .filter((w) => w.sample === row.sample)
                      .reduce<Array<{ value: number; well?: string; replicate?: number }>>((acc, w) => {
                        const v = param.getter(w as any)
                        if (v == null || !Number.isFinite(Number(v))) return acc
                        acc.push({
                          value: Number(v),
                          well: w.well,
                          replicate: w.replicate,
                        })
                        return acc
                      }, []),
                  })),
                  settings.sort,
                )
                const navId = `param-${param.id}`
                const chartId = `${navId}-chart`
                const isFullscreen = chartFullscreen === chartId
                const handleSettingsChange = (next: ChartSettings) => {
                  setChartSettings((prev) => ({ ...prev, [param.id]: next }))
                }
                const renderControls = () => (
                  <ParameterPlotControls
                    param={param}
                    settings={settings}
                    onChange={handleSettingsChange}
                    onReset={() => handleSettingsChange(defaultChartSettings(param))}
                    onExport={() => exportChartPng(chartId, settings.title || param.label)}
                    onCopy={() => copyChartPng(chartId, settings.title || param.label)}
                    legendVisible={!!settings.legendVisible}
                    onToggleLegend={() => handleSettingsChange({ ...settings, legendVisible: !settings.legendVisible })}
                    samples={sortedData.map((d) => d.sample)}
                    sampleColors={sampleColors}
                    disabled={!results.length}
                  />
                )
                return (
                  <div key={param.id} className="parameter-section" id={navId}>
                    {!isFullscreen && renderControls()}
                    {isFullscreen && fullscreenControlsVisible && (
                      <div className="plot-controls-float">{renderControls()}</div>
                    )}
                    <ParameterChartCard
                      param={param}
                      data={sortedData}
                      settings={settings}
                      sampleColors={sampleColors}
                      chartId={chartId}
                      chartRef={registerChartRef(chartId)}
                      fullscreen={isFullscreen}
                      onToggleFullscreen={() =>
                        setChartFullscreen((prev) => {
                          const next = prev === chartId ? null : chartId
                          if (next) setFullscreenControlsVisible(true)
                          return next
                        })
                      }
                      showControls={fullscreenControlsVisible}
                      onToggleControls={() => setFullscreenControlsVisible((v) => !v)}
                    />
                  </div>
                )
              })}
            </div>
          </div>

          <button
            type="button"
            className="parameters-nav-toggle"
            onClick={() => setNavOpen(true)}
            aria-label="Otworz panel nawigacji"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
            </svg>
          </button>

          {navOpen && (
            <div className="parameters-nav-overlay" role="dialog" aria-label="Nawigacja kart Parameters">
              <div className="panel parameters-nav parameters-nav--floating">
                <div className="parameters-nav__header">
                  <h4 style={{ margin: 0 }}>Nawigacja</h4>
                  <button className="btn" type="button" onClick={() => setNavOpen(false)} aria-label="Zamknij nawigacje">
                    ×
                  </button>
                </div>
                <p className="small" style={{ marginTop: 6 }}>
                  Przeskakuj bezposrednio do tabeli lub konkretnego wykresu.
                </p>
                <div className="parameters-nav__list">
                  {navItems.map((item) => (
                    <button
                      key={item.id}
                      className="btn parameters-nav__btn"
                      type="button"
                      onClick={() => handleJump(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
