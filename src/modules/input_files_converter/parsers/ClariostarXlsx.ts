import type { Parser, ParseResult } from './BaseParser'
import type { UnifiedDataset, UnifiedRow } from '@/types'
import { isValidWell } from '@/utils/plate'
import { v4 as uuidv4 } from 'uuid'
import * as XLSX from 'xlsx'

function parseTimeLabelToMinutes(label: string): number {
  const s = String(label || '').trim().toLowerCase()
  if (!s) return NaN
  // Patterns: "X h Y min", "X h", "Y min", "0 h"
  // allow spaces variations
  const hourMin = /^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+(?:\.\d+)?)\s*min)?$/i.exec(s)
  if (hourMin) {
    const h = parseFloat(hourMin[1])
    const m = hourMin[2] ? parseFloat(hourMin[2]) : 0
    return h * 60 + m
  }
  const onlyMin = /^(\d+(?:\.\d+)?)\s*min$/i.exec(s)
  if (onlyMin) return parseFloat(onlyMin[1])
  // Accept plain 0 h
  if (/^0\s*h$/.test(s)) return 0
  return NaN
}

function toNumber(value: any): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    // allow comma as decimal separator
    const normalized = trimmed.replace(',', '.')
    const num = Number(normalized)
    return Number.isFinite(num) ? num : null
  }
  return null
}

const ClariostarXlsx: Parser = {
  id: 'clariostar-xlsx',
  label: 'BMG CLARIOstar (.xlsx)',
  description: 'Excel export: sheet "Table All Cycles"; headers: Well/Content/Raw Data (600) with time row below',
  fileExtensions: ['.xlsx'],
  detect: (_text, filename) => filename.toLowerCase().endsWith('.xlsx'),
  parse: async (content, filename): Promise<ParseResult> => {
    try {
      if (!(content instanceof ArrayBuffer)) {
        return { ok: false, error: 'Expected binary Excel (ArrayBuffer) content for .xlsx' }
      }
      const wb = XLSX.read(content, { type: 'array' })
      const sheetName = wb.SheetNames.includes('Table All Cycles') ? 'Table All Cycles' : wb.SheetNames[0]
      const ws = wb.Sheets[sheetName]
      if (!ws) return { ok: false, error: 'Worksheet not found in workbook' }

      const matrix: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][]
      // Find header row index
      let headerRowIdx = -1
      let dataColIdxs: number[] = []
      for (let i = 0; i < matrix.length; i++) {
        const row = matrix[i] || []
        const c0 = String(row[0] ?? '').trim()
        const c1 = String(row[1] ?? '').trim()
        if (c0 === 'Well' && c1 === 'Content') {
          const idxs: number[] = []
          for (let j = 2; j < row.length; j++) {
            if (String(row[j] ?? '') === 'Raw Data (600)') idxs.push(j)
          }
          if (idxs.length >= 2) {
            headerRowIdx = i
            dataColIdxs = idxs
            break
          }
        }
      }
      if (headerRowIdx < 0) {
        return { ok: false, error: "CLARIOstar format not detected: missing 'Well/Content/Raw Data (600)' header row" }
      }

      // Time labels row
      const timeRow = matrix[headerRowIdx + 1] || []
      const timeMinutes: number[] = []
      for (const colIdx of dataColIdxs) {
        const label = String(timeRow[colIdx] ?? '').trim()
        const mins = parseTimeLabelToMinutes(label)
        if (isNaN(mins)) {
          // do not reject yet; collect NaN and validate later
          timeMinutes.push(NaN)
        } else {
          timeMinutes.push(mins)
        }
      }
      if (timeMinutes.every(x => isNaN(x))) {
        return { ok: false, error: "No time labels parsed under 'Raw Data (600)'" }
      }

      // Data start two rows below headers
      const firstDataRowIdx = headerRowIdx + 2
      const runId = uuidv4()
      const plateId = 'Plate-1'
      const measurementType = 'OD600'
      const rowsOut: UnifiedRow[] = []
      const seen = new Set<string>()
      let dupCount = 0

      for (let i = firstDataRowIdx; i < matrix.length; i++) {
        const row = matrix[i] || []
        const wellRaw = String(row[0] ?? '').trim()
        if (!/^([A-H])\d{2}$/.test(wellRaw)) break
        if (!isValidWell(wellRaw[0] + String(parseInt(wellRaw.slice(1), 10)))) break

        for (let k = 0; k < dataColIdxs.length; k++) {
          const colIdx = dataColIdxs[k]
          const tmin = timeMinutes[k]
          if (isNaN(tmin)) continue
          const cell = row[colIdx]
          if (cell === undefined || cell === null || cell === '') continue
          const val = toNumber(cell)
          if (val === null) continue
          const wellA1 = wellRaw[0] + String(parseInt(wellRaw.slice(1), 10))
          const key = `${wellA1}|${tmin}`
          if (seen.has(key)) { dupCount++; continue }
          seen.add(key)
          rowsOut.push({
            runId,
            plateId,
            sourceFile: filename,
            well: wellA1,
            timeSeconds: tmin * 60,
            timeLabel: `${tmin} min`,
            measurementType,
            value: val
          })
        }
      }

      // Sort by (well, timeSeconds)
      rowsOut.sort((a, b) => a.well.localeCompare(b.well) || a.timeSeconds - b.timeSeconds)

      if (rowsOut.length === 0) {
        return { ok: false, error: 'No data rows parsed (no numeric OD600 values under valid wells)' }
      }

      const dataset: UnifiedDataset = {
        runId,
        plateId,
        sourceFile: filename,
        measurementType,
        createdAt: new Date().toISOString(),
        parserId: 'clariostar-xlsx',
        rows: rowsOut
      }
      const warnings: string[] = []
      if (dupCount > 0) warnings.push(`Dropped ${dupCount} duplicate (well,time) entries`)
      return { ok: true, dataset, warnings: warnings.length ? warnings : undefined }
    } catch (e: any) {
      return { ok: false, error: 'Failed to parse CLARIOstar .xlsx: ' + (e?.message || String(e)) }
    }
  }
}

export default ClariostarXlsx
