import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import type { KeyboardEvent } from 'react'
import { useApp } from '@/state/store'
import type { UnifiedDataset, Mapping } from '@/types'
import { buildAssignmentsPayload as buildAssignmentsPayloadUtil } from '@/utils/assignments'
import { HelpTooltip } from '@/components/HelpTooltip'

const styles = {
  flexRowWrap: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } as const,
  assignmentInput: {
    border: '1px solid rgba(0,0,0,.15)',
    borderRadius: 4,
    padding: '2px 6px',
    minWidth: 180,
  } as const,
}

function AssignmentRow({
  ds,
  mappingId,
  saved,
  mappings,
  onChangeMapping,
  assignmentName,
  onAssignmentNameChange,
  onAssign,
  onOpenPlots,
  onAutoRun,
  isPl,
}: {
  ds: UnifiedDataset
  mappingId: string
  saved: boolean
  mappings: Mapping[]
  onChangeMapping: (id: string) => void
  assignmentName: string
  onAssignmentNameChange: (value: string) => void
  onAssign: () => void
  onOpenPlots: () => void
  onAutoRun: () => void
  isPl: boolean
}) {
  const disabled = !mappingId

  const handleAssignmentKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!disabled) onAssign()
    }
  }

  return (
    <tr>
      <td>{ds.sourceFile}</td>
      <td>
        <div style={styles.flexRowWrap}>
          <select
            value={mappingId}
            onChange={(e) => onChangeMapping(e.target.value)}
            title="Select mapping for this dataset"
          >
            <option value="">(no mapping)</option>
            {mappings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {saved && <span className="badge">{isPl ? 'zapisane' : 'saved'}</span>}
        </div>
      </td>
      <td>
        <div style={styles.flexRowWrap}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              value={assignmentName}
              onChange={(e) => onAssignmentNameChange(e.target.value)}
              onKeyDown={handleAssignmentKey}
              style={styles.assignmentInput}
              aria-label="Assignment filename"
              placeholder="assignment"
            />
            <span>.assignment.json</span>
          </div>
          <button className="btn basic-btn" type="button" disabled={disabled} onClick={onAssign}>
            {isPl ? 'Pobierz' : 'Download'}
          </button>
          <button className="btn primary" type="button" onClick={onOpenPlots}>
            {isPl ? 'Kolejny etap' : 'Next step'}
          </button>
          <button className="btn primary" type="button" onClick={onAutoRun}>
            {isPl ? 'Automatyczna analiza' : 'Auto analysis'}
          </button>
        </div>
      </td>
    </tr>
  )
}

