import Papa from 'papaparse'
import type { AssignedRow, UnifiedDataset, UnifiedRow } from '@/types'

export function downloadCSV(filename: string, rows: object[]) {
  const csv = Papa.unparse(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function toAssignedCSVRows(ds: UnifiedDataset, assigned: Record<string, string>) {
  const rows = ds.rows.map(r => ({
    runId: r.runId,
    plateId: r.plateId,
    sourceFile: r.sourceFile,
    timeSeconds: r.timeSeconds,
    timeLabel: r.timeLabel ?? '',
    well: formatWellA01(r.well),
    measurementType: r.measurementType,
    value: r.value,
    sample: assigned[r.well] ?? ''
  }))
  return rows
}

// Export rows for measurements.csv as requested: well, time_min, val_od600
export function toMeasurementsCSVRows(ds: UnifiedDataset) {
  const rowMap = new Map<string, { well: string; time_min: number; val_od600: number }>()
  for (const r of ds.rows) {
    const canonical = canonicalWell(r.well)
    const well = formatWellA01(canonical)
    const time_min = +(r.timeSeconds / 60).toFixed(6)
    const key = `${canonical}|${time_min}`
    const entry = rowMap.get(key)
    if (entry) {
      entry.val_od600 = r.value
    } else {
      rowMap.set(key, { well, time_min, val_od600: r.value })
    }
  }
  return Array.from(rowMap.values()).sort((a, b) => {
    const cmp = String(a.well).localeCompare(String(b.well), undefined, { numeric: true })
    return cmp !== 0 ? cmp : a.time_min - b.time_min
  })
}

export function formatWellA01(wellA1: string): string {
  // input like A1..H12 -> output A01..H12
  const m = /^([A-Ha-h])\s*(\d{1,2})$/.exec(wellA1.trim())
  if (!m) return wellA1
  const row = m[1].toUpperCase()
  const col = m[2].padStart(2, '0')
  return `${row}${col}`
}

function canonicalWell(code: string): string {
  const match = /^\s*([A-Ha-h])\s*0*([1-9]|1[0-2])\s*$/.exec(String(code ?? ''))
  if (!match) {
    return String(code ?? '').trim().toUpperCase()
  }
  const row = match[1].toUpperCase()
  const col = parseInt(match[2], 10)
  return `${row}${col}`
}

// Export with mapping: well, sample, replicate, time_min, val_od600
export function toAssignedMeasurementsCSVRows(
  ds: UnifiedDataset,
  assignments: Record<string, string>
) {
  const baseRows = toMeasurementsCSVRows(ds)
  const wellsInDs = Array.from(new Set(ds.rows.map((r) => canonicalWell(r.well)))).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  )

  const sampleToWells: Record<string, string[]> = {}
  for (const well of wellsInDs) {
    const sample = (assignments[well] ?? '').trim()
    if (!sample) continue
    if (!sampleToWells[sample]) sampleToWells[sample] = []
    sampleToWells[sample].push(well)
  }

  const wellReplicate: Record<string, number> = {}
  for (const [sample, wells] of Object.entries(sampleToWells)) {
    wells.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    wells.forEach((well, idx) => {
      wellReplicate[well] = idx + 1
    })
  }

  return baseRows.map((row) => {
    const canonical = canonicalWell(row.well)
    const sample = (assignments[canonical] ?? '').trim()
    const replicate = sample ? wellReplicate[canonical] ?? 1 : ''
    return { ...row, sample, replicate }
  })
}
