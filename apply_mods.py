from pathlib import Path

path = Path('src/modules/plots_viewer/PlotsViewer.tsx')
text = path.read_text().replace('\r\n', '\n')

old_import = "import { useEffect, useMemo, useState } from 'react'"
if old_import not in text:
    raise SystemExit('import line not found')
text = text.replace(old_import, "import { useEffect, useMemo, useState, useCallback } from 'react'", 1)

import_colors = "import { hexToHsl, hslToHex, withAlpha } from '@/utils/colors'\n"
type_block = """type LegendPlacement = 'below' | 'right' | 'inside'
type LegendItem = { key: string, label: string, color: string, seriesName: string }
type LegendGroup = { sample: string, baseColor: string, items: LegendItem[] }

"""
if import_colors not in text:
    raise SystemExit('color import not found')
text = text.replace(import_colors, import_colors + type_block, 1)

sample_marker = "  const sampleNames = Object.keys(sampleReplicates)"
idx = text.find(sample_marker)
if idx == -1:
    raise SystemExit('sampleNames marker not found')
legend_insert = """

  const legendGroups = useMemo(() => {
    return sampleNames.map((sname) => {
      const reps = sampleReplicates[sname] || []
      if (!reps.length) return null
      const baseColor = selectedMapping.sampleColors?.[sname] ?? '#60a5fa'
      return {
        sample: sname,
        baseColor,
        items: reps.map((r) => ({
          key: `${sname}|${r.replicate}`,
          label: `r${r.replicate} (${r.well})`,
          color: varyReplicateColor(baseColor, r.replicate),
          seriesName: `${sname} r${r.replicate}`,
        })),
      }
    }).filter((g): g is LegendGroup => !!g)
  }, [sampleNames, sampleReplicates, selectedMapping?.sampleColors])

  const seriesKeyByName = useMemo(() => {
    const map = new Map<string, string>()
    legendGroups.forEach((group) => {
      group.items.forEach((item) => {
        map.set(item.seriesName, item.key)
      })
    })
    return map
  }, [legendGroups])

  const legendPlacementOptions: { value: LegendPlacement; label: string }[] = [
    { value: 'below', label: 'Below' },
    { value: 'right', label: 'Side' },
    { value: 'inside', label: 'Inside' },
  ]
"""
text = text[:idx + len(sample_marker)] + legend_insert + text[idx + len(sample_marker):]

current_sample_marker = "  const currentSample = sampleNames[sampleIndex]"
idx = text.find(current_sample_marker)
if idx == -1:
    raise SystemExit('currentSample marker not found')
state_insert = """
  const [highlighted, setHighlighted] = useState<string[]>([])
  const [legendPlacement, setLegendPlacement] = useState<LegendPlacement>('below')
"""
text = text[:idx + len(current_sample_marker)] + state_insert + text[idx + len(current_sample_marker):]

per_sample_end = "  }, [selectedDataset?.runId, selectedMapping?.id, currentSample, sampleReplicates[currentSample]?.map(x=>x.well).join('\\u0001')])"
idx = text.find(per_sample_end)
if idx == -1:
    raise SystemExit('perSampleSeries end not found')
logic_insert = """

  const toggleLegendKey = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      let next: string[]
      if (prev.includes(key)) {
        next = prev.filter((k) => k !== key)
      } else {
        const set = new Set([...prev, key])
        next = allKeys.filter((k) => set.has(k))
      }
      setHighlighted((current) => current.filter((name) => {
        const mapped = seriesKeyByName.get(name)
        return not mapped or next.includes(mapped)
      }))
      return next
    })
  }, [allKeys, seriesKeyByName])

  const handleToggleAll = useCallback(() => {
    setSelectedKeys((prev) => {
      if (prev.length == len(allKeys)) {
        setHighlighted([])
        return []
      }
      setHighlighted([])
      return allKeys
    })
  }, [allKeys])

  useEffect(() => {
    setHighlighted((prev) => prev.filter((name) => {
      const mapped = seriesKeyByName.get(name)
      return not mapped or selectedKeys.includes(mapped)
    }))
  }, [selectedKeys, seriesKeyByName])

  useEffect(() => {
    setHighlighted([])
  }, [selectedDataset?.runId, selectedMapping?.id])
"""
logic_insert = logic_insert.replace('not ', 'not ').replace('len(', 'len(')
text = text[:idx + len(per_sample_end)] + logic_insert + text[idx + len(per_sample_end):]

return_idx = text.find("  return (")
if return_idx == -1:
    raise SystemExit('return marker not found')