export default function ConvertAndAssign() {
  const datasets = useApp((s) => Object.values(s.datasets))
  const mappings = useApp((s) => Object.values(s.mappings))
  const datasetMapping = useApp((s) => s.datasetMapping ?? {})
  const setDatasetMapping = useApp((s) => s.setDatasetMapping)
  const setDatasetMappings = useApp((s) => s.setDatasetMappings)
  const setActiveTab = useApp((s) => s.setActiveTab)
  const setPlotsSelectedRunId = useApp((s) => s.setPlotsSelectedRunId)
  const setBlankCorrectionAssignments = useApp((s) => s.setBlankCorrectionAssignments)
  const setCurvesSmoothingAssignments = useApp((s) => s.setCurvesSmoothingAssignments)
  const setCurvesSmoothingSmoothed = useApp((s) => s.setCurvesSmoothingSmoothed)
  const setAutoRun = useApp((s) => s.setAutoRun)
  const resetAutoRun = useApp((s) => s.resetAutoRun)

  const [assignedMappingByRun, setAssignedMappingByRun] = useState<Record<string, string>>({})
  const [savedInitSnap] = useState<Record<string, string>>(() => ({ ...datasetMapping }))
  const [assignmentBases, setAssignmentBases] = useState<Record<string, string>>({})
  const [log, setLog] = useState<string[]>([])
  const [showAssignHelp, setShowAssignHelp] = useState(false)
  const language = useApp((s) => s.language)
  const isPl = language === 'pl'
  const assignHelpRef = useRef<HTMLButtonElement | null>(null)

  const datasetsSorted = useMemo(() => {
    return [...datasets].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [datasets])

  const mappingsById = useMemo(() => Object.fromEntries(mappings.map((m) => [m.id, m])) as Record<string, Mapping>, [mappings])

  const makeDefaultAssignmentBase = useCallback((ds: UnifiedDataset) => {
    const base = ds.sourceFile ? ds.sourceFile.replace(/\.[^/.]+$/, '') : ds.runId
    return `${base || 'assignment'}-assignment`
  }, [])

  useEffect(() => {
    setAssignmentBases((prev) => {
      let changed = false
      const next = { ...prev }
      const runIds = new Set(datasets.map((d) => d.runId))
      for (const ds of datasets) {
        if (!next[ds.runId]) {
          next[ds.runId] = makeDefaultAssignmentBase(ds)
          changed = true
        }
      }
      for (const key of Object.keys(next)) {
        if (!runIds.has(key)) {
          delete next[key]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [datasets, makeDefaultAssignmentBase])

  const sanitizeBaseName = useCallback((raw: string, fallback: string) => {
    const trimmed = (raw || '').trim()
    const withoutExt = trimmed.replace(/(\.data\.converted)?\.(json|csv)$/i, '')
    const safe = (withoutExt || fallback).replace(/[^a-zA-Z0-9._-]+/g, '_')
    return safe.length ? safe : fallback
  }, [])

  const buildAssignmentsPayload = useCallback(
    (pairs: Record<string, string>) => buildAssignmentsPayloadUtil(datasets, pairs, mappingsById),
    [datasets, mappingsById]
  )

  const downloadAssignmentsPayload = useCallback(
    (payload: { version: number; createdAt: string; assignments: any[] }, baseName: string) => {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${baseName}.assignment.json`
      a.click()
      URL.revokeObjectURL(url)
    },
    []
  )

  const handleAssignSingle = useCallback(
    (ds: UnifiedDataset, mappingId: string) => {
      if (!mappingId) {
        setLog((prev) => [`[WARN] Select mapping before downloading ${ds.sourceFile ?? ds.runId}`, ...prev].slice(0, 200))
        return
      }
      const payload = buildAssignmentsPayload({ [ds.runId]: mappingId })
      if (!payload) {
        setLog((prev) => [`[ERR] Cannot build assignment for ${ds.sourceFile ?? ds.runId}`, ...prev].slice(0, 200))
        return
      }
      const baseRaw = assignmentBases[ds.runId] ?? makeDefaultAssignmentBase(ds)
      const baseName = sanitizeBaseName(baseRaw, makeDefaultAssignmentBase(ds))
      downloadAssignmentsPayload(payload, baseName)
      setDatasetMappings({ [ds.runId]: mappingId })
      setLog((prev) => [`[FILE] ${ds.sourceFile ?? ds.runId} -> ${baseName}.assignment.json`, ...prev].slice(0, 200))
    },
    [assignmentBases, buildAssignmentsPayload, makeDefaultAssignmentBase, sanitizeBaseName, downloadAssignmentsPayload, setDatasetMappings, setLog]
  )

  const handleSaveAllAssignmentFiles = useCallback(() => {
    if (!datasetsSorted.length) {
      setLog((prev) => ['[INFO] No datasets to download', ...prev].slice(0, 200))
      return
    }
    const updated: Record<string, string> = {}
    for (const ds of datasetsSorted) {
      const mappingId =
        assignedMappingByRun[ds.runId] ?? datasetMapping[ds.runId] ?? savedInitSnap[ds.runId] ?? ''
      if (!mappingId) continue
      const payload = buildAssignmentsPayload({ [ds.runId]: mappingId })
      if (!payload) continue
      const baseRaw = assignmentBases[ds.runId] ?? makeDefaultAssignmentBase(ds)
      const baseName = sanitizeBaseName(baseRaw, makeDefaultAssignmentBase(ds))
      downloadAssignmentsPayload(payload, baseName)
      updated[ds.runId] = mappingId
    }
    if (!Object.keys(updated).length) {
      setLog((prev) => ['[INFO] No mappings selected to download', ...prev].slice(0, 200))
      return
    }
    setDatasetMappings(updated)
    setLog((prev) => [`${Object.keys(updated).length} assignment file(s) downloaded`, ...prev].slice(0, 200))
    const firstRunId = Object.keys(updated)[0]
    if (firstRunId) {
      setPlotsSelectedRunId(firstRunId)
      setActiveTab('plots')
    }
  }, [
    assignmentBases,
    assignedMappingByRun,
    buildAssignmentsPayload,
    datasetMapping,
    datasetsSorted,
    downloadAssignmentsPayload,
    makeDefaultAssignmentBase,
    sanitizeBaseName,
    savedInitSnap,
    setActiveTab,
    setDatasetMappings,
    setLog,
    setPlotsSelectedRunId,
  ])

  const handleSelectMapping = useCallback(
    (runId: string, mappingId: string) => {
      setAssignedMappingByRun((prev) => ({ ...prev, [runId]: mappingId }))
      setDatasetMapping(runId, mappingId)
    },
    [setDatasetMapping]
  )

  const handleOpenPlots = useCallback(
    (runId: string) => {
      setPlotsSelectedRunId(runId)
      setActiveTab('plots')
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    },
    [setActiveTab, setPlotsSelectedRunId]
  )

  const handleAutoRun = useCallback(
    (ds: UnifiedDataset, mappingId: string) => {
      if (!mappingId) {
        setLog((prev) => [`[WARN] Select a mapping before fast-tracking ${ds.sourceFile ?? ds.runId}.`, ...prev].slice(0, 200))
        return
      }
      resetAutoRun()
      setBlankCorrectionAssignments(null)
      setCurvesSmoothingAssignments(null)
      setCurvesSmoothingSmoothed(null)
      setDatasetMapping(ds.runId, mappingId)
      setPlotsSelectedRunId(ds.runId)
      setAutoRun({
        runId: ds.runId,
        mappingId,
        stage: 'toBlank',
        startedAt: new Date().toISOString(),
        error: null,
      })
      setActiveTab('plots')
      setLog((prev) => [`[AUTO] Fast-track analysis queued for ${ds.sourceFile ?? ds.runId}.`, ...prev].slice(0, 200))
    },
    [
      resetAutoRun,
      setBlankCorrectionAssignments,
      setCurvesSmoothingAssignments,
      setCurvesSmoothingSmoothed,
      setDatasetMapping,
      setPlotsSelectedRunId,
      setAutoRun,
      setActiveTab,
      setLog,
    ]
  )

  return (
    <div className="panel panel-soft full-span">
      <div className="panel-heading with-help">
        <div>
          <h3> {isPl ? 'Przypisz zmapowania do plików' : 'Assign mappings to files'}</h3>
          <p className="small">
            {isPl
              ? 'Połącz każdy plik danych ze zmapowaniem prób do dołków, nazwij i pobierz plik przypisania (.assignment.json) i przejdź do kolejnych kroków (wykluczanie danych z analizy, ustalanie blank, wygładzanie krzywych). Możesz kontrolować każdy kolejny etap lub przejsć od razu do wyników - program przeprowadzi analizę z doyślnymi parametrami. Przy pierwszym użyciu zaleca się kontrolowanie każdego etapu.'
              : 'Pair each converted dataset with a plate mapping, download assignment files, and jump to plots.'}
          </p>
        </div>
        <button
          ref={assignHelpRef}
          className="help-btn"
          type="button"
          onClick={() => setShowAssignHelp((v) => !v)}
        >
          ?
        </button>
      </div>
      <HelpTooltip anchorRef={assignHelpRef} open={showAssignHelp}>
        {isPl
          ? 'Wybierz mapowanie dla każdej konwertowanej próbki. Możesz pobrać pojedynczy plik assignment albo wszystkie naraz.'
          : 'Select a mapping for each converted dataset. Download a single assignment file or all at once.'}
      </HelpTooltip>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <button
          className="btn basic-btn"
          type="button"
          onClick={handleSaveAllAssignmentFiles}
          disabled={datasetsSorted.length === 0}
        >
          {isPl ? 'Pobierz wszystkie assignmenty' : 'Download all assignments'}
        </button>
      </div>

      <table className="table" style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>{isPl ? 'Plik' : 'File'}</th>
            <th>{isPl ? 'Mapowanie' : 'Mapping'}</th>
            <th>{isPl ? 'Akcje' : 'Actions'}</th>
          </tr>
        </thead>
        <tbody>
          {datasetsSorted.map((ds) => {
            const savedId = datasetMapping[ds.runId] ?? savedInitSnap[ds.runId] ?? ''
            const mappingId = assignedMappingByRun[ds.runId] ?? savedId
            return (
              <AssignmentRow
                key={ds.runId}
                ds={ds}
                mappingId={mappingId}
                saved={!!datasetMapping[ds.runId]}
                mappings={mappings}
                assignmentName={assignmentBases[ds.runId] ?? makeDefaultAssignmentBase(ds)}
                onAssignmentNameChange={(value) => setAssignmentBases((prev) => ({ ...prev, [ds.runId]: value }))}
                onChangeMapping={(id) => handleSelectMapping(ds.runId, id)}
                onAssign={() => handleAssignSingle(ds, mappingId)}
                onOpenPlots={() => handleOpenPlots(ds.runId)}
                onAutoRun={() => handleAutoRun(ds, mappingId)}
                isPl={isPl}
              />
            )
          })}
          {datasetsSorted.length === 0 && (
            <tr>
              <td colSpan={3}>
                <div className="small">
                  {isPl
                    ? 'Brak skonwertowanych danych. Najpierw zaimportuj pliki pomiarowe.'
                    : 'No converted datasets. Import measurement files to begin.'}
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
