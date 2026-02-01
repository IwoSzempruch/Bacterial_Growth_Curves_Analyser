import { useCallback, useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useApp } from '@/state/store'
import type { UnifiedDataset } from '@/types'
import { downloadCSV, toMeasurementsCSVRows, formatWellA01 } from '@/utils/csv'

function sanitizeBaseName(raw: string, fallback: string) {
  const trimmed = (raw || '').trim()
  const withoutExt = trimmed.replace(/(\.data\.converted)?\.(json|csv)$/i, '')
  const safe = (withoutExt || fallback).replace(/[^a-zA-Z0-9._-]+/g, '_')
  return safe.length ? safe : fallback
}

function defaultBase(ds: UnifiedDataset) {
  return ds.sourceFile ? ds.sourceFile.replace(/\.[^/.]+$/, '') : `dataset-${ds.runId.slice(0, 6)}`
}

function buildAssignmentLikeRows(ds: UnifiedDataset) {
  const rowMap = new Map<string, any>()
  ds.rows.forEach((row) => {
    if (!Number.isFinite(row?.timeSeconds) || !Number.isFinite(row?.value)) return
    const well = formatWellA01(row.well)
    if (!well) return
    const time_min = +(row.timeSeconds / 60).toFixed(6)
    const key = `${well}|${time_min}`
    const measurementKey = `val_${String(row?.measurementType || ds.measurementType || 'value').toLowerCase()}`
    const entry = rowMap.get(key) ?? { well, time_min }
    entry[measurementKey] = row.value
    rowMap.set(key, entry)
  })
  return Array.from(rowMap.values()).sort((a, b) => {
    const cmp = String(a.well).localeCompare(String(b.well), undefined, { numeric: true })
    return cmp !== 0 ? cmp : a.time_min - b.time_min
  })
}

function DatasetRow({
  ds,
  baseName,
  onBaseChange,
  onDownloadJson,
  onDownloadCsv,
}: {
  ds: UnifiedDataset
  baseName: string
  onBaseChange: (v: string) => void
  onDownloadJson: () => void
  onDownloadCsv: () => void
}) {
  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onDownloadJson()
    }
  }
  return (
    <tr>
      <td>{ds.sourceFile || ds.runId}</td>
      <td>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={baseName}
            onChange={(e) => onBaseChange(e.target.value)}
            onKeyDown={handleKey}
            style={{ border: '1px solid rgba(0,0,0,.18)', borderRadius: 4, padding: '2px 6px', minWidth: 160 }}
            aria-label="Base filename"
            placeholder="dataset"
          />
          <span className="small">.data.json / .data.converted.csv</span>
        </div>
      </td>
      <td>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn basic-btn" type="button" onClick={onDownloadJson}>
            JSON
          </button>
          <button className="btn basic-btn" type="button" onClick={onDownloadCsv}>
            CSV
          </button>
        </div>
      </td>
    </tr>
  )
}

export default function ExportDataPanel() {
  const datasets = useApp((s) => Object.values(s.datasets))
  const language = useApp((s) => s.language)
  const isPl = language === 'pl'
  const [bases, setBases] = useState<Record<string, string>>({})

  const datasetsSorted = useMemo(
    () => [...datasets].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [datasets]
  )

  const downloadDatasetJson = useCallback(
    (ds: UnifiedDataset) => {
      const base = sanitizeBaseName(bases[ds.runId] ?? defaultBase(ds), defaultBase(ds))
      const rows = buildAssignmentLikeRows(ds)
      const { rows: _rows, ...meta } = ds
      const payload = { meta, rows }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${base}.data.json`
      a.click()
      URL.revokeObjectURL(url)
    },
    [bases]
  )

  const downloadConvertedCsv = useCallback(
    (ds: UnifiedDataset) => {
      const base = sanitizeBaseName(bases[ds.runId] ?? defaultBase(ds), defaultBase(ds))
      const filename = `${base}.data.converted.csv`
      downloadCSV(filename, toMeasurementsCSVRows(ds))
    },
    [bases]
  )

  return (
    <div className="panel panel-soft full-span">
      <div className="panel-heading with-help">
        <div>
          <h3> {isPl ? 'Eksportuj dane' : 'Export data'}</h3>
          <p className="small">
            {isPl ? (
              <>
                Możesz pobrać na swoje urządzenie plik z danymi przekonwertowany na format, na którym pracuje program
                (.json) lub w formacie .csv. <strong>Ten krok jest opcjonalny.</strong>
              </>
            ) : (
              <>
                You can download the converted data file (.json) or in .csv format to your device.{' '}
                <strong>This step is optional.</strong>
              </>
            )}
          </p>
        </div>
      </div>

      <table className="table" style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>{isPl ? 'Plik' : 'File'}</th>
            <th>{isPl ? 'Nazwa wyjściowa' : 'Output name'}</th>
            <th>{isPl ? 'Akcje' : 'Actions'}</th>
          </tr>
        </thead>
        <tbody>
          {datasetsSorted.map((ds) => (
            <DatasetRow
              key={ds.runId}
              ds={ds}
              baseName={bases[ds.runId] ?? defaultBase(ds)}
              onBaseChange={(v) => setBases((prev) => ({ ...prev, [ds.runId]: v }))}
              onDownloadJson={() => downloadDatasetJson(ds)}
              onDownloadCsv={() => downloadConvertedCsv(ds)}
            />
          ))}
          {datasetsSorted.length === 0 && (
            <tr>
              <td colSpan={3}>
                <div className="small">
                  {isPl ? 'Brak danych. Najpierw zaimportuj plik w panelu 0 lub 1.' : 'No data. Import a file in panel 0 or 1 first.'}
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
