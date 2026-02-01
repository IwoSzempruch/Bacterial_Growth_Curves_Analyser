import type { AssignmentEntry } from '@/utils/assignments'
import { sanitizeFileName } from '@/utils/export'
import type { LogPhaseSelection } from '@/types'

export interface WellSeries {
  sample: string
  well: string
  replicate?: number
  timesMin: number[]
  values: number[]
  logPhase?: { startMin: number; endMin: number }
}

export interface ConfidenceInterval {
  alpha: number
  method: 't' | 'bootstrap'
  low: number | null
  high: number | null
  iterations?: number
}

export interface ParameterSpread {
  mean: number | null
  median: number | null
  sd: number | null
  sem: number | null
  ciLow: number | null
  ciHigh: number | null
  ci?: ConfidenceInterval
  ciBootstrap?: ConfidenceInterval
  ci95?: [number | null, number | null]
  ci95Bootstrap?: [number | null, number | null]
  n: number
}

export interface ParameterSpreadMap {
  muMax?: ParameterSpread
  td?: ParameterSpread
  lambda?: ParameterSpread
  kHat?: ParameterSpread
  odMax?: ParameterSpread
  tInflection?: ParameterSpread
  tMid?: ParameterSpread
  slopeAtInflection?: ParameterSpread
  auc?: ParameterSpread
  detection?: Record<string, ParameterSpread>
  logStart?: ParameterSpread
  logEnd?: ParameterSpread
  tLogDuration?: ParameterSpread
}

export interface ParameterResult {
  sample: string
  muMax: number | null
  td: number | null
  lambda: number | null
  lambdaMethod: 'threshold' | 'tangent' | null
  kHat: number | null
  odMax: number | null
  tInflection: number | null
  tMid: number | null
  slopeAtInflection: number | null
  auc: number | null
  detection: Record<string, number | null>
  logStart: number | null
  logEnd: number | null
  tLogDuration: number | null
  replicates?: number
  replicatesTotal?: number
  stats?: ParameterSpreadMap
  ci?: { alpha: number; method: 't'; bootstrapIterations: number }
  wells?: { well: string; replicate?: number }[]
}

export interface WellParameterResult extends ParameterResult {
  well: string
  replicate?: number
}

export interface ParameterComputationOutput {
  results: ParameterResult[]
  wellResults: WellParameterResult[]
  paramsByReplicate: WellParameterResult[]
  statsBySample: SampleStatsEntry[]
  statsConfig: StatsComputationConfig
  warnings: string[]
  sourceLabel: string
}

export interface ParameterStatsSummary {
  mean: number | null
  median: number | null
  sd: number | null
  sem: number | null
  ci95: [number | null, number | null]
  ci95Bootstrap?: [number | null, number | null]
  n: number
}

export interface SampleStatsEntry {
  sample: string
  nTotal: number
  nUsed: number
  usedWells: { well: string; replicate?: number }[]
  ci: { alpha: number; method: 't'; bootstrapIterations: number }
  params: Record<string, ParameterStatsSummary | undefined>
  detection?: Record<string, ParameterStatsSummary | undefined>
}

export interface StatsComputationConfig {
  alpha: number
  bootstrapIterations: number
}

const DEFAULT_CI_ALPHA = 0.05
const DEFAULT_BOOTSTRAP_ITERATIONS = 2000
export const DEFAULT_STATS_CONFIG: StatsComputationConfig = {
  alpha: DEFAULT_CI_ALPHA,
  bootstrapIterations: DEFAULT_BOOTSTRAP_ITERATIONS,
}

const MIN_OD = 1e-6

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

function safeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function percentile(values: number[], p: number): number | null {
  const valid = values.filter((v) => Number.isFinite(v))
  if (!valid.length) return null
  const sorted = [...valid].sort((a, b) => a - b)
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  const frac = idx - lo
  if (lo === hi) return sorted[lo]
  return sorted[lo] * (1 - frac) + sorted[hi] * frac
}

function linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  const n = xs.length
  if (n < 2) return null
  const meanX = xs.reduce((acc, v) => acc + v, 0) / n
  const meanY = ys.reduce((acc, v) => acc + v, 0) / n
  let sXX = 0
  let sXY = 0
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX
    const dy = ys[i] - meanY
    sXX += dx * dx
    sXY += dx * dy
  }
  if (sXX === 0) return null
  const slope = sXY / sXX
  const intercept = meanY - slope * meanX
  return { slope, intercept }
}

