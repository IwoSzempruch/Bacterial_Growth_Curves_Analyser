import { useCallback, useEffect, useMemo, useState } from 'react'
import SimpleLineChart from '@/components/SimpleLineChart'
import { useApp } from '@/state/store'
import type { LogPhasePoint, LogPhaseSelection, SampleCurvesExportRecord, SmoothedCurvesPayload } from '@/types'
import type { AssignmentEntry } from '@/utils/assignments'
import { formatWellA01 } from '@/utils/csv'
import { downloadBlob, sanitizeFileName } from '@/utils/export'
import { loess } from '@/utils/loess'

interface RangeSelection {
  start: number
  end: number
}

interface SharedBlankedInfo {
  version?: number
  createdAt?: string
  blanked?: boolean | null
}

function clampRange(range: RangeSelection | null): RangeSelection | null {
  if (!range) return null
  const start = Math.min(range.start, range.end)
  const end = Math.max(range.start, range.end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return null
  return { start, end }
}

function buildLogPhaseMap(entries?: LogPhaseSelection[] | null): Record<string, LogPhaseSelection> {
  if (!entries?.length) return {}
  const map: Record<string, LogPhaseSelection> = {}
  entries.forEach((entry) => {
    map[entry.sample] = entry
  })
  return map
}

interface BlankedAssignmentsPayload {
  version?: number
  createdAt?: string
  blanked?: boolean
  assignments?: AssignmentEntry[]
}

const DEFAULT_COLOR = '#2563eb'

function buildSampleCurvesFromPayload(payload: SmoothedCurvesPayload | null): SampleCurvesExportRecord[] {
  if (!payload?.samples?.length) return []
  return payload.samples
    .map((sample) => {
      const latest = sample.history?.[sample.history.length - 1]
      if (!latest?.points?.length) return null
      return {
        sample: sample.sample,
        time_min: latest.points.map((point) => Number(point.x ?? 0)),
        od600_smoothed_vals: latest.points.map((point) => Number(point.y ?? 0)),
      }
    })
    .filter((entry): entry is SampleCurvesExportRecord => Boolean(entry))
}

function sanitizePoints(points?: LogPhasePoint[] | null): LogPhasePoint[] | undefined {
  if (!points?.length) return undefined
  const sanitized = points
    .map((point) => ({
      t_min: Number(point.t_min),
      od600: Number(point.od600),
    }))
    .filter((point) => Number.isFinite(point.t_min) && Number.isFinite(point.od600))
  return sanitized.length ? sanitized : undefined
}

function collectPointsForLogPhase(
  payload: SmoothedCurvesPayload,
  entry: LogPhaseSelection
): LogPhasePoint[] | undefined {
  const sample = payload.samples.find((item) => item.sample === entry.sample)
  const latest = sample?.history?.[sample.history.length - 1]
  const start = Math.min(entry.start, entry.end)
  const end = Math.max(entry.start, entry.end)
  const derived =
    latest?.points
      ?.filter(
        (point) =>
          Number.isFinite(point.x) &&
          Number.isFinite(point.y) &&
          point.x >= start &&
          point.x <= end,
      )
      .map((point) => ({
        t_min: Number(point.x),
        od600: Number(point.y),
      })) ?? []
  if (derived.length) return derived
  return sanitizePoints(entry.points)
}

function buildLogPhasesWithPoints(payload: SmoothedCurvesPayload): LogPhaseSelection[] {
  if (!payload.logPhases?.length) return []
  return payload.logPhases.map((entry) => {
    const points = collectPointsForLogPhase(payload, entry)
    return points?.length ? { ...entry, points } : { ...entry, points: undefined }
  })
}

function convertAssignmentToSmoothed(entry: AssignmentEntry): SmoothedCurvesPayload | null {
  const dataset = entry?.dataset
  if (!dataset?.sample_curves?.length) return null
  const rawMap: Record<string, { x: number; y: number }[]> = {}
  dataset.rows?.forEach((row: any) => {
    if (!row || row?.curation?.excluded) return
    const sample = typeof row.sample === 'string' ? row.sample : ''
    if (!sample) return
    const time =
      typeof row.time_min === 'number'
        ? row.time_min
        : Number.isFinite(Number(row.time_min))
        ? Number(row.time_min)
        : null
    if (!Number.isFinite(time)) return
    const candidates = [row.val_od600_blank_corrected, row.val_od600, row.value]
    const value = candidates.find((val) => typeof val === 'number' && Number.isFinite(val))
    if (value == null) return
    if (!rawMap[sample]) rawMap[sample] = []
    rawMap[sample].push({ x: Number(time), y: Number(value) })
  })
  Object.values(rawMap).forEach((points) => points.sort((a, b) => a.x - b.x))
  const colorMap = new Map<string, string>()
  const wellsMap = new Map<string, { well: string; replicate: number }[]>()
  entry.mapping?.samples?.forEach((sample) => {
    if (!sample?.name) return
    if (sample.color) colorMap.set(sample.name, sample.color)
    const wells = sample.wells
      ?.map((well, idx) => {
        const formatted = formatWellA01(well)
        if (!formatted) return null
        return { well: formatted, replicate: idx + 1 }
      })
      .filter((value): value is { well: string; replicate: number } => Boolean(value))
    if (wells?.length) wellsMap.set(sample.name, wells)
  })
  const smoothedSamples = dataset.sample_curves
    .map((curve) => {
      if (!curve?.time_min?.length || !curve.od600_smoothed_vals?.length) return null
      const points = curve.time_min.map((time, idx) => ({
        x: Number(time ?? 0),
        y: Number(curve.od600_smoothed_vals[idx] ?? 0),
      }))
      return {
        sample: curve.sample,
        color: colorMap.get(curve.sample) ?? DEFAULT_COLOR,
        wells: wellsMap.get(curve.sample) ?? [],
        history: [
          {
            label: 'Raw',
            points: rawMap[curve.sample] ?? [],
          },
          {
            label: 'Smoothed (import)',
            points,
          },
        ],
      }
    })
    .filter((value): value is SmoothedCurvesPayload['samples'][number] => Boolean(value))
  if (!smoothedSamples.length) return null
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: {
      file: dataset.meta?.sourceFile ?? '',
      runId: dataset.meta?.runId ?? '',
      plateId: dataset.meta?.plateId ?? '',
    },
    smoothing: {
      span: 'imported',
      degree: 1,
    },
    samples: smoothedSamples,
    logPhases: dataset.log_phases?.map((entry) => ({ ...entry })) ?? undefined,
  }
}

