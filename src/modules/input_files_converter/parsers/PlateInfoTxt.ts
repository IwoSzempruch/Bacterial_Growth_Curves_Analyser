import type { Parser, ParseResult } from './BaseParser'
import type { UnifiedDataset, UnifiedRow } from '@/types'
import { v4 as uuidv4 } from 'uuid'

type WellValueEntry = { well: string; meas: number; value: number }
type WellTimeMap = Record<string, Record<number, { seconds: number; label: string }>>
type WellMaskMap = Record<string, boolean>

const SECTION_PLATE_INFO = /^plate information/i
const SECTION_RESULTS = /^results for/i
const SECTION_SATURATED = /^saturated for/i
const SECTION_TIME = /^measurement time/i

function detectDelimiter(text: string): string {
  const candidates: Array<',' | ';' | '\t'> = [',', ';', '\t']
  const lines = text.split(/\r?\n/).slice(0, 50)
  const scores = candidates.map((delim) =>
    lines.reduce((acc, line) => acc + (line.split(delim).length - 1), 0)
  )
  const maxScore = Math.max(...scores)
  const idx = scores.findIndex((s) => s === maxScore)
  return candidates[idx] || ','
}

function splitCells(line: string, delimiter: string): string[] {
  const parts = line.split(delimiter)
  while (parts.length && parts[parts.length - 1] === '') parts.pop()
  return parts.map((p) => p.trim())
}

function toNumber(value: string): number {
  if (value === undefined || value === null) return NaN
  const cleaned = value.replace(',', '.').trim()
  if (!cleaned.length) return NaN
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : NaN
}

function parseTimeToSeconds(raw: string): number {
  const cleaned = raw.replace(',', '.').trim()
  if (!cleaned) return NaN
  // hh:mm:ss(.fff) or mm:ss(.fff)
  const hms = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(cleaned)
  if (hms) {
    const [_, h, m, s] = hms
    return Number(h) * 3600 + Number(m) * 60 + Number(s)
  }
  const ms = /^(\d+):(\d{2}(?:\.\d+)?)$/.exec(cleaned)
  if (ms) {
    const [_, m, s] = ms
    return Number(m) * 60 + Number(s)
  }
  const onlyNum = Number(cleaned)
  return Number.isFinite(onlyNum) ? onlyNum : NaN
}

function isSectionStart(line: string): boolean {
  const l = line.trim().toLowerCase()
  return (
    l.length === 0 ||
    SECTION_RESULTS.test(l) ||
    SECTION_SATURATED.test(l) ||
    SECTION_TIME.test(l) ||
    SECTION_PLATE_INFO.test(l) ||
    l.startsWith('background information') ||
    l.startsWith('basic assay information') ||
    l.startsWith('protocol:') ||
    l.startsWith('plate type:')
  )
}

function parseResultsTable(lines: string[], idx: number, delimiter: string): { entries: WellValueEntry[]; last: number } {
  const entries: WellValueEntry[] = []
  let headerIdx = -1
  for (let i = idx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    headerIdx = i
    break
  }
  if (headerIdx < 0) return { entries, last: idx }

  const headers = splitCells(lines[headerIdx], delimiter).slice(1) // drop leading empty cell
  const colNums = headers.map((h) => Number.parseInt(h.replace(/^0+/, '') || '0', 10))

  let lastIdx = headerIdx
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) continue
    if (isSectionStart(trimmed) && !/^[A-H]/i.test(trimmed)) {
      lastIdx = i - 1
      break
    }
    const cells = splitCells(line, delimiter)
    if (!cells.length) continue
    const rowLabel = cells[0]?.trim()
    if (!/^[A-Ha-h]$/.test(rowLabel)) {
      lastIdx = i - 1
      break
    }
    for (let c = 0; c < colNums.length; c++) {
      const col = colNums[c]
      if (!Number.isFinite(col) || col < 1 || col > 12) continue
      const well = `${rowLabel.toUpperCase()}${col}`
      const valRaw = cells[c + 1] ?? ''
      const valNum = valRaw === '' ? NaN : toNumber(valRaw)
      entries.push({ well, meas: col, value: valNum })
    }
    lastIdx = i
  }
  return { entries, last: lastIdx }
}

