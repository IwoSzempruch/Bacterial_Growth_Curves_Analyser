import { useEffect, useMemo, useState, useCallback, useRef } from "react";

import { useApp, type RawDataPointOverride } from "@/state/store";

import { hexToHsl, hslToHex } from "@/utils/colors";

import { formatWellA01 } from "@/utils/csv";

import type { Series } from "@/components/SimpleLineChart";

import { combinedContainers } from "./containers/combined";

import {
  replicateSelectionContainers,
  type SampleReplicate,
} from "./containers/replicate_selection";

import type { RawReplicatePointMeta } from "./types";

import { downloadBlob, sanitizeFileName } from "@/utils/export";

import { buildAssignmentEntry } from "@/utils/assignments";

import type { Mapping } from "@/types";
import {
  BASELINE_BIN_WIDTH,
  BASELINE_DEFAULT_MIN_CONSECUTIVE,
  BASELINE_DEFAULT_TOLERANCE,
  BASELINE_T_PRE_MINUTES,
  MONOTONIC_DEFAULT_TOLERANCE,
  MONOTONIC_DEFAULT_WINDOW_MINUTES,
  computeBaselineForPoints,
  makePointId,
} from "../raw_data/exclusion";
// Generates subtle color shifts for replicate curves so lines stay distinguishable.

function varyReplicateColor(base: string, replicate: number): string {
  if (replicate <= 1) return base;

  const { h, s, l } = hexToHsl(base);

  const step = (replicate - 1) % 4;

  if (step === 1)
    return hslToHex(h, Math.min(100, s + 5), Math.min(100, l + 8));

  if (step === 2) return hslToHex(h, Math.max(0, s - 5), Math.max(0, l - 8));

  return hslToHex((h + 10) % 360, s, l);
}
type ReplicateChartPoint = RawReplicatePointMeta & { x: number };

