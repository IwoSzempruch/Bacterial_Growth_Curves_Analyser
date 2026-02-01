import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { useApp } from '@/state/store'
import type { UnifiedDataset, UnifiedDatasetMeta, Mapping } from '@/types'
import { getParsers, pickParserFor } from '@/modules/input_files_converter'
import { downloadCSV, toAssignedMeasurementsCSVRows, toMeasurementsCSVRows } from '@/utils/csv'
import { applyImportedFile, describeImportResult } from '@/utils/importers'
import { buildAssignmentsPayload as buildAssignmentsPayloadUtil } from '@/utils/assignments'
import { HelpTooltip } from '@/components/HelpTooltip'

type FileFilter = 'all' | 'csv' | 'json' | 'excel' | 'common'

const styles: Record<string, CSSProperties> = {
  flexRowWrap: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  miniInput: {
    border: '1px solid rgba(0,0,0,.15)',
    borderRadius: 4,
    padding: '2px 6px',
    minWidth: 140,
  },
  assignmentInput: {
    border: '1px solid rgba(0,0,0,.15)',
    borderRadius: 4,
    padding: '2px 6px',
    minWidth: 180,
  },
  columnInfo: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 220 },
}

function ConvertedRow({
  ds,
  downloadName,
  onDownloadNameChange,
  onDownload,
  onRemove,
}: {
  ds: UnifiedDataset
  downloadName: string
  onDownloadNameChange: (value: string) => void
  onDownload: () => void
  onRemove: () => void
}) {
  const handleInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onDownload()
    }
  }

  return (
    <tr>
      <td>{new Date(ds.createdAt).toLocaleString()}</td>
      <td>{ds.sourceFile}</td>
      <td>{ds.measurementType}</td>
      <td>{ds.rows.length}</td>
      <td>{ds.parserId}</td>
      <td>
        <div style={styles.flexRowWrap}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              value={downloadName}
              onChange={(e) => onDownloadNameChange(e.target.value)}
              onKeyDown={handleInputKey}
              style={styles.miniInput}
              aria-label="Converted CSV base name"
              placeholder="measurements"
            />
            <span>.data.converted.csv</span>
          </div>
          <button className="btn" type="button" onClick={onDownload}>
            Download converted
          </button>
          <button className="btn danger" type="button" onClick={onRemove}>
            Remove
          </button>
        </div>
      </td>
    </tr>
  )
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
          {saved && <span className="badge">saved</span>}
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
          <button className="btn primary" type="button" disabled={disabled} onClick={onAssign}>
            Download assignment
          </button>
          <button className="btn primary next-btn" type="button" onClick={onOpenPlots}>
            Control each step
          </button>
          <button className="btn primary" type="button" onClick={onAutoRun}>
            Straight to the result
          </button>
        </div>
      </td>
    </tr>
  )
}