render_insert = """
  function renderLegend(placement: LegendPlacement){
    if (!legendGroups.length) return null
    const groupNodes = legendGroups.map((group) => {
      return (
        <div key={group.sample} style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ width:12, height:12, background: withAlpha(group.baseColor, 0.9) }} />
            <strong>{group.sample}</strong>
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {group.items.map((item) => {
              const active = selectedKeys.includes(item.key)
              const highlightedMatch = highlighted.includes(item.seriesName)
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => toggleLegendKey(item.key)}
                  onMouseEnter={() => active && setHighlighted([item.seriesName])}
                  onFocus={() => active && setHighlighted([item.seriesName])}
                  onMouseLeave={() => setHighlighted([])}
                  onBlur={() => setHighlighted([])}
                  aria-pressed={active}
                  style={{
                    display:'inline-flex',
                    alignItems:'center',
                    gap:6,
                    padding:'2px 7px',
                    borderRadius:6,
                    border:`1px solid ${highlightedMatch ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.22)'}`,
                    background: active ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.7)',
                    opacity: active ? 1 : 0.4,
                    cursor:'pointer',
                    fontSize:'11px',
                  }}
                >
                  <span style={{ width:12, height:12, borderRadius:3, background:item.color }} />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )
    })
    if (placement === 'below') {
      return (
        <div style={{ display:'grid', gridTemplateColumns:`repeat(auto-fit, minmax(220px, 1fr))`, gap:10 }}>
          {groupNodes}
        </div>
      )
    }
    const containerStyle = placement === 'inside'
      ? { maxHeight:'60%', overflowY:'auto', background:'rgba(255,255,255,0.92)', border:'1px solid rgba(0,0,0,0.12)', borderRadius:8, padding:8 }
      : { display:'flex', flexDirection:'column', gap:8 }
    return (
      <div style={containerStyle}>
        {groupNodes}
      </div>
    )
  }

"""
text = text[:return_idx] + render_insert + text[return_idx:]

old_block_start = "          {/* Selection + Combined */}"
old_block_end = "          {/* Per-sample navigator */}"
start = text.find(old_block_start)
end = text.find(old_block_end, start)
if start == -1 or end == -1:
    raise SystemExit('selection section markers not found')
new_combined = """          {/* Combined */}
          <div className="panel" style={{ marginTop: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn" onClick={()=> setFontScale(s=>Math.max(0.6, +(s-0.1).toFixed(1)))} title="Smaller text">A-</button>
                <button className="btn" onClick={()=> setFontScale(s=>Math.min(2.0, +(s+0.1).toFixed(1)))} title="Larger text">A+</button>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <div className="col"><label>Chart title</label><input value={title} onChange={e=>setTitle(e.target.value)} /></div>
                <div className="col"><label>X axis</label><input value={xLabel} onChange={e=>setXLabel(e.target.value)} /></div>
                <div className="col"><label>Y axis</label><input value={yLabel} onChange={e=>setYLabel(e.target.value)} /></div>
              </div>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="small">Legend placement:</span>
              {legendPlacementOptions.map((option)=>{
                const active = option.value === legendPlacement
                return (
                  <button
                    key={option.value}
                    type="button"
                    className="btn"
                    onClick={()=> setLegendPlacement(option.value)}
                    aria-pressed={active}
                    style={active ? { fontWeight: 600 } : undefined}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={legendPlacement === 'right' ? { display:'flex', gap:12, alignItems:'stretch', flexWrap:'wrap' } : undefined}>
                <div style={legendPlacement === 'right' ? { flex:'1 1 0', minWidth:320, position:'relative' } : { position:'relative' }}>
                  <SimpleLineChart
                    series={combinedSeries}
                    title={title}
                    xLabel={xLabel}
                    yLabel={yLabel}
                    height={360}
                    fontScale={fontScale}
                    legendMode="none"
                    highlightedNames={highlighted}
                  />
                  {legendPlacement === 'inside' && (
                    <div style={{ position:'absolute', top:16, right:16, maxWidth:'40%', minWidth:180 }}>
                      {renderLegend('inside')}
                    </div>
                  )}
                </div>
                {legendPlacement === 'right' && (
                  <div style={{ flex:'0 0 260px', maxWidth:'35%', minWidth:200 }}>
                    {renderLegend('right')}
                  </div>
                )}
              </div>
              {legendPlacement === 'below' && (
                <div style={{ marginTop: 10 }}>
                  {renderLegend('below')}
                </div>
              )}
            </div>
            <div className="row" style={{ justifyContent:'space-between', marginTop:8, gap:8, flexWrap:'wrap', alignItems:'center' }}>
              <button className="btn" onClick={handleToggleAll} disabled={!allKeys.length}>Select/Deselect All</button>
            </div>
          </div>
"""
text = text[:start] + new_combined + text[end:]

text = text.replace('\n', '\r\n')
path.write_text(text)
