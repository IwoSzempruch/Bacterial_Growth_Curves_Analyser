export type LegendPlacement = 'below' | 'right' | 'inside'

export type LegendChip = {
  key: string
  sample: string
  label: string
  color: string
  seriesName: string
  order: number
}

export type LegendGroup = {
  sample: string
  baseColor: string
  items: { key: string; label: string; color: string; seriesName: string }[]
}

export type LegendSection = {
  sample: string
  replicates: { key: string; label: string; color: string }[]
}

export type LegendBoxSize = {
  right: { w: number; h: number }
  below: { w: number; h: number }
  inside: { w: number; h: number }
}

export type LegendPosition = { x: number; y: number }

export type RawReplicatePointMeta = {
  id: string
  sample: string
  replicate: number
  well: string
  timeSeconds: number
  value: number
  strokeColor?: string
  strokeWidth?: number
  fillColor?: string
  fillOpacity?: number
}
