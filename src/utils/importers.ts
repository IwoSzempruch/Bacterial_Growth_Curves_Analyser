import { useApp } from '@/state/store'
import type { Mapping, UnifiedDataset, UnifiedDatasetMeta } from '@/types'
import { reportUnknownFile } from './unknownReporter'
import { getParsers, pickParserFor } from '@/modules/input_files_converter'

export interface ParsedMappingFile {
  assignments: Record<string, string>
  samplesOrdered: string[]
  colorBySample: Record<string, string>
  satBySample: Record<string, number>
}

export type ImportResult =
  | { kind: 'mapping'; mappingId: string; mappingName: string }
  | { kind: 'assignments'; datasetRunIds: string[]; mappingIds: string[]; pairs: Record<string, string> }
  | { kind: 'analysis'; runId: string | null; mappingId: string | null; excluded?: Record<string, 1 | 0>; sampleBlanks?: Record<string, 1 | 0>; analysis: any }
  | { kind: 'dataset'; runId: string; measurementType: string; fileName: string; warnings?: string[] }

function normalizeImportedWell(w: string): string | null {
  const m = /^\s*([A-Ha-h])\s*0*([1-9]|1[0-2])\s*$/.exec(String(w ?? '').trim())
  if (!m) return null
  const row = m[1].toUpperCase()
  const col = Number.parseInt(m[2], 10)
  if (!Number.isFinite(col)) return null
  return `${row}${col}`
}



