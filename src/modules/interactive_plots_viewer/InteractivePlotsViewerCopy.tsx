import { useCallback, useEffect, useMemo, useState } from "react";

import SimpleLineChart, { type Series } from "@/components/SimpleLineChart";
import { useApp } from "@/state/store";
import type { AssignmentEntry } from "@/utils/assignments";
import { downloadBlob, sanitizeFileName } from "@/utils/export";
import { formatWellA01 } from "@/utils/csv";
import { generateDistinctColors } from "@/utils/colors";
import { makePointId } from "@/modules/raw_data/exclusion";

const GOLD_STROKE = "#f59e0b";
const DEFAULT_SAMPLE_COLOR = "#2563eb";

type SampleReplicateInfo = {
  replicate: number;
  well: string;
};

type BlankSummary = {
  value: number;
  ids: Set<string>;
};

type ChartPointMeta = {
  id: string;
  sample: string;
  replicate: number;
  well: string;
  timeMinutes: number;
  rawValue: number;
  blankCorrectedValue: number | null;
  isBlank: boolean;
};

function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getTimeMinutes(row: any): number {
  const direct =
    safeNumber(row?.time_min) ??
    safeNumber(row?.timeMinutes) ??
    safeNumber(row?.time_minutes);
  if (direct != null) return direct;
  const seconds =
    safeNumber(row?.time_seconds) ?? safeNumber(row?.timeSeconds) ?? null;
  if (seconds != null) return seconds / 60;
  return 0;
}

function resolveMeasurementKey(entry: AssignmentEntry | null): string | null {
  if (!entry?.dataset?.rows?.length) return null;
  const measurementType = entry.dataset.meta?.measurementType;
  if (typeof measurementType === "string" && measurementType.trim().length) {
    const candidate = `val_${measurementType.trim().toLowerCase()}`;
    const hasValues = entry.dataset.rows.some(
      (row) => safeNumber(row?.[candidate]) != null,
    );
    if (hasValues) return candidate;
  }
  const firstRow = entry.dataset.rows.find(
    (row) =>
      row &&
      Object.keys(row).some(
        (key) => key.startsWith("val_") && safeNumber(row[key]) != null,
      ),
  );
  if (firstRow) {
    const valueKey =
      Object.keys(firstRow).find(
        (key) => key.startsWith("val_") && safeNumber(firstRow[key]) != null,
      ) ?? null;
    if (valueKey) return valueKey;
  }
  if (entry.dataset.rows.some((row) => safeNumber(row?.value) != null)) {
    return "value";
  }
  return null;
}

function computeBlankSummary(
  rows: any[],
  measurementKey: string,
): Map<string, BlankSummary> {
  const grouped = new Map<
    string,
    { time: number; value: number; id: string }[]
  >();
  rows.forEach((row) => {
    const well = formatWellA01(row?.well);
    if (!well) return;
    const value = safeNumber(row?.[measurementKey]);
    if (value == null) return;
    const timeMinutes = getTimeMinutes(row);
    const timeSeconds = Number((timeMinutes * 60).toFixed(6));
    const id = makePointId(well, timeSeconds);
    if (!grouped.has(well)) grouped.set(well, []);
    grouped.get(well)!.push({ time: timeMinutes, value, id });
  });
  const summary = new Map<string, BlankSummary>();
  grouped.forEach((entries, well) => {
    entries.sort((a, b) => a.time - b.time);
    const first = entries[0];
    if (!first) return;
    const ids = new Set<string>();
    ids.add(first.id);
    for (let i = 1; i < entries.length; i += 1) {
      const entry = entries[i];
      if (Math.abs(entry.value - first.value) < 1e-9) ids.add(entry.id);
      else break;
    }
    summary.set(well, { value: first.value, ids });
  });
  return summary;
}

