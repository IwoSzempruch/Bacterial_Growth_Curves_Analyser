import { describe, expect, it } from 'vitest'

import { computeParameters } from '@/utils/parameters'

function buildSyntheticEntry({
  sample = 'S1',
  well = 'A1',
  dtMin = 15,
  tEndMin = 600,
  logStartMin = 180,
  logEndMin = 360,
  baselineOd = 0.02,
  mu = 1.2, // 1/h
  odMax = 1.0,
}: {
  sample?: string
  well?: string
  dtMin?: number
  tEndMin?: number
  logStartMin?: number
  logEndMin?: number
  baselineOd?: number
  mu?: number
  odMax?: number
}) {
  const timesMin: number[] = []
  const values: number[] = []
  for (let t = 0; t <= tEndMin; t += dtMin) {
    timesMin.push(t)
    const th = t / 60
    const t0h = logStartMin / 60
    const od = th < t0h ? baselineOd : Math.min(odMax, baselineOd * Math.exp(mu * (th - t0h)))
    values.push(od)
  }

  return {
    dataset: {
      meta: { sourceFile: 'synthetic.json' },
      log_phases: [{ sample, start: logStartMin, end: logEndMin }],
      well_curves: [
        {
          sample,
          well,
          time_min: timesMin,
          od600_smoothed: values,
        },
      ],
    },
  } as any
}

describe('computeParameters lag time and muMax marker', () => {
  it('keeps muMax marker (tInflection) inside provided log phase', () => {
    const entry = buildSyntheticEntry({ logStartMin: 180, logEndMin: 360 })
    const out = computeParameters(entry)
    expect(out.wellResults).toHaveLength(1)
    const row = out.wellResults[0]!

    expect(row.muMax).not.toBeNull()
    expect(row.tInflection).not.toBeNull()
    expect(row.logStart).not.toBeNull()
    expect(row.logEnd).not.toBeNull()

    expect(row.tInflection!).toBeGreaterThanOrEqual(row.logStart!)
    expect(row.tInflection!).toBeLessThanOrEqual(row.logEnd!)
  })

  it('does not return zero lag time for a curve with clear baseline then growth', () => {
    const entry = buildSyntheticEntry({ logStartMin: 180, logEndMin: 360 })
    const out = computeParameters(entry)
    const row = out.wellResults[0]!

    expect(row.lambda).not.toBeNull()
    expect(row.lambda!).toBeGreaterThan(0.01)
    expect(row.lambda!).toBeLessThan(24)
  })
})