function slidingMu(timesH: number[], lnOd: number[], window = 7): { t: number; mu: number | null }[] {
  if (!timesH.length || !lnOd.length || timesH.length !== lnOd.length) return []
  const n = timesH.length
  const half = Math.floor(window / 2)
  const out: { t: number; mu: number | null }[] = []
  for (let i = 0; i < n; i += 1) {
    const start = Math.max(0, i - half)
    const end = Math.min(n - 1, i + half)
    const sliceT = timesH.slice(start, end + 1)
    const sliceLn = lnOd.slice(start, end + 1)
    const regression = linearRegression(sliceT, sliceLn)
    out.push({ t: timesH[i], mu: regression ? regression.slope : null })
  }
  return out
}

function trapezoidArea(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null
  let area = 0
  for (let i = 0; i < xs.length - 1; i += 1) {
    const dx = xs[i + 1] - xs[i]
    area += 0.5 * (ys[i] + ys[i + 1]) * dx
  }
  return area
}

function interpolateTimeForValue(xs: number[], ys: number[], target: number): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null
  for (let i = 0; i < ys.length - 1; i += 1) {
    const y0 = ys[i]
    const y1 = ys[i + 1]
    if (y0 === y1) {
      if (y0 === target) return xs[i]
      continue
    }
    const min = Math.min(y0, y1)
    const max = Math.max(y0, y1)
    if (target < min || target > max) continue
    const ratio = (target - y0) / (y1 - y0)
    return xs[i] + ratio * (xs[i + 1] - xs[i])
  }
  return null
}

function closestTimeForValue(xs: number[], ys: number[], target: number): number | null {
  if (xs.length !== ys.length || !xs.length) return null
  let bestIdx = 0
  let bestDiff = Math.abs(ys[0] - target)
  for (let i = 1; i < ys.length; i += 1) {
    const diff = Math.abs(ys[i] - target)
    if (diff < bestDiff) {
      bestDiff = diff
      bestIdx = i
    }
  }
  return xs[bestIdx] ?? null
}

function computeMedian(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

function bootstrapMeanCi(
  values: number[],
  alpha: number,
  iterations: number,
): [number | null, number | null] {
  if (!values.length || iterations <= 0) return [null, null]
  const n = values.length
  const means: number[] = []
  for (let i = 0; i < iterations; i += 1) {
    let sum = 0
    for (let j = 0; j < n; j += 1) {
      const idx = Math.floor(Math.random() * n)
      sum += values[idx] ?? 0
    }
    means.push(sum / n)
  }
  means.sort((a, b) => a - b)
  const lowerIdx = Math.floor((alpha / 2) * (means.length - 1))
  const upperIdx = Math.ceil((1 - alpha / 2) * (means.length - 1))
  return [
    means[lowerIdx] ?? null,
    means[Math.min(upperIdx, means.length - 1)] ?? null,
  ]
}

function tCritical(df: number, alpha = DEFAULT_CI_ALPHA): number {
  if (!Number.isFinite(df) || df <= 0) return 0
  // Table covers two-tailed alpha = 0.05; for other alpha fall back to the same table.
  const useDefaultAlpha = Math.abs(alpha - DEFAULT_CI_ALPHA) < 1e-6
  if (df >= 60) return 1.96
  const rounded = Math.round(df)
  if (rounded in T_CRITICAL_975) return T_CRITICAL_975[rounded as keyof typeof T_CRITICAL_975]
  if (df > 30) return useDefaultAlpha ? 2.0 : 2.0
  const floored = Math.floor(df)
  if (floored in T_CRITICAL_975) return T_CRITICAL_975[floored as keyof typeof T_CRITICAL_975]
  return 0
}

function computeSpread(
  values: Array<number | null | undefined>,
  alpha = DEFAULT_CI_ALPHA,
  bootstrapIterations = DEFAULT_BOOTSTRAP_ITERATIONS,
): ParameterSpread {
  const filtered = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const n = filtered.length
  if (!n) {
    return {
      mean: null,
      median: null,
      sd: null,
      sem: null,
      ciLow: null,
      ciHigh: null,
      ci: { alpha, method: 't', low: null, high: null },
      ciBootstrap: { alpha, method: 'bootstrap', low: null, high: null, iterations: bootstrapIterations },
      ci95: [null, null],
      ci95Bootstrap: [null, null],
      n: 0,
    }
  }
  const mean = filtered.reduce((acc, v) => acc + v, 0) / n
  const median = computeMedian(filtered)
  let sd: number | null = null
  if (n > 1) {
    const variance = filtered.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1)
    sd = Math.sqrt(variance)
  } else {
    sd = 0
  }
  const sem = sd != null ? sd / Math.sqrt(n) : null
  const t = sem != null ? tCritical(n - 1, alpha) : 0
  const ciWidth = sem != null ? t * sem : null
  const [bootLow, bootHigh] =
    bootstrapIterations > 0 ? bootstrapMeanCi(filtered, alpha, bootstrapIterations) : [null, null]
  return {
    mean,
    median,
    sd,
    sem,
    ciLow: ciWidth != null ? mean - ciWidth : mean,
    ciHigh: ciWidth != null ? mean + ciWidth : mean,
    ci: {
      alpha,
      method: 't',
      low: ciWidth != null ? mean - ciWidth : mean,
      high: ciWidth != null ? mean + ciWidth : mean,
    },
    ciBootstrap: {
      alpha,
      method: 'bootstrap',
      low: bootLow,
      high: bootHigh,
      iterations: bootstrapIterations,
    },
    ci95: [ciWidth != null ? mean - ciWidth : mean, ciWidth != null ? mean + ciWidth : mean],
    ci95Bootstrap: [bootLow, bootHigh],
    n,
  }
}