function parseMaskTable(lines: string[], idx: number, delimiter: string): WellMaskMap {
  const map: WellMaskMap = {}
  let headerIdx = -1
  for (let i = idx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    headerIdx = i
    break
  }
  if (headerIdx < 0) return map
  const headers = splitCells(lines[headerIdx], delimiter).slice(1)
  const colNums = headers.map((h) => Number.parseInt(h.replace(/^0+/, '') || '0', 10))
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) continue
    if (isSectionStart(trimmed) && !/^[A-H]/i.test(trimmed)) break
    const cells = splitCells(line, delimiter)
    const rowLabel = cells[0]?.trim()
    if (!/^[A-Ha-h]$/.test(rowLabel)) break
    for (let c = 0; c < colNums.length; c++) {
      const col = colNums[c]
      if (!Number.isFinite(col) || col < 1 || col > 12) continue
      const well = `${rowLabel.toUpperCase()}${col}`
      const valRaw = cells[c + 1] ?? ''
      map[well] = valRaw.toUpperCase() === 'SAT'
    }
  }
  return map
}

function parseTimeTable(lines: string[], idx: number, delimiter: string): { map: WellTimeMap; last: number } {
  const map: WellTimeMap = {}
  let headerIdx = -1
  for (let i = idx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    headerIdx = i
    break
  }
  if (headerIdx < 0) return { map, last: idx }
  const headers = splitCells(lines[headerIdx], delimiter).slice(1)
  const colNums = headers.map((h) => Number.parseInt(h.replace(/^0+/, '') || '0', 10))
  let lastIdx = headerIdx
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) continue
    if (isSectionStart(trimmed) && !/^[A-H]/i.test(trimmed)) {
      lastIdx = i - 1
      break
    }
    const cells = splitCells(line, delimiter)
    const rowLabel = cells[0]?.trim()
    if (!/^[A-Ha-h]$/.test(rowLabel)) {
      lastIdx = i - 1
      break
    }
    for (let c = 0; c < colNums.length; c++) {
      const meas = colNums[c]
      if (!Number.isFinite(meas) || meas < 1 || meas > 12) continue
      const well = `${rowLabel.toUpperCase()}${meas}`
      const rawTime = cells[c + 1] ?? ''
      if (!map[well]) map[well] = {}
      map[well][meas] = {
        label: rawTime,
        seconds: rawTime === '' ? NaN : parseTimeToSeconds(rawTime),
      }
    }
    lastIdx = i
  }
  return { map, last: lastIdx }
}

