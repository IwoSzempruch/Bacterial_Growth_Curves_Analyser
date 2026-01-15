import type { NumericPoint } from '@/utils/loess'

export interface LogPhaseDetectionOptions {
  windowSize?: number
  r2Min?: number
  odMin?: number
  fracKMax?: number
  muRelMin?: number
  muRelMax?: number
}

export interface LogPhaseDetectionResult {
  indices: number[]
  muMax: number | null
  muMean: number | null
  kEstimate: number | null
  startTime: number | null
  endTime: number | null
}

export const LOG_PHASE_DEFAULTS: Required<LogPhaseDetectionOptions> = {
  windowSize: 20,
  r2Min: 0.98,
  odMin: 0.001,
  fracKMax: 0.9,
  muRelMin: 0.5,
  muRelMax: 1.05,
}

const DEFAULT_OPTIONS = LOG_PHASE_DEFAULTS

function median(values: number[]): number | null {
  const filtered = values.filter((value) => Number.isFinite(value))
  if (!filtered.length) return null
  const sorted = [...filtered].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

function linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number } | null {
  const n = xs.length
  if (n < 2) return null
  const meanX = xs.reduce((acc, value) => acc + value, 0) / n
  const meanY = ys.reduce((acc, value) => acc + value, 0) / n
  let sTT = 0
  let sTU = 0
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX
    const dy = ys[i] - meanY
    sTT += dx * dx
    sTU += dx * dy
  }
  if (sTT === 0) return null
  const slope = sTU / sTT
  const intercept = meanY - slope * meanX
  const ssTot = ys.reduce((acc, value) => acc + (value - meanY) ** 2, 0)
  const ssRes = xs.reduce((acc, value, idx) => {
    const pred = slope * value + intercept
    const diff = ys[idx] - pred
    return acc + diff * diff
  }, 0)
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot
  return { slope, intercept, r2 }
}

function emptyResult(): LogPhaseDetectionResult {
  return {
    indices: [],
    muMax: null,
    muMean: null,
    kEstimate: null,
    startTime: null,
    endTime: null,
  }
}

export function detectLogPhase(
  points: NumericPoint[],
  options: LogPhaseDetectionOptions = {},
): LogPhaseDetectionResult {
  const { windowSize, r2Min, odMin, fracKMax, muRelMin, muRelMax } = {
    ...DEFAULT_OPTIONS,
    ...options,
  }
  if (!points.length) return emptyResult()
  const normalizedWindow = Math.max(2, Math.round(windowSize))
  const xs = points.map((point) => point?.x ?? Number.NaN)
  const ys = points.map((point) => point?.y ?? Number.NaN)
  if (xs.some((value) => !Number.isFinite(value)) || ys.some((value) => !Number.isFinite(value))) {
    return emptyResult()
  }

  const validIndices: number[] = []
  for (let i = 0; i < ys.length; i += 1) {
    if (ys[i] >= odMin) validIndices.push(i)
  }
  if (validIndices.length < normalizedWindow + 1) return emptyResult()

  const tail = validIndices.length >= 5 ? validIndices.slice(-5) : [...validIndices]
  const tailValues = tail.map((idx) => ys[idx])
  const kEstimate = median(tailValues)
  if (!kEstimate || !(kEstimate > 0)) return emptyResult()

  const goodWindows: { start: number; end: number; slope: number; r2: number }[] = []
  for (let k = 0; k <= validIndices.length - normalizedWindow; k += 1) {
    const idxs = validIndices.slice(k, k + normalizedWindow)
    const windowY = idxs.map((idx) => ys[idx])
    const windowX = idxs.map((idx) => xs[idx])
    const maxY = Math.max(...windowY)
    if (maxY / kEstimate >= fracKMax) continue
    if (windowY.some((value) => value <= 0)) continue
    const logY = windowY.map((value) => Math.log(value))
    const regression = linearRegression(windowX, logY)
    if (!regression) continue
    if (regression.slope <= 0) continue
    if (regression.r2 < r2Min) continue
    goodWindows.push({
      start: idxs[0],
      end: idxs[idxs.length - 1],
      slope: regression.slope,
      r2: regression.r2,
    })
  }
  if (!goodWindows.length) {
    return {
      ...emptyResult(),
      kEstimate,
    }
  }

  const muMax = Math.max(...goodWindows.map((win) => win.slope))
  let logWindows = goodWindows.filter(
    (win) => win.slope >= muRelMin * muMax && win.slope <= muRelMax * muMax,
  )
  if (!logWindows.length) {
    const best = goodWindows.reduce((prev, cur) => (cur.slope > prev.slope ? cur : prev))
    logWindows = [best]
  }

  const isLog = new Array(points.length).fill(false)
  logWindows.forEach((win) => {
    for (let idx = win.start; idx <= win.end; idx += 1) {
      isLog[idx] = true
    }
  })

  const runs: number[][] = []
  let current: number[] = []
  isLog.forEach((flag, idx) => {
    if (flag) {
      current.push(idx)
    } else if (current.length) {
      runs.push(current)
      current = []
    }
  })
  if (current.length) runs.push(current)
  if (!runs.length) {
    return {
      indices: [],
      muMax,
      muMean: null,
      kEstimate,
      startTime: null,
      endTime: null,
    }
  }

  const logIndices = runs.reduce((best, run) => (run.length > best.length ? run : best), runs[0])
  const overlappingMus = logWindows
    .filter((win) => !(win.end < logIndices[0] || win.start > logIndices[logIndices.length - 1]))
    .map((win) => win.slope)
  const muMean =
    overlappingMus.length && muMax != null
      ? overlappingMus.reduce((acc, value) => acc + value, 0) / overlappingMus.length
      : muMax
  const startTime = Number.isFinite(xs[logIndices[0]]) ? xs[logIndices[0]] : null
  const endTime = Number.isFinite(xs[logIndices[logIndices.length - 1]]) ? xs[logIndices[logIndices.length - 1]] : null

  return {
    indices: logIndices,
    muMax,
    muMean,
    kEstimate,
    startTime,
    endTime,
  }
}