function applyBlankCorrectionToEntry(
  entry: AssignmentEntry,
  timestamp: string,
): { entry: AssignmentEntry; missingWells: string[] } {
  if (!entry?.dataset?.rows?.length) return { entry, missingWells: [] };
  const measurementKey = resolveMeasurementKey(entry);
  if (!measurementKey) return { entry, missingWells: [] };
  const includedRows = entry.dataset.rows.filter(
    (row) => !row?.curation?.excluded,
  );
  const blankSummary = computeBlankSummary(includedRows, measurementKey);
  const blankKey = `${measurementKey}_blank_corrected`;
  const correctedRows = entry.dataset.rows.map((row) => {
    const well = formatWellA01(row?.well);
    const value = safeNumber(row?.[measurementKey]);
    if (!well || value == null) return row;
    const blank = blankSummary.get(well);
    if (!blank) return row;
    const corrected = Number((value - blank.value).toFixed(6));
    return {
      ...row,
      [blankKey]: corrected,
    };
  });
  const wellsInDataset = Array.from(
    new Set(
      entry.dataset.rows
        .map((row) => formatWellA01(row?.well))
        .filter((well): well is string => Boolean(well)),
    ),
  );
  const missing = wellsInDataset.filter((well) => !blankSummary.has(well));
  return {
    entry: {
      ...entry,
      dataset: {
        ...entry.dataset,
        rows: correctedRows,
        blankedAt: timestamp,
        blankCorrection: {
          appliedAt: timestamp,
          measurementKey,
          blankKey,
          blanks: Array.from(blankSummary.entries()).map(
            ([well, info]) => ({
              well,
              value: info.value,
            }),
          ),
        },
      },
    },
    missingWells: missing,
  };
}

