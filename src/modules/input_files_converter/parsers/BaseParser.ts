import type { UnifiedDataset } from '@/types'

export interface ParseResultOk {
  ok: true
  dataset: UnifiedDataset
  warnings?: string[]
}
export interface ParseResultErr {
  ok: false
  error: string
}
export type ParseResult = ParseResultOk | ParseResultErr

export interface Parser {
  id: string
  label: string
  description: string
  fileExtensions: string[]
  detect: (text: string, filename: string) => boolean
  parse: (content: string | ArrayBuffer, filename: string) => Promise<ParseResult>
}
