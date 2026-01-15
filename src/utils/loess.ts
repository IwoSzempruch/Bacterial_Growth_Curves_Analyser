export interface NumericPoint {
  x: number
  y: number
}

export interface LoessDiagnostics {
  residuals: number[]
  robustnessWeights: number[]
  windowSize: number
}

export interface LoessOptions {
  span: number
  degree?: 1 | 2
  robustIters?: number
  minWindowSize?: number
}

export interface LoessResult {
  points: NumericPoint[]
  diagnostics: LoessDiagnostics
}

const EPS = 1e-12

function computeWindowSize(span: number, totalPoints: number, minWindowSize: number): number {
  if (!(totalPoints > 1)) return 1
  const normalized = span < 1 ? Math.max(span, 0.01) * totalPoints : span
  const clamped = Math.max(minWindowSize, Math.min(totalPoints, Math.round(normalized)))
  return Math.max(minWindowSize, clamped)
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

function solveLinearSystem(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length
  const aug = matrix.map((row, i) => [...row, rhs[i]])
  for (let i = 0; i < n; i += 1) {
    let pivotRow = i
    for (let r = i + 1; r < n; r += 1) {
      if (Math.abs(aug[r][i]) > Math.abs(aug[pivotRow][i])) pivotRow = r
    }
    const pivot = aug[pivotRow][i]
    if (Math.abs(pivot) < EPS) return null
    if (pivotRow !== i) {
      const tmp = aug[i]
      aug[i] = aug[pivotRow]
      aug[pivotRow] = tmp
    }
    for (let c = i; c <= n; c += 1) {
      aug[i][c] /= pivot
    }
    for (let r = 0; r < n; r += 1) {
      if (r === i) continue
      const factor = aug[r][i]
      if (Math.abs(factor) < EPS) continue
      for (let c = i; c <= n; c += 1) {
        aug[r][c] -= factor * aug[i][c]
      }
    }
  }
  return aug.map((row) => row[n])
}

function weightedAverage(points: NumericPoint[], indices: number[], weights: number[]): number {
  let total = 0
  let weighted = 0
  indices.forEach((idx, i) => {
    const w = weights[i]
    if (!(w > 0)) return
    total += w
    weighted += w * points[idx].y
  })
  if (!(total > 0)) return points[indices[Math.floor(indices.length / 2)]].y
  return weighted / total
}

function getWindowIndices(center: number, windowSize: number, total: number): number[] {
  if (total <= windowSize) return Array.from({ length: total }, (_, i) => i)
  let start = Math.max(0, center - Math.floor((windowSize - 1) / 2))
  let end = start + windowSize - 1
  if (end >= total) {
    end = total - 1
    start = Math.max(0, end - windowSize + 1)
  }
  const list: number[] = []
  for (let idx = start; idx <= end; idx += 1) list.push(idx)
  return list
}

function fitLocalPolynomial(
  points: NumericPoint[],
  indices: number[],
  weights: number[],
  degree: 1 | 2,
  x0: number
): number | null {
  const order = degree + 1
  const matrix = Array.from({ length: order }, () => new Array(order).fill(0))
  const rhs = new Array(order).fill(0)
  let weightSum = 0
  indices.forEach((idx, i) => {
    const w = weights[i]
    if (!(w > 0)) return
    weightSum += w
    const xi = points[idx].x - x0
    const basis = new Array(order).fill(1)
    for (let k = 1; k < order; k += 1) {
      basis[k] = basis[k - 1] * xi
    }
    for (let r = 0; r < order; r += 1) {
      for (let c = 0; c < order; c += 1) {
        matrix[r][c] += w * basis[r] * basis[c]
      }
      rhs[r] += w * basis[r] * points[idx].y
    }
  })
  if (!(weightSum > 0)) return null
  const solution = solveLinearSystem(matrix, rhs)
  if (!solution || !Number.isFinite(solution[0])) return null
  return solution[0]
}

export function loess(points: NumericPoint[], options: LoessOptions): LoessResult {
  const clean = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
  const sorted = clean.sort((a, b) => a.x - b.x)
  const n = sorted.length
  if (n <= 1) {
    return {
      points: sorted.slice(),
      diagnostics: { residuals: new Array(n).fill(0), robustnessWeights: new Array(n).fill(1), windowSize: n },
    }
  }
  const degree = options.degree ?? 2
  const minWindowSize = Math.max(options.minWindowSize ?? degree + 1, degree + 1)
  const windowSize = computeWindowSize(options.span, n, minWindowSize)
  const iterations = Math.max(1, options.robustIters ?? 2)
  let robustnessWeights = new Array(n).fill(1)
  let fitted = new Array(n).fill(0)
  let residuals = new Array(n).fill(0)

  for (let iter = 0; iter < iterations; iter += 1) {
    for (let i = 0; i < n; i += 1) {
      const window = getWindowIndices(i, windowSize, n)
      const x0 = sorted[i].x
      let maxDist = 0
      const distances = window.map((idx) => {
        const dist = Math.abs(sorted[idx].x - x0)
        if (dist > maxDist) maxDist = dist
        return dist
      })
      if (!(maxDist > 0)) maxDist = 1
      const weights = window.map((idx, j) => {
        const u = distances[j] / maxDist
        const tricube = Math.pow(1 - Math.pow(u, 3), 3)
        return Math.max(0, tricube) * robustnessWeights[idx]
      })
      const prediction =
        fitLocalPolynomial(sorted, window, weights, degree, x0) ?? weightedAverage(sorted, window, weights)
      fitted[i] = prediction
    }
    residuals = sorted.map((point, idx) => point.y - fitted[idx])
    if (iter === iterations - 1) break
    const absResiduals = residuals.map((r) => Math.abs(r))
    const mad = median(absResiduals)
    if (mad < EPS) {
      robustnessWeights = new Array(n).fill(1)
      continue
    }
    const scale = 6 * mad
    robustnessWeights = absResiduals.map((r) => {
      const ratio = r / scale
      if (ratio >= 1) return 0
      const value = 1 - ratio * ratio
      return value * value
    })
  }

  return {
    points: sorted.map((point, idx) => ({ x: point.x, y: fitted[idx] })),
    diagnostics: {
      residuals,
      robustnessWeights,
      windowSize,
    },
  }
}