export default function InteractivePlotsViewer() {
  const autoAssignments = useApp((state) => state.blankCorrectionAssignments);
  const setCurvesSmoothingAssignments = useApp(
    (state) => state.setCurvesSmoothingAssignments,
  );
  const [assignments, setAssignments] = useState<AssignmentEntry[]>([]);
  const [activeEntryIndex, setActiveEntryIndex] = useState(0);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("");
  const [filename, setFilename] = useState<string>("");
  const [hasBlankApplied, setHasBlankApplied] = useState<boolean>(false);
  const [lastBlankPayload, setLastBlankPayload] = useState<string>("");
  const [lastBlankFilename, setLastBlankFilename] = useState<string>("");

  const activeEntry = assignments[activeEntryIndex] ?? null;
  const measurementKey = useMemo(
    () => resolveMeasurementKey(activeEntry),
    [activeEntry],
  );
  const measurementLabel =
    activeEntry?.dataset?.meta?.measurementType ?? "OD600";

  const orderedSamples = useMemo(() => {
    const fromMapping = activeEntry?.mapping?.samples ?? [];
    if (fromMapping.length) {
      return fromMapping
        .slice()
        .sort(
          (a, b) =>
            (a?.order ?? Number.MAX_SAFE_INTEGER) -
            (b?.order ?? Number.MAX_SAFE_INTEGER),
        )
        .map((sample) => sample.name)
        .filter((name): name is string => Boolean(name));
    }
    const samples = new Set<string>();
    activeEntry?.dataset?.rows?.forEach((row) => {
      const sample = typeof row?.sample === "string" ? row.sample.trim() : "";
      if (sample) samples.add(sample);
    });
    return Array.from(samples).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
  }, [activeEntry]);
  const orderedSamplesKey = useMemo(
    () => orderedSamples.join("\u0001"),
    [orderedSamples],
  );

  const sampleColors = useMemo(() => {
    const map = new Map<string, string>();
    const mappingSamples = activeEntry?.mapping?.samples ?? [];
    if (mappingSamples.length) {
      const fallbackColors = generateDistinctColors(
        Math.max(mappingSamples.length, 1),
      );
      mappingSamples.forEach((sample, index) => {
        const name = sample.name;
        if (!name) return;
        const color =
          typeof sample.color === "string" && sample.color.trim()
            ? sample.color
            : null;
        map.set(
          name,
          color ?? fallbackColors[index % fallbackColors.length] ?? DEFAULT_SAMPLE_COLOR,
        );
      });
    } else if (orderedSamples.length) {
      const colors = generateDistinctColors(Math.max(orderedSamples.length, 1));
      orderedSamples.forEach((sample, index) => {
        map.set(sample, colors[index % colors.length] ?? DEFAULT_SAMPLE_COLOR);
      });
    }
    return map;
  }, [activeEntry, orderedSamplesKey]);

  const { sampleReplicates, replicateLookup } = useMemo(() => {
    const map: Record<string, SampleReplicateInfo[]> = {};
    const lookup = new Map<string, number>();
    const mappingSamples = activeEntry?.mapping?.samples ?? [];
    mappingSamples.forEach((sample) => {
      const name = sample.name;
      if (!name) return;
      const reps: SampleReplicateInfo[] = [];
      (sample.wells ?? []).forEach((well, index) => {
        const formatted = formatWellA01(well);
        if (!formatted) return;
        const replicate = index + 1;
        reps.push({ replicate, well: formatted });
        lookup.set(formatted, replicate);
      });
      if (reps.length) map[name] = reps;
    });
    (activeEntry?.dataset?.rows ?? []).forEach((row) => {
      const well = formatWellA01(row?.well);
      if (!well) return;
      const sample =
        (typeof row?.sample === "string" ? row.sample.trim() : "") || well;
      const replicate =
        safeNumber(row?.replicate) ?? lookup.get(well) ?? 1;
      if (!map[sample]) map[sample] = [];
      if (!map[sample].some((entry) => entry.replicate === replicate)) {
        map[sample].push({ replicate, well });
        map[sample].sort((a, b) => a.replicate - b.replicate);
      }
      if (!lookup.has(well)) lookup.set(well, replicate);
    });
    return { sampleReplicates: map, replicateLookup: lookup };
  }, [activeEntry]);
  const sampleReplicatesKey = useMemo(
    () =>
      Object.entries(sampleReplicates)
        .map(
          ([sample, reps]) =>
            `${sample}:${reps.map((rep) => rep.replicate).join(",")}`,
        )
        .sort()
        .join("|"),
    [sampleReplicates],
  );

  const includedRows = useMemo(() => {
    if (!activeEntry?.dataset?.rows?.length) return [];
    return activeEntry.dataset.rows.filter((row) => !row?.curation?.excluded);
  }, [activeEntry]);
  const blankSummary = useMemo(() => {
    if (!measurementKey) return new Map<string, BlankSummary>();
    return computeBlankSummary(includedRows, measurementKey);
  }, [includedRows, measurementKey]);

  const replicatePoints = useMemo(() => {
    const map = new Map<string, { x: number; meta: ChartPointMeta }[]>();
    if (!activeEntry || !measurementKey) return map;
    includedRows.forEach((row) => {
      const well = formatWellA01(row?.well);
      if (!well) return;
      const sample =
        (typeof row?.sample === "string" ? row.sample.trim() : "") || well;
      const replicate =
        safeNumber(row?.replicate) ?? replicateLookup.get(well) ?? 1;
      const value = safeNumber(row?.[measurementKey]);
      if (value == null) return;
      const timeMinutes = getTimeMinutes(row);
      const timeSeconds = Number((timeMinutes * 60).toFixed(6));
      const id = makePointId(well, timeSeconds);
      const blank = blankSummary.get(well) ?? null;
      const isBlank = blank ? blank.ids.has(id) : false;
      const blankedValue =
        blank && blank.value != null
          ? Number((value - blank.value).toFixed(6))
          : null;
      const key = `${sample}|${replicate}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({
        x: timeMinutes,
        meta: {
          id,
          sample,
          replicate,
          well,
          timeMinutes,
          rawValue: value,
          blankCorrectedValue: blankedValue,
          isBlank,
        },
      });
    });
    map.forEach((points) => points.sort((a, b) => a.x - b.x));
    return map;
  }, [activeEntry, measurementKey, includedRows, blankSummary, replicateLookup]);
  const allReplicateKeys = useMemo(() => {
    const keys: string[] = [];
    Object.entries(sampleReplicates).forEach(([sample, reps]) => {
      reps.forEach((rep) => keys.push(`${sample}|${rep.replicate}`));
    });
    return keys;
  }, [sampleReplicatesKey]);

  useEffect(() => {
    if (!allReplicateKeys.length) {
      setSelectedKeys([]);
      return;
    }
    setSelectedKeys((prev) => {
      const retained = prev.filter((key) => allReplicateKeys.includes(key));
      if (retained.length) return retained;
      const firstSample = orderedSamples[0];
      if (firstSample) {
        const firstRep = sampleReplicates[firstSample]?.[0]?.replicate;
        if (firstRep) return [`${firstSample}|${firstRep}`];
      }
      return [allReplicateKeys[0]];
    });
  }, [activeEntryIndex, orderedSamplesKey, sampleReplicatesKey, allReplicateKeys]);

  const visibleSeries: Series[] = useMemo(() => {
    const list: Series[] = [];
    replicatePoints.forEach((points, key) => {
      if (!selectedKeys.includes(key)) return;
      const [sample, replicateStr] = key.split("|");
      const replicate = Number(replicateStr) || 1;
      const color = sampleColors.get(sample) ?? DEFAULT_SAMPLE_COLOR;
      list.push({
        name: `${sample} R${replicate}`,
        color,
        points: points.map((point) => ({
          x: point.x,
          y: point.meta.rawValue,
          id: point.meta.id,
          meta: {
            ...point.meta,
            strokeColor: point.meta.isBlank ? GOLD_STROKE : color,
            strokeWidth: point.meta.isBlank ? 2.2 : 1,
            fillColor: color,
          },
        })),
      });
    });
    return list;
  }, [replicatePoints, selectedKeys, sampleColors]);

  const correctedSeries: Series[] = useMemo(() => {
    if (!hasBlankApplied) return [];
    const list: Series[] = [];
    replicatePoints.forEach((points, key) => {
      if (!selectedKeys.includes(key)) return;
      const [sample, replicateStr] = key.split("|");
      const replicate = Number(replicateStr) || 1;
      const color = sampleColors.get(sample) ?? DEFAULT_SAMPLE_COLOR;
      list.push({
        name: `${sample} R${replicate}`,
        color,
        points: points.map((point) => ({
          x: point.x,
          y:
            point.meta.blankCorrectedValue ??
            point.meta.rawValue,
          id: `blanked|${point.meta.id}`,
          meta: {
            ...point.meta,
            strokeColor: point.meta.isBlank ? GOLD_STROKE : color,
            strokeWidth: point.meta.isBlank ? 2.2 : 1,
            fillColor: color,
          },
        })),
      });
    });
    return list;
  }, [hasBlankApplied, replicatePoints, selectedKeys, sampleColors]);

  const toggleReplicate = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      if (prev.includes(key)) return prev.filter((item) => item !== key);
      return [...prev, key];
    });
  }, []);

  const toggleSample = useCallback(
    (sample: string) => {
      const reps = sampleReplicates[sample];
      if (!reps?.length) return;
      const keys = reps.map((rep) => `${sample}|${rep.replicate}`);
      setSelectedKeys((prev) => {
        const hasAll = keys.every((key) => prev.includes(key));
        if (hasAll) return prev.filter((key) => !keys.includes(key));
        const next = new Set(prev);
        keys.forEach((key) => next.add(key));
        return Array.from(next);
      });
    },
    [sampleReplicates],
  );

  const handleFileChange = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList?.length) return;
      const file = fileList[0];
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as {
          assignments?: AssignmentEntry[];
        };
        if (!parsed.assignments?.length) {
          setAssignments([]);
          setStatus("[WARN] Wybrany plik nie zawiera assignmentów.");
          setFilename(file.name);
          setHasBlankApplied(false);
          setCurvesSmoothingAssignments(null);
          setLastBlankPayload("");
          setLastBlankFilename("");
          return;
        }
        setAssignments(parsed.assignments);
        setActiveEntryIndex(0);
        setFilename(file.name);
        setStatus(
          `[OK] Wczytano ${file.name} (${parsed.assignments.length} assignment${
            parsed.assignments.length > 1 ? "s" : ""
          }).`,
        );
        setHasBlankApplied(false);
        setCurvesSmoothingAssignments(null);
        setLastBlankPayload("");
        setLastBlankFilename("");
      } catch (error: any) {
        console.error(error);
        setStatus(
          `[ERR] Nie udało się odczytać pliku: ${
            error?.message ?? String(error)
          }`,
        );
      }
    },
    [],
  );

  const autoAssignmentsKey = useMemo(() => {
    if (!autoAssignments?.length) return "";
    return autoAssignments
      .map((entry) => entry?.dataset?.meta?.runId ?? "")
      .join("|");
  }, [autoAssignments]);

  useEffect(() => {
    if (!autoAssignments?.length) return;
    setAssignments(autoAssignments);
    setActiveEntryIndex(0);
    const meta = autoAssignments[0]?.dataset?.meta;
    const base = meta?.sourceFile || meta?.runId || "assignment";
    setFilename(`[auto] ${base}`);
    setStatus(
      `[AUTO] Dane z Karty Kontrola Danych (${autoAssignments.length} assignment${
        autoAssignments.length > 1 ? "s" : ""
      }).`,
    );
    setHasBlankApplied(false);
    setLastBlankPayload("");
    setLastBlankFilename("");
    setCurvesSmoothingAssignments(null);
  }, [autoAssignmentsKey]);

  const handleApplyBlankCorrection = useCallback(() => {
    if (!assignments.length) {
      setStatus("[WARN] Brak danych do korekty blank.");
      return;
    }
    const now = new Date().toISOString();
    const updated: AssignmentEntry[] = [];
    const missingSummary: string[] = [];
    assignments.forEach((entry, index) => {
      const { entry: corrected, missingWells } = applyBlankCorrectionToEntry(
        entry,
        now,
      );
      updated.push(corrected);
      if (missingWells.length) {
        const meta = corrected?.dataset?.meta;
        const label = meta?.sourceFile || meta?.runId || `assignment-${index}`;
        missingSummary.push(
          `${label}: ${missingWells.slice(0, 6).join(", ")}${
            missingWells.length > 6
              ? ` +${missingWells.length - 6} kolejne`
              : ""
          }`,
        );
      }
    });
    const payload = {
      version: 5,
      createdAt: now,
      blanked: true,
      assignments: updated,
    };
    const baseMeta = updated[0]?.dataset?.meta;
    const baseName =
      baseMeta?.sourceFile || baseMeta?.runId || filename || "assignment";
    const targetName = sanitizeFileName(`${baseName}-blanked.json`);
    const json = JSON.stringify(payload, null, 2);
    setHasBlankApplied(true);
    setCurvesSmoothingAssignments(updated);
    setLastBlankPayload(json);
    setLastBlankFilename(targetName);
    if (missingSummary.length) {
      setStatus(
        `[WARN] Korekta blank zakończona (${updated.length} assignment${
          updated.length > 1 ? "s" : ""
        }), ale nie znaleziono punktów bazowych dla: ${missingSummary.join(
          "; ",
        )}.`,
      );
    } else {
      setStatus(
        `[OK] Zastosowano korektę blank (${updated.length} assignment${
          updated.length > 1 ? "s" : ""
        }).`,
      );
    }
  }, [assignments, filename, setCurvesSmoothingAssignments]);

  const handleDownloadAgain = useCallback(() => {
    if (!lastBlankPayload || !lastBlankFilename) return;
    downloadBlob(
      new Blob([lastBlankPayload], { type: "application/json;charset=utf-8" }),
      lastBlankFilename,
    );
  }, [lastBlankPayload, lastBlankFilename]);

  const handleEntryChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const next = Number(event.target.value);
      if (!Number.isFinite(next)) return;
      setActiveEntryIndex(next);
    },
    [],
  );

  return (
    <div className="panel">
      <h2>Blank Correction Check</h2>
      <div className="small" style={{ marginBottom: 8 }}>
        Wczytaj <code>.curated-data.json</code> z Karty Kontrola Danych (albo użyj
        danych przesłanych automatycznie), wybierz widoczne próby i zastosuj
        korektę blank.
      </div>

      <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
        <div className="col" style={{ minWidth: 240 }}>
          <label className="small">Plik z danymi (curated)</label>
          <input
            type="file"
            accept=".json"
            onChange={(event) => handleFileChange(event.target.files)}
          />
          {filename && (
            <div className="small" style={{ marginTop: 4 }}>
              Aktywny plik: {filename}
            </div>
          )}
        </div>
        <div className="col" style={{ minWidth: 240 }}>
          <label className="small">Assignment</label>
          <select
            value={activeEntryIndex}
            onChange={handleEntryChange}
            disabled={!assignments.length}
          >
            {!assignments.length && (
              <option value={0}>(brak danych)</option>
            )}
            {assignments.map((entry, index) => {
              const meta = entry?.dataset?.meta;
              const label =
                meta?.sourceFile || meta?.runId || `assignment-${index + 1}`;
              return (
                <option key={label} value={index}>
                  {index + 1}. {label}
                </option>
              );
            })}
          </select>
        </div>
        <div className="col" style={{ minWidth: 200 }}>
          <label className="small">&nbsp;</label>
          <button
            type="button"
            className="btn"
            onClick={handleApplyBlankCorrection}
            disabled={!assignments.length}
          >
            Apply Blank Correction
          </button>
          {hasBlankApplied && lastBlankPayload && (
            <button
              type="button"
              className="btn"
              style={{ marginLeft: 8 }}
              onClick={handleDownloadAgain}
            >
              Download .blanked.json
            </button>
          )}
        </div>
      </div>

      {status && (
        <div className="small" style={{ marginTop: 12 }}>
          {status}
        </div>
      )}

      {!activeEntry && (
        <div className="empty-state" style={{ marginTop: 32 }}>
          Wczytaj najpierw dane curated, aby zweryfikować blanki.
        </div>
      )}

      {activeEntry && measurementKey && (
        <>
          <div className="small" style={{ marginTop: 12 }}>
            Na wykresach widoczne są wyłącznie punkty dopuszczone do analizy.
            Złota obwódka oznacza pierwszy niewykluczony punkt danego dołka
            (oraz kolejne punkty o tej samej wartości), który definiuje blank.
          </div>

          <div
            className="row"
            style={{ gap: 16, marginTop: 16, flexWrap: "wrap" }}
          >
            <div className="col" style={{ flex: "1 1 360px" }}>
              <SimpleLineChart
                series={visibleSeries}
                title="Przed korektą blank"
                xLabel="Czas (min)"
                yLabel={`${measurementLabel} (raw)`}
                height={360}
                minHeight={320}
                maxHeight={520}
                legendMode="none"
                pointMarkers="all"
                mode="scatter"
                pointMarkerRadius={3}
                enableZoom={true}
                enablePan={true}
                minPanX={Number.NEGATIVE_INFINITY}
                minPanY={Number.NEGATIVE_INFINITY}
                pointSelectionMode="immediate"
              />
            </div>
            <div className="col" style={{ flex: "1 1 360px" }}>
              {hasBlankApplied ? (
                <SimpleLineChart
                  series={correctedSeries}
                  title="Po korekcie blank"
                  xLabel="Czas (min)"
                  yLabel={`${measurementLabel} (blank-corrected)`}
                  height={360}
                  minHeight={320}
                  maxHeight={520}
                  legendMode="none"
                  pointMarkers="all"
                  mode="scatter"
                  pointMarkerRadius={3}
                  enableZoom={true}
                  enablePan={true}
                  minPanX={Number.NEGATIVE_INFINITY}
                  minPanY={Number.NEGATIVE_INFINITY}
                  pointSelectionMode="immediate"
                />
              ) : (
                <div
                  className="empty-state"
                  style={{
                    height: 360,
                    minHeight: 320,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "1px dashed #cbd5f5",
                  }}
                >
                  Zastosuj korektę blank, aby zobaczyć dane po odjęciu blanków.
                </div>
              )}
            </div>
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <h3>Legenda i wybór replikatów</h3>
            {!allReplicateKeys.length && (
              <div className="small">Brak replikatów do wyświetlenia.</div>
            )}
            {orderedSamples.map((sample) => {
              const reps = sampleReplicates[sample] ?? [];
              if (!reps.length) return null;
              const sampleKeys = reps.map((rep) => `${sample}|${rep.replicate}`);
              const selectedCount = sampleKeys.filter((key) =>
                selectedKeys.includes(key),
              ).length;
              const swatchColor =
                sampleColors.get(sample) ?? DEFAULT_SAMPLE_COLOR;
              return (
                <div
                  key={sample}
                  style={{
                    borderTop: "1px solid #e2e8f0",
                    padding: "8px 0",
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontWeight: 600,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedCount === sampleKeys.length}
                      onChange={() => toggleSample(sample)}
                    />
                    <span
                      style={{
                        display: "inline-block",
                        width: 12,
                        height: 12,
                        borderRadius: 2,
                        background: swatchColor,
                      }}
                    />
                    {sample}
                  </label>
                  <div
                    className="small"
                    style={{
                      display: "flex",
                      gap: 12,
                      flexWrap: "wrap",
                      marginTop: 4,
                    }}
                  >
                    {reps.map((rep) => {
                      const key = `${sample}|${rep.replicate}`;
                      return (
                        <label
                          key={key}
                          style={{ display: "flex", alignItems: "center", gap: 4 }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedKeys.includes(key)}
                            onChange={() => toggleReplicate(key)}
                          />
                          R{rep.replicate}
                          {rep.well ? ` (${rep.well})` : ""}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {activeEntry && !measurementKey && (
        <div className="empty-state" style={{ marginTop: 24 }}>
          Nie udało się zidentyfikować kolumny z wartościami pomiarowymi. Upewnij
          się, że dane zawierają pola typu <code>val_od600</code>.
        </div>
      )}
    </div>
  );
}