export default function PlotsViewer() {
  const datasets = useApp((state) => state.datasets);
  const datasetMapping = useApp((state) => state.datasetMapping ?? {});
  const mappings = useApp((state) => state.mappings);
  const activeTab = useApp((state) => state.activeTab);
  const plotsSelectedRunId = useApp((state) => state.plotsSelectedRunId);
  const rawDataPointOverrides = useApp((state) => state.rawDataPointOverrides);
  const rawDataSettings = useApp((state) => state.rawDataSettings);
  const autoRun = useApp((state) => state.autoRun);
  const setRawDataPointOverride = useApp(
    (state) => state.setRawDataPointOverride,
  );
  const setRawDataSettings = useApp((state) => state.setRawDataSettings);
  const resetRawDataPointOverrides = useApp(
    (state) => state.resetRawDataPointOverrides,
  );
  const setSampleColor = useApp((state) => state.setSampleColor);
  const setDatasetMappings = useApp((state) => state.setDatasetMappings);
  const setActiveTab = useApp((state) => state.setActiveTab);
  const setPlotsSelectedRunId = useApp((state) => state.setPlotsSelectedRunId);
  const setBlankCorrectionAssignments = useApp(
    (state) => state.setBlankCorrectionAssignments,
  );
  const setAutoRun = useApp((state) => state.setAutoRun);
  const datasetList = useMemo(
    () =>
      Object.values(datasets).sort((a, b) =>
        (a.sourceFile || a.runId).localeCompare(
          b.sourceFile || b.runId,
          undefined,
          {
            numeric: true,
          },
        ),
      ),
    [datasets],
  );

  const [selectedRunId, setSelectedRunId] = useState<string>("");
  // Auto-select the first dataset (prefer one with a saved mapping) once data is available.

  useEffect(() => {
    if (!selectedRunId && datasetList.length) {
      const preferred =
        datasetList.find((d) => !!datasetMapping[d.runId]) ?? datasetList[0];

      setSelectedRunId(preferred.runId);
    }
  }, [
    datasetList.map((d) => d.runId).join("\u0001"),

    Object.entries(datasetMapping)
      .map(([runId, mappingId]) => `${runId}:${mappingId}`)
      .join("\u0001"),

    selectedRunId,
  ]);
  // Sync selection when other modules request a specific run to be displayed.

  useEffect(() => {
    if (plotsSelectedRunId) setSelectedRunId(plotsSelectedRunId);
  }, [plotsSelectedRunId]);
  // Locate the active dataset whenever the selection or backing store changes.

  const selectedDataset = useMemo(
    () => datasetList.find((d) => d.runId === selectedRunId) ?? null,
    [datasetList, selectedRunId],
  );

  // Pick the mapping tied to the active dataset, falling back to null if none exists.

  const selectedMapping = useMemo(() => {
    if (!selectedDataset) return null;

    const mid = datasetMapping[selectedDataset.runId];

    return mid ? (mappings[mid] ?? null) : null;
  }, [selectedDataset?.runId, datasetMapping, mappings]);
  const language = useApp((state) => state.language);
  const isPl = language === "pl";
  const normalizedAssignments = useMemo(() => {
    if (!selectedMapping) return {};

    const normalized: Record<string, string> = {};

    Object.entries(selectedMapping.assignments ?? {}).forEach(
      ([well, value]) => {
        const formatted = formatWellA01(well);

        if (!formatted) return;

        normalized[formatted] = value ?? "";
      },
    );

    return normalized;
  }, [selectedMapping]);
  const normalizedAssignmentsKey = useMemo(
    () =>
      Object.entries(normalizedAssignments)

        .map(([well, sample]) => `${well}:${sample ?? ""}`)

        .sort()

        .join("|"),

    [normalizedAssignments],
  );
  const mappingForAssignment = useMemo(() => {
    if (!selectedMapping) return null;

    const clone: Mapping = {
      ...selectedMapping,

      assignments: normalizedAssignments,
    };

    return clone;
  }, [selectedMapping, normalizedAssignmentsKey]);
  // Build a lookup of replicate numbers per sample so we can cluster series and legends consistently.

  const sampleReplicates = useMemo(() => {
    const out: Record<string, SampleReplicate[]> = {};

    if (!selectedDataset) return out;

    const datasetWells = Array.from(
      new Set(
        selectedDataset.rows
          .map((r) => formatWellA01(r.well))
          .filter((w): w is string => !!w),
      ),
    );

    const mappingWells = Object.keys(normalizedAssignments);

    const wells = Array.from(new Set([...datasetWells, ...mappingWells]))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const hasAssignments = Object.values(normalizedAssignments).some(
      (value) => !!(value && value.trim()),
    );

    const assignments = hasAssignments
      ? normalizedAssignments
      : Object.fromEntries(wells.map((w) => [w, w]));

    const sampleToWells: Record<string, string[]> = {};

    wells.forEach((well) => {
      const sample = (assignments[well] ?? "").trim() || well;

      if (!sampleToWells[sample]) sampleToWells[sample] = [];

      sampleToWells[sample].push(well);
    });

    Object.entries(sampleToWells).forEach(([sample, list]) => {
      list.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      out[sample] = list.map((well, index) => ({ well, replicate: index + 1 }));
    });

    return out;
  }, [selectedDataset?.runId, normalizedAssignmentsKey]);
  const sampleReplicatesKey = useMemo(() => {
    return Object.entries(sampleReplicates)

      .map(
        ([sample, reps]) =>
          `${sample}:${reps.map((rep) => `${rep.well}:${rep.replicate}`).join(",")}`,
      )

      .sort()

      .join("|");
  }, [sampleReplicates]);
  const sampleByWell = useMemo(() => {
    const map: Record<string, string> = {};

    Object.entries(sampleReplicates).forEach(([sample, reps]) => {
      reps.forEach(({ well }) => {
        map[well.toUpperCase()] = sample;
      });
    });

    return map;
  }, [sampleReplicatesKey]);
  const replicateIndexByWell = useMemo(() => {
    const map: Record<string, number> = {};

    Object.values(sampleReplicates).forEach((reps) => {
      reps.forEach(({ well, replicate }) => {
        map[well.toUpperCase()] = replicate;
      });
    });

    return map;
  }, [sampleReplicatesKey]);
  const replicatePointData = useMemo(() => {
    const pointsByRep = new Map<string, ReplicateChartPoint[]>();

    const pointById = new Map<string, ReplicateChartPoint>();

    if (!selectedDataset) {
      return {
        pointsByRep,

        pointById,

        minX: null as number | null,

        maxX: null as number | null,

        minY: null as number | null,

        maxY: null as number | null,
      };
    }
    const rows = selectedDataset.rows
      .slice()
      .sort((a, b) => (a.timeSeconds ?? 0) - (b.timeSeconds ?? 0));

    let minX: number | null = null;

    let maxX: number | null = null;

    let minY: number | null = null;

    let maxY: number | null = null;
    for (const row of rows) {
      const normalizedWell = formatWellA01(row.well);

      if (!normalizedWell) continue;

      const well = normalizedWell.toUpperCase();

      const sampleName = sampleByWell[well] ?? normalizedWell;

      if (!sampleName) continue;

      const replicate = replicateIndexByWell[well] ?? 1;

      const timeSeconds = Number(row.timeSeconds ?? 0) || 0;

      const x = Number.isFinite(timeSeconds) ? timeSeconds / 60 : 0;

      const value = Number(row.value ?? 0);

      const id = makePointId(well, timeSeconds);

      const entry: ReplicateChartPoint = {
        id,
        sample: sampleName,
        replicate,
        well,
        timeSeconds,
        value,
        x,
      };

      const key = `${sampleName}|${replicate}`;

      if (!pointsByRep.has(key)) pointsByRep.set(key, []);

      pointsByRep.get(key)!.push(entry);

      pointById.set(id, entry);

      if (Number.isFinite(x)) {
        minX = minX == null ? x : Math.min(minX, x);

        maxX = maxX == null ? x : Math.max(maxX, x);
      }

      if (Number.isFinite(value)) {
        minY = minY == null ? value : Math.min(minY, value);

        maxY = maxY == null ? value : Math.max(maxY, value);
      }
    }
    pointsByRep.forEach((list) => list.sort((a, b) => a.x - b.x));
    return { pointsByRep, pointById, minX, maxX, minY, maxY };
  }, [selectedDataset?.runId, sampleByWell, replicateIndexByWell]);
  const datasetRunId = selectedDataset?.runId ?? "";

  const overridesForRun = datasetRunId
    ? (rawDataPointOverrides[datasetRunId] ?? {})
    : {};

  const overridesKey = useMemo(() => {
    return Object.entries(overridesForRun)

      .map(([id, state]) => `${id}:${state}`)

      .sort()

      .join("|");
  }, [overridesForRun]);
  const lowestPointCount = Math.max(
    1,
    rawDataSettings?.lowestPointCount ?? BASELINE_DEFAULT_MIN_CONSECUTIVE,
  );

  const removeEarlierPoints = true;

  const outlierThresholdSetting = rawDataSettings?.outlierThreshold;

  const outlierThreshold = Number.isFinite(outlierThresholdSetting)
    ? Math.max(0, Number(outlierThresholdSetting))
    : BASELINE_DEFAULT_TOLERANCE;

  const windowMinutesSetting = rawDataSettings?.outlierWindowMinutes;

  const outlierWindowMinutes =
    windowMinutesSetting == null
      ? MONOTONIC_DEFAULT_WINDOW_MINUTES
      : Math.max(0, windowMinutesSetting);

  const rawMonotonicTolerance =
    rawDataSettings?.outlierWindowPercent ?? MONOTONIC_DEFAULT_TOLERANCE;

  const outlierWindowPercent =
    rawMonotonicTolerance > 1
      ? rawMonotonicTolerance / 100
      : Math.max(0, rawMonotonicTolerance);
  useEffect(() => {
    if (
      rawDataSettings?.outlierWindowPercent != null &&
      rawDataSettings.outlierWindowPercent > 1
    ) {
      setRawDataSettings({
        outlierWindowPercent: rawDataSettings.outlierWindowPercent / 100,
      });
    }
  }, [rawDataSettings?.outlierWindowPercent, setRawDataSettings]);
  const {
    baselineSet: autoBaselineSet,

    excludedSet: autoExcludedSet,

    reasonMap: autoReasonMap,

    baselineKey: autoBaselineKey,

    excludedKey: autoExcludedKey,

    reasonKey: autoReasonKey,
  } = useMemo(() => {
    const baselineSet = new Set<string>();

    const excludedSet = new Set<string>();

    const reasonMap = new Map<string, string[]>();

    const addReason = (id: string, reason: string) => {
      if (!reasonMap.has(id)) reasonMap.set(id, []);

      reasonMap.get(id)!.push(reason);
    };
    replicatePointData.pointsByRep.forEach((points) => {
      if (!points.length) return;

      const {
        baselineIndices,

        preExcludedIndices,

        monotonicExcludedIndices,
      } = computeBaselineForPoints(points, {
        minConsecutive: lowestPointCount,

        tolerance: outlierThreshold || BASELINE_DEFAULT_TOLERANCE,

        monotonicTimeMax:
          outlierWindowMinutes > 0
            ? outlierWindowMinutes
            : MONOTONIC_DEFAULT_WINDOW_MINUTES,

        monotonicTolerance: outlierWindowPercent,

        removePreBaselineSpikes: removeEarlierPoints,
      });
      baselineIndices.forEach((index) => baselineSet.add(points[index].id));

      preExcludedIndices.forEach((index) => {
        const id = points[index].id;

        excludedSet.add(id);

        addReason(id, "pre_baseline_spike");
      });

      monotonicExcludedIndices.forEach((index) => {
        const id = points[index].id;

        excludedSet.add(id);

        addReason(id, "non_monotonic_segment");
      });
    });
    const buildKey = (set: Set<string>) => Array.from(set).sort().join("|");

    const reasonKey = Array.from(reasonMap.entries())

      .map(([id, reasons]) => `${id}:${[...reasons].sort().join(",")}`)

      .sort()

      .join("|");
    return {
      baselineSet,

      excludedSet,

      reasonMap,

      baselineKey: buildKey(baselineSet),

      excludedKey: buildKey(excludedSet),

      reasonKey,
    };
  }, [
    replicatePointData,
    lowestPointCount,
    outlierThreshold,
    outlierWindowMinutes,
    outlierWindowPercent,
  ]);
  const manualExcludeSet = useMemo(() => {
    const set = new Set<string>();

    Object.entries(overridesForRun).forEach(([id, state]) => {
      if (state === "exclude") set.add(id);
    });

    return set;
  }, [overridesKey]);
  const excludedPointSet = useMemo(() => {
    const set = new Set<string>(autoExcludedSet);

    manualExcludeSet.forEach((id) => set.add(id));

    Object.entries(overridesForRun).forEach(([id, state]) => {
      if (state === "exclude") set.add(id);

      if (state === "include") set.delete(id);
    });

    return set;
  }, [autoExcludedKey, manualExcludeSet, overridesKey]);
  const exclusionReasons = useMemo(() => {
    const map = new Map<string, string[]>();

    const add = (id: string, reason: string) => {
      if (!map.has(id)) map.set(id, []);

      map.get(id)!.push(reason);
    };

    autoReasonMap.forEach((reasons, id) => {
      map.set(id, [...reasons]);
    });

    manualExcludeSet.forEach((id) => add(id, "manual_exclude"));

    Object.entries(overridesForRun).forEach(([id, state]) => {
      if (state === "include") add(id, "manual_include");
    });

    return map;
  }, [autoReasonKey, manualExcludeSet, overridesKey]);
  const excludedPointSetKey = useMemo(
    () => Array.from(excludedPointSet).sort().join("|"),
    [excludedPointSet],
  );

  const selectedPointIds = useMemo(
    () => Array.from(excludedPointSet),
    [excludedPointSetKey],
  );
  const replicateExclusionState = useMemo(() => {
    const state: Record<string, "none" | "partial" | "all"> = {};

    replicatePointData.pointsByRep.forEach((points, key) => {
      if (!points.length) {
        state[key] = "none";

        return;
      }

      let excludedCount = 0;

      points.forEach((point) => {
        if (excludedPointSet.has(point.id)) excludedCount += 1;
      });

      if (excludedCount === 0) state[key] = "none";
      else if (excludedCount === points.length) state[key] = "all";
      else state[key] = "partial";
    });

    return state;
  }, [replicatePointData, excludedPointSetKey]);
  const sampleExclusionState = useMemo(() => {
    const summary = new Map<string, { total: number; excluded: number }>();

    replicatePointData.pointsByRep.forEach((points, key) => {
      const [sampleName] = key.split("|");

      if (!summary.has(sampleName))
        summary.set(sampleName, { total: 0, excluded: 0 });

      const entry = summary.get(sampleName)!;

      entry.total += points.length;

      points.forEach((point) => {
        if (excludedPointSet.has(point.id)) entry.excluded += 1;
      });
    });

    const state: Record<string, "none" | "partial" | "all"> = {};

    Object.keys(sampleReplicates).forEach((sampleName) => {
      const entry = summary.get(sampleName);

      if (!entry || entry.total === 0 || entry.excluded === 0) {
        state[sampleName] = "none";
      } else if (entry.excluded >= entry.total) {
        state[sampleName] = "all";
      } else {
        state[sampleName] = "partial";
      }
    });

    return state;
  }, [replicatePointData, excludedPointSetKey, sampleReplicatesKey]);
  const minPanX = useMemo(() => {
    if (replicatePointData.minX == null || replicatePointData.maxX == null)
      return undefined;

    const span = Math.max(1, replicatePointData.maxX - replicatePointData.minX);

    return replicatePointData.minX - span * 0.5;
  }, [replicatePointData.minX, replicatePointData.maxX]);
  const minPanY = useMemo(() => {
    if (replicatePointData.minY == null || replicatePointData.maxY == null)
      return undefined;

    const span = Math.max(1, replicatePointData.maxY - replicatePointData.minY);

    return replicatePointData.minY - span * 0.5;
  }, [replicatePointData.minY, replicatePointData.maxY]);
  const setPointState = useCallback(
    (point: RawReplicatePointMeta, desiredExcluded: boolean) => {
      if (!datasetRunId) return;

      const defaultExcluded = autoExcludedSet.has(point.id);

      const manualState = overridesForRun[point.id];

      const currentExcluded = manualState
        ? manualState === "exclude"
        : defaultExcluded;

      if (currentExcluded === desiredExcluded) return;

      let nextOverride: RawDataPointOverride | null = null;

      if (desiredExcluded === defaultExcluded) {
        nextOverride = null;
      } else {
        nextOverride = desiredExcluded ? "exclude" : "include";
      }

      setRawDataPointOverride(datasetRunId, point.id, nextOverride);
    },

    [datasetRunId, autoExcludedKey, overridesKey, setRawDataPointOverride],
  );
  const handlePointToggle = useCallback(
    (point: RawReplicatePointMeta) => {
      if (!datasetRunId) return;

      const defaultExcluded = autoExcludedSet.has(point.id);

      const manualState = overridesForRun[point.id];

      const currentExcluded = manualState
        ? manualState === "exclude"
        : defaultExcluded;

      setPointState(point, !currentExcluded);
    },

    [
      datasetRunId,
      autoExcludedKey,
      overridesKey,
      overridesForRun,
      setPointState,
    ],
  );
  const handleSelectionBox = useCallback(
    (points: RawReplicatePointMeta[]) => {
      points.forEach((point) => setPointState(point, true));
    },

    [setPointState],
  );
  const handleSetReplicateExcluded = useCallback(
    (sampleName: string, replicate: number, desiredExcluded: boolean) => {
      const key = `${sampleName}|${replicate}`;

      const points = replicatePointData.pointsByRep.get(key);

      if (!points?.length) return;

      if (desiredExcluded) {
        points.forEach((point) => setPointState(point, desiredExcluded));
      } else {
        // Clear manual overrides so auto-exclusion runs fresh after restoring.
        points.forEach((point) =>
          setRawDataPointOverride(datasetRunId, point.id, null),
        );
      }
    },

    [datasetRunId, replicatePointData, setPointState, setRawDataPointOverride],
  );
  const handleSetSampleExcluded = useCallback(
    (sampleName: string, desiredExcluded: boolean) => {
      replicatePointData.pointsByRep.forEach((points, key) => {
        if (!points.length) return;

        if (!key.startsWith(`${sampleName}|`)) return;

        if (desiredExcluded) {
          points.forEach((point) => setPointState(point, desiredExcluded));
        } else {
          // Clear overrides for the restored sample to let auto logic re-apply.
          points.forEach((point) =>
            setRawDataPointOverride(datasetRunId, point.id, null),
          );
        }
      });
    },

    [datasetRunId, replicatePointData, setPointState, setRawDataPointOverride],
  );
  const handleRerunAutoExclusion = useCallback(() => {
    if (!datasetRunId) return;
    resetRawDataPointOverrides(datasetRunId);
  }, [datasetRunId, resetRawDataPointOverrides]);
  const buildCuratedPayload = useCallback(() => {
    if (!selectedDataset || !mappingForAssignment) return;
    const assignmentEntry = buildAssignmentEntry(
      selectedDataset,
      mappingForAssignment,
    );
    if (!assignmentEntry) return;
    const curatedStamp = new Date().toISOString();
    const rowsWithCuration = assignmentEntry.dataset.rows.map((row) => {
      const normalizedSeconds = Number((row.time_min * 60).toFixed(6));
      const pointId = makePointId(row.well, normalizedSeconds);
      const excluded = excludedPointSet.has(pointId);
      const reasons = exclusionReasons.get(pointId) ?? [];
      if (!excluded && !reasons.length) return row;
      return {
        ...row,
        curation: {
          excluded,
          reasons,
        },
      };
    });
    const excludedPoints: any[] = [];
    excludedPointSet.forEach((id) => {
      const meta = replicatePointData.pointById.get(id);
      if (!meta) return;
      excludedPoints.push({
        id,
        sample: meta.sample,
        replicate: meta.replicate,
        well: meta.well,
        timeSeconds: meta.timeSeconds,
        timeMinutes: +(meta.timeSeconds / 60).toFixed(4),
        value: meta.value,
        reasons: exclusionReasons.get(id) ?? [],
      });
    });
    excludedPoints.sort((a, b) => {
      const sampleOrder = String(a.sample || "").localeCompare(
        String(b.sample || ""),
        undefined,
        { numeric: true },
      );
      if (sampleOrder !== 0) return sampleOrder;
      const wellOrder = String(a.well || "").localeCompare(
        String(b.well || ""),
        undefined,
        { numeric: true },
      );
      if (wellOrder !== 0) return wellOrder;
      return Number(a.timeSeconds ?? 0) - Number(b.timeSeconds ?? 0);
    });
    const curatedEntry = {
      ...assignmentEntry,
      dataset: {
        ...assignmentEntry.dataset,
        rows: rowsWithCuration,
        curatedAt: curatedStamp,
        curation: {
          generatedAt: curatedStamp,
          reviewer: "raw_data_check",
          settings: {
            baselineMinConsecutive: lowestPointCount,
            baselineTolerance: outlierThreshold,
            baselinePreWindowMinutes: BASELINE_T_PRE_MINUTES,
            baselineBinWidth: BASELINE_BIN_WIDTH,
            removePreBaselineSpikes: removeEarlierPoints,
            monotonicWindowMinutes: outlierWindowMinutes,
            monotonicTolerance: outlierWindowPercent,
          },
          excludedCount: excludedPoints.length,
          excludedPoints,
        },
      },
    };
    const payload = {
      version: 5,
      createdAt: curatedStamp,
      curated: true,
      assignments: [curatedEntry],
    };
    const filename = sanitizeFileName(
      `${selectedDataset.sourceFile || selectedDataset.runId || "dataset"}-curated-data.json`,
    );
    return { payload, filename };
  }, [
    selectedDataset?.runId,
    selectedDataset?.sourceFile,
    mappingForAssignment,
    excludedPointSetKey,
    replicatePointData.pointById,
    exclusionReasons,
    lowestPointCount,
    removeEarlierPoints,
    outlierThreshold,
    outlierWindowMinutes,
    outlierWindowPercent,
  ]);
  const handleExportCurated = useCallback(() => {
    const result = buildCuratedPayload();
    if (!result) return;
    const json = JSON.stringify(result.payload, null, 2);
    downloadBlob(
      new Blob([json], { type: "application/json;charset=utf-8" }),
      result.filename,
    );
    setBlankCorrectionAssignments(result.payload.assignments ?? null);
  }, [buildCuratedPayload, setBlankCorrectionAssignments]);
  const handleSendToBlankCorrection = useCallback(() => {
    const result = buildCuratedPayload();
    if (!result) return;
    setBlankCorrectionAssignments(result.payload.assignments ?? null);
    setActiveTab("interactive");
    if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
    }
  }, [buildCuratedPayload, setBlankCorrectionAssignments, setActiveTab]);

  useEffect(() => {
    if (!autoRun || autoRun.stage !== "toBlank") return;
    if (!autoRun.runId) {
      setAutoRun({ stage: "error", error: "Missing dataset for fast-track run." });
      return;
    }
    if (selectedRunId !== autoRun.runId) {
      setSelectedRunId(autoRun.runId);
      setPlotsSelectedRunId(autoRun.runId);
      return;
    }
    const dataset = datasetList.find((d) => d.runId === autoRun.runId);
    if (!dataset) {
      setAutoRun({ stage: "error", error: "Dataset not found for fast-track run." });
      return;
    }
    const desiredMappingId = autoRun.mappingId;
    if (desiredMappingId) {
      const currentMappingId = datasetMapping[autoRun.runId];
      if (currentMappingId !== desiredMappingId) {
        if (mappings[desiredMappingId]) {
          setDatasetMappings({ [autoRun.runId]: desiredMappingId });
        } else {
          setAutoRun({ stage: "error", error: "Mapping not found for fast-track run." });
        }
        return;
      }
      if (!selectedMapping || selectedMapping.id !== desiredMappingId) {
        return;
      }
    } else if (!selectedMapping) {
      setAutoRun({ stage: "error", error: "Select a mapping before fast-track run." });
      return;
    }
    handleSendToBlankCorrection();
    setAutoRun({ stage: "blankQueued", error: null });
  }, [
    autoRun,
    datasetList,
    datasetMapping,
    handleSendToBlankCorrection,
    mappings,
    selectedMapping,
    selectedRunId,
    setAutoRun,
    setDatasetMappings,
    setPlotsSelectedRunId,
  ]);

  const [title, setTitle] = useState<string>("");

  const [xLabel, setXLabel] = useState<string>("");

  const [yLabel, setYLabel] = useState<string>("");

  const [fontScale, setFontScale] = useState<number>(1);

  const [chartResetKey, setChartResetKey] = useState(0);
  // Populate default chart metadata once a dataset is chosen.

  useEffect(() => {
    if (selectedDataset) {
      setTitle(`${selectedDataset.sourceFile} - Combined`);

      setXLabel("Time (min)");

      setYLabel(selectedDataset.measurementType || "Value");
    }
  }, [selectedDataset?.runId]);

  useEffect(() => {
    setChartResetKey((key) => key + 1);
  }, [selectedDataset?.runId, selectedMapping?.id]);

  // Preserve mapping-defined ordering for samples while ensuring any extras still appear.

  const orderedSamples = useMemo(() => {
    const seen = new Set<string>();

    const order: string[] = [];

    const mappingOrder = selectedMapping?.samples ?? [];

    for (const name of mappingOrder) {
      if (sampleReplicates[name] && !seen.has(name)) {
        seen.add(name);

        order.push(name);
      }
    }

    for (const name of Object.keys(sampleReplicates)) {
      if (!seen.has(name)) {
        seen.add(name);

        order.push(name);
      }
    }

    return order;
  }, [selectedMapping?.samples, sampleReplicates]);
  const orderedSamplesKey = useMemo(
    () => orderedSamples.join("\u0001"),
    [orderedSamples],
  );
  const sampleOrderIndex = useMemo(() => {
    const index = new Map<string, number>();

    orderedSamples.forEach((sample, i) => index.set(sample, i));

    return index;
  }, [orderedSamplesKey]);
  // Flatten sample/replicate combinations into stable keys used throughout selection and highlighting logic.

  const allKeys = useMemo(
    () =>
      Object.entries(sampleReplicates).flatMap(([sample, reps]) =>
        reps.map(({ replicate }) => `${sample}|${replicate}`),
      ),
    [sampleReplicates],
  );
  const orderedKeys = useMemo(
    () =>
      orderedSamples.flatMap((sample) =>
        (sampleReplicates[sample] ?? []).map(
          (rep) => `${sample}|${rep.replicate}`,
        ),
      ),
    [orderedSamplesKey, sampleReplicatesKey],
  );
  const orderedKeysKey = useMemo(
    () => orderedKeys.join("\u0001"),
    [orderedKeys],
  );

  const firstSampleKeys = useMemo(() => {
    if (!orderedSamples.length) return [];

    const first = orderedSamples[0];

    const reps = sampleReplicates[first] ?? [];

    return reps.map(({ replicate }) => `${first}|${replicate}`);
  }, [orderedSamplesKey, sampleReplicatesKey]);
  const samplesWithPointsKey = useMemo(() => {
    const samples: string[] = [];
    replicatePointData.pointsByRep.forEach((points, key) => {
      if (!points.length) return;
      const [sample] = key.split("|");
      if (sample) samples.push(sample);
    });
    return Array.from(new Set(samples))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .join("|");
  }, [replicatePointData]);
  const firstSampleWithPointsKeys = useMemo(() => {
    if (!samplesWithPointsKey) return [];
    const presentSamples = samplesWithPointsKey.split("|");
    const target =
      orderedSamples.find((name) => presentSamples.includes(name)) ??
      presentSamples[0] ??
      null;
    if (!target) return [];
    const reps = sampleReplicates[target] ?? [];
    return reps.map(({ replicate }) => `${target}|${replicate}`);
  }, [samplesWithPointsKey, orderedSamplesKey, sampleReplicatesKey]);

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const selectedKeysSignature = useMemo(
    () => selectedKeys.slice().sort().join("|"),
    [selectedKeys],
  );

  // Reset which series are shown whenever the dataset or mapping changes (default to first sample only).

  useEffect(() => {
    const fallbackList = firstSampleWithPointsKeys.length
      ? firstSampleWithPointsKeys
      : firstSampleKeys.length
      ? firstSampleKeys
      : allKeys;

    // Default to a single first replicate to avoid jumping to later samples.
    const single = fallbackList.length ? [fallbackList[0]] : [];
    setSelectedKeys(single);
  }, [
    selectedDataset?.runId,

    selectedMapping?.id,

    firstSampleWithPointsKeys.join("\u0001"),

    firstSampleKeys.join("\u0001"),

    allKeys.join("\u0001"),
  ]);
  // Compose combined-chart series by merging every selected replicate into a single array.

  const pointsSeries: Series[] = useMemo(() => {
    if (!selectedDataset) return [];

    const entries: Series[] = [];

    const keys = Array.from(replicatePointData.pointsByRep.keys()).sort(
      (a, b) => {
        const [sampleA, repA] = a.split("|");

        const [sampleB, repB] = b.split("|");

        const orderA = sampleOrderIndex.get(sampleA) ?? Number.MAX_SAFE_INTEGER;

        const orderB = sampleOrderIndex.get(sampleB) ?? Number.MAX_SAFE_INTEGER;

        if (orderA !== orderB) return orderA - orderB;

        return Number(repA) - Number(repB);
      },
    );
    keys.forEach((key) => {
      if (!selectedKeys.includes(key)) return;

      const [sampleName, replicateStr] = key.split("|");

      const replicate = Number(replicateStr) || 1;

      const baseColor =
        selectedMapping?.sampleColors?.[sampleName] ?? "#60a5fa";

      const rawPoints = replicatePointData.pointsByRep.get(key) ?? [];

      if (!rawPoints.length) return;

      entries.push({
        name: `${sampleName} R${replicate}`,

        color: baseColor,

        points: rawPoints.map((point) => {
          const excluded = excludedPointSet.has(point.id);

          const strokeColor = excluded ? "#000000" : baseColor;

          const strokeWidth = excluded ? 1.8 : 1;

          const fillColor = excluded ? "#ffffff" : baseColor;

          const fillOpacity = excluded ? 0.3 : 1;

          return {
            x: point.x,

            y: point.value,

            id: point.id,

            meta: {
              id: point.id,

              sample: point.sample,

              replicate: point.replicate,

              well: point.well,

              timeSeconds: point.timeSeconds,

              value: point.value,

              excluded,

              strokeColor,

              strokeWidth,

              fillColor,

              fillOpacity,
            } as RawReplicatePointMeta,
          };
        }),
      });
    });
    return entries;
  }, [
    selectedDataset?.runId,

    replicatePointData,

    selectedKeys.join("\u0001"),

    selectedMapping?.sampleColors,

    excludedPointSetKey,

    orderedSamplesKey,

    sampleOrderIndex,

    autoBaselineKey,
  ]);
  // Map display names back to selection keys so hover/highlight logic stays in sync.

  const seriesKeyByName = useMemo(() => {
    const map = new Map<string, string>();

    Object.entries(sampleReplicates).forEach(([sampleName, reps]) => {
      reps.forEach((rep) => {
        map.set(
          `${sampleName} R${rep.replicate}`,
          `${sampleName}|${rep.replicate}`,
        );
      });
    });

    return map;
  }, [sampleReplicatesKey]);
  const [highlighted, setHighlighted] = useState<string[]>([]);
  // Keep a pivot replicate so global arrow navigation can advance selection without requiring prior focus.
  const navPivotRef = useRef<string | null>(null);

  const getSampleKeys = useCallback(
    (sampleName: string) =>
      (sampleReplicates[sampleName] ?? []).map(
        ({ replicate }) => `${sampleName}|${replicate}`,
      ),
    [sampleReplicatesKey],
  );

  const findNextSample = useCallback(
    (currentSample: string, direction: 1 | -1) => {
      if (!orderedSamples.length) return null;
      const startIndex = Math.max(0, orderedSamples.indexOf(currentSample));
      for (let step = 1; step <= orderedSamples.length; step += 1) {
        const idx =
          (startIndex + direction * step + orderedSamples.length) %
          orderedSamples.length;
        const candidate = orderedSamples[idx];
        if ((sampleReplicates[candidate]?.length ?? 0) > 0) return candidate;
      }
      return null;
    },
    [orderedSamplesKey, sampleReplicatesKey],
  );

  const findNextKey = useCallback(
    (currentKey: string, direction: 1 | -1) => {
      if (!orderedKeys.length) return null;
      const startIndex = orderedKeys.indexOf(currentKey);
      const base =
        startIndex === -1 ? (direction === 1 ? -1 : 0) : startIndex;
      const nextIndex =
        (base + direction + orderedKeys.length) % orderedKeys.length;
      return orderedKeys[nextIndex] ?? null;
    },
    [orderedKeysKey],
  );

  const handleGlobalNavigate = useCallback(
    (direction: 1 | -1, withSample: boolean) => {
      if (!orderedKeys.length) return;
      let pivot = navPivotRef.current;
      if (!pivot || !orderedKeys.includes(pivot)) {
        pivot =
          selectedKeys.find((key) => orderedKeys.includes(key)) ??
          orderedKeys[0];
      }
      if (!pivot) return;

      // When nothing is selected yet, start with the pivot so the first
      // arrow press immediately focuses a replicate without needing a click.
      if (selectedKeys.length === 0 && !withSample) {
        navPivotRef.current = pivot;
        setSelectedKeys([pivot]);
        const [sample, repStr] = pivot.split("|");
        const repNum = Number(repStr) || 1;
        setHighlighted([`${sample} R${repNum}`]);
        return;
      }

      const desired: string[] = [];

      if (withSample) {
        const currentSample = pivot.split("|")[0];
        const targetSample =
          findNextSample(currentSample, direction) ?? currentSample;
        const keys = getSampleKeys(targetSample);
        if (!keys.length) return;
        desired.push(keys[0]);
      } else {
        const nextKey = findNextKey(pivot, direction);
        if (!nextKey) return;
        desired.push(nextKey);
      }

      const targetKey = desired[0];
      navPivotRef.current = targetKey;
      setSelectedKeys(desired);
      const [sample, repStr] = targetKey.split("|");
      const repNum = Number(repStr) || 1;
      setHighlighted([`${sample} R${repNum}`]);
    },
    [
      findNextKey,
      findNextSample,
      getSampleKeys,
      orderedKeysKey,
      selectedKeysSignature,
    ],
  );

  useEffect(() => {
    if (!orderedKeys.length) {
      navPivotRef.current = null;
      return;
    }
    const fallback =
      selectedKeys.find((key) => orderedKeys.includes(key)) ?? orderedKeys[0];
    navPivotRef.current = fallback ?? null;
  }, [orderedKeysKey, selectedKeysSignature]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (activeTab !== "plots") return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        handleGlobalNavigate(event.key === "ArrowDown" ? 1 : -1, event.shiftKey);
        return;
      }
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        handleResetView();
        return;
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [activeTab, handleGlobalNavigate]);
  // Toggle a replicate on/off from legend or selection chips and keep highlight state aligned.

  const toggleLegendKey = useCallback(
    (key: string) => {
      setSelectedKeys((prev) => {
        let next: string[];

        if (prev.includes(key)) {
          next = prev.filter((k) => k !== key);
        } else {
          const set = new Set([...prev, key]);

          next = allKeys.filter((k) => set.has(k));
        }
        setHighlighted((current) =>
          current.filter((name) => {
            const mapped = seriesKeyByName.get(name);

            return !mapped || next.includes(mapped);
          }),
        );
        return next;
      });
    },
    [allKeys, seriesKeyByName],
  );
  const handleToggleAll = useCallback(() => {
    setSelectedKeys((prev) => {
      if (prev.length === allKeys.length) {
        setHighlighted([]);

        return [];
      }

      setHighlighted([]);

      return allKeys;
    });
  }, [allKeys]);
  const handleToggleSample = useCallback(
    (sampleName: string) => {
      const reps = sampleReplicates[sampleName] ?? [];

      if (!reps.length) return;

      const sampleKeys = reps.map(
        ({ replicate }) => `${sampleName}|${replicate}`,
      );

      setSelectedKeys((prev) => {
        const prevSet = new Set(prev);

        const shouldSelect = sampleKeys.some((key) => !prevSet.has(key));

        if (shouldSelect) {
          sampleKeys.forEach((key) => prevSet.add(key));
        } else {
          sampleKeys.forEach((key) => prevSet.delete(key));
        }

        const next = allKeys.filter((key) => prevSet.has(key));

        setHighlighted((current) =>
          current.filter((name) => {
            const mapped = seriesKeyByName.get(name);

            return !mapped || next.includes(mapped);
          }),
        );

        return next;
      });
    },
    [sampleReplicatesKey, allKeys, seriesKeyByName],
  );
  const handleResetView = useCallback(() => {
    setChartResetKey((key) => key + 1);
  }, []);
  // Drop highlight entries when their backing series has been deselected.

  useEffect(() => {
    setHighlighted((prev) =>
      prev.filter((name) => {
        const mapped = seriesKeyByName.get(name);

        return !mapped || selectedKeys.includes(mapped);
      }),
    );
  }, [selectedKeys, seriesKeyByName]);
  // Clear highlight on dataset/mapping change.

  useEffect(() => {
    setHighlighted([]);
  }, [selectedDataset?.runId, selectedMapping?.id]);
  const sampleColors = selectedMapping?.sampleColors ?? {};
  const chartRef = useRef<HTMLDivElement | null>(null);
  // Active container implementations. Add new variants in the corresponding containers/* folders.

  const activeCombinedContainer = combinedContainers[0]!;

  const activeReplicateSelectionContainer = replicateSelectionContainers[0]!;
  const CombinedContainer = activeCombinedContainer.Component;

  const ReplicateSelectionContainerComponent =
    activeReplicateSelectionContainer.Component;

  return (
    <div className="raw-data-page">
        <div className="panel panel-landing raw-data-info">
          <div className="panel-heading panel-heading--centered">
            <div>
              <div className="eyebrow">{isPl ? "Dane surowe" : "Raw Data"}</div>
              <h2 className="info-card__title">
                {isPl ? "Kontrola Danych" : "Data Control Module"}
              </h2>
              <p className="small info-card__description">
                {isPl
                  ? "Sprawdź czy w próbie bez bakterii nie doszło do wzrostu. Porównaj wszystkie replikaty danej próby. Wyklucz z analizy 'outliery'-dane które znacznie odstają od reszty i nie odzwierciedlają wzrostu bakterii. Jest to ważne zwłaszcza na początku krzywej - w kolejnych krokach będzie ustalany blank oraz faza logarytmiczna. Możesz wykluczyć z dalszej analizy całe replikaty lub pojedyncz punkty. Niektóre punkty już zostały wykluczone automatycznie zgodnie z parametrami poniżej."
                  : "Check that there is no growth in the control sample. Compare all replicates of a given sample. Exclude 'outliers' - data points that significantly deviate from the rest and do not reflect bacterial growth. This is especially important at the beginning of the curve - in subsequent steps, the blank and logarithmic phase will be determined. You can exclude entire replicates or individual points from further analysis. Some points have already been automatically excluded according to the parameters below."}
            </p>
          </div>
        </div>
      </div>

      {!selectedDataset || !selectedMapping ? (
        <div className="panel panel-soft raw-data-empty">
          {isPl
            ? "Brak aktywnego zestawu danych lub mapowania. Wroc do Setup i pobierz assignment."
            : "No active dataset or mapping. Return to Setup and download an assignment first."}
        </div>
      ) : (
        <CombinedContainer
          fontScale={fontScale}
          setFontScale={setFontScale}
          title={title}
          setTitle={setTitle}
          xLabel={xLabel}
          setXLabel={setXLabel}
          yLabel={yLabel}
          setYLabel={setYLabel}
          pointsSeries={pointsSeries}
          chartRef={chartRef}
          highlightedNames={highlighted}
          orderedSamples={orderedSamples}
          sampleReplicates={sampleReplicates}
          selectedKeys={selectedKeys}
          onToggleKey={toggleLegendKey}
          onToggleSample={handleToggleSample}
          highlighted={highlighted}
          setHighlighted={setHighlighted}
          sampleColors={sampleColors}
          varyReplicateColor={varyReplicateColor}
          allKeys={allKeys}
          onToggleAll={handleToggleAll}
          replicateExclusionState={replicateExclusionState}
          sampleExclusionState={sampleExclusionState}
          onSetReplicateExcluded={handleSetReplicateExcluded}
          onSetSampleExcluded={handleSetSampleExcluded}
          replicateSelectionContainerComponent={
            ReplicateSelectionContainerComponent
          }
          lowestPointCount={lowestPointCount}
          onLowestPointCountChange={(value) =>
            setRawDataSettings({ lowestPointCount: value })
          }
          outlierThreshold={outlierThreshold}
          onOutlierThresholdChange={(value) =>
            setRawDataSettings({ outlierThreshold: value })
          }
          outlierWindowMinutes={outlierWindowMinutes}
          onOutlierWindowMinutesChange={(value) =>
            setRawDataSettings({ outlierWindowMinutes: value })
          }
          outlierWindowPercent={outlierWindowPercent}
          onOutlierWindowPercentChange={(value) =>
            setRawDataSettings({ outlierWindowPercent: value })
          }
          onRerunAutoExclusion={handleRerunAutoExclusion}
          selectedPointIds={selectedPointIds}
          onChartPointToggle={handlePointToggle}
          onChartSelection={handleSelectionBox}
          minPanX={minPanX}
          minPanY={minPanY}
          resetViewKey={`${selectedDataset?.runId ?? ""}|${selectedMapping?.id ?? ""}|${chartResetKey}`}
          onResetView={handleResetView}
          onExportCurated={handleExportCurated}
          onSendToBlankCorrection={handleSendToBlankCorrection}
        />
      )}
    </div>
  );
}

