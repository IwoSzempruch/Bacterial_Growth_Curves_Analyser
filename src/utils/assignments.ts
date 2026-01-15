import type {
  LogPhaseSelection,
  Mapping,
  SampleCurvesExportRecord,
  WellCurveExportRecord,
  UnifiedDataset,
  UnifiedDatasetMeta,
} from '@/types'
import { formatWellA01 } from '@/utils/csv'

export interface AssignmentMappingExport {
  type: 'mapping'
  version: number
  id: string
  name: string
  createdAt: string
  notes?: string
  samples: {
    name: string
    order: number
    color: string | null
    saturation: number | null
    wells: string[]
  }[]
}

export interface AssignmentEntry {
  mapping: AssignmentMappingExport
  dataset: {
    meta: UnifiedDatasetMeta
    rows: any[]
    sample_curves?: SampleCurvesExportRecord[]
    well_curves?: WellCurveExportRecord[]
    log_phases?: LogPhaseSelection[]
    blankPoints?: Array<{
      well: string
      sample: string
      replicate: number
      time_min: number
      time_seconds: number
      measurement: string
      value: number
    }>
    curatedAt?: string
    curation?: any
    blankedAt?: string
    blankCorrection?: {
      appliedAt: string
      measurementKey: string
      blankKey: string
      blanks: Array<{ well: string; value: number }>
    }
  }
}

export interface AssignmentsPayload {
  version: number
  createdAt: string
  assignments: AssignmentEntry[]
}

export function createMappingExport(mapping: Mapping): AssignmentMappingExport {
  const orderedSamples = mapping.samples.length
    ? mapping.samples
    : Array.from(new Set(Object.values(mapping.assignments))).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
      )

  const sampleToWells: Record<string, string[]> = {}
  Object.entries(mapping.assignments).forEach(([well, sample]) => {
    const trimmed = sample?.trim()
    if (!trimmed) return
    if (!sampleToWells[trimmed]) sampleToWells[trimmed] = []
    sampleToWells[trimmed].push(formatWellA01(well))
  })

  const sampleEntries = orderedSamples.map((name, index) => ({
    name,
    order: index,
    color: mapping.sampleColors?.[name] ?? null,
    saturation: mapping.sampleSaturations?.[name] ?? null,
    wells: (sampleToWells[name] ?? [])
      .map((w) => w)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
  }))

  return {
    type: 'mapping',
    version: 1,
    id: mapping.id,
    name: mapping.name,
    createdAt: mapping.createdAt ?? new Date().toISOString(),
    notes: mapping.notes,
    samples: sampleEntries,
  }
}

export function buildAssignmentEntry(dataset: UnifiedDataset, mapping: Mapping): AssignmentEntry | null {
  const mappingExport = createMappingExport(mapping)

  const wellsInDataset = Array.from(new Set(dataset.rows.map((r) => formatWellA01(r.well)))).sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true })
  )

  const sampleToWells: Record<string, string[]> = {}
  wellsInDataset.forEach((well) => {
    const sample = (mapping.assignments[well] ?? '').trim()
    if (!sample) return
    if (!sampleToWells[sample]) sampleToWells[sample] = []
    sampleToWells[sample].push(formatWellA01(well))
  })

  const wellReplicate: Record<string, number> = {}
  Object.entries(sampleToWells).forEach(([sample, wells]) => {
    wells
      .map((w) => w)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .forEach((well, index) => {
        wellReplicate[well] = index + 1
      })
  })

  const rowMap = new Map<string, any>()
  dataset.rows.forEach((row) => {
    const formattedWell = formatWellA01(row.well)
    const sample = (mapping.assignments[formattedWell] ?? '').trim()
    if (!sample) return
    const timeMin = +(row.timeSeconds / 60).toFixed(6)
    const key = `${formattedWell}|${timeMin}`
    let entry = rowMap.get(key)
    if (!entry) {
      entry = {
        well: formattedWell,
        sample,
        replicate: wellReplicate[formattedWell] ?? 1,
        time_min: timeMin,
      }
      rowMap.set(key, entry)
    }
    const columnKey = `val_${String(row.measurementType || 'value').toLowerCase()}`
    entry[columnKey] = row.value
  })

  const rows = Array.from(rowMap.values()).sort((a, b) => {
    const cmp = String(a.well).localeCompare(String(b.well), undefined, { numeric: true })
    return cmp !== 0 ? cmp : a.time_min - b.time_min
  })

  if (!rows.length) return null

  const { rows: _rows, ...meta } = dataset
  return {
    mapping: mappingExport,
    dataset: {
      meta: meta as UnifiedDatasetMeta,
      rows,
    },
  }
}

export function buildAssignmentsPayload(
  datasets: UnifiedDataset[],
  pairs: Record<string, string>,
  mappingsById: Record<string, Mapping>
): AssignmentsPayload | null {
  if (!Object.keys(pairs).length) return null
  const datasetById = Object.fromEntries(datasets.map((d) => [d.runId, d])) as Record<string, UnifiedDataset>
  const assignments: AssignmentEntry[] = []
  for (const [runId, mappingId] of Object.entries(pairs)) {
    const ds = datasetById[runId]
    const mapping = mappingsById[mappingId]
    if (!ds || !mapping) continue
    const entry = buildAssignmentEntry(ds, mapping)
    if (entry) assignments.push(entry)
  }
  if (!assignments.length) return null
  return {
    version: 5,
    createdAt: new Date().toISOString(),
    assignments,
  }
}
