import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/state/store';
import { ROWS, COLS, wellKey, WELLS } from '@/utils/plate';
import type { Mapping } from '@/types';
import { downloadCSV } from '@/utils/csv';
import { withAlpha } from '@/utils/colors';

export default function MappingManager() {
  const sampleLists = useApp((s) => s.sampleLists);
  const activeListName = useApp((s) => s.activeSampleListName);
  const createMapping = useApp((s) => s.createMapping);
  const mappings = useApp((s) => s.mappings);
  const activeMappingId = useApp((s) => s.activeMappingId);
  const setActiveMapping = useApp((s) => s.setActiveMapping);
  const updateAssignments = useApp((s) => s.updateMappingAssignments);
  const renameMapping = useApp((s) => s.renameMapping);
  const deleteMapping = useApp((s) => s.deleteMapping);

  // NEW: color actions
  const setSampleColor = useApp((s) => s.setSampleColor);
  const randomizeSampleColors = useApp((s) => s.randomizeSampleColors);

  const activeList = activeListName ? sampleLists[activeListName] : null;

  const [cursor, setCursor] = useState(0);
  const mapping: Mapping | null = activeMappingId
    ? mappings[activeMappingId]
    : null;
  const assignments = mapping?.assignments ?? {};
  const samples = mapping?.samples ?? [];
  const sampleColors = mapping?.sampleColors ?? {};

  useEffect(() => {
    setCursor(0);
  }, [activeMappingId]);

  // Migration: if an older mapping has no colors or mismatch length, randomize once
  useEffect(() => {
    if (
      mapping &&
      (!mapping.sampleColors ||
        Object.keys(mapping.sampleColors).length !== mapping.samples.length)
    ) {
      randomizeSampleColors(mapping.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping?.id]);

  function startNewMapping() {
    if (!activeList) return;
    const id = createMapping(`Mapping: ${activeList.name}`, activeList.items);
    setActiveMapping(id);
  }

  function assignWell(well: string) {
    if (!mapping) return;
    const s = samples[cursor];
    if (!s) return;
    updateAssignments(mapping.id, { ...assignments, [well]: s });
  }

  function clearWell(well: string) {
    if (!mapping) return;
    const { [well]: _, ...rest } = assignments;
    updateAssignments(mapping.id, rest);
  }

  function exportCSV() {
    if (!mapping) return;
    const rows = WELLS.map((w) => ({
      well: w,
      sampleName: assignments[w] ?? '',
    }));
    downloadCSV(`${mapping.name.replace(/\s+/g, '_')}.mapping.csv`, rows);
  }

  const assignedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    Object.values(assignments).forEach((s) => {
      counts[s] = (counts[s] ?? 0) + 1;
    });
    return counts;
  }, [assignments]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!mapping) return;
      if (e.key === 'ArrowDown') {
        setCursor((c) => Math.min(c + 1, samples.length - 1));
        e.preventDefault();
      }
      if (e.key === 'ArrowUp') {
        setCursor((c) => Math.max(c - 1, 0));
        e.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mapping, samples.length]);

  return (
    <div className="panel">
      <h2>Mapping Manager</h2>
      <div className="small">
        Create/choose a sample list in <b>Sample Manager</b>. Here you create
        mappings, assign wells, and set sample colors. Navigation:{' '}
        <span className="kbd">↑/↓</span> moves the active sample. You can also{' '}
        <b>click a sample</b> to select it.
      </div>

      <div className="row">
        {/* Left: Mappings */}
        <div className="col" style={{ flex: 1, minWidth: 280 }}>
          <div className="panel">
            <strong>Mappings</strong>
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="btn primary"
                disabled={!activeList}
                onClick={startNewMapping}
              >
                + New from active sample list
              </button>
            </div>
            <div style={{ marginTop: 8 }}>
              {Object.values(mappings).length === 0 && (
                <div className="small">No mappings yet.</div>
              )}
              <ul>
                {Object.values(mappings).map((m) => (
                  <li key={m.id} style={{ marginBottom: 6 }}>
                    <label
                      style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                    >
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
                      <span className="badge">
                        {Object.keys(m.assignments).length}/96
                      </span>
                      <button
                        className="btn warn"
                        onClick={() => deleteMapping(m.id)}
                      >
                        Delete
                      </button>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
            {mapping && (
              <div className="row" style={{ marginTop: 8, gap: 8 }}>
                <button className="btn" onClick={exportCSV}>
                  Export CSV
                </button>
                <button
                  className="btn"
                  onClick={() => randomizeSampleColors(mapping.id)}
                >
                  Randomize colors
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Middle: Sample list */}
        <div className="col" style={{ flex: 1, minWidth: 320 }}>
          <div className="panel">
            <strong>Sample list ({samples.length})</strong>
            {samples.length === 0 && (
              <div className="small">
                No samples. Create a mapping to load the list.
              </div>
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
                {samples.map((s, i) => {
                  const color = sampleColors[s] ?? '#60a5fa';
                  return (
                    <li
                      key={i}
                      className={[
                        'sample-row',
                        i === cursor ? 'active' : '',
                      ].join(' ')}
                      onClick={() => setCursor(i)}
                      title={`Click to select sample "${s}"`}
                    >
                      <label
                        className="color-chip"
                        title={`Pick color for sample ${s}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="color"
                          aria-label={`Pick color for ${s}`}
                          value={color}
                          onChange={(e) =>
                            mapping &&
                            setSampleColor(mapping.id, s, e.target.value)
                          }
                        />
                        <span style={{ background: color }} />
                      </label>
                      <div style={{ flex: 1 }}>
                        {i === cursor ? (
                          <span style={{ color: 'var(--accent)' }}>▶ </span>
                        ) : (
                          <span style={{ opacity: 0.3 }}>• </span>
                        )}
                        {s}{' '}
                        <span className="small">
                          ({assignedCounts[s] ?? 0})
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
            <div className="small" style={{ marginTop: 6 }}>
              Click the colored square to change color; click a row to make that
              sample active.
            </div>
          </div>
        </div>

        {/* Right: 96-well plate */}
        <div className="col" style={{ flex: 2, minWidth: 520 }}>
          <div className="panel">
            <strong>96-well plate</strong>
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
                    const w = wellKey(r, c);
                    const assigned = assignments[w];
                    const color = assigned
                      ? sampleColors[assigned] ?? '#34d399'
                      : '';
                    const style = assigned
                      ? {
                          background: withAlpha(color, 0.18),
                          borderColor: withAlpha(color, 0.55),
                        }
                      : undefined;
                    return (
                      <div
                        key={w}
                        className="well"
                        style={style}
                        title={assigned ? `${w} → ${assigned}` : w}
                        onClick={() =>
                          assigned ? clearWell(w) : assignWell(w)
                        }
                      >
                        {assigned ? assigned : w}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="small" style={{ marginTop: 8 }}>
              Click to assign <b>{samples[cursor] ?? '(none)'}</b> to a well.
              Click again to clear.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