function pickMostCommon<T>(values: Array<T | null | undefined>): T | null {
  const counts = new Map<T, number>()
  values.forEach((value) => {
    if (value == null) return
    counts.set(value, (counts.get(value) ?? 0) + 1)
  })
  let best: T | null = null
  let bestCount = 0
  counts.forEach((count, value) => {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  })
  return best
}

function normalizeDetectionKey(threshold: number): string {
  return threshold.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function buildLogPhaseMap(entry: AssignmentEntry | null): Record<string, LogPhaseSelection> {
  const map: Record<string, LogPhaseSelection> = {}
  if (!entry?.dataset) return map
  const logPhases = entry.dataset?.log_phases ?? (entry.dataset as any)?.logPhases ?? []
  if (!Array.isArray(logPhases)) return map
  logPhases.forEach((phase) => {
    if (phase?.sample) map[phase.sample] = phase
  })
  return map
}

function extractWellSeries(entry: AssignmentEntry | null): { series: WellSeries[]; warnings: string[] } {
  const warnings: string[] = []
  if (!entry?.dataset) return { series: [], warnings: ['Brak dataset w pliku assignment.'] }

  const logPhaseMap = buildLogPhaseMap(entry)
  const wellCurves = Array.isArray((entry.dataset as any).well_curves)
    ? (entry.dataset as any).well_curves
    : []
  const sampleCurves = Array.isArray(entry.dataset?.sample_curves)
    ? entry.dataset.sample_curves
    : []

  const source = wellCurves.length ? wellCurves : sampleCurves
  const usingWellCurves = wellCurves.length > 0

  if (!source.length) {
    warnings.push('Brak krzywych (sample_curves / well_curves) w pliku.')
    return { series: [], warnings }
  }

  const result: WellSeries[] = source
    .map((curve: any, index: number) => {
      const sample = typeof curve?.sample === 'string' ? curve.sample.trim() : ''
      if (!sample) {
        warnings.push(`Pomijam krzywą nr ${index + 1} (brak nazwy próbki).`)
        return null
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
      const timesMin: number[] = []
      const values: number[] = []
      for (let i = 0; i < len; i += 1) {
        const t = safeNumber(timeRaw[i])
        const v = safeNumber(valsRaw[i])
        if (t == null || v == null) continue
        timesMin.push(t)
        values.push(Math.max(MIN_OD, v))
      }
      if (!timesMin.length || timesMin.length !== values.length) {
        warnings.push(`Krzywa ${sample}/${well} ma nieprawidłową długość danych.`)
        return null
      }
      const phase = logPhaseMap[sample]
      return {
        sample,
        well,
        replicate,
        timesMin,
        values,
        logPhase: phase
          ? { startMin: Number(phase.start), endMin: Number(phase.end) }
          : undefined,
      }
    })
    .filter((s: WellSeries | null): s is WellSeries => Boolean(s))

  result.sort((a, b) => {
    const cmp = a.sample.localeCompare(b.sample, undefined, { numeric: true })
    if (cmp !== 0) return cmp
    const wellCmp = a.well.localeCompare(b.well, undefined, { numeric: true })
    if (wellCmp !== 0) return wellCmp
    return (a.replicate ?? 0) - (b.replicate ?? 0)
  })

  return { series: result, warnings }
}

function computeCurveParameters(
  curve: WellSeries,
  detectionThresholds: number[],
): WellParameterResult | null {
  if (curve.timesMin.length < 2) return null
  const timesH = curve.timesMin.map((t) => t / 60)
  const odPos = curve.values.map((v) => Math.max(MIN_OD, v))
  const lnOd = odPos.map((v) => Math.log(v))
  const muSeries = slidingMu(timesH, lnOd, 7)
  const logStartH = curve.logPhase ? curve.logPhase.startMin / 60 : null
  const logEndH = curve.logPhase ? curve.logPhase.endMin / 60 : null

  const muCandidates = muSeries.filter(
    (pt) => pt.mu != null && (!logStartH || !logEndH || (pt.t >= logStartH && pt.t <= logEndH)),
  )
  const muValues = muCandidates.map((pt) => pt.mu as number)
  const muMax =
    muValues.length >= 5
      ? percentile(muValues, 95)
      : muValues.length
      ? Math.max(...muValues)
      : null
  const td = muMax && muMax > 0 ? Math.log(2) / muMax : null

  const thresholdMu = muMax ? 0.1 * muMax : null
  const firstTime = timesH[0] ?? 0
  let lambdaThreshold: number | null = null
  if (thresholdMu != null && thresholdMu > 0 && muSeries.length) {
    for (let i = 0; i < muSeries.length; i += 1) {
      const win = muSeries.slice(i, i + 3)
      if (win.length < 3) break
      if (win.every((pt) => pt.mu != null && (pt.mu as number) >= thresholdMu)) {
        lambdaThreshold = (muSeries[i]?.t ?? firstTime) - firstTime
        break
      }
    }
  }

  const bestMu = muSeries.reduce<{ mu: number; t: number }>(
    (acc, pt) => {
      if (pt.mu != null && pt.mu > acc.mu) return { mu: pt.mu, t: pt.t }
      return acc
    },
    { mu: Number.NEGATIVE_INFINITY, t: timesH[0] ?? 0 },
  )
  const tInflection = Number.isFinite(bestMu.mu) ? bestMu.t : null
  const slopeAtInflection =
    Number.isFinite(bestMu.mu) && bestMu.mu !== Number.NEGATIVE_INFINITY ? bestMu.mu : null
  const lnAtInflection =
    tInflection != null
      ? (() => {
          const idx = timesH.findIndex((t) => Math.abs(t - tInflection) < 1e-9)
          return idx >= 0 ? lnOd[idx] : null
        })()
      : null
  const baseline =
    lnOd.length >= 2
      ? lnOd.slice(0, Math.min(3, lnOd.length)).reduce((acc, v) => acc + v, 0) /
        Math.min(3, lnOd.length)
      : lnOd[0] ?? null
  let lambdaTangent: number | null = null
  if (slopeAtInflection != null && slopeAtInflection > 0 && lnAtInflection != null && baseline != null) {
    const t0 = tInflection! - (lnAtInflection - baseline) / slopeAtInflection
    lambdaTangent = tInflection! - t0
  }

  let lambda: number | null = null
  let lambdaMethod: 'threshold' | 'tangent' | null = null
  const candidates: Array<{ value: number | null; method: 'threshold' | 'tangent' }> = [
    { value: lambdaThreshold, method: 'threshold' },
    { value: lambdaTangent, method: 'tangent' },
  ]
  const positive = candidates.filter((c) => c.value != null && (c.value as number) >= 0)
  if (positive.length) {
    const best = positive.reduce((prev, cur) =>
      (cur.value as number) < (prev.value as number) ? cur : prev,
    )
    lambda = best.value as number
    lambdaMethod = best.method
  } else if (lambdaThreshold != null) {
    lambda = lambdaThreshold
    lambdaMethod = 'threshold'
  } else if (lambdaTangent != null) {
    lambda = lambdaTangent
    lambdaMethod = 'tangent'
  }

  const kHat = percentile(odPos, 95)
  const odMax = odPos.length ? Math.max(...odPos) : null
  const halfK = kHat != null ? kHat / 2 : null
  let tMid: number | null = null
  if (halfK != null) {
    tMid = interpolateTimeForValue(timesH, odPos, halfK)
    if (tMid == null) tMid = closestTimeForValue(timesH, odPos, halfK)
  }

  const auc = trapezoidArea(timesH, odPos)
  const detection: Record<string, number | null> = {}
  detectionThresholds.forEach((thr) => {
    const key = normalizeDetectionKey(thr)
    detection[key] = interpolateTimeForValue(timesH, odPos, thr)
  })

  const tLogDuration = logStartH != null && logEndH != null ? Math.max(0, logEndH - logStartH) : null

  return {
    sample: curve.sample,
    well: curve.well,
    replicate: curve.replicate,
    muMax: muMax ?? null,
    td,
    lambda,
    lambdaMethod,
    kHat,
    odMax,
    tInflection,
    tMid,
    slopeAtInflection,
    auc,
    detection,
    logStart: logStartH,
    logEnd: logEndH,
    tLogDuration,
  }
}

function spreadToSummary(spread?: ParameterSpread | null): ParameterStatsSummary {
  return {
    mean: spread?.mean ?? null,
    median: spread?.median ?? null,
    sd: spread?.sd ?? null,
    sem: spread?.sem ?? null,
    ci95: [
      spread?.ci?.low ?? spread?.ciLow ?? null,
      spread?.ci?.high ?? spread?.ciHigh ?? null,
    ],
    ci95Bootstrap:
      spread?.ciBootstrap || spread?.ci95Bootstrap
        ? [
            spread?.ciBootstrap?.low ?? spread?.ci95Bootstrap?.[0] ?? null,
            spread?.ciBootstrap?.high ?? spread?.ci95Bootstrap?.[1] ?? null,
          ]
        : undefined,
    n: spread?.n ?? 0,
  }
}

function aggregateSamples(
  wellResults: WellParameterResult[],
  detectionThresholds: number[],
  totalCounts: Map<string, number>,
  statsConfig: StatsComputationConfig = DEFAULT_STATS_CONFIG,
): { summaries: ParameterResult[]; statsBySample: SampleStatsEntry[] } {
  const bySample = new Map<string, WellParameterResult[]>()
  wellResults.forEach((result) => {
    if (!bySample.has(result.sample)) bySample.set(result.sample, [])
    bySample.get(result.sample)!.push(result)
  })

  const numericKeys: Array<Exclude<keyof ParameterSpreadMap, 'detection'>> = [
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
  ]

  const summaries: ParameterResult[] = []
  const statsBySample: SampleStatsEntry[] = []
  bySample.forEach((list, sample) => {
    const stats: ParameterSpreadMap = {}
    const sampleParams: Record<string, ParameterStatsSummary | undefined> = {}
    numericKeys.forEach((key) => {
      const values = list.map((item) => item[key as keyof WellParameterResult] as number | null | undefined)
      const spread = computeSpread(values, statsConfig.alpha, statsConfig.bootstrapIterations)
      stats[key] = spread
      sampleParams[key] = spreadToSummary(spread)
    })

    const detectionStats: Record<string, ParameterSpread> = {}
    const detectionSummary: Record<string, ParameterStatsSummary> = {}
    const detectionMeans: Record<string, number | null> = {}
    detectionThresholds.forEach((thr) => {
      const key = normalizeDetectionKey(thr)
      const spread = computeSpread(
        list.map((item) => item.detection[key]),
        statsConfig.alpha,
        statsConfig.bootstrapIterations,
      )
      detectionStats[key] = spread
      detectionMeans[key] = spread.mean
      detectionSummary[key] = spreadToSummary(spread)
    })
    stats.detection = detectionStats

    const lambdaMethod = pickMostCommon(list.map((item) => item.lambdaMethod))
    const replicatesTotal = totalCounts.get(sample) ?? list.length
    summaries.push({
      sample,
      muMax: stats.muMax?.mean ?? null,
      td: stats.td?.mean ?? null,
      lambda: stats.lambda?.mean ?? null,
      lambdaMethod,
      kHat: stats.kHat?.mean ?? null,
      odMax: stats.odMax?.mean ?? null,
      tInflection: stats.tInflection?.mean ?? null,
      tMid: stats.tMid?.mean ?? null,
      slopeAtInflection: stats.slopeAtInflection?.mean ?? null,
      auc: stats.auc?.mean ?? null,
      detection: detectionMeans,
      logStart: stats.logStart?.mean ?? null,
      logEnd: stats.logEnd?.mean ?? null,
      tLogDuration: stats.tLogDuration?.mean ?? null,
      replicates: list.length,
      replicatesTotal,
      stats,
      ci: {
        alpha: statsConfig.alpha,
        method: 't',
        bootstrapIterations: statsConfig.bootstrapIterations,
      },
      wells: list.map((item) => ({ well: item.well, replicate: item.replicate })),
    })
    statsBySample.push({
      sample,
      nTotal: replicatesTotal,
      nUsed: list.length,
      usedWells: list.map((item) => ({ well: item.well, replicate: item.replicate })),
      ci: {
        alpha: statsConfig.alpha,
        method: 't',
        bootstrapIterations: statsConfig.bootstrapIterations,
      },
      params: sampleParams,
      detection: Object.keys(detectionSummary).length ? detectionSummary : undefined,
    })
  })

  return {
    summaries: summaries.sort((a, b) => a.sample.localeCompare(b.sample, undefined, { numeric: true })),
    statsBySample: statsBySample.sort((a, b) => a.sample.localeCompare(b.sample, undefined, { numeric: true })),
  }
}

export function computeParameters(
  entry: AssignmentEntry | null,
  detectionThresholds: number[] = [0.05, 0.1],
): ParameterComputationOutput {
  const warnings: string[] = []
  const { series, warnings: extractWarnings } = extractWellSeries(entry)
  warnings.push(...extractWarnings)
  const statsConfig = { ...DEFAULT_STATS_CONFIG }
  if (!series.length) {
    const baseSource =
      entry?.dataset?.meta?.sourceFile ||
      entry?.dataset?.meta?.runId ||
      (entry as any)?.meta?.sourceFile ||
      ''
    const sourceLabel = sanitizeFileName((baseSource || 'dataset').replace(/\.[^.]+$/, ''))
    if (!warnings.length) warnings.push('Brak danych do obliczeń.')
    return {
      results: [],
      wellResults: [],
      paramsByReplicate: [],
      statsBySample: [],
      statsConfig,
      warnings,
      sourceLabel,
    }
  }

  const totalCounts = new Map<string, number>()
  series.forEach((curve) => {
    totalCounts.set(curve.sample, (totalCounts.get(curve.sample) ?? 0) + 1)
  })

  const wellResults: WellParameterResult[] = []
  series.forEach((curve) => {
    const computed = computeCurveParameters(curve, detectionThresholds)
    if (!computed) {
      warnings.push(`Za mało punktów do obliczeń dla ${curve.sample}/${curve.well}.`)
      return
    }
    wellResults.push(computed)
  })

  const { summaries: sampleResults, statsBySample } = aggregateSamples(
    wellResults,
    detectionThresholds,
    totalCounts,
    statsConfig,
  )

  const baseSource =
    entry?.dataset?.meta?.sourceFile ||
    entry?.dataset?.meta?.runId ||
    (entry as any)?.meta?.sourceFile ||
    ''
  const sourceLabel = sanitizeFileName((baseSource || 'dataset').replace(/\.[^.]+$/, ''))

  return {
    results: sampleResults,
    wellResults,
    paramsByReplicate: wellResults,
    statsBySample,
    statsConfig,
    warnings,
    sourceLabel,
  }
}