function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^#?[0-9A-Fa-f]{6}$/.test(trimmed)) return null
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`
}

function normalizeSaturation(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, Math.round(value)))
  }
  if (typeof value === 'string' && value.trim().length) {
    const num = Number(value)
    if (Number.isFinite(num)) {
      return Math.max(0, Math.min(100, Math.round(num)))
    }
  }
  return null
}

export function parseMappingJsonPayload(obj: any): ParsedMappingFile {
  if (!obj || (obj.type && obj.type !== 'mapping')) {
    throw new Error('Invalid mapping JSON')
  }

  let sampleEntries: any[] = Array.isArray(obj.samples) ? obj.samples : []
  if (!sampleEntries.length && obj.samples && typeof obj.samples === 'object' && !Array.isArray(obj.samples)) {
    const maybeItems = Array.isArray(obj.samples.items) ? obj.samples.items : []
    sampleEntries = maybeItems
  }

  let assignmentsEntries: any[] = Array.isArray(obj.assignments) ? obj.assignments : Array.isArray(obj.wells) ? obj.wells : []
  if (!assignmentsEntries.length && obj.assignments && typeof obj.assignments === 'object' && !Array.isArray(obj.assignments)) {
    assignmentsEntries = Object.entries(obj.assignments).map(([well, sample]) => ({ well, sample }))
  }

  const derivedAssignments: { sample: string; wells: string[] }[] = []

  const assignments: Record<string, string> = {}
  const colorBySample: Record<string, string> = {}
  const satBySample: Record<string, number> = {}
  const ordered: string[] = []

  for (const entry of sampleEntries) {
    const nameValue =
      typeof entry === 'string' || typeof entry === 'number'
        ? String(entry).trim()
        : entry?.name
    const name = nameValue ? String(nameValue).trim() : ''
    if (name && !ordered.includes(name)) {
      ordered.push(name)
    }

    if (!name) continue

    const color = normalizeHexColor(entry?.color ?? entry?.Color ?? entry?.colour ?? entry?.Colour)
    if (color) colorBySample[name] = color
    const saturation = normalizeSaturation(entry?.saturation ?? entry?.Saturation)
    if (saturation !== null) satBySample[name] = saturation

    const wellsRaw = entry?.wells ?? entry?.Wells
    const wellsList: string[] = []
    if (Array.isArray(wellsRaw)) {
      for (const w of wellsRaw) {
        if (typeof w !== 'string' && typeof w !== 'number') continue
        wellsList.push(String(w))
      }
    } else if (typeof wellsRaw === 'string') {
      wellsList.push(...wellsRaw.split(/[,\s]+/))
    }
    if (wellsList.length) {
      derivedAssignments.push({ sample: name, wells: wellsList })
    }
  }

  if (!assignmentsEntries.length && derivedAssignments.length) {
    assignmentsEntries = derivedAssignments
  }
  for (const entry of assignmentsEntries) {
    const sampleValue = entry?.sample ?? entry?.Sample ?? entry?.name
    const sample = sampleValue ? String(sampleValue).trim() : ''
    if (!sample) continue

    const wellsRaw = Array.isArray(entry?.wells) ? entry.wells : entry?.wells ?? entry?.Wells
    const wellsList: string[] = []
    if (Array.isArray(wellsRaw)) {
      for (const w of wellsRaw) {
        if (typeof w !== 'string' && typeof w !== 'number') continue
        wellsList.push(String(w))
      }
    } else if (typeof wellsRaw === 'string') {
      wellsList.push(...wellsRaw.split(/[,\s]+/))
    }

    if (wellsList.length) {
      for (const wellRaw of wellsList) {
        const well = normalizeImportedWell(wellRaw)
        if (!well) continue
        assignments[well] = sample
      }
    } else {
      const well = normalizeImportedWell(entry?.well ?? entry?.Well)
      if (!well) continue
      assignments[well] = sample
    }

    if (!ordered.includes(sample)) ordered.push(sample)
  }

  return { assignments, samplesOrdered: ordered, colorBySample, satBySample }
}

export async function parseMappingJsonFile(file: File): Promise<ParsedMappingFile> {
  const text = await file.text()
  let obj: any
  try {
    obj = JSON.parse(text)
  } catch (err) {
    throw new Error('Invalid mapping JSON')
  }
  return parseMappingJsonPayload(obj)
}


function ensureMappingDefaults(mapping: Mapping): Mapping {
  const assignments: Record<string, string> = {}
  if (mapping.assignments && typeof mapping.assignments === 'object') {
    for (const [wellRaw, sampleRaw] of Object.entries(mapping.assignments)) {
      const sample = sampleRaw ? String(sampleRaw).trim() : ''
      if (!sample) continue
      const normalizedWell = normalizeImportedWell(String(wellRaw))
      const well = normalizedWell ?? (typeof wellRaw === 'string' ? wellRaw.trim() : String(wellRaw).trim())
      if (!well) continue
      assignments[well] = sample
    }
  }

  const sampleColors = { ...(mapping.sampleColors ?? {}) }
  const sampleSaturations = { ...(mapping.sampleSaturations ?? {}) }
  const ordered: string[] = []
  const pushSample = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed || ordered.includes(trimmed)) return
    ordered.push(trimmed)
  }

  const samplesField: any[] = Array.isArray(mapping.samples) ? mapping.samples : []
  for (const entry of samplesField) {
    if (typeof entry === 'string' || typeof entry === 'number') {
      pushSample(String(entry))
      continue
    }

    const name = entry?.name ? String(entry.name).trim() : ''
    if (name) pushSample(name)

    const color = normalizeHexColor(entry?.color ?? entry?.Color ?? entry?.colour ?? entry?.Colour)
    if (color && name) sampleColors[name] = color
    const saturation = normalizeSaturation(entry?.saturation ?? entry?.Saturation)
    if (saturation !== null && name) sampleSaturations[name] = saturation

    const wellsRaw = entry?.wells ?? entry?.Wells
    if (Array.isArray(wellsRaw)) {
      for (const w of wellsRaw) {
        if (typeof w !== 'string' && typeof w !== 'number') continue
        const well = normalizeImportedWell(String(w))
        if (!well || !name) continue
        assignments[well] = name
      }
    } else if (typeof wellsRaw === 'string') {
      for (const part of wellsRaw.split(/[,\s]+/)) {
        if (!part) continue
        const well = normalizeImportedWell(part)
        if (!well || !name) continue
        assignments[well] = name
      }
    }
  }

  if (!ordered.length && Object.keys(assignments).length) {
    for (const sample of Object.values(assignments)) {
      if (!ordered.includes(sample)) ordered.push(sample)
    }
  }

  const finalSamples = ordered.length ? ordered : samplesField.filter((value): value is string => typeof value === 'string')

  const result: Mapping = {
    ...mapping,
    createdAt: mapping.createdAt ?? new Date().toISOString(),
    assignments,
    samples: finalSamples.length ? finalSamples : Object.values(assignments),
    sampleColors: Object.keys(sampleColors).length ? sampleColors : mapping.sampleColors,
    sampleSaturations: Object.keys(sampleSaturations).length ? sampleSaturations : mapping.sampleSaturations,
  }

  return result
}


function parseAssignmentsPayload(obj: any) {
  const datasets: UnifiedDataset[] = []
  const mappings: Mapping[] = []
  const pairs: Record<string, string> = {}

  if (!obj || !Array.isArray(obj.assignments)) {
    throw new Error('Invalid assignments JSON (missing assignments array)')
  }

  for (const item of obj.assignments) {
    if (!item || !item.mapping || !item.dataset) continue
    const mappingRaw = item.mapping as Mapping
    if (!mappingRaw?.id) continue
    const mapping = ensureMappingDefaults(mappingRaw)
    const meta = (item.dataset.meta ?? {}) as Partial<UnifiedDatasetMeta>
    const rowsIn = Array.isArray(item.dataset.rows) ? (item.dataset.rows as any[]) : []
    if (!rowsIn.length) continue

    const measurementCols = new Set<string>()
    for (const row of rowsIn) {
      Object.keys(row || {}).forEach((key) => {
        if (key.startsWith('val_')) measurementCols.add(key)
      })
    }
    if (!measurementCols.size) measurementCols.add('val_od600')

    const baseRunId = String(meta.runId || mapping.id || `import-${Date.now()}`)
    const sourceFile = String((meta as any).sourceFile || 'import.json')
    const plateId = String(meta.plateId || 'Plate-1')
    const createdAt = String(meta.createdAt || new Date().toISOString())
    const parserId = meta.parserId || 'import-json'
    const mappingWellCount =
      Object.keys(mapping.assignments ?? {}).length ||
      (Array.isArray((mapping as any).samples)
        ? (mapping as any).samples.reduce(
            (acc: number, s: any) => acc + (Array.isArray(s?.wells) ? s.wells.length : 0),
            0,
          )
        : 0)

    for (const col of Array.from(measurementCols)) {
      const measurementType = col.slice(4).toUpperCase()
      const runId = measurementCols.size > 1 ? `${baseRunId}::${measurementType}` : baseRunId
      const rows: UnifiedDataset['rows'] = []
      for (const row of rowsIn) {
        const well = normalizeImportedWell(row?.well ?? row?.Well ?? row?.WELL ?? row?.w ?? '')
        if (!well) continue
        const timeMinRaw = row?.time_min ?? row?.timeMin ?? row?.timeMinutes ?? row?.time
        const timeMin = typeof timeMinRaw === 'number' ? timeMinRaw : Number(timeMinRaw)
        if (!Number.isFinite(timeMin)) continue
        const valueRaw = row?.[col]
        if (valueRaw === undefined || valueRaw === null || valueRaw === '') continue
        const value = Number(valueRaw)
        if (!Number.isFinite(value)) continue
        rows.push({
          runId,
          plateId,
          sourceFile,
          well,
          timeSeconds: timeMin * 60,
          timeLabel: row?.timeLabel ?? `${timeMin} min`,
          measurementType,
          value,
        })
      }
      if (!rows.length) continue
      const datasetWellCount = new Set(rows.map((r) => r.well)).size
      if (mappingWellCount && mappingWellCount !== datasetWellCount) {
        console.warn(
          `[ASSIGNMENTS IMPORT] Well count mismatch for run "${sourceFile}": mapping has ` +
            `${mappingWellCount} wells, dataset has ${datasetWellCount}.`,
        )
      }
      datasets.push({
        runId,
        plateId,
        sourceFile,
        measurementType,
        createdAt,
        parserId,
        rows,
      })
      pairs[runId] = mapping.id
    }
    mappings.push(mapping)
  }

  return { datasets, mappings, pairs }
}

function parseAnalysisPayload(obj: any) {
  if (!obj || typeof obj !== 'object') {
    throw new Error('Invalid analysis JSON')
  }
  const dataset = obj.dataset as UnifiedDataset | undefined
  const mapping = obj.mapping ? ensureMappingDefaults(obj.mapping as Mapping) : undefined
  const excluded = obj.excluded as Record<string, 1 | 0> | undefined
  const sampleBlanks = obj.sampleBlanks as Record<string, 1 | 0> | undefined
  return { dataset, mapping, excluded, sampleBlanks, analysis: obj }
}

async function handleUnsupportedFile(file: File, reason: string, source: string): Promise<never> {
  const hasReporterEndpoint = Boolean(import.meta.env?.VITE_UNKNOWN_FILE_ENDPOINT)
  const message =
    `Brak obsługi tego formatu.\n\n` +
    `Plik: ${file.name} (${file.type || 'unknown'}, ${file.size} B)\n\n` +
    `${reason}\n\n` +
    (hasReporterEndpoint
      ? `Możesz wysłać plik, aby dodać obsługę formatu.\n`
      : `Tryb lokalny: brak skonfigurowanego endpointu wysyłki, plik nie zostanie przesłany.\n`) +
    `Jeśli dane są wrażliwe, utwórz plik w tym samym formacie z danymi fikcyjnymi i wgraj go zamiast oryginału.\n\n` +
    `Czy chcesz kontynuować?`

  const canPrompt = typeof window !== 'undefined' && typeof window.confirm === 'function'
  if (!canPrompt) {
    throw new Error(reason)
  }

  const consent = window.confirm(message)
  if (!consent) {
    throw new Error(reason)
  }

  if (!hasReporterEndpoint) {
    throw new Error(`${reason} (tryb lokalny: brak wysyłki)`)
  }

  try {
    const res = await reportUnknownFile(file, { source, message: reason })
    const link = res.issueUrl || res.pullRequestUrl
    throw new Error(link ? `${reason} Zgłoszenie utworzone: ${link}` : `${reason} Zgłoszenie wysłane.`)
  } catch (err: any) {
    throw new Error(`${reason} (wysyłka nieudana: ${err?.message || err})`)
  }
}

export async function applyImportedFile(file: File): Promise<ImportResult> {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.csv') || lower.endsWith('.xlsx') || lower.endsWith('.txt')) {
    // Try measurement parsers (same as Input Files Converter)
    const parsers = getParsers()
    const isXlsx = lower.endsWith('.xlsx')
    const probeText = isXlsx ? '' : await file.text()
    const parser = pickParserFor(probeText, file.name)
    if (!parser) {
      await handleUnsupportedFile(
        file,
        'Brak dopasowania parsera (CSV/XLSX). Dodaj nowy parser lub prześlij próbkę.',
        'setup-import'
      )
    }
    const content = isXlsx ? await file.arrayBuffer() : probeText
    const res = await parser!.parse(content as any, file.name)
    if (!res.ok || !res.dataset) {
      const message = !res.ok ? res.error : 'Nie udalo sie sparsowac pliku'
      throw new Error(message)
    }
    const {
      upsertDatasets,
      setPlotsSelectedRunId,
    } = useApp.getState()
    upsertDatasets([res.dataset])
    setPlotsSelectedRunId(res.dataset.runId)
    return {
      kind: 'dataset',
      runId: res.dataset.runId,
      measurementType: res.dataset.measurementType,
      fileName: file.name,
      warnings: res.warnings,
    }
  }

  const text = await file.text()
  let obj: any
  try {
    obj = JSON.parse(text)
  } catch (err) {
    await handleUnsupportedFile(file, 'Unsupported file format (invalid JSON)', 'setup-import')
  }

  if (obj?.type === 'mapping' || Array.isArray(obj?.samples) || Array.isArray(obj?.sampleList)) {
    const parsed = parseMappingJsonPayload(obj)
    const { createMapping, updateMappingAssignments, setSampleColor, setSampleSaturation } = useApp.getState()
    const samples = parsed.samplesOrdered.length
      ? parsed.samplesOrdered
      : Array.from(new Set(Object.values(parsed.assignments))).sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true })
        )
    if (!samples.length) {
      throw new Error('Mapping JSON does not contain any sample assignments')
    }
    const baseName =
      typeof obj.name === 'string' && obj.name.trim().length
        ? obj.name.trim()
        : file.name.replace(/\.[^/.]+$/, '') || `Imported mapping ${new Date().toLocaleTimeString()}`
    const mappingId = createMapping(baseName, samples)
    updateMappingAssignments(mappingId, parsed.assignments)
    Object.entries(parsed.colorBySample).forEach(([sample, color]) => setSampleColor(mappingId, sample, color))
    Object.entries(parsed.satBySample).forEach(([sample, sat]) => setSampleSaturation(mappingId, sample, sat))
    return { kind: 'mapping', mappingId, mappingName: baseName }
  }

  if (obj && Array.isArray(obj.assignments)) {
    const { datasets, mappings, pairs } = parseAssignmentsPayload(obj)
    if (!datasets.length && !mappings.length) {
      throw new Error('Assignments file did not contain usable data')
    }

    const app = useApp.getState()
    const {
      upsertDatasets,
      upsertMappings,
      setDatasetMappings,
      setPlotsSelectedRunId,
      setActiveTab,
      createSampleList,
      updateSampleList,
      setActiveSampleList,
      setActiveMapping,
      sampleLists,
    } = app

    if (datasets.length) upsertDatasets(datasets)
    if (mappings.length) {
      upsertMappings(mappings)
      const existingNames = new Set(Object.keys(sampleLists))
      let firstSampleListName: string | null = null
      mappings.forEach((mapping, index) => {
        if (!Array.isArray(mapping.samples) || mapping.samples.length === 0) return
        const baseName = mapping.name && mapping.name.trim().length ? mapping.name.trim() : `Imported mapping ${index + 1}`
        let listName = baseName
        if (!sampleLists[listName] && existingNames.has(listName)) {
          let suffix = 2
          while (existingNames.has(`${baseName} (${suffix})`)) suffix += 1
          listName = `${baseName} (${suffix})`
        }
        existingNames.add(listName)
        if (sampleLists[listName]) {
          updateSampleList(listName, mapping.samples)
        } else {
          createSampleList(listName, mapping.samples)
        }
        if (!firstSampleListName) firstSampleListName = listName
      })
      if (firstSampleListName) setActiveSampleList(firstSampleListName)
      if (mappings.length) setActiveMapping(mappings[0].id)
    }

    if (Object.keys(pairs).length) {
      setDatasetMappings(pairs)
      const firstRun = Object.keys(pairs)[0]
      if (firstRun) {
        setPlotsSelectedRunId(firstRun)
      }
    }

    setActiveTab('samplesMapping')

    return {
      kind: 'assignments',
      datasetRunIds: Object.keys(pairs),
      mappingIds: Array.from(new Set(Object.values(pairs))),
      pairs,
    }
  }

  if (obj && obj.meta && (obj.dataset || obj.mapping || obj.summary)) {
    const { dataset, mapping, excluded, sampleBlanks, analysis } = parseAnalysisPayload(obj)
    const {
      upsertDatasets,
      upsertMappings,
      setDatasetMappings,
      setPlotsSelectedRunId,
      setActiveTab,
      setInteractiveAnalysis,
    } = useApp.getState()
    if (dataset) upsertDatasets([dataset])
    if (mapping) upsertMappings([mapping])
    if (dataset?.runId && mapping?.id) setDatasetMappings({ [dataset.runId]: mapping.id })
    const runId = dataset?.runId ?? obj.meta?.runId ?? null
    if (runId) {
      setPlotsSelectedRunId(runId)
      setActiveTab('plots')
    }
    setInteractiveAnalysis(analysis)
    return { kind: 'analysis', runId, mappingId: mapping?.id ?? null, excluded, sampleBlanks, analysis }
  }

  return await handleUnsupportedFile(file, 'Unsupported file format', 'setup-import')
}

export function describeImportResult(result: ImportResult, fileName: string): string {
  switch (result.kind) {
    case 'mapping':
      return `Mapping "${result.mappingName}" imported from ${fileName}`
    case 'assignments':
      return `Assignments imported (${result.datasetRunIds.length} dataset(s)) from ${fileName}`
    case 'analysis':
      return `Analysis data imported${result.runId ? ` for ${result.runId}` : ''} from ${fileName}`
    case 'dataset':
      return `Dataset imported (${result.measurementType}) from ${fileName}`
    default:
      return `Imported ${fileName}`
  }
}