export default function ConvertAndAssign() {
  const addDataset = useApp((s) => s.addDataset)
  const datasets = useApp((s) => Object.values(s.datasets))
  const removeDataset = useApp((s) => s.removeDataset)
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

  const datasetsSorted = useMemo(() => {
    return [...datasets].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }, [datasets])

  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [assignedMappingByRun, setAssignedMappingByRun] = useState<Record<string, string>>({})
  const [savedInitSnap] = useState<Record<string, string>>(() => ({ ...datasetMapping }))
  const assignmentsFileInputRef = useRef<HTMLInputElement | null>(null)
  const globalImportInputRef = useRef<HTMLInputElement | null>(null)
  const [downloadBases, setDownloadBases] = useState<Record<string, string>>({})
  const [assignmentBases, setAssignmentBases] = useState<Record<string, string>>({})
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [fileFilter, setFileFilter] = useState<FileFilter>('all')
  const [showConvertHelp, setShowConvertHelp] = useState(false)
  const [showAssignHelp, setShowAssignHelp] = useState(false)
  const language = useApp((s) => s.language)
  const isPl = language === 'pl'
  const convertHelpRef = useRef<HTMLButtonElement | null>(null)
  const assignHelpRef = useRef<HTMLButtonElement | null>(null)

  const fileFilterAccept: Record<FileFilter, string> = {
    all: '*/*',
    csv: '.csv,text/csv',
    json: '.json,application/json',
    excel: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    common: '.csv,.json,.xlsx,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }

  const mappingsById = useMemo(() => {
    return Object.fromEntries(mappings.map((m) => [m.id, m])) as Record<string, Mapping>
  }, [mappings])

  const sanitizeBaseName = useCallback((raw: string, fallback: string) => {
    const trimmed = (raw || '').trim()
    const withoutExt = trimmed.replace(/(\.data\.converted)?\.(json|csv)$/i, '')
    const safe = (withoutExt || fallback).replace(/[^a-zA-Z0-9._-]+/g, '_')
    return safe.length ? safe : fallback
  }, [])

  const makeDefaultDownloadBase = useCallback((ds: UnifiedDataset) => {
    if (ds.sourceFile) {
      return ds.sourceFile.replace(/\.[^/.]+$/, '')
    }
    return `measurements-${ds.runId.slice(0, 6)}`
  }, [])

  const makeDefaultAssignmentBase = useCallback((ds: UnifiedDataset) => {
    const base = ds.sourceFile ? ds.sourceFile.replace(/\.[^/.]+$/, '') : ds.runId
    return `${base || 'assignment'}-assignment`
  }, [])

  useEffect(() => {
    setDownloadBases((prev) => {
      let changed = false
      const next = { ...prev }
      const runIds = new Set(datasets.map((d) => d.runId))
      for (const ds of datasets) {
        if (!next[ds.runId]) {
          next[ds.runId] = makeDefaultDownloadBase(ds)
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
  }, [datasets, makeDefaultDownloadBase])

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

  const appendPendingFiles = useCallback((files: FileList | File[]) => {
    if (!files || !files.length) return
    const incoming = Array.from(files)
    setPendingFiles((prev) => {
      const existingKeys = new Set(prev.map((file) => `${file.name}|${file.lastModified}`))
      if (!incoming.length) return prev
      let changed = false
      const next = [...prev]
      for (const file of incoming) {
        const key = `${file.name}|${file.lastModified}`
        if (existingKeys.has(key)) continue
        existingKeys.add(key)
        next.push(file)
        changed = true
      }
      return changed ? next : prev
    })
  }, [])

  const handleProcessFiles = useCallback(
    async (files: File[]) => {
      if (!files || !files.length) return
      setBusy(true)
      const parsers = getParsers()
      const newLog: string[] = []
      try {
        for (const file of files) {
          try {
            const isXlsx = file.name.toLowerCase().endsWith('.xlsx')
            const probeText = isXlsx ? '' : await file.text()
            const parser = pickParserFor(probeText, file.name) ?? parsers[0]
            newLog.push(`File: ${file.name} -> parser: ${parser.label}`)
            const content = isXlsx ? await file.arrayBuffer() : probeText
            const res = await parser.parse(content, file.name)
            if (res.ok) {
              addDataset(res.dataset)
              if (res.warnings?.length) {
                newLog.push(...res.warnings.map((w) => '[WARN] ' + w))
              }
            } else {
              newLog.push('[ERR] ' + res.error)
            }
          } catch (e: any) {
            newLog.push(`[ERR] ${file.name}: ${e?.message ?? String(e)}`)
          }
        }
      } finally {
        setLog((prev) => [...newLog, ...prev].slice(0, 200))
        setBusy(false)
      }
    },
    [addDataset]
  )

  const handleConvertPending = useCallback(async () => {
    if (!pendingFiles.length) {
      setLog((prev) => ['[INFO] No files queued for conversion', ...prev].slice(0, 200))
      return
    }
    try {
      await handleProcessFiles(pendingFiles)
    } finally {
      setPendingFiles([])
    }
  }, [handleProcessFiles, pendingFiles, setLog])

  const handleGlobalImport = useCallback(
    async (file: File) => {
      try {
        const result = await applyImportedFile(file)
        if (result.kind === 'assignments') {
          setAssignedMappingByRun((prev) => ({ ...prev, ...result.pairs }))
        }
        setLog((prev) => [`[OK] ${describeImportResult(result, file.name)}`, ...prev].slice(0, 200))
      } catch (e: any) {
        setLog((prev) => [`[ERR] ${file.name}: ${e?.message ?? String(e)}`, ...prev].slice(0, 200))
      }
    },
    [setLog, setAssignedMappingByRun]
  )

  const buildAssignmentsPayload = useCallback(
    (pairs: Record<string, string>) => buildAssignmentsPayloadUtil(datasets, pairs, mappingsById),
    [datasets, mappingsById]
  )

  const downloadAssignmentsPayload = useCallback(
    (payload: { version: number; createdAt: string; assignments: any[] }, baseName: string, extension: string) => {
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${baseName}${extension}`
      a.click()
      URL.revokeObjectURL(url)
    },
    []
  )

  const handleDownloadConverted = useCallback(
    (ds: UnifiedDataset) => {
      const baseRaw = downloadBases[ds.runId] ?? makeDefaultDownloadBase(ds)
      const sanitized = sanitizeBaseName(baseRaw, makeDefaultDownloadBase(ds))
      const mappingId =
        assignedMappingByRun[ds.runId] ?? datasetMapping[ds.runId] ?? savedInitSnap[ds.runId] ?? ''
      const mapping = mappingId ? mappingsById[mappingId] : undefined
      const filename = `${sanitized}.data.converted.csv`
      if (mapping) {
        downloadCSV(filename, toAssignedMeasurementsCSVRows(ds, mapping.assignments))
      } else {
        downloadCSV(filename, toMeasurementsCSVRows(ds))
      }
      setLog((prev) => [`[FILE] ${ds.sourceFile ?? ds.runId} -> ${filename}`, ...prev].slice(0, 200))
    },
    [assignedMappingByRun, datasetMapping, downloadBases, makeDefaultDownloadBase, mappingsById, sanitizeBaseName, savedInitSnap]
  )

  const handleDownloadAllConverted = useCallback(() => {
    if (!datasetsSorted.length) {
      setLog((prev) => ['[INFO] No converted datasets to download', ...prev].slice(0, 200))
      return
    }
    datasetsSorted.forEach((ds) => handleDownloadConverted(ds))
  }, [datasetsSorted, handleDownloadConverted])

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
      downloadAssignmentsPayload(payload, baseName, '.assignment.json')
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
      downloadAssignmentsPayload(payload, baseName, '.assignment.json')
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
  }, [assignmentBases, assignedMappingByRun, buildAssignmentsPayload, datasetMapping, datasetsSorted, downloadAssignmentsPayload, makeDefaultAssignmentBase, sanitizeBaseName, savedInitSnap, setActiveTab, setDatasetMappings, setLog, setPlotsSelectedRunId])

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
    },
    [setActiveTab, setPlotsSelectedRunId]
  )

  const handleAutoRun = useCallback(
    (ds: UnifiedDataset, mappingId: string) => {
      if (!mappingId) {
        setLog((prev) =>
          [`[WARN] Select a mapping before fast-tracking ${ds.sourceFile ?? ds.runId}.`, ...prev].slice(0, 200)
        )
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
      setLog((prev) =>
        [`[AUTO] Fast-track analysis queued for ${ds.sourceFile ?? ds.runId}.`, ...prev].slice(0, 200)
      )
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

  const handleImportAssignmentsJSON = useCallback(
    (file: File) => {
      void handleGlobalImport(file)
    },
    [handleGlobalImport]
  )

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(false)
      const items = e.dataTransfer?.files
      if (items && items.length) {
        appendPendingFiles(items)
      }
    },
    [appendPendingFiles]
  )

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }, [])

  return (
    <div className="setup-grid">
      <div className="panel panel-landing full-span">
        <div className="panel-heading with-help">
          <div>
            <h3>6. {isPl ? 'Konwersja plików pomiarowych' : 'Convert measurement files'}</h3>
            <p className="small">
              {isPl
                ? 'Upuść lub wybierz pliki pomiarowe i zamień je na uporządkowane CSV gotowe do mapowania.'
                : 'Drop or select raw measurement exports and convert them into tidy CSV ready for mapping.'}
            </p>
          </div>
          <button
            ref={convertHelpRef}
            className="help-btn"
            type="button"
            onClick={() => setShowConvertHelp((v) => !v)}
          >
            ?
          </button>
        </div>
        <HelpTooltip anchorRef={convertHelpRef} open={showConvertHelp}>
          {isPl
            ? 'Obsługuje CSV, JSON i XLSX. Upuść pliki lub wybierz je z dysku, a następnie kliknij konwersję. Dane zostaną uporządkowane do formatu well / time / value.'
            : 'Supports CSV, JSON, and XLSX. Drop files or pick them, then convert. Data will be normalized to well / time / value.'}
        </HelpTooltip>

        <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="small">{isPl ? 'Filtr plików:' : 'File filter:'}</label>
          <select value={fileFilter} onChange={(e) => setFileFilter(e.target.value as typeof fileFilter)}>
            <option value="all">{isPl ? 'Wszystkie pliki' : 'All files'}</option>
            <option value="common">CSV / JSON / Excel</option>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
            <option value="excel">Excel (.xlsx)</option>
          </select>
        </div>

        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          className="dropzone"
          style={{
            border: '2px dashed #7ea0d8',
            borderRadius: 14,
            padding: 24,
            textAlign: 'center',
            background: dragOver ? 'rgba(124, 149, 196, 0.08)' : 'rgba(255,255,255,0.7)',
            marginTop: 12,
            transition: 'all 0.2s ease',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ marginBottom: 8, fontWeight: 600 }}>
            {busy
              ? isPl ? 'Przetwarzanie plików...' : 'Processing files...'
              : isPl ? 'Upuść pliki lub wybierz je poniżej, potem konwertuj' : 'Drop files or pick them below, then convert'}
          </div>
          <input
            type="file"
            multiple
            accept={fileFilterAccept[fileFilter]}
            onChange={(e) => {
              const files = e.target.files
              if (files && files.length) appendPendingFiles(files)
              e.currentTarget.value = ''
            }}
          />
          {pendingFiles.length > 0 && (
            <div style={{ marginTop: 12, textAlign: 'left' }}>
              <div style={{ fontWeight: 600 }}>{isPl ? 'Pliki gotowe do konwersji' : 'Files ready for conversion'}</div>
              <ul style={{ marginTop: 4, paddingLeft: 16 }}>
                {pendingFiles.map((file) => (
                  <li key={`${file.name}-${file.lastModified}`}>{file.name}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div
          className="row"
          style={{ marginTop: 12, gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
        >
          <button
            className="btn primary"
            type="button"
            onClick={() => void handleConvertPending()}
            disabled={busy || pendingFiles.length === 0}
          >
            {isPl ? 'Kontynuuj – konwertuj dane' : 'Continue - convert the data'}
          </button>
          <div className="badge">{busy ? (isPl ? 'Praca' : 'Busy') : (isPl ? 'Gotowe' : 'Ready')}</div>
          {pendingFiles.length > 0 && (
            <div className="small">
              {isPl ? `${pendingFiles.length} plik(i) w kolejce` : `${pendingFiles.length} file(s) queued`}
            </div>
          )}
        </div>
      </div>

      <div className="panel panel-soft full-span">
        <div className="panel-heading with-help">
          <div>
            <h3>7. {isPl ? 'Przypisz mapowania do plików' : 'Assign mappings to files'}</h3>
            <p className="small">
              {isPl
                ? 'Połącz każdy skonwertowany plik z mapowaniem, pobierz assignment i przejdź do wykresów.'
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
            ? 'Wybierz mapowanie dla każdej konwertowanej próbki. Możesz pobrać pojedynczy plik assignment albo wszystkie naraz i od razu przejść do modułu Plots.'
            : 'Select a mapping for each converted dataset. Download a single assignment file or all at once and jump to Plots.'}
        </HelpTooltip>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <button
            className="btn primary"
            type="button"
            onClick={handleSaveAllAssignmentFiles}
            disabled={busy || datasetsSorted.length === 0}
          >
            {isPl ? 'Pobierz wszystkie assignmenty' : 'Download all assignments'}
          </button>
          <div className="badge">{busy ? (isPl ? 'Praca' : 'Busy') : (isPl ? 'Gotowe' : 'Ready')}</div>
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
                  onAssignmentNameChange={(value) =>
                    setAssignmentBases((prev) => ({ ...prev, [ds.runId]: value }))
                  }
                  onChangeMapping={(id) => handleSelectMapping(ds.runId, id)}
                  onAssign={() => handleAssignSingle(ds, mappingId)}
                  onOpenPlots={() => handleOpenPlots(ds.runId)}
                  onAutoRun={() => handleAutoRun(ds, mappingId)}
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
    </div>
  )
}
