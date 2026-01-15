import { useState } from 'react'
import { useApp } from '@/state/store'
import { getParsers, pickParserFor } from './index'
import { downloadCSV, toMeasurementsCSVRows } from '@/utils/csv'
import type { UnifiedDataset } from '@/types'
import { reportUnknownFile } from '@/utils/unknownReporter'

function FileRow({ds, onRemove}:{ds: UnifiedDataset, onRemove:()=>void}){
  return (
    <tr>
      <td>{new Date(ds.createdAt).toLocaleString()}</td>
      <td>{ds.sourceFile}</td>
      <td>{ds.measurementType}</td>
      <td>{ds.rows.length}</td>
      <td>{ds.parserId}</td>
      <td>
        <button className="btn" onClick={()=>downloadCSV('measurements.data.converted.csv', toMeasurementsCSVRows(ds))}>Download measurements.data.converted.csv</button>
        <button className="btn danger" style={{marginLeft:8}} onClick={onRemove}>Remove</button>
      </td>
    </tr>
  )
}

export default function InputFilesConverter(){
  const addDataset = useApp(s=>s.addDataset)
  const datasets = useApp(s=>Object.values(s.datasets))
  const removeDataset = useApp(s=>s.removeDataset)

  const hasReporterEndpoint = Boolean(import.meta.env.VITE_UNKNOWN_FILE_ENDPOINT)

  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function handleFiles(files: FileList | null){
    if (!files || !files.length) return
    setBusy(true)
    const parsers = getParsers()
    const newLog: string[] = []
    for (const file of Array.from(files)) {
      const isXlsx = file.name.toLowerCase().endsWith('.xlsx')
      const probeText = isXlsx ? '' : await file.text()
      const parser = pickParserFor(probeText, file.name)
      if (!parser) {
        const consent = window.confirm(
          `Brak obsługi tego formatu.\n\n` +
          `Plik: ${file.name} (${file.type || 'unknown'}, ${file.size} B)\n\n` +
          (hasReporterEndpoint
            ? `Możesz wysłać plik, aby dodać obsługę formatu.\n`
            : `Tryb lokalny: brak skonfigurowanego endpointu wysyłki, plik nie zostanie przesłany.\n`) +
          `Jeśli dane są wrażliwe, utwórz plik w tym samym formacie z danymi fikcyjnymi i wgraj go zamiast oryginału.\n\n` +
          `Czy chcesz kontynuować?`
        )
        if (consent) {
          if (hasReporterEndpoint) {
            newLog.push(`File: ${file.name} -> unknown format, wysyłka zgłoszenia...`)
            try {
              const res = await reportUnknownFile(file, {
                source: 'input-files-converter',
                message: 'Auto-report: unsupported input format',
              })
              if (res.issueUrl || res.pullRequestUrl) {
                newLog.push(`Zgłoszenie utworzone: ${res.issueUrl || res.pullRequestUrl}`)
              } else {
                newLog.push('Zgłoszenie wysłane (brak URL w odpowiedzi).')
              }
            } catch (err: any) {
              newLog.push(`[ERR] Nie udało się wysłać pliku: ${err?.message || err}`)
            }
          } else {
            newLog.push(`File: ${file.name} -> unknown format, tryb lokalny (brak wysyłki).`)
          }
        } else {
          newLog.push(`File: ${file.name} -> unknown format, użytkownik anulował wysyłkę.`)
        }
        continue
      }
      newLog.push(`File: ${file.name} -> parser: ${parser.label}`)
      const content = isXlsx ? await file.arrayBuffer() : probeText
      const res = await parser.parse(content, file.name)
      if (res.ok) {
        addDataset(res.dataset)
        if (res.warnings?.length) newLog.push(...res.warnings.map(w=>'[WARN] '+w))
      } else {
        newLog.push('[ERR] ' + res.error)
      }
    }
    setLog(prev=>[...newLog, ...prev].slice(0,200))
    setBusy(false)
  }

  return (
    <div className="panel">
      <h2>Input Files Converter</h2>
      <div className="small">Load data files. The system will automatically choose a parser (you can extend the registry with new formats).</div>
      <div className="row">
        <input type="file" multiple onChange={e=>handleFiles(e.target.files)} />
        <div className="badge">{busy ? 'Przetwarzanie...' : 'Gotowy'}</div>
        <div className="badge">{busy ? 'Processing...' : 'Ready'}</div>
      </div>

      <div className="panel" style={{marginTop:12}}>
        <strong>Converted Files ({datasets.length})</strong>
        <table className="table" style={{marginTop:8}}>
          <thead><tr><th>Created</th><th>File</th><th>Measurement Type</th><th># Rows</th><th>Parser</th><th>Actions</th></tr></thead>
          <tbody>
            {datasets.map(ds=>(
              <FileRow key={ds.runId} ds={ds} onRemove={()=>removeDataset(ds.runId)} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel" style={{marginTop:12}}>
        <strong>Log</strong>
        <pre style={{whiteSpace:'pre-wrap'}}>{log.join('\n')}</pre>
      </div>
    </div>
  )
}
