export const ROWS = ['A','B','C','D','E','F','G','H'] as const
export const COLS = [1,2,3,4,5,6,7,8,9,10,11,12] as const

export const WELLS = ROWS.flatMap(r => COLS.map(c => `${r}${c}`))

export function isValidWell(code: string): boolean {
  return WELLS.includes(code.toUpperCase())
}

export function parseWell(code: string): {row: string, col: number} | null {
  const m = /^([A-Ha-h])\s*([1-9]|1[0-2])$/.exec(code.trim())
  if (!m) return null
  return { row: m[1].toUpperCase(), col: parseInt(m[2],10) }
}

export function wellKey(row: string, col: number) {
  return `${row}${col}`
}
