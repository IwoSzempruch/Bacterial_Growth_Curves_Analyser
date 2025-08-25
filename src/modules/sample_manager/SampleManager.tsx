import { useState } from 'react'
import { useApp } from '@/state/store'

function normalizeInput(text: string): string[] {
  const lines = text.replace(/\r/g,'').split(/\n|,|;|\t/).map(s=>s.trim()).filter(Boolean)
  // dedupe, keep order
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of lines) {
    if (!seen.has(s)) { seen.add(s); out.push(s) }
  }
  return out
}

export default function SampleManager(){
  const [raw, setRaw] = useState('')
  const sampleLists = useApp(s=>s.sampleLists)
  const activeName = useApp(s=>s.activeSampleListName)
  const createList = useApp(s=>s.createSampleList)
  const updateList = useApp(s=>s.updateSampleList)
  const setActive = useApp(s=>s.setActiveSampleList)
  const deleteList = useApp(s=>s.deleteSampleList)

  const active = activeName ? sampleLists[activeName] : null
  const [newListName, setNewListName] = useState(activeName ?? 'Default')

  const parsed = normalizeInput(raw)

  return (
    <div className="panel">
      <h2>Sample Manager</h2>
      <div className="small">Paste a list of sample names (each on a new line or separated by commas/semicolons/tabs).</div>
      <div className="row">
        <div className="col" style={{flex:1}}>
          <textarea value={raw} onChange={e=>setRaw(e.target.value)} placeholder="Sample_1\nSample_2\n..."/>
          <div className="row">
            <input type="text" value={newListName} onChange={e=>setNewListName(e.target.value)} placeholder="List name (e.g. 'Experiment-1')"/>
            <button className="btn primary" onClick={()=>{
              if (!newListName.trim()) return
              createList(newListName.trim(), parsed)
            }}>Save as New List</button>
          </div>
          <div className="small">A list with the given name will be created and set as active.</div>
        </div>

        <div className="col" style={{flex:1}}>
          <div className="panel" style={{padding:'12px'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <strong>Active Sample List</strong>
              <select value={activeName ?? ''} onChange={e=>setActive(e.target.value||null)}>
                <option value="">(none)</option>
                {Object.values(sampleLists).map(l=>(
                  <option key={l.name} value={l.name}>{l.name}</option>
                ))}
              </select>
            </div>
            <div className="small">Left: {parsed.length} items found. Below: {active?.items.length ?? 0} in active list.</div>
            <div style={{maxHeight: 240, overflow:'auto', border:'1px solid rgba(255,255,255,.06)', borderRadius:8, padding:8, marginTop:8}}>
              <ol>
                {(active?.items ?? []).map((s,i)=>(<li key={i}>{s}</li>))}
              </ol>
            </div>
            <div className="row" style={{marginTop:8}}>
              <button className="btn success" onClick={()=>{ if(active) updateList(active.name, parsed)}} disabled={!active}>Update Active List</button>
              <button className="btn" onClick={()=>setActive(null)} disabled={!active}>Deselect</button>
              <button className="btn danger" onClick={()=>active&&deleteList(active.name)} disabled={!active}>Delete List</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