export default function LogPhaseIdentification() {
  const sharedSmoothed = useApp((s) => s.curvesSmoothingSmoothed)
  const setSharedSmoothed = useApp((s) => s.setCurvesSmoothingSmoothed)
  const setActiveTab = useApp((s) => s.setActiveTab)
  const [payload, setPayload] = useState<SmoothedCurvesPayload | null>(sharedSmoothed?.smoothed ?? null)
  const [status, setStatus] = useState<string>('')
  const [filename, setFilename] = useState<string>(sharedSmoothed?.filename ?? '')
  const [assignment, setAssignment] = useState<AssignmentEntry | null>(sharedSmoothed?.assignment ?? null)
  const [rawPayload, setRawPayload] = useState<any | null>(sharedSmoothed?.rawPayload ?? null)
  const [blankedInfo, setBlankedInfo] = useState<SharedBlankedInfo | null>(
    (sharedSmoothed?.blankedInfo as SharedBlankedInfo | undefined) ?? null,
  )
  const [selectedSample, setSelectedSample] = useState<string>('')
  const [range, setRange] = useState<RangeSelection | null>(null)
  const [localSpan, setLocalSpan] = useState<string>(sharedSmoothed?.smoothed?.smoothing?.span ?? '0.05')
  const [localDegree, setLocalDegree] = useState<1 | 2>(
    (sharedSmoothed?.smoothed?.smoothing?.degree as 1 | 2) ?? 2,
  )
  const [localRobustPasses, setLocalRobustPasses] = useState<number>(3)
  const [localMaxRuns, setLocalMaxRuns] = useState<number>(3)
  const [localTol, setLocalTol] = useState<number>(0.0001)

  const syncSharedContext = useCallback(
    (
      smoothed: SmoothedCurvesPayload | null,
      assignmentOverride?: AssignmentEntry | null,
      infoOverride?: SharedBlankedInfo | null,
      nameOverride?: string,
      rawOverride?: any | null,
    ) => {
      if (!smoothed) {
        setSharedSmoothed(null)
        return
      }
      const resolvedInfo = infoOverride !== undefined ? infoOverride : blankedInfo
      const resolvedAssignment = assignmentOverride !== undefined ? assignmentOverride : assignment
      const resolvedRaw = rawOverride !== undefined ? rawOverride : rawPayload
      setSharedSmoothed({
        smoothed,
        assignment: resolvedAssignment,
        rawPayload: resolvedRaw,
        blankedInfo: resolvedInfo ?? undefined,
        filename: nameOverride ?? filename,
      })
    },
    [assignment, blankedInfo, filename, rawPayload, setSharedSmoothed],
  )

  useEffect(() => {
    if (!sharedSmoothed) return
    setPayload(sharedSmoothed.smoothed)
    setAssignment(sharedSmoothed.assignment ?? null)
    setRawPayload(sharedSmoothed.rawPayload ?? null)
    setBlankedInfo((sharedSmoothed.blankedInfo as SharedBlankedInfo | undefined) ?? null)
    setFilename(sharedSmoothed.filename ?? sharedSmoothed.smoothed.source?.file ?? '')
    setLocalSpan(sharedSmoothed.smoothed.smoothing?.span ?? '0.05')
    setLocalDegree((sharedSmoothed.smoothed.smoothing?.degree as 1 | 2) ?? 2)
  }, [sharedSmoothed])

  const samples = payload?.samples ?? []
  const sampleNames = samples.map((sample) => sample.sample)

  useEffect(() => {
    if (!selectedSample && sampleNames.length) {
      setSelectedSample(sampleNames[0])
    } else if (selectedSample && !sampleNames.includes(selectedSample) && sampleNames.length) {
      setSelectedSample(sampleNames[0])
    }
  }, [sampleNames.join('|'), selectedSample])

  const annotations = useMemo(() => buildLogPhaseMap(payload?.logPhases), [payload?.logPhases])
  const annotationsKey = useMemo(
    () =>
      payload?.logPhases
        ?.map((entry) => `${entry.sample}:${entry.start}:${entry.end}`)
        .sort()
        .join('|') ?? '',
    [payload?.logPhases]
  )

  useEffect(() => {
    if (!selectedSample) {
      setRange(null)
      return
    }
    const saved = annotations[selectedSample]
    if (saved) {
      setRange({ start: saved.start, end: saved.end })
    } else {
      setRange(null)
    }
  }, [selectedSample, annotationsKey])

  const activeSample = useMemo(
    () => samples.find((sample) => sample.sample === selectedSample) ?? null,
    [samples, selectedSample]
  )

  const historyLength = activeSample?.history?.length ?? 0
  const hasSmoothedSeries = historyLength > 1
  const latestHistory = historyLength ? activeSample?.history?.[historyLength - 1] ?? null : null
  const linearSeries = latestHistory
    ? [
        {
          name: `${selectedSample} LOESS`,
          color: activeSample?.color ?? '#2563eb',
          points: latestHistory.points,
        },
      ]
    : []

  const logSeries = latestHistory
    ? [
        {
          name: `${selectedSample} ln`,
          color: activeSample?.color ?? '#2563eb',
          points: latestHistory.points.map((point) => ({
            x: point.x,
            y: Math.log(Math.max(1e-6, point.y)),
          })),
        },
      ]
    : []

  const activeBand = clampRange(range)
  const highlightBands = activeBand
    ? [
        {
          start: activeBand.start,
          end: activeBand.end,
          color: '#fde047',
          opacity: 0.25,
        },
      ]
    : undefined

  const handleSelection = useCallback(
    ({ points }: { points: { point: { x: number } }[] }) => {
      if (!points?.length) return
      const xs = points.map((entry) => entry.point.x)
      const start = Math.min(...xs)
      const end = Math.max(...xs)
      if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return
      setRange({ start, end })
    },
    []
  )

  const runLocalSmoothing = useCallback(
    (points: { x: number; y: number }[]) => {
      if (!points?.length) return null
      const spanValue = Number(localSpan)
      if (!Number.isFinite(spanValue) || spanValue <= 0) return null
      const loops = Math.max(1, Math.round(localMaxRuns))
      const robust = Math.max(1, Math.round(localRobustPasses))
      let previous: { x: number; y: number }[] | null = null
      let lastResult: ReturnType<typeof loess> | null = null
      for (let i = 0; i < loops; i += 1) {
        const result = loess(points, {
          span: spanValue,
          degree: localDegree,
          robustIters: robust,
        })
        lastResult = result
        if (previous && result.points.length === previous.length) {
          const maxDiff = result.points.reduce((acc, pt, idx) => {
            const prev = previous ? previous[idx] : null
            if (!prev) return acc
            return Math.max(acc, Math.abs(pt.y - prev.y))
          }, 0)
          if (maxDiff <= localTol) {
            return { result, loops: i + 1, converged: true }
          }
        }
        previous = result.points.map((pt) => ({ x: pt.x, y: pt.y }))
      }
      if (!lastResult) return null
      return { result: lastResult, loops, converged: false }
    },
    [localDegree, localMaxRuns, localRobustPasses, localSpan, localTol]
  )

  const handleSaveRange = useCallback(() => {
    const normalized = clampRange(range)
    if (!payload || !selectedSample || !normalized) {
      setStatus('[WARN] Zaznacz próbę i zakres, aby zapisać fazę log.')
      return
    }
    const entry: LogPhaseSelection = {
      sample: selectedSample,
      start: normalized.start,
      end: normalized.end,
      createdAt: new Date().toISOString(),
    }
    const others = (payload.logPhases ?? []).filter((item) => item.sample !== selectedSample)
    const nextPayload: SmoothedCurvesPayload = {
      ...payload,
      logPhases: [...others, entry],
    }
    setPayload(nextPayload)
    syncSharedContext(nextPayload)
    setStatus(`[OK] Zapisano log phase dla ${selectedSample}.`)
  }, [payload, range, selectedSample, syncSharedContext])

  const handleResmoothSample = useCallback(() => {
    if (!payload || !selectedSample) {
      setStatus('[WARN] Wybierz próbę do ponownego wygładzenia.')
      return
    }
    const spanValue = Number(localSpan)
    if (!Number.isFinite(spanValue) || spanValue <= 0) {
      setStatus('[ERR] Podaj poprawny span (>0).')
      return
    }
    const sampleIndex = payload.samples.findIndex((sample) => sample.sample === selectedSample)
    if (sampleIndex < 0) {
      setStatus('[WARN] Nie znaleziono danych tej próby.')
      return
    }
    const sample = payload.samples[sampleIndex]
    const rawPoints = sample.history?.[0]?.points
    if (!rawPoints?.length) {
      setStatus('[WARN] Brak surowych danych tej próby.')
      return
    }
    const smoothing = runLocalSmoothing(rawPoints)
    if (!smoothing) {
      setStatus('[ERR] Parametry LOESS są nieprawidłowe (span?).')
      return
    }
    const newHistory = [
      sample.history[0],
      {
        label: `LOESS span ${localSpan} (custom)`,
        points: smoothing.result.points.map((pt) => ({ x: pt.x, y: pt.y })),
        diagnostics: smoothing.result.diagnostics,
      },
    ]
    const nextSamples = payload.samples.map((entry, idx) =>
      idx === sampleIndex ? { ...entry, history: newHistory } : entry
    )
    const nextPayload: SmoothedCurvesPayload = {
      ...payload,
      samples: nextSamples,
    }
    setPayload(nextPayload)
    syncSharedContext(nextPayload)
    setStatus(`[OK] Zaktualizowano smoothing próby ${selectedSample}.`)
  }, [localSpan, payload, runLocalSmoothing, selectedSample, syncSharedContext])

  const handleUndoSmoothing = useCallback(() => {
    if (!payload || !selectedSample) {
      setStatus('[WARN] Wybierz próbę, aby cofnąć smoothing.')
      return
    }
    const sampleIndex = payload.samples.findIndex((sample) => sample.sample === selectedSample)
    if (sampleIndex < 0) {
      setStatus('[WARN] Nie znaleziono danych tej próby.')
      return
    }
    const sample = payload.samples[sampleIndex]
    if (!sample.history || sample.history.length <= 1) {
      setStatus('[INFO] Brak dodatkowych iteracji do cofnięcia.')
      return
    }
    const nextHistory = sample.history.slice(0, -1)
    const nextSamples = payload.samples.map((entry, idx) =>
      idx === sampleIndex ? { ...entry, history: nextHistory } : entry
    )
    const nextPayload: SmoothedCurvesPayload = {
      ...payload,
      samples: nextSamples,
    }
    setPayload(nextPayload)
    syncSharedContext(nextPayload)
    setStatus(`[OK] Cofnięto ostatni smoothing próby ${selectedSample}.`)
  }, [payload, selectedSample, syncSharedContext])

  const handleImport = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return
      const file = files[0]
      try {
        const text = await file.text()
        const parsed = JSON.parse(text) as BlankedAssignmentsPayload | SmoothedCurvesPayload
        if ('assignments' in parsed && parsed.assignments?.length) {
          const entry = parsed.assignments[0]
          if (!entry?.dataset?.sample_curves?.length) {
            throw new Error('Brak wygładzonych krzywych (sample_curves) w pliku.')
          }
          const smoothedFromAssignment = convertAssignmentToSmoothed(entry)
          if (!smoothedFromAssignment) {
            throw new Error('Nie udało się odbudować krzywych z pliku.')
          }
          const info: SharedBlankedInfo = {
            version: parsed.version,
            createdAt: parsed.createdAt,
            blanked: parsed.blanked ?? true,
          }
          setAssignment(entry)
          setBlankedInfo(info)
          setPayload(smoothedFromAssignment)
          setRawPayload(parsed)
          syncSharedContext(smoothedFromAssignment, entry, info, file.name, parsed)
        } else {
          const smoothedOnly = parsed as SmoothedCurvesPayload
          if (!smoothedOnly?.samples?.length) {
            throw new Error('Brak próbek w pliku.')
          }
          setAssignment(null)
          setBlankedInfo(null)
          setPayload(smoothedOnly)
          setRawPayload(parsed)
          syncSharedContext(smoothedOnly, null, null, file.name, parsed)
        }
        setFilename(file.name)
        setStatus(`[OK] Wczytano ${file.name}`)
      } catch (error: any) {
        setStatus(`[ERR] Nie udało się wczytać: ${error?.message ?? String(error)}`)
      }
    },
    [syncSharedContext],
  )

  const handleExport = useCallback(() => {
    if (!payload) {
      setStatus('[WARN] Brak danych do eksportu.')
      return
    }
    const logPhaseList = buildLogPhasesWithPoints(payload)

    if (rawPayload && typeof rawPayload === 'object' && Array.isArray((rawPayload as any).assignments)) {
      const exportPayload: any = JSON.parse(JSON.stringify(rawPayload))
      exportPayload.logPhases = logPhaseList.length ? logPhaseList.map((entry) => ({ ...entry })) : undefined
      exportPayload.assignments = exportPayload.assignments.map((entry: AssignmentEntry) => {
        if (!entry?.dataset) return entry
        return {
          ...entry,
          dataset: {
            ...entry.dataset,
            log_phases: logPhaseList.length ? logPhaseList.map((item) => ({ ...item })) : undefined,
          },
        }
      })
      const base =
        exportPayload.source?.file ||
        exportPayload.source?.runId ||
        exportPayload.assignments?.[0]?.dataset?.meta?.sourceFile ||
        exportPayload.assignments?.[0]?.dataset?.meta?.runId ||
        filename ||
        'log-phases'
      const safeBase = sanitizeFileName(base.replace(/\.[^/.]+$/, '') || 'log-phases')
      const fileName = `${safeBase}-log-phases.json`
      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
        type: 'application/json;charset=utf-8',
      })
      downloadBlob(blob, fileName)
      setRawPayload(exportPayload)
      syncSharedContext(payload, undefined, undefined, undefined, exportPayload)
      setStatus(`[FILE] Wyeksportowano ${fileName}`)
      return
    }

    if (assignment?.dataset) {
      const datasetExport = {
        ...assignment.dataset,
        log_phases: logPhaseList.length ? logPhaseList.map((item) => ({ ...item })) : undefined,
      }
      const updatedAssignment: AssignmentEntry = {
        ...assignment,
        dataset: datasetExport,
      }
      const blankedPayload: any = {
        version: rawPayload?.version ?? blankedInfo?.version ?? 5,
        createdAt: rawPayload?.createdAt ?? blankedInfo?.createdAt ?? new Date().toISOString(),
        blanked: rawPayload?.blanked ?? blankedInfo?.blanked ?? true,
        assignments: [JSON.parse(JSON.stringify(updatedAssignment))],
        logPhases: logPhaseList.length ? logPhaseList.map((item) => ({ ...item })) : undefined,
      }
      const base =
        datasetExport.meta?.sourceFile || datasetExport.meta?.runId || filename || 'log-phases'
      const safeBase = sanitizeFileName(base.replace(/\.[^/.]+$/, '') || 'log-phases')
      const fileName = `${safeBase}-log-phases.json`
      const blob = new Blob([JSON.stringify(blankedPayload, null, 2)], {
        type: 'application/json;charset=utf-8',
      })
      downloadBlob(blob, fileName)
      setRawPayload(blankedPayload)
      syncSharedContext(payload, undefined, undefined, undefined, blankedPayload)
      setStatus(`[FILE] Wyeksportowano ${fileName}`)
      return
    }

    if (rawPayload && typeof rawPayload === 'object' && 'samples' in (rawPayload as any)) {
      const exportPayload: any = {
        ...rawPayload,
        logPhases: logPhaseList.length ? logPhaseList.map((entry) => ({ ...entry })) : undefined,
      }
      const base = exportPayload.source?.file || exportPayload.source?.runId || filename || 'log-phases'
      const safeBase = sanitizeFileName(base.replace(/\.[^/.]+$/, '') || 'log-phases')
      const fileName = `${safeBase}-log-phases.json`
      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
        type: 'application/json;charset=utf-8',
      })
      downloadBlob(blob, fileName)
      setRawPayload(exportPayload)
      syncSharedContext(payload, undefined, undefined, undefined, exportPayload)
      setStatus(`[FILE] Wyeksportowano ${fileName}`)
      return
    }

    const exportPayload: SmoothedCurvesPayload = {
      ...payload,
      logPhases: logPhaseList.length ? logPhaseList : undefined,
    }
    const base = exportPayload.source?.file || exportPayload.source?.runId || filename || 'log-phases'
    const safeBase = sanitizeFileName(base.replace(/\.[^/.]+$/, '') || 'log-phases')
    const fileName = `${safeBase}-log-phases.json`
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    downloadBlob(blob, fileName)
    setRawPayload(exportPayload)
    syncSharedContext(exportPayload, undefined, undefined, undefined, exportPayload)
    setStatus(`[FILE] Wyeksportowano ${fileName}`)
  }, [assignment, blankedInfo, filename, payload, rawPayload, syncSharedContext])

  const rangeLabel = activeBand ? `${activeBand.start.toFixed(2)} – ${activeBand.end.toFixed(2)} min` : 'brak'

  return (
    <div className="panel">
      <h2>Log Phase Identification</h2>
      <div className="small">
        Importuj plik <code>.smoothed.json</code> (lub skorzystaj z danych przesłanych z Curves Smoothing), zaznacz zakres
        odpowiadający fazie log i zapisz go dla każdej próby. Przeciągnięcie z wciśniętym klawiszem <strong>Shift</strong>
        (ew. Alt/Ctrl/Cmd) zaznacza log phase, natomiast zwykłe przeciągnięcie służy do panoramowania / zoomu.
      </div>

      <div className="row" style={{ marginTop: 16, gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 220 }}>
          <label className="small">Plik .smoothed / .log JSON</label>
          <input
            type="file"
            accept=".json"
            onChange={(event) => {
              handleImport(event.target.files)
              if (event.target) event.target.value = ''
            }}
          />
          {filename && (
            <div className="small" style={{ marginTop: 4 }}>
              Ostatnio wczytano: <strong>{filename}</strong>
            </div>
          )}
        </div>
        <button className="btn" disabled={!payload} onClick={handleExport}>
          Export log phases (.log-phases.json)
        </button>
        <div className="small" style={{ alignSelf: 'center' }}>
          Aktualny zakres: <strong>{rangeLabel}</strong>
        </div>
      </div>

      {status && (
        <div className="small" style={{ marginTop: 8 }}>
          {status}
        </div>
      )}

      {!samples.length && (
        <div className="empty-state" style={{ marginTop: 32 }}>
          Brak danych – zaimportuj plik .smoothed.json lub skorzystaj z Curves Smoothing.
        </div>
      )}

      {samples.length > 0 && (
        <div className="row" style={{ marginTop: 24, gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 260px', minWidth: 220, maxWidth: 320 }}>
            <div className="section-title">Próby</div>
            <div className="small" style={{ marginBottom: 8 }}>
              Wybierz jedną próbę, aby analizować jej log phase.
            </div>
            <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, maxHeight: 460, overflow: 'auto' }}>
              {samples.map((sample) => {
                const isActive = selectedSample === sample.sample
                const saved = annotations[sample.sample]
                return (
                  <div
                    key={sample.sample}
                    onClick={() => setSelectedSample(sample.sample)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: isActive ? `2px solid ${sample.color}` : '1px solid #e5e7eb',
                      background: isActive ? 'rgba(99,102,241,0.08)' : 'white',
                      cursor: 'pointer',
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: sample.color,
                          display: 'inline-block',
                        }}
                      />
                      <strong>{sample.sample}</strong>
                    </div>
                    {saved ? (
                      <div className="small">
                        Log phase: {saved.start.toFixed(2)}–{saved.end.toFixed(2)} min
                      </div>
                    ) : (
                      <div className="small" style={{ color: '#6b7280' }}>
                        Brak zapisanej fazy log
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <button
              className="btn"
              style={{ marginTop: 12, width: '100%' }}
              disabled={!selectedSample || !clampRange(range)}
              onClick={handleSaveRange}
            >
              Save for this sample
            </button>
          </div>

          <div style={{ flex: '1 1 640px', minWidth: 360 }}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 24,
              }}
            >
              <div style={{ flex: '1 1 320px', minWidth: 300 }}>
                <div className="section-title">Linear scale</div>
                <SimpleLineChart
                  series={linearSeries}
                  xBands={highlightBands}
                  title=""
                  xLabel="Time (min)"
                  yLabel="OD600"
                  aspect={1.6}
                  legendMode="none"
                  pointSelectionMode="modifier"
                  onPointSelection={handleSelection}
                  mode={hasSmoothedSeries ? 'line' : 'scatter'}
                  pointMarkers={hasSmoothedSeries ? 'none' : 'all'}
                  pointMarkerRadius={3}
                  enableZoom
                  enablePan
                />
              </div>
              <div style={{ flex: '1 1 320px', minWidth: 300 }}>
                <div className="section-title">Log scale</div>
                <SimpleLineChart
                  series={logSeries}
                  xBands={highlightBands}
                  title=""
                  xLabel="Time (min)"
                  yLabel="ln(OD600)"
                  aspect={1.6}
                  legendMode="none"
                  pointSelectionMode="modifier"
                  onPointSelection={handleSelection}
                  mode={hasSmoothedSeries ? 'line' : 'scatter'}
                  pointMarkers={hasSmoothedSeries ? 'none' : 'all'}
                  pointMarkerRadius={3}
                  enableZoom
                  enablePan
                />
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
                alignItems: 'flex-end',
                marginTop: 16,
              }}
            >
              <div className="col" style={{ minWidth: 140 }}>
                <label className="small">Span</label>
                <input
                  type="text"
                  value={localSpan}
                  onChange={(event) => setLocalSpan(event.target.value)}
                  placeholder="0.05"
                />
              </div>
              <div className="col" style={{ minWidth: 140 }}>
                <label className="small">Local model</label>
                <select
                  value={localDegree}
                  onChange={(event) => setLocalDegree(Number(event.target.value) === 1 ? 1 : 2)}
                >
                  <option value={1}>Line (deg 1)</option>
                  <option value={2}>Parabola (deg 2)</option>
                </select>
              </div>
              <div className="col" style={{ minWidth: 140 }}>
                <label className="small">Robust passes</label>
                <input
                  type="number"
                  min={1}
                  value={localRobustPasses}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    setLocalRobustPasses(Number.isFinite(value) && value >= 1 ? Math.round(value) : 1)
                  }}
                />
              </div>
              <div className="col" style={{ minWidth: 140 }}>
                <label className="small">Max re-runs</label>
                <input
                  type="number"
                  min={1}
                  value={localMaxRuns}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    setLocalMaxRuns(Number.isFinite(value) && value >= 1 ? Math.round(value) : 1)
                  }}
                />
              </div>
              <div className="col" style={{ minWidth: 160 }}>
                <label className="small">Convergence tol.</label>
                <input
                  type="number"
                  min={0}
                  step={0.0001}
                  value={localTol}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    setLocalTol(Number.isFinite(value) && value > 0 ? value : 0.0001)
                  }}
                />
              </div>
              <button className="btn" onClick={handleResmoothSample} disabled={!selectedSample}>
                Re-run smoothing (current sample)
              </button>
              <button className="btn" onClick={handleUndoSmoothing} disabled={!selectedSample}>
                Undo smoothing (current sample)
              </button>
              <button className="btn" onClick={() => setActiveTab('compiler')}>
                Open Curves Smoothing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
