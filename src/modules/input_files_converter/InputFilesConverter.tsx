import { useState } from 'react'
import { useApp } from '@/state/store'
import { getParsers, pickParserFor } from './index'
import type { UnifiedDataset } from '@/types'

function FileRow({ds, onRemove}:{ds: UnifiedDataset, onRemove:()=>void}){
  return (
    <tr>
      <td>{new Date(ds.createdAt).toLocaleString()}</td>
      <td>{ds.sourceFile}</td>
      <td>{ds.measurementType}</td>
      <td>{ds.rows.length}</td>
      <td>{ds.parserId}</td>
      <td><button className="btn danger" onClick={onRemove}>Remove</button></td>
    </tr>
  )
}

export default function InputFilesConverter(){
  const addDataset = useApp(s=>s.addDataset)
  const datasets = useApp(s=>Object.values(s.datasets))
  const removeDataset = useApp(s=>s.removeDataset)

  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function handleFiles(files: FileList | null){
    if (!files || !files.length) return
    setBusy(true)
    const parsers = getParsers()
    const newLog: string[] = []
    for (const file of Array.from(files)) {
      const text = await file.text()
      const parser = pickParserFor(text, file.name) ?? parsers[0]
      newLog.push(`File: ${file.name} -> parser: ${parser.label}`)
      const res = await parser.parse(text, file.name)
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