const PlateInfoTxt: Parser = {
  id: 'plate-info-txt',
  label: 'Plate TXT (Plate information blocks)',
  description: 'Tekstowy export z sekcjami Plate information / Results / Measurement time (OD600)',
  fileExtensions: ['.txt', '.csv'],
  detect: (text, filename) => {
    const lower = text.toLowerCase()
    const nameOk = filename.toLowerCase().endsWith('.txt') || filename.toLowerCase().endsWith('.csv')
    // Szukamy sygnatur w całym pliku (w dużych exportach nagłówek "Measurement time"
    // bywa daleko za pierwszymi 2 kB i wczesne ucięcie powodowało fałszywe negatywy).
    return (
      nameOk &&
      lower.includes('plate information') &&
      lower.includes('measurement time') &&
      lower.includes('results for')
    )
  },
  parse: async (content, filename): Promise<ParseResult> => {
    const text = String(content)
    const delimiter = detectDelimiter(text)
    const lines = text.split(/\r?\n/).map((l) => l.trimEnd())
    const blockStarts: number[] = []
    for (let i = 0; i < lines.length; i++) {
      if (SECTION_PLATE_INFO.test(lines[i])) blockStarts.push(i)
    }
    if (!blockStarts.length) {
      return { ok: false, error: 'Nie znaleziono sekcji "Plate information" w pliku TXT' }
    }

    const runId = uuidv4()
    let plateId = 'Plate-1'
    const measurementType = 'OD600'
    const rows: UnifiedRow[] = []
    let droppedNonFinite = 0
    const warnings: string[] = []

    for (let b = 0; b < blockStarts.length; b++) {
      const start = blockStarts[b]
      const end = blockStarts[b + 1] ?? lines.length
    const block = lines.slice(start, end)

      // Plate information -> kinetics + plate number
      let headerLine = ''
      let dataLine = ''
      for (let i = 1; i < block.length; i++) {
        if (!block[i].trim()) continue
        headerLine = block[i]
        for (let j = i + 1; j < block.length; j++) {
          if (!block[j].trim()) continue
          dataLine = block[j]
          break
        }
        break
      }
      const headerCells = headerLine ? splitCells(headerLine, delimiter) : []
      const dataCells = dataLine ? splitCells(dataLine, delimiter) : []
      const kineticsIdx = headerCells.findIndex((h) => h.toLowerCase() === 'kinetics')
      const plateIdx = headerCells.findIndex((h) => h.toLowerCase() === 'plate')
      if (plateIdx >= 0 && dataCells[plateIdx]) {
        plateId = `Plate-${dataCells[plateIdx]}`
      }
      const kineticsRaw = kineticsIdx >= 0 ? dataCells[kineticsIdx] ?? '' : ''
      const kinetics = kineticsRaw ? Number(kineticsRaw) : NaN

      // Results / saturated / time sections can appear multiple times in a block.
      const resultsList: WellValueEntry[] = []
      const satMap: WellMaskMap = {}
      const timeMap: WellTimeMap = {}
      let idx = 0
      while (idx < block.length) {
        const line = block[idx]
        if (SECTION_RESULTS.test(line)) {
          const { entries, last } = parseResultsTable(block, idx, delimiter)
          resultsList.push(...entries)
          idx = Math.max(idx + 1, last + 1)
          continue
        }
        if (SECTION_SATURATED.test(line)) {
          const mask = parseMaskTable(block, idx, delimiter)
          Object.assign(satMap, mask)
          idx += 1
          continue
        }
        if (SECTION_TIME.test(line)) {
          const { map, last } = parseTimeTable(block, idx, delimiter)
          Object.assign(timeMap, map)
          idx = Math.max(idx + 1, last + 1)
          continue
        }
        idx += 1
      }

      resultsList.forEach(({ well, meas, value }) => {
        const timeInfo = timeMap[well]?.[meas] ?? null
        const timeSeconds = timeInfo ? timeInfo.seconds : NaN
        const timeLabel =
          timeInfo?.label || (!Number.isNaN(kinetics) ? `Kinetics ${kinetics}` : undefined)
        const saturated = satMap[well] === true
        if (!Number.isFinite(value) || !Number.isFinite(timeSeconds)) {
          droppedNonFinite += 1
          return
        }
        const row: UnifiedRow = {
          runId,
          plateId,
          sourceFile: filename,
          well,
          timeSeconds,
          timeLabel,
          measurementType,
          value,
        }
        if (saturated) {
          row.value = value
        }
        rows.push(row)
      })
    }

    if (droppedNonFinite) {
      warnings.push(
        `Pominięto ${droppedNonFinite} punktów z niefinicznymi wartościami czasu lub OD (parser plate-info-txt).`,
      )
    }

    if (!rows.length) {
      return { ok: false, error: 'Nie udało się wyciągnąć danych OD z pliku TXT' }
    }

    rows.sort((a, b) => {
      const wellCmp = a.well.localeCompare(b.well, undefined, { numeric: true })
      if (wellCmp !== 0) return wellCmp
      return (a.timeSeconds || 0) - (b.timeSeconds || 0)
    })

    const dataset: UnifiedDataset = {
      runId,
      plateId,
      sourceFile: filename,
      measurementType,
      createdAt: new Date().toISOString(),
      parserId: 'plate-info-txt',
      rows,
    }

    return { ok: true, dataset, warnings: warnings.length ? warnings : undefined }
  },
}

export default PlateInfoTxt
