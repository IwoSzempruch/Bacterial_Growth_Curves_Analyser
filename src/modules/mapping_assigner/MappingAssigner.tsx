import { useMemo, useState } from 'react'
import { useApp } from '@/state/store'
import { downloadCSV, toAssignedCSVRows } from '@/utils/csv'

export default function MappingAssigner(){
  const datasets = useApp(s=>Object.values(s.datasets))
  const mappings = useApp(s=>Object.values(s.mappings))
  const [selectedRunId, setSelectedRunId] = useState<string>('')
  const [selectedMappingId, setSelectedMappingId] = useState<string>('')

  const dataset = useMemo(()=> datasets.find(d=>d.runId===selectedRunId) ?? null, [datasets, selectedRunId])
  const mapping = useMemo(()=> mappings.find(m=>m.id===selectedMappingId) ?? null, [mappings, selectedMappingId])

  const preview = useMemo(()=>{
    if (!dataset || !mapping) return []
    return toAssignedCSVRows(dataset, mapping.assignments).slice(0, 12*5) // show first 5 time points x 12 wells
  }, [dataset, mapping])

  function exportAssigned(){
    if (!dataset || !mapping) return
    const rows = toAssignedCSVRows(dataset, mapping.assignments)
    downloadCSV(`${dataset.sourceFile}.assigned.csv`, rows)
  }

  return (
    <div className="panel">
      <h2>Mapping Assigner</h2>
      <div className="row">
        <div className="col" style={{flex:1}}>
          <label>Select Dataset</label>
          <select value={selectedRunId} onChange={e=>setSelectedRunId(e.target.value)}>
            <option value="">(select)</option>
            {datasets.map(d=>(
              <option key={d.runId} value={d.runId}>{d.sourceFile} — {d.measurementType} — {d.rows.length} rows</option>
            ))}
          </select>
        </div>
        <div className="col" style={{flex:1}}>
          <label>Select Mapping</label>
          <select value={selectedMappingId} onChange={e=>setSelectedMappingId(e.target.value)}>
            <option value="">(select)</option>
            {mappings.map(m=>(
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="panel" style={{marginTop:12}}>
        <strong>Preview (fragment)</strong>
        {(!dataset || !mapping) && <div className="small">Select dataset and mapping to see preview.</div>}
        {(dataset && mapping) && (
          <>
            <div className="small">File: <b>{dataset.sourceFile}</b> | Mapping: <b>{mapping.name}</b></div>
            <table className="table" style={{marginTop:8}}>
              <thead><tr>
                <th>runId</th><th>plateId</th><th>sourceFile</th><th>timeSeconds</th><th>timeLabel</th><th>well</th><th>measurementType</th><th>value</th><th>sampleName</th>
              </tr></thead>
              <tbody>
                {preview.map((r,i)=>(
                  <tr key={i}>
                    <td>{r.runId}</td><td>{r.plateId}</td><td>{r.sourceFile}</td>
                    <td>{r.timeSeconds}</td><td>{r.timeLabel}</td><td>{r.well}</td>
                    <td>{r.measurementType}</td><td>{r.value}</td><td>{r.sampleName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{marginTop:8}}>
              <button className="btn primary" onClick={exportAssigned}>Export Complete Data as CSV</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
