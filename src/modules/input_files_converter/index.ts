import type { Parser } from './parsers/BaseParser'
import WellTimeLongCSV from './parsers/WellTimeLongCSV'
import TimeSeriesWideCSV from './parsers/TimeSeriesWideCSV'

const registry: Parser[] = [
  WellTimeLongCSV,
  TimeSeriesWideCSV
]

export function getParsers(){ return registry }

export function pickParserFor(text: string, filename: string): Parser | null {
  for (const p of registry) {
    try {
      if (p.detect(text, filename)) return p
    } catch {}
  }
  return null
}
