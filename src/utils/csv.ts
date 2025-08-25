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
    well: r.well,
    measurementType: r.measurementType,
    value: r.value,
    sampleName: assigned[r.well] ?? ''
  }))
  return rows
}
