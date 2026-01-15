import Papa from 'papaparse'
import type { Parser, ParseResult } from './BaseParser'
import type { UnifiedDataset, UnifiedRow } from '@/types'
import { WELLS } from '@/utils/plate'
import { v4 as uuidv4 } from 'uuid'

function parseTimeToSeconds(s: string): number {
  const t = s.trim()
  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t) * 60 // assume minutes
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t)
  if (!m) return NaN
  const h = parseInt(m[1] || '0',10)
  const min = parseInt(m[2] || '0',10)
  const sec = parseInt(m[3] || '0',10)
  return h*3600 + min*60 + sec
}

const TimeSeriesWideCSV: Parser = {
  id: 'timeseries-wide-csv',
  label: 'Wide CSV (Time, A1..H12)',
  description: 'Kolumny: Time, następnie A1..H12 (każda kolumna to dołek).',
  fileExtensions: ['.csv', '.txt'],
  detect: (text) => {
    const head = text.slice(0, 1024)
    return /Time/i.test(head) && /A1/i.test(head) && /H12/i.test(head)
  },
  parse: async (content, filename): Promise<ParseResult> => {
    const text = String(content)
    const res = Papa.parse(text, { header: true, dynamicTyping: false, skipEmptyLines: 'greedy' })
    if (res.errors?.length) {
      return { ok: false, error: 'Błąd parsowania CSV: ' + res.errors[0].message }
    }
    const rows = res.data as any[]
    const runId = uuidv4()
    const plateId = 'Plate-1'
    const measurementType = 'OD600'

    const out: UnifiedRow[] = []
    rows.forEach(r => {
      const tRaw = (r['Time'] ?? r['time'] ?? '').toString().trim()
      if (!tRaw) return
      const timeSeconds = parseTimeToSeconds(tRaw)
      if (isNaN(timeSeconds)) return
      for (const well of WELLS) {
        if (well in r) {
          const valRaw = (r[well] ?? '').toString().trim()
          if (valRaw === '') continue
          const value = parseFloat(valRaw)
          if (isNaN(value)) continue
          out.push({ runId, plateId, sourceFile: filename, well, timeSeconds, timeLabel: tRaw, measurementType, value })
        }
      }
    })

    const dataset: UnifiedDataset = {
      runId, plateId, sourceFile: filename, measurementType, createdAt: new Date().toISOString(), parserId: 'timeseries-wide-csv',
      rows: out
    }
    return { ok: true, dataset }
  }
}

export default TimeSeriesWideCSV
