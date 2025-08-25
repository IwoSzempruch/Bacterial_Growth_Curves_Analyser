import Papa from 'papaparse'
import type { Parser, ParseResult } from './BaseParser'
import type { UnifiedDataset, UnifiedRow } from '@/types'
import { WELLS, isValidWell } from '@/utils/plate'
import { v4 as uuidv4 } from 'uuid'

function parseTimeToSeconds(s: string): number {
  const t = s.trim()
  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t) * 60 // assume minutes -> seconds
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t)
  if (!m) return NaN
  const h = parseInt(m[1] || '0',10)
  const min = parseInt(m[2] || '0',10)
  const sec = parseInt(m[3] || '0',10)
  return h*3600 + min*60 + sec
}

const WellTimeLongCSV: Parser = {
  id: 'well-time-long-csv',
  label: 'Long CSV (Well,Time,OD)',
  description: 'Kolumny: Well, Time, OD (czas w min lub HH:MM:SS)',
  fileExtensions: ['.csv', '.txt'],
  detect: (text) => {
    const head = text.slice(0, 1024).toLowerCase()
    return head.includes('well') && head.includes('time') && (head.includes('od') || head.includes('value'))
  },
  parse: async (text, filename): Promise<ParseResult> => {
    const res = Papa.parse(text, { header: true, dynamicTyping: false, skipEmptyLines: 'greedy' })
    if (res.errors?.length) {
      return { ok: false, error: 'Błąd parsowania CSV: ' + res.errors[0].message }
    }
    const rows = res.data as any[]
    const warnings: string[] = []
    const runId = uuidv4()
    const plateId = 'Plate-1'
    const measurementType = 'OD600'
    const dsRows: UnifiedRow[] = []
    for (const r of rows) {
      const wellRaw = (r['Well'] ?? r['well'] ?? '').toString().trim()
      const timeRaw = (r['Time'] ?? r['time'] ?? '').toString().trim()
      const valRaw = (r['OD'] ?? r['od'] ?? r['Value'] ?? r['value'] ?? '').toString().trim()
      if (!wellRaw || !timeRaw || !valRaw) continue
      if (!isValidWell(wellRaw)) { warnings.push(`Niepoprawny well: ${wellRaw}`); continue }
      const timeSeconds = parseTimeToSeconds(timeRaw)
      if (isNaN(timeSeconds)) { warnings.push(`Nie można rozpoznać czasu: ${timeRaw}`); continue }
      const value = parseFloat(valRaw)
      if (isNaN(value)) { warnings.push(`Nie można rozpoznać wartości OD: ${valRaw}`); continue }
      dsRows.push({
        runId, plateId, sourceFile: filename, well: wellRaw.toUpperCase(),
        timeSeconds, timeLabel: timeRaw, measurementType, value
      })
    }
    const dataset: UnifiedDataset = {
      runId, plateId, sourceFile: filename, measurementType, createdAt: new Date().toISOString(), parserId: 'well-time-long-csv',
      rows: dsRows
    }
    return { ok: true, dataset, warnings }
  }
}

export default WellTimeLongCSV
