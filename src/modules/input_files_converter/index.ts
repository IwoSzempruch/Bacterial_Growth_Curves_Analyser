import type { Parser } from './parsers/BaseParser'
import WellTimeLongCSV from './parsers/WellTimeLongCSV'
import TimeSeriesWideCSV from './parsers/TimeSeriesWideCSV'
import ClariostarXlsx from './parsers/ClariostarXlsx'
import PlateInfoTxt from './parsers/PlateInfoTxt'

const registry: Parser[] = [
  PlateInfoTxt,
  ClariostarXlsx,
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
