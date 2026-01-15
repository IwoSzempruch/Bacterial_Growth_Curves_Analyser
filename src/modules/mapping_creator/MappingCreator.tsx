import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useApp } from '@/state/store'
import { ROWS, COLS, wellKey, WELLS } from '@/utils/plate'
import type { Mapping } from '@/types'
import { formatWellA01 } from '@/utils/csv'
import { withAlpha } from '@/utils/colors'

function normalizeInput(text: string): string[] {
  const lines = text
    .replace(/\r/g, '')
    .split(/\n|,|;|\t/)
    .map((s) => s.trim())
    .filter(Boolean)
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of lines) {
    if (!seen.has(s)) {
      seen.add(s)
      out.push(s)
    }
  }
  return out
}

export default function MappingCreator() {
  const sampleLists = useApp((s) => s.sampleLists)
  const activeSampleListName = useApp((s) => s.activeSampleListName)
  const createMapping = useApp((s) => s.createMapping)
  const mappings = useApp((s) => s.mappings)
  const activeMappingId = useApp((s) => s.activeMappingId)
  const setActiveMapping = useApp((s) => s.setActiveMapping)
  const updateAssignments = useApp((s) => s.updateMappingAssignments)
  const renameMapping = useApp((s) => s.renameMapping)
  const deleteMapping = useApp((s) => s.deleteMapping)
  const createList = useApp((s) => s.createSampleList)
  const updateList = useApp((s) => s.updateSampleList)
  const setActiveSampleList = useApp((s) => s.setActiveSampleList)
  const setMappingSamples = useApp((s) => s.setMappingSamples)
  const duplicateMapping = useApp((s) => s.duplicateMapping)

  const setSampleColor = useApp((s) => s.setSampleColor)
  const setSampleSaturation = useApp((s) => s.setSampleSaturation)
  const randomizeSampleColors = useApp((s) => s.randomizeSampleColors)
  const language = useApp((s) => s.language)
  const isPl = language === 'pl'

  const activeList = activeSampleListName ? sampleLists[activeSampleListName] : null

  const [cursor, setCursor] = useState(0)
  const [raw, setRaw] = useState<string>(() => activeList?.items.join('\n') ?? '')
  const mapping: Mapping | null = activeMappingId ? mappings[activeMappingId] : null
  const assignments = mapping?.assignments ?? {}
  const samples = mapping?.samples ?? []
  const displaySamples = samples.length ? samples : activeList?.items ?? []
  const sampleColors = mapping?.sampleColors ?? {}
  const sampleSaturations = mapping?.sampleSaturations ?? {}
  const parsed = useMemo(() => normalizeInput(raw), [raw])
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [help, setHelp] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setCursor(0)
  }, [activeMappingId])

  useEffect(() => {
    if (
      mapping &&
      (!mapping.sampleColors ||
        Object.keys(mapping.sampleColors).length !== mapping.samples.length ||
        !mapping.sampleSaturations ||
        Object.keys(mapping.sampleSaturations).length !== mapping.samples.length)
    ) {
      randomizeSampleColors(mapping.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping?.id])

  useEffect(() => {
    const CUR = '_Current'
    if (!sampleLists[CUR]) {
      createList(CUR, parsed)
    } else {
      updateList(CUR, parsed)
    }
    if (activeSampleListName !== CUR) setActiveSampleList(CUR)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.join('\u0001')])

  useEffect(() => {
    if (parsed.length === 0) return
    if (!activeMappingId) {
      const id = createMapping(`Mapping: ${activeList?.name ?? '_Current'}`, parsed)
      setActiveMapping(id)
      return
    }
    const current = mappings[activeMappingId]
    if (!current) return
    if (current.samples.join('\u0001') !== parsed.join('\u0001')) {
      setMappingSamples(current.id, parsed)
    }
  }, [activeList?.name, activeMappingId, parsed, createMapping, mappings, setActiveMapping, setMappingSamples])

  function assignWell(well: string) {
    if (!mapping) return
    const s = samples[cursor]
    if (!s) return
    updateAssignments(mapping.id, { ...assignments, [well]: s })
  }

  function clearWell(well: string) {
    if (!mapping) return
    const { [well]: _removed, ...rest } = assignments
    updateAssignments(mapping.id, rest)
  }

  function normalizeImportedWell(w: string): string | null {
    const m = /^\s*([A-Ha-h])\s*0*([1-9]|1[0-2])\s*$/.exec(w || '')
    if (!m) return null
    const row = m[1].toUpperCase()
    const col = parseInt(m[2], 10)
    return wellKey(row, col)
  }

  function downloadMappingJSON(m: Mapping) {
    const orderedSamples = m.samples.length ? m.samples : displaySamples
    const sampleToWells: Record<string, string[]> = {}
    for (const well of WELLS) {
      const sample = m.assignments[well]
      if (!sample) continue
      if (!sampleToWells[sample]) sampleToWells[sample] = []
      sampleToWells[sample].push(formatWellA01(well))
    }

    const sampleEntries = orderedSamples.map((name, index) => ({
      name,
      order: index,
      color: m.sampleColors?.[name] ?? null,
      saturation: m.sampleSaturations?.[name] ?? null,
      wells: (sampleToWells[name] ?? [])
        .map((w) => w)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    }))

    const payload = {
      type: 'mapping' as const,
      version: 1,
      name: m.name,
      createdAt: m.createdAt ?? new Date().toISOString(),
      samples: sampleEntries,
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8;',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${m.name.replace(/\s+/g, '_')}.mapping.json`
    a.click()
    URL.revokeObjectURL(url)
  }


  async function importMappingFile(file: File): Promise<string | null> {
    const text = await file.text()
    let payload: any
    try {
      payload = JSON.parse(text)
    } catch (err) {
      throw new Error('Invalid mapping JSON')
    }

    if (payload?.type && payload.type !== 'mapping') {
      throw new Error('Unsupported mapping JSON')
    }

    const sampleEntries = Array.isArray(payload?.samples) ? payload.samples : []
    const orderedFromFile = sampleEntries
      .map((entry: any) => (entry?.name ? String(entry.name).trim() : ''))
      .filter((name: string) => !!name)
      .filter((name: string, index: number, arr: string[]) => arr.indexOf(name) === index)

    const assignmentsRaw = Array.isArray(payload?.assignments) ? payload.assignments : []
    const assignmentSources = assignmentsRaw.length ? assignmentsRaw : sampleEntries
    const newAssignments: Record<string, string> = {}
    for (const item of assignmentSources) {
      const sampleRaw = item?.sample ?? item?.Sample ?? item?.name
      const sample = sampleRaw ? String(sampleRaw).trim() : ''
      if (!sample) continue

      const wellsRaw = Array.isArray(item?.wells) ? item.wells : item?.wells ?? item?.Wells
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
          const well = normalizeImportedWell(String(wellRaw))
          if (!well) continue
          newAssignments[well] = sample
        }
      } else {
        const well = normalizeImportedWell(item?.well ?? item?.Well)
        if (!well) continue
        newAssignments[well] = sample
      }

      if (!orderedFromFile.includes(sample)) {
        orderedFromFile.push(sample)
      }
    }

    const ordered = orderedFromFile.length
      ? orderedFromFile
      : Array.from(new Set(Object.values(newAssignments))).sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true })
        )

    if (!ordered.length) {
      return null
    }

    const baseName =
      typeof payload?.name === 'string' && payload.name.trim().length
        ? payload.name.trim()
        : file.name.replace(/\.[^/.]+$/, '') || `Imported mapping ${new Date().toLocaleTimeString()}`

    const id = createMapping(baseName, ordered)
    updateAssignments(id, newAssignments)

    for (const entry of sampleEntries) {
      const name = entry?.name ? String(entry.name).trim() : ''
      if (!name) continue
      const colorRaw = entry?.color ?? entry?.Color ?? entry?.colour ?? entry?.Colour
      if (typeof colorRaw === 'string' && /^#?[0-9A-Fa-f]{6}$/.test(colorRaw.trim())) {
        const hex = colorRaw.trim()
        setSampleColor(id, name, hex.startsWith('#') ? hex : `#${hex}`)
      }
      const satRaw = entry?.saturation ?? entry?.Saturation
      const satNum =
        typeof satRaw === 'number'
          ? satRaw
          : typeof satRaw === 'string' && satRaw.trim().length
          ? Number(satRaw)
          : Number.NaN
      if (!Number.isNaN(satNum)) {
        const clamped = Math.max(0, Math.min(100, Math.round(satNum)))
        setSampleSaturation(id, name, clamped)
      }
    }

    setRaw(ordered.join('\n'))
    setCursor(0)
    setActiveMapping(id)
    return id
  }

  async function importMappingFiles(fileList: FileList | File[]) {
    let lastId: string | null = null
    for (const file of Array.from(fileList)) {
      const id = await importMappingFile(file)
      if (id) lastId = id
    }
    if (lastId) setActiveMapping(lastId)
  }

  const assignedCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    Object.values(assignments).forEach((s) => {
      counts[s] = (counts[s] ?? 0) + 1
    })
    return counts
  }, [assignments])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!mapping || samples.length === 0) return
      if (e.key === 'ArrowDown') {
        setCursor((c) => (c + 1) % samples.length)
        e.preventDefault()
      }
      if (e.key === 'ArrowUp') {
        setCursor((c) => (c - 1 + samples.length) % samples.length)
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mapping, samples.length])

  return (
    <div className="mapping-grid">
      <div className="panel panel-soft">
        <div className="panel-heading with-help">
          <div>
            <strong>2. {isPl ? 'Lista próbek' : 'Sample List'}</strong>
            <p className="small">
              {isPl ? 'Zdefiniuj lub zaimportuj listę próbek, które trafią na płytkę.' : 'Define or import samples that will go onto the plate.'}
            </p>
          </div>
          <button className="help-btn" type="button" onClick={() => setHelp((h)=>({ ...h, samples: !h.samples }))}>?</button>
        </div>
        {help.samples && (
          <div className="help-banner">
            Wklej lub wczytaj listę próbek. Zmiany aktualizują aktywne mapowanie i listę kolorów.
          </div>
        )}
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const f = e.dataTransfer.files?.[0]
            if (f) f.text().then((t) => setRaw(t))
          }}
          placeholder={'Sample_1\nSample_2\n...'}
        />
        <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
          <input
            type="file"
            accept=".txt,.json"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) f.text().then((t) => setRaw(t))
            }}
          />
          <button
            className="btn"
            onClick={() => {
              if (parsed.length === 0) return
              const blob = new Blob([parsed.join('\n')], { type: 'text/plain;charset=utf-8;' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = 'samples.txt'
              a.click()
              URL.revokeObjectURL(url)
            }}
          >
            Save List
          </button>
        </div>
        <div className="small">Items parsed: {parsed.length}</div>
      </div>

      <div
        className="panel panel-soft"
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const files = e.dataTransfer?.files
          if (files && files.length) {
            void importMappingFiles(files)
          }
        }}
      >
        <div className="panel-heading with-help">
          <div>
            <strong>3. {isPl ? 'Mapowania' : 'Mappings'}</strong>
            <p className="small">
              {isPl ? 'Twórz/wybieraj mapowania, zapisuj lub importuj przypisania dołków.' : 'Create/select mappings, save or import well assignments.'}
            </p>
          </div>
          <button className="help-btn" type="button" onClick={() => setHelp((h)=>({ ...h, mappings: !h.mappings }))}>?</button>
        </div>
        {help.mappings && (
          <div className="help-banner">
            Zarządzaj mapowaniami: wybierz aktywne, zmień nazwę, duplikuj, importuj/eksportuj lub wyczyść przypisania.
          </div>
        )}
        {mapping && (
          <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn primary"
              onClick={() => duplicateMapping(mapping.id)}
            >
              New mapping (copy current)
            </button>
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          {Object.values(mappings).length === 0 && (
            <div className="small">No mappings yet. Add samples to create one automatically.</div>
          )}
          <ul>
            {Object.values(mappings).map((m) => (
              <li key={m.id} style={{ marginBottom: 6 }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="radio"
                    name="mapping"
                    checked={activeMappingId === m.id}
                    onChange={() => setActiveMapping(m.id)}
                  />
                  <input
                    type="text"
                    value={m.name}
                    onChange={(e) => renameMapping(m.id, e.target.value)}
                  />
                  <span className="badge">{Object.keys(m.assignments).length}/96</span>
                  <button
                    className="btn"
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      downloadMappingJSON(m)
                    }}
                  >
                    Download
                  </button>
                  <button className="btn warn" onClick={() => deleteMapping(m.id)}>
                    Delete
                  </button>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={() => importInputRef.current?.click()}>
            Import JSON
          </button>
          <button
            className="btn warn"
            onClick={() => mapping && updateAssignments(mapping.id, {})}
            title="Clear all well assignments"
            disabled={!mapping}
          >
            Clear all
          </button>
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept=".json,application/json"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = e.target.files
            if (files && files.length) {
              void importMappingFiles(files)
            }
            e.currentTarget.value = ''
          }}
        />
      </div>

      <div className="panel panel-soft samples-panel">
        <div className="panel-heading with-help">
          <div>
            <strong>4. {isPl ? 'Próbki do przypisania' : 'Samples to Assign'} ({displaySamples.length})</strong>
            <p className="small">
              {isPl ? 'Lista próbek do umieszczenia na płytce; ustaw kolor i nasycenie.' : 'Samples to place on the plate; adjust color and saturation.'}
            </p>
          </div>
          <button className="help-btn" type="button" onClick={() => setHelp((h)=>({ ...h, samplesAssign: !h.samplesAssign }))}>?</button>
        </div>
        {help.samplesAssign && (
          <div className="help-banner">
            Lista próbek wymagających przypisania do dołków. Kliknij próbkę, aby ją aktywować, zmieniaj kolory lub nasycenie.
          </div>
        )}
        {displaySamples.length === 0 && (
          <div className="small">No samples. Enter samples on the left to build the list.</div>
        )}
        <div
          style={{
            maxHeight: 360,
            overflow: 'auto',
            border: '1px solid rgba(255,255,255,.06)',
            borderRadius: 8,
            padding: 8,
            marginTop: 8,
          }}
        >
          <ol>
            {displaySamples.map((s, i) => {
              const color = sampleColors[s] ?? '#60a5fa'
              const sat = sampleSaturations[s] ?? 65
              return (
                <li
                  key={i}
                  className={['sample-row', i === cursor ? 'active' : ''].join(' ')}
                  onClick={() => setCursor(i)}
                  title={`Click to select sample "${s}"`}
                >
                  <label
                    title={`Pick color for sample ${s}`}
                    onClick={(e) => e.stopPropagation()}
                    style={{ position: 'relative', width: 14, height: 14, flex: '0 0 14px' }}
                  >
                    <input
                      type="color"
                      aria-label={`Pick color for ${s}`}
                      value={color}
                      onChange={(e) => mapping && setSampleColor(mapping.id, s, e.target.value)}
                      style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                    />
                    <span
                      style={{
                        position: 'absolute',
                        left: i === cursor ? 0 : 2,
                        top: i === cursor ? 0 : 2,
                        width: i === cursor ? 0 : 10,
                        height: i === cursor ? 0 : 10,
                        borderLeft: i === cursor ? '7px solid transparent' : undefined,
                        borderRight: i === cursor ? '7px solid transparent' : undefined,
                        borderBottom: i === cursor ? `14px solid ${color}` : undefined,
                        background: i === cursor ? undefined : color,
                        borderRadius: i === cursor ? undefined : '50%',
                      }}
                    />
                  </label>
                  <span style={{ flex: 1 }}>
                    {s}{' '}
                    <span className="small">({assignedCounts[s] ?? 0})</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={sat}
                    title={`Saturation for ${s}`}
                    onChange={(e) =>
                      mapping && setSampleSaturation(mapping.id, s, Number(e.target.value))
                    }
                    style={{ width: 80 }}
                    onClick={(e) => e.stopPropagation()}
                  />
                </li>
              )
            })}
          </ol>
        </div>
        <div className="small" style={{ marginTop: 6 }}>
          Click the colored square to change color; click a row to make that sample active. The slider sets saturation.
        </div>
        <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
          <button
            className="btn"
            onClick={() => mapping && randomizeSampleColors(mapping.id)}
            disabled={!mapping}
          >
            Randomize colors
          </button>
        </div>
      </div>

      <div className="panel panel-soft plate-panel" style={{ overflowX: 'auto' }}>
        <div className="panel-heading with-help">
          <div>
            <strong>5. {isPl ? 'Płytka 96-dołkowa' : '96-well Plate'}</strong>
            <p className="small">
              {isPl ? 'Kliknij dołek, aby przypisać aktywną próbkę lub usunąć przypisanie.' : 'Click a well to assign the active sample or clear the assignment.'}
            </p>
          </div>
          <button className="help-btn" type="button" onClick={() => setHelp((h)=>({ ...h, plate: !h.plate }))}>?</button>
        </div>
        {help.plate && (
          <div className="help-banner">
            Kliknij dołek, aby przypisać aktywną próbkę; kliknij ponownie, aby usunąć. Użyj strzałek góra/dół do zmiany aktywnej próbki.
          </div>
        )}
        <div className="grid96" style={{ marginTop: 8 }}>
          <div></div>
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="collabel">
              {i + 1}
            </div>
          ))}
          {ROWS.map((r) => (
            <div key={r} style={{ display: 'contents' }}>
              <div className="rowlabel">{r}</div>
              {COLS.map((c) => {
                const w = wellKey(r, c)
                const assigned = assignments[w]
                const color = assigned ? sampleColors[assigned] ?? '#34d399' : ''
                const isActiveSample = assigned && assigned === samples[cursor]
                const style: CSSProperties = {}
                if (assigned) {
                  style.background = withAlpha(color, 0.35)
                  style.borderColor = withAlpha(color, 0.8)
                }
                if (isActiveSample) {
                  style.boxShadow = '0 0 0 2px var(--accent)'
                }
                return (
                  <div
                    key={w}
                    className="well"
                    style={Object.keys(style).length ? style : undefined}
                    title={assigned ? `${w} -> ${assigned}` : w}
                    onClick={() => (assigned ? clearWell(w) : assignWell(w))}
                  >
                    {assigned ? assigned : w}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <div className="small" style={{ marginTop: 8 }}>
          Click to assign <b>{displaySamples[cursor] ?? '(none)'}</b> to a well. Click again to clear.
        </div>
      </div>
    </div>
  )
}


