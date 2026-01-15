// Phase classification utilities for OD growth curves
// Constants
export const EPS_MU = 0.05
export const TAU_LOG = 0.60
export const TAU_LAG = 0.10
export const EPS_DOWN_OD = 0.005
export const KAPPA_FACTOR = 0.20
export const PLATEAU_FRAC = 0.95

export type PhaseCode = 0 | 0.5 | 1 | 1.5 | 2 | 2.5 | 3

function movingAverage(arr: number[], win: number): number[] {
  if (arr.length < win) return [...arr]
  const out = new Array(arr.length).fill(0)
  let sum = 0
  for (let i=0;i<arr.length;i++){
    sum += arr[i]
    if (i>=win) sum -= arr[i-win]
    if (i>=win-1){ out[i - Math.floor((win-1)/2)] = sum/win }
  }
  // fill edges
  for (let i=0;i<Math.floor((win-1)/2);i++) out[i] = out[Math.floor((win-1)/2)]
  for (let i=arr.length-1;i>arr.length-1-Math.floor(win/2);i--) out[i] = out[arr.length-1-Math.floor(win/2)]
  return out
}

function percentile(arr: number[], p: number): number{
  if (!arr.length) return 0
  const a = [...arr].sort((x,y)=>x-y)
  const idx = Math.min(a.length-1, Math.max(0, Math.floor(p*(a.length-1))))
  return a[idx]
}

function gradient(x: number[], y: number[]): number[]{
  const out = new Array(y.length).fill(0)
  const n = y.length
  if (n===0) return out
  for (let i=0;i<n;i++){
    const i0 = Math.max(0, i-1)
    const i1 = Math.min(n-1, i+1)
    const dx = (x[i1]-x[i0]) || 1
    out[i] = (y[i1]-y[i0]) / dx
  }
  return out
}

function slidingOLS(x: number[], y: number[], win: number): number[]{
  const n = y.length
  const out = new Array(n).fill(0)
  if (n===0) return out
  const half = Math.floor(win/2)
  for (let i=0;i<n;i++){
    const a = Math.max(0, i-half)
    const b = Math.min(n-1, i+half)
    const len = b-a+1
    let sx=0, sy=0, sxx=0, sxy=0
    for (let k=a;k<=b;k++){ const xv=x[k], yv=y[k]; sx+=xv; sy+=yv; sxx+=xv*xv; sxy+=xv*yv }
    const denom = len*sxx - sx*sx
    const slope = denom!==0 ? (len*sxy - sx*sy)/denom : 0
    out[i] = slope
  }
  // extend ends by nearest defined (already continuous)
  return out
}

export function classifyPhasesForSeries(time_min: number[], od_raw: number[]): { phases: PhaseCode[], mu: number[], dmu: number[], dOD: number[] }{
  const n = time_min.length
  const t_h = time_min.map(t=> t/60)
  const OD0 = od_raw.map(v=> (v>0 ? v : 1e-6))
  const OD_smooth = n>=5 ? movingAverage(OD0, 5) : [...OD0]
  const lnOD = OD_smooth.map(v=> Math.log(v))
  const mu = slidingOLS(t_h, lnOD, Math.min(7, Math.max(3, Math.floor(n/2)*2+1)))
  const dmu = gradient(t_h, mu)
  const dOD = gradient(t_h, OD_smooth)

  const mu_max = percentile(mu.filter(isFinite), 0.95)
  const K_hat = percentile(OD_smooth.filter(isFinite), 0.95)

  const phases: PhaseCode[] = new Array(n).fill(0)
  // Helper arrays for conditions
  const isDeath = dOD.map(v=> v < -EPS_DOWN_OD)
  const isDeathStreak = (idx: number)=> isDeath[idx] && isDeath[idx-1] && isDeath[idx-2]
  for (let i=0;i<n;i++){
    const od = OD_smooth[i]
    const mu_i = mu[i]
    const dmu_i = dmu[i]
    // priority: death > stationary > log > lag
    if (i>=2 && isDeathStreak(i)) { phases[i] = 3; continue }
    if (Math.abs(mu_i) < EPS_MU && od >= PLATEAU_FRAC*K_hat) { phases[i] = 2; continue }
    if (mu_i >= TAU_LOG*mu_max && Math.abs(dmu_i) < KAPPA_FACTOR*mu_max) { phases[i] = 1; continue }
    if (mu_i <= TAU_LAG*mu_max && dmu_i > 0) { phases[i] = 0; continue }
    // halves
    if (mu_i > TAU_LAG*mu_max && mu_i < TAU_LOG*mu_max && dmu_i >= 0) { phases[i] = 0.5; continue }
    if (mu_i < TAU_LOG*mu_max && dmu_i <= 0 && (0.90*K_hat) <= od && od < PLATEAU_FRAC*K_hat) { phases[i] = 1.5; continue }
    if (od >= PLATEAU_FRAC*K_hat && dOD[i] < 0 && dOD[i] >= -EPS_DOWN_OD) { phases[i] = 2.5; continue }
    // default fallback
    phases[i] = 0
  }

  // Merge short islands (<=2 points)
  const merged = [...phases]
  for (let i=2;i<n-2;i++){
    if (merged[i-1]===merged[i+1] && merged[i]!==merged[i-1]){
      merged[i] = merged[i-1]
    }
  }
  return { phases: merged as PhaseCode[], mu, dmu, dOD }
}

export function buildSegments(time_min: number[], phases: PhaseCode[]): { start: number, end: number, phase: PhaseCode }[]{
  const out: { start:number, end:number, phase: PhaseCode }[] = []
  if (time_min.length===0) return out
  let s = time_min[0]
  let cur = phases[0]
  for (let i=1;i<time_min.length;i++){
    if (phases[i] !== cur){
      out.push({ start: s, end: time_min[i-1], phase: cur })
      s = time_min[i]
      cur = phases[i]
    }
  }
  out.push({ start: s, end: time_min[time_min.length-1], phase: cur })
  return out
}

