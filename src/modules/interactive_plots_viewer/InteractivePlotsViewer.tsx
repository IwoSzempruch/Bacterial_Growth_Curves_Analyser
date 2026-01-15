import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { StandardLineChartCard } from "@/components/StandardLineChartCard";
import { PanelWithHelp } from "@/components/PanelWithHelp";
import { HelpTooltip } from "@/components/HelpTooltip";
import type { Series } from "@/components/SimpleLineChart";
import { useApp } from "@/state/store";
import type { AssignmentEntry } from "@/utils/assignments";
import { downloadBlob, sanitizeFileName } from "@/utils/export";
import { formatWellA01 } from "@/utils/csv";
import { generateDistinctColors } from "@/utils/colors";
import { makePointId } from "@/modules/raw_data/exclusion";

const GOLD_STROKE = "#f59e0b";
const DEFAULT_SAMPLE_COLOR = "#2563eb";

// Subtle color shifts for replicate curves to keep lines distinguishable.
function varyReplicateColor(base: string, replicate: number): string {
  if (replicate <= 1) return base;
  const hex = base.startsWith("#") ? base.slice(1) : base;
  const num = parseInt(hex, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const clamp = (value: number) => Math.min(255, Math.max(0, value));
  const variants = [
    [12, 16, 18],
    [-10, -6, -8],
    [14, 10, 6],
  ];
  const delta = variants[(replicate - 2) % variants.length];
  const next = [clamp(r + delta[0]), clamp(g + delta[1]), clamp(b + delta[2])]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  return `#${next}`;
}

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

function PlotControlsPanel({
  title,
  chartTitle,
  setChartTitle,
  xLabel,
  setXLabel,
  yLabel,
  setYLabel,
  fontScale,
  setFontScale,
  onResetView,
  onExportPng,
  onCopyPng,
  onToggleLegend,
  legendOpen,
  legendPanel,
  isPl,
  disabled,
}: {
  title?: string;
  chartTitle: string;
  setChartTitle: (value: string) => void;
  xLabel: string;
  setXLabel: (value: string) => void;
  yLabel: string;
  setYLabel: (value: string) => void;
  fontScale: number;
  setFontScale: (fn: (value: number) => number) => void;
  onResetView: () => void;
  onExportPng: () => void;
  onCopyPng: () => void;
  onToggleLegend: () => void;
  legendOpen: boolean;
  legendPanel?: JSX.Element | null;
  isPl: boolean;
  disabled?: boolean;
}) {
  const helpContent = isPl
    ? "Steruj tytułem, osiami, rozmiarem czcionki i eksportem wykresu Blank Check. Reset przywraca domyślny widok."
    : "Adjust chart title, axes, text size, and export controls for Blank Check chart. Reset restores the default view.";

  return (
    <PanelWithHelp
      title={title || "Plot Controls"}
      helpContent={helpContent}
      className="panel-soft control-panel"
    >
      <div className="control-grid">
        <label className="field">
          <div className="field-label-row">
            <span>{isPl ? "Tytuł wykresu" : "Chart title"}</span>
          </div>
          <input
            className="field-input"
            value={chartTitle}
            onChange={(e) => setChartTitle(e.target.value)}
            disabled={disabled}
          />
        </label>
        <label className="field">
          <div className="field-label-row">
            <span>{isPl ? "Oś X" : "X axis"}</span>
          </div>
          <input
            className="field-input"
            value={xLabel}
            onChange={(e) => setXLabel(e.target.value)}
            disabled={disabled}
          />
        </label>
        <label className="field">
          <div className="field-label-row">
            <span>{isPl ? "Oś Y" : "Y axis"}</span>
          </div>
          <input
            className="field-input"
            value={yLabel}
            onChange={(e) => setYLabel(e.target.value)}
            disabled={disabled}
          />
        </label>
      </div>
      <div className="control-row">
        <div className="btn-pair">
          <button
            className="btn"
            onClick={() => setFontScale((s) => Math.max(0.6, +(s - 0.1).toFixed(1)))}
            title={isPl ? "Mniejsza czcionka" : "Smaller text"}
            disabled={disabled}
          >
            A-
          </button>
          <button
            className="btn"
            onClick={() => setFontScale((s) => Math.min(2, +(s + 0.1).toFixed(1)))}
            title={isPl ? "Większa czcionka" : "Larger text"}
            disabled={disabled}
          >
            A+
          </button>
        </div>
        <div className="control-actions" style={{ gap: 8 }}>
          <button type="button" className="btn" onClick={onExportPng} disabled={disabled}>
            {isPl ? "Eksportuj PNG" : "Export PNG"}
          </button>
          <button type="button" className="btn" onClick={onCopyPng} disabled={disabled}>
            {isPl ? "Kopiuj PNG" : "Copy PNG"}
          </button>
          <label
            className={`parameters-toggle ${legendOpen ? "is-on" : ""}`}
            title={legendOpen ? (isPl ? "Ukryj legendę" : "Hide legend") : isPl ? "Pokaż legendę" : "Show legend"}
          >
            <input
              type="checkbox"
              checked={legendOpen}
              onChange={onToggleLegend}
              disabled={disabled}
              aria-pressed={legendOpen}
            />
            <span className="parameters-toggle__slider" aria-hidden />
            <span className="parameters-toggle__label">
              {legendOpen ? (isPl ? "Ukryj legendę" : "Hide legend") : isPl ? "Legenda" : "Legend"}
            </span>
          </label>
          <button type="button" className="btn primary" onClick={onResetView} disabled={disabled}>
            {isPl ? "Reset widoku" : "Reset view"}
          </button>
        </div>
      </div>
      {legendPanel}
    </PanelWithHelp>
  );
}

function ReplicatePanel({
  orderedSamples,
  sampleReplicates,
  selectedKeys,
  onToggleKey,
  onToggleSample,
  highlighted,
  setHighlighted,
  sampleColors,
  isPl,
}: {
  orderedSamples: string[];
  sampleReplicates: Record<string, SampleReplicateInfo[]>;
  selectedKeys: string[];
  onToggleKey: (key: string) => void;
  onToggleSample: (sample: string) => void;
  highlighted: string[];
  setHighlighted: (value: string[]) => void;
  sampleColors: Map<string, string>;
  isPl: boolean;
}) {
  const helpAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const bootstrapRef = useRef(false);
  const keySignatureRef = useRef("");
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  const orderedKeys = useMemo(() => {
    const list: string[] = [];
    orderedSamples.forEach((sample) => {
      const reps = sampleReplicates[sample] ?? [];
      reps.forEach((rep) => list.push(`${sample}|${rep.replicate}`));
    });
    return list;
  }, [orderedSamples, sampleReplicates]);
  const orderedKeysSignature = useMemo(
    () => orderedKeys.join("|"),
    [orderedKeys],
  );

  useEffect(() => {
    if (keySignatureRef.current !== orderedKeysSignature) {
      keySignatureRef.current = orderedKeysSignature;
      bootstrapRef.current = false;
      setActiveKey(orderedKeys[0] ?? null);
    }
  }, [orderedKeysSignature, orderedKeys]);

  useEffect(() => {
    if (!orderedKeys.length) return;
    if (!activeKey) setActiveKey(orderedKeys[0]);
    if (!bootstrapRef.current && selectedKeys.length === 0) {
      onToggleKey(orderedKeys[0]);
      setActiveKey(orderedKeys[0]);
      bootstrapRef.current = true;
    }
  }, [activeKey, onToggleKey, orderedKeys, selectedKeys]);

  useEffect(() => {
    if (selectedKeys.length > 0) bootstrapRef.current = true;
  }, [selectedKeys.length]);

  const getSampleKeys = useCallback(
    (sampleName: string) =>
      (sampleReplicates[sampleName] ?? []).map(
        (rep) => `${sampleName}|${rep.replicate}`,
      ),
    [sampleReplicates],
  );

  const applySelection = useCallback(
    (desiredKeys: Set<string>) => {
      const current = new Set(selectedKeys);
      current.forEach((key) => {
        if (!desiredKeys.has(key)) onToggleKey(key);
      });
      desiredKeys.forEach((key) => {
        if (!current.has(key)) onToggleKey(key);
      });
    },
    [onToggleKey, selectedKeys],
  );

  const findNextKey = useCallback(
    (currentKey: string, direction: 1 | -1) => {
      if (!orderedKeys.length) return null;
      const startIndex = orderedKeys.indexOf(currentKey);
      const baseIndex =
        startIndex === -1
          ? direction === 1
            ? -1
            : 0
          : startIndex;
      const nextIndex =
        (baseIndex + direction + orderedKeys.length) % orderedKeys.length;
      return orderedKeys[nextIndex] ?? null;
    },
    [orderedKeys],
  );

  const findNextSample = useCallback(
    (currentSample: string, direction: 1 | -1) => {
      if (!orderedSamples.length) return null;
      const startIndex = Math.max(0, orderedSamples.indexOf(currentSample));
      for (let step = 1; step <= orderedSamples.length; step += 1) {
        const candidateIndex =
          (startIndex + direction * step + orderedSamples.length) %
          orderedSamples.length;
        const candidate = orderedSamples[candidateIndex];
        if ((sampleReplicates[candidate]?.length ?? 0) > 0) return candidate;
      }
      return null;
    },
    [orderedSamples, sampleReplicates],
  );

  const handleNavigate = useCallback(
    (direction: 1 | -1, withSample: boolean) => {
      if (!orderedKeys.length) return;
      const fallbackKey = orderedKeys[0];
      const currentKey =
        (activeKey && orderedKeys.includes(activeKey)
          ? activeKey
          : fallbackKey) ?? null;
      if (!currentKey) return;
      const desired = new Set(selectedKeys);
      if (withSample) {
        const currentSample = currentKey.split("|")[0];
        const currentKeys = getSampleKeys(currentSample);
        if (!currentKeys.length) return;
        const selectedInSample = currentKeys.filter((k) => desired.has(k));
        const currentAllSelected =
          selectedInSample.length === currentKeys.length && currentKeys.length > 0;
        if (!currentAllSelected) {
          currentKeys.forEach((key) => desired.add(key));
          applySelection(desired);
          setActiveKey(currentKeys[0]);
          return;
        }
        currentKeys.forEach((key) => desired.delete(key));
        const targetSample = findNextSample(currentSample, direction);
        const targetKeys = targetSample ? getSampleKeys(targetSample) : [];
        if (targetKeys.length) {
          targetKeys.forEach((key) => desired.add(key));
          applySelection(desired);
          setActiveKey(targetKeys[0]);
        } else {
          applySelection(desired);
          setActiveKey(null);
        }
        return;
      }
      const nextKey = findNextKey(currentKey, direction);
      if (!nextKey) return;
      if (nextKey !== currentKey) desired.delete(currentKey);
      desired.add(nextKey);
      applySelection(desired);
      setActiveKey(nextKey);
    },
    [
      activeKey,
      applySelection,
      findNextKey,
      findNextSample,
      getSampleKeys,
      onToggleKey,
      orderedKeys,
      orderedSamples,
      selectedKeys,
    ],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
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
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      handleNavigate(event.key === "ArrowDown" ? 1 : -1, event.shiftKey);
    };
    window.addEventListener("keydown", handler as any);
    return () => window.removeEventListener("keydown", handler as any);
  }, [handleNavigate]);

  useEffect(() => {
    const sample = activeKey ? activeKey.split("|")[0] : null;
    if (!sample) return;
    const node = refs.current[sample];
    if (node && node.scrollIntoView) {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [activeKey]);

  const handleKeyNav = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      handleNavigate(event.key === "ArrowDown" ? 1 : -1, event.shiftKey);
    },
    [handleNavigate],
  );

  const handleDeselectAll = useCallback(() => {
    if (!selectedKeys.length) return;
    selectedKeys.forEach((key) => onToggleKey(key));
    setActiveKey(null);
    setHighlighted([]);
  }, [onToggleKey, selectedKeys, setHighlighted]);

  const cards = useMemo(() => {
    const items: JSX.Element[] = [];

    for (const sampleName of orderedSamples) {
      const reps = sampleReplicates[sampleName] ?? [];
      if (!reps.length) continue;
      const sampleKeys = reps.map((rep) => `${sampleName}|${rep.replicate}`);
      const selectedCount = sampleKeys.filter((key) =>
        selectedKeys.includes(key),
      ).length;
      const fullySelected =
        selectedCount === sampleKeys.length && sampleKeys.length > 0;
      const partiallySelected =
        selectedCount > 0 && selectedCount < sampleKeys.length;
      const baseColor = sampleColors.get(sampleName) ?? DEFAULT_SAMPLE_COLOR;

      items.push(
        <div
          key={sampleName}
          className="replicate-card"
          onClick={() => {
            onToggleSample(sampleName);
            setActiveKey(sampleKeys[0] ?? null);
          }}
          ref={(node) => {
            if (node) refs.current[sampleName] = node;
          }}
        >
          <div className="replicate-card__top">
            <div className="replicate-card__identity">
              <span
                className="replicate-card__dot"
                style={{ background: baseColor }}
              />
              <div>
                <div className="replicate-card__name">{sampleName}</div>
                <div className="replicate-card__meta">
                  {isPl
                    ? `${reps.length} replikat${reps.length === 1 ? "" : "y"} · ${selectedCount} na wykresie`
                    : `${reps.length} replicate${reps.length === 1 ? "" : "s"} · ${selectedCount} on chart`}
                </div>
              </div>
            </div>
            <div className="replicate-card__toggles">
              <button
                type="button"
                className={`state-pill state-pill--plot ${fullySelected ? "is-on" : ""} ${partiallySelected ? "is-partial" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleSample(sampleName);
                  setActiveKey(sampleKeys[0] ?? null);
                }}
                aria-pressed={fullySelected}
                title={
                  fullySelected
                    ? isPl
                      ? "Ukryj replikaty tej próby"
                      : "Hide all replicates in this sample"
                    : isPl
                    ? "Pokaż replikaty tej próby"
                    : "Show all replicates in this sample"
                }
              >
                📈 {fullySelected ? "✓" : partiallySelected ? "~" : "✕"}
              </button>
            </div>
          </div>

          <div className="replicate-card__list" onKeyDown={handleKeyNav}>
            {reps.map((rep) => {
              const key = `${sampleName}|${rep.replicate}`;
              const active = selectedKeys.includes(key);
              const highlightedMatch = highlighted.includes(
                `${sampleName} R${rep.replicate}`,
              );
              return (
                <div
                  key={key}
                  className={`replicate-row replicate-row--single-toggle ${activeKey === key ? "is-focused" : ""} ${highlightedMatch ? "is-highlighted" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleKey(key);
                    setActiveKey(key);
                  }}
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onToggleKey(key);
                      setActiveKey(key);
                    } else {
                      handleKeyNav(event);
                    }
                  }}
                >
                  <div
                    className="replicate-row__label"
                    onMouseEnter={() =>
                      setHighlighted([`${sampleName} R${rep.replicate}`])
                    }
                    onFocus={() =>
                      setHighlighted([`${sampleName} R${rep.replicate}`])
                    }
                    onMouseLeave={() => setHighlighted([])}
                    onBlur={() => setHighlighted([])}
                  >
                    <span
                      className="replicate-row__badge"
                      style={{
                        color: varyReplicateColor(baseColor, rep.replicate),
                        borderColor: varyReplicateColor(baseColor, rep.replicate),
                      }}
                    >
                      R{rep.replicate}
                    </span>
                    <span className="replicate-row__name">
                      {rep.well.toUpperCase()}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`state-pill state-pill--plot ${active ? "is-on" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleKey(key);
                      setActiveKey(key);
                    }}
                    aria-pressed={active}
                    title={
                      active
                        ? isPl
                          ? "Ukryj krzywą na wykresie"
                          : "Hide curve on chart"
                        : isPl
                        ? "Pokaż krzywą na wykresie"
                        : "Show curve on chart"
                    }
                  >
                    {active ? "✓" : "✕"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>,
      );
    }

    if (!items.length) {
      items.push(
        <div key="empty" className="small">
          {isPl ? "Brak replikatów do wyświetlenia." : "No replicates assigned."}
        </div>,
      );
    }

    return items;
  }, [
    activeKey,
    highlighted,
    isPl,
    onToggleKey,
    onToggleSample,
    orderedSamples,
    sampleReplicates,
    selectedKeys,
    setHighlighted,
    sampleColors,
  ]);

  return (
    <div className="replicate-panel replicate-panel--single-toggle">
      <button
        ref={helpAnchorRef}
        type="button"
        className="help-btn circle replicate-panel__help-btn"
        onClick={() => setShowHelp((prev) => !prev)}
      >
        ?
      </button>
      <div className="replicate-panel__header">
        <div>
          <h3 className="replicate-panel__title">
            {isPl ? "Probki i replikaty" : "Samples & Replicates"}
          </h3>
          <p className="replicate-panel__description">
            {isPl
              ? "Kliknij nazwę, aby pokazać lub ukryć krzywą. Kolumna po prawej steruje widocznością na wykresach."
              : "Click a name to show or hide the curve. The right column controls plot visibility."}
          </p>
        </div>
        <div className="replicate-panel__actions">
          <button
            className="btn"
            onClick={handleDeselectAll}
            disabled={!selectedKeys.length}
            title={isPl ? "Odznacz wszystkie" : "Deselect all"}
          >
            {isPl ? "Wyczyść" : "Clear"}
          </button>
        </div>
      </div>
      <HelpTooltip anchorRef={helpAnchorRef} open={showHelp}>
        {isPl
          ? "Strzalki gora/dol przechodza miedzy replikatami; z Shiftem zaznaczysz cala probe. Panel steruje tylko widocznoscia krzywych."
          : "Use up/down arrows to move between replicates; hold Shift to toggle the whole sample. This panel only controls chart visibility."}
      </HelpTooltip>

      <div className="replicate-panel__legend">
        <span className="replicate-panel__legend-label">
          {isPl ? "Próba" : "Sample"}
        </span>
        <div className="replicate-panel__legend-pills">
          <span>{isPl ? "Wykres" : "Plot"}</span>
        </div>
      </div>

      <div className="replicate-panel__list" onKeyDown={handleKeyNav}>
        {cards}
      </div>
    </div>
  );
}

export default function InteractivePlotsViewer() {
  const autoAssignments = useApp((state) => state.blankCorrectionAssignments);
  const setCurvesSmoothingAssignments = useApp(
    (state) => state.setCurvesSmoothingAssignments,
  );
  const setActiveTab = useApp((state) => state.setActiveTab);
  const afterBlankRef = useRef<HTMLDivElement | null>(null);
  const language = useApp((state) => state.language);
  const isPl = language === "pl";
  const [assignments, setAssignments] = useState<AssignmentEntry[]>([]);
  const [activeEntryIndex, setActiveEntryIndex] = useState(0);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("");
  const [filename, setFilename] = useState<string>("");
  const [hasBlankApplied, setHasBlankApplied] = useState<boolean>(false);
  const [lastBlankPayload, setLastBlankPayload] = useState<string>("");
  const [lastBlankFilename, setLastBlankFilename] = useState<string>("");
  const [chartTitle, setChartTitle] = useState<string>("Blank Correction Check");
  const [xLabel, setXLabel] = useState<string>("");
  const [yLabelRaw, setYLabelRaw] = useState<string>("");
  const [yLabelBlank, setYLabelBlank] = useState<string>("");
  const [fontScale, setFontScale] = useState<number>(1);
  const [resetViewKey, setResetViewKey] = useState(0);
  const [chartFullscreen, setChartFullscreen] = useState<"raw" | "blank" | null>(null);
  const [showPlotControls, setShowPlotControls] = useState(true);
  const [legendEntries, setLegendEntries] = useState<
    { id: string; label: string; color: string; hidden?: boolean }[]
  >([]);
  const [legendScale, setLegendScale] = useState(1);
  const [legendTitle, setLegendTitle] = useState(isPl ? "Legenda" : "Legend");
  const [legendVisibleRaw, setLegendVisibleRaw] = useState(false);
  const [legendVisibleBlank, setLegendVisibleBlank] = useState(false);

  const rawChartRef = useRef<HTMLDivElement | null>(null);
  const blankChartRef = useRef<HTMLDivElement | null>(null);

  const activeEntry = assignments[activeEntryIndex] ?? null;
  const measurementKey = useMemo(
    () => resolveMeasurementKey(activeEntry),
    [activeEntry],
  );
  const measurementLabel =
    activeEntry?.dataset?.meta?.measurementType ?? "OD600";

  useEffect(() => {
    setXLabel((prev) => (prev ? prev : isPl ? "Czas (min)" : "Time (min)"));
    setYLabelRaw((prev) => (prev ? prev : `${measurementLabel} (raw)`));
    setYLabelBlank((prev) =>
      prev ? prev : `${measurementLabel} (blank-corrected)`,
    );
    setLegendTitle((prev) =>
      prev && prev !== "Legenda" && prev !== "Legend" ? prev : isPl ? "Legenda" : "Legend",
    );
  }, [isPl, measurementLabel]);

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

  const firstReplicateKey = useMemo(() => {
    const firstSample = orderedSamples[0];
    if (firstSample) {
      const reps = sampleReplicates[firstSample] ?? [];
      if (reps.length) return `${firstSample}|${reps[0].replicate}`;
    }
    return allReplicateKeys[0] ?? null;
  }, [allReplicateKeys, orderedSamples, sampleReplicates, sampleReplicatesKey]);

  // Keep legend entries in sync with available replicates, preserving labels and hidden flags.
  const selectedKeysSignature = useMemo(
    () => selectedKeys.slice().sort().join("|"),
    [selectedKeys],
  );
  const replicatePointsSignature = useMemo(
    () => Array.from(replicatePoints.keys()).sort().join("|"),
    [replicatePoints],
  );

  useEffect(() => {
    setLegendEntries((prev) => {
      const prevMap = new Map(prev.map((entry) => [entry.id, entry]));
      const next: typeof legendEntries = [];
      selectedKeys.forEach((key) => {
        const points = replicatePoints.get(key);
        if (!points) return;
        const [sample, replicateStr] = key.split("|");
        const replicate = Number(replicateStr) || 1;
        const baseColor = sampleColors.get(sample) ?? DEFAULT_SAMPLE_COLOR;
        const color = varyReplicateColor(baseColor, replicate);
        const prevEntry = prevMap.get(key);
        next.push({
          id: key,
          label: prevEntry?.label ?? `${sample} R${replicate}`,
          color,
          hidden: prevEntry?.hidden ?? false,
        });
      });
      return next;
    });
  }, [selectedKeysSignature, replicatePointsSignature, sampleColors]);

  useEffect(() => {
    if (!allReplicateKeys.length) {
      setSelectedKeys([]);
      return;
    }
    setSelectedKeys((prev) => {
      const retained = prev.filter((key) => allReplicateKeys.includes(key));
      if (retained.length) return retained;
      if (firstReplicateKey && allReplicateKeys.includes(firstReplicateKey)) {
        return [firstReplicateKey];
      }
      return allReplicateKeys.length ? [allReplicateKeys[0]] : [];
    });
  }, [
    activeEntryIndex,
    orderedSamplesKey,
    sampleReplicatesKey,
    allReplicateKeys,
    firstReplicateKey,
  ]);

  const hiddenLegendMap = useMemo(
    () => new Map(legendEntries.map((entry) => [entry.id, !!entry.hidden])),
    [legendEntries],
  );

  const visibleSeries: Series[] = useMemo(() => {
    const list: Series[] = [];
    replicatePoints.forEach((points, key) => {
      if (!selectedKeys.includes(key)) return;
      if (hiddenLegendMap.get(key)) return;
      const [sample, replicateStr] = key.split("|");
      const replicate = Number(replicateStr) || 1;
      const baseColor = sampleColors.get(sample) ?? DEFAULT_SAMPLE_COLOR;
      const color = varyReplicateColor(baseColor, replicate);
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
  }, [replicatePoints, selectedKeys, sampleColors, hiddenLegendMap]);

  const correctedSeries: Series[] = useMemo(() => {
    if (!hasBlankApplied) return [];
    const list: Series[] = [];
    replicatePoints.forEach((points, key) => {
      if (!selectedKeys.includes(key)) return;
      if (hiddenLegendMap.get(key)) return;
      const [sample, replicateStr] = key.split("|");
      const replicate = Number(replicateStr) || 1;
      const baseColor = sampleColors.get(sample) ?? DEFAULT_SAMPLE_COLOR;
      const color = varyReplicateColor(baseColor, replicate);
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
  }, [hasBlankApplied, replicatePoints, selectedKeys, sampleColors, hiddenLegendMap]);

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
      `[AUTO] Dane z Raw Data Check (${autoAssignments.length} assignment${
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

  const chartHelp = isPl
    ? "Na wykresach widać punkty dopuszczone do analizy. Złota obwódka oznacza punkty bazowe blanku. Przyciski umożliwiają pełny ekran oraz pokazanie Plot Controls."
    : "Charts show points included in analysis. Gold outline marks baseline blank points. Use the buttons for fullscreen and Plot Controls.";
  const resolvedXLabel = xLabel || (isPl ? "Czas (min)" : "Time (min)");
  const resolvedYRaw = yLabelRaw || `${measurementLabel} (raw)`;
  const resolvedYBlank = yLabelBlank || `${measurementLabel} (blank-corrected)`;

  const getChartSvg = useCallback(
    (ref: MutableRefObject<HTMLDivElement | null>) => {
      const node = ref.current;
      if (!node) return null;
      return node.querySelector("svg") as SVGSVGElement | null;
    },
    [],
  );

  const makeSafeName = useCallback((raw: string) => {
    const safe = (raw || "blank-check-plot").replace(/[^a-z0-9_-]+/gi, "-");
    return safe || "blank-check-plot";
  }, []);

  const buildPngBlob = useCallback(
    async (ref: MutableRefObject<HTMLDivElement | null>) => {
      const svg = getChartSvg(ref);
      if (!svg) return null;
      const serializer = new XMLSerializer();
      const source = serializer.serializeToString(svg);
      const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);
      const rect = svg.getBoundingClientRect();
      const viewBox = svg.viewBox?.baseVal;
      const width = Math.max(1, Math.round(viewBox?.width || rect.width || 1200));
      const height = Math.max(1, Math.round(viewBox?.height || rect.height || 600));
      return await new Promise<Blob | null>((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              resolve(null);
              return;
            }
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => resolve(blob), "image/png");
          } finally {
            URL.revokeObjectURL(url);
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(null);
        };
        img.src = url;
      });
    },
    [getChartSvg],
  );

  const exportPng = useCallback(
    async (ref: MutableRefObject<HTMLDivElement | null>, baseName: string) => {
      const blob = await buildPngBlob(ref);
      if (!blob) return;
      const name = `${makeSafeName(baseName)}.png`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    },
    [buildPngBlob, makeSafeName],
  );

  const copyPng = useCallback(
    async (ref: MutableRefObject<HTMLDivElement | null>, baseName: string) => {
      const blob = await buildPngBlob(ref);
      if (!blob) return;
      if (
        typeof ClipboardItem !== "undefined" &&
        navigator.clipboard &&
        "write" in navigator.clipboard
      ) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          return;
        } catch {
          // fallback to download below
        }
      }
      const name = `${makeSafeName(baseName)}.png`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    },
    [buildPngBlob, makeSafeName],
  );

  const handleLegendLabelChange = useCallback((id: string, label: string) => {
    setLegendEntries((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, label } : entry)),
    );
  }, []);

  const handleLegendToggle = useCallback((id: string) => {
    setLegendEntries((prev) =>
      prev.map((entry) =>
        entry.id === id ? { ...entry, hidden: !entry.hidden } : entry,
      ),
    );
  }, []);

  const legendPanel = useMemo(() => {
    if (!legendVisibleRaw && !legendVisibleBlank) return null;
    return (
      <div className="legend-editor panel-soft">
        <div className="legend-editor__header">
          <div>
            <div className="legend-editor__title">{legendTitle || (isPl ? "Legenda" : "Legend")}</div>
            <div className="legend-editor__subtitle">
              {isPl
                ? "Ukryj lub zmien nazwy wpisow legendy. Ukrycie nie usuwa serii z danych."
                : "Hide or rename legend entries. Hiding does not remove data from analysis."}
            </div>
            <label className="field" style={{ marginTop: 6 }}>
              <div className="field-label-row">
                <span>{isPl ? "Tytul legendy" : "Legend title"}</span>
              </div>
              <input
                className="field-input"
                value={legendTitle}
                onChange={(e) => setLegendTitle(e.target.value)}
                placeholder={isPl ? "Legenda" : "Legend"}
              />
            </label>
          </div>
          <div className="legend-editor__font">
            <span>{isPl ? "Rozmiar legendy" : "Legend text"}</span>
            <div className="btn-pair">
              <button
                type="button"
                className="btn"
                onClick={() => setLegendScale((s) => Math.max(0.6, +(s - 0.1).toFixed(1)))}
              >
                A-
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setLegendScale((s) => Math.min(2, +(s + 0.1).toFixed(1)))}
              >
                A+
              </button>
            </div>
          </div>
        </div>
        <div className="legend-editor__list">
          {legendEntries.map((entry) => (
            <div key={entry.id} className="legend-editor__row">
              <label className="legend-editor__checkbox">
                <input
                  type="checkbox"
                  checked={!entry.hidden}
                  onChange={() => handleLegendToggle(entry.id)}
                />
                <span>{isPl ? "Pokaż" : "Show"}</span>
              </label>
              <span
                className="legend-editor__swatch"
                style={{ background: entry.color }}
              />
              <input
                className="legend-editor__input"
                value={entry.label}
                onChange={(e) => handleLegendLabelChange(entry.id, e.target.value)}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }, [handleLegendLabelChange, handleLegendToggle, isPl, legendEntries, legendVisibleBlank, legendVisibleRaw]);

  const infoHelp = isPl
    ? "Krotkie wprowadzenie do etapu Blank Correction. Wybierz widoczne krzywe, obejrzyj blanki i uruchom korekte."
    : "Quick primer for the Blank Correction stage. Pick the curves you want visible, review blanks, and run the correction.";
  const applyHelp = isPl
    ? "Uruchamia korekte blank dla wszystkich assignmentow i zapisuje kopie danych do kolejnego kroku."
    : "Runs blank correction for all assignments and saves a copy of the data for the next step.";
  const entryViewKey = useMemo(
    () => `${activeEntryIndex}|${measurementKey || "none"}|${orderedSamplesKey}`,
    [activeEntryIndex, measurementKey, orderedSamplesKey],
  );
  const lastEntryViewKey = useRef<string | null>(null);

  useEffect(() => {
    if (entryViewKey !== lastEntryViewKey.current) {
      setResetViewKey((v) => v + 1);
      lastEntryViewKey.current = entryViewKey;
    }
  }, [entryViewKey]);

  useEffect(() => {
    if (hasBlankApplied && afterBlankRef.current) {
      afterBlankRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [hasBlankApplied]);

  return (
    <div className="blank-page">
      <PanelWithHelp
        title={isPl ? "Blank Correction" : "Blank Correction"}
        helpContent={infoHelp}
        className="panel panel-landing blank-info"
        contentClassName="blank-info__body"
      >
        <div>
          <h2 style={{ margin: 0 }}>
            {isPl ? "Okno Blank Correction" : "Blank Correction"}
          </h2>
          <p style={{ margin: "6px 0 0", color: "var(--text-secondary)" }}>
            {isPl
              ? "Wybierz widoczne krzywe i sprawdz blanki przed uruchomieniem korekty."
              : "Pick the curves you want to inspect, review blank baselines, and then run correction."}
          </p>
        </div>
      </PanelWithHelp>

      {!activeEntry && (
        <div className="empty-state panel-soft blank-empty">
          Wczytaj dane z poprzedniego kroku, aby przejrzec blanki.
        </div>
      )}

      {activeEntry && !measurementKey && (
        <div className="empty-state panel-soft blank-empty">
          Nie udalo sie zidentyfikowac kolumny z wartosciami pomiarowymi. Upewnij sie, ze dane zawieraja pola typu <code>val_od600</code>.
        </div>
      )}

      {activeEntry && measurementKey && (
        <>
          {chartFullscreen && showPlotControls && (
            <div className="plot-controls-float">
              {chartFullscreen === "raw" ? (
                <PlotControlsPanel
                  title={isPl ? "Plot Controls (przed korekta)" : "Plot Controls (Before blank correction)"}
                  chartTitle={chartTitle}
                  setChartTitle={setChartTitle}
                  xLabel={xLabel}
                  setXLabel={setXLabel}
                  yLabel={resolvedYRaw}
                  setYLabel={setYLabelRaw}
                  fontScale={fontScale}
                  setFontScale={setFontScale}
                  onResetView={() => setResetViewKey((v) => v + 1)}
                  onExportPng={() =>
                    exportPng(rawChartRef, chartTitle || (isPl ? "Przed-korekta" : "before-blank"))
                  }
                  onCopyPng={() =>
                    copyPng(rawChartRef, chartTitle || (isPl ? "Przed-korekta" : "before-blank"))
                  }
                  onToggleLegend={() => setLegendVisibleRaw((v) => !v)}
                  legendOpen={legendVisibleRaw}
                  legendPanel={legendPanel}
                  isPl={isPl}
                  disabled={!visibleSeries.length}
                />
              ) : (
                <PlotControlsPanel
                  title={isPl ? "Plot Controls (po korekcie)" : "Plot Controls (After blank correction)"}
                  chartTitle={chartTitle}
                  setChartTitle={setChartTitle}
                  xLabel={xLabel}
                  setXLabel={setXLabel}
                  yLabel={resolvedYBlank}
                  setYLabel={setYLabelBlank}
                  fontScale={fontScale}
                  setFontScale={setFontScale}
                  onResetView={() => setResetViewKey((v) => v + 1)}
                  onExportPng={() =>
                    exportPng(
                      blankChartRef,
                      chartTitle || (isPl ? "Po-korekcie" : "after-blank"),
                    )
                  }
                  onCopyPng={() =>
                    copyPng(
                      blankChartRef,
                      chartTitle || (isPl ? "Po-korekcie" : "after-blank"),
                    )
                  }
                  onToggleLegend={() => setLegendVisibleBlank((v) => !v)}
                  legendOpen={legendVisibleBlank}
                  legendPanel={legendPanel}
                  isPl={isPl}
                  disabled={!correctedSeries.length}
                />
              )}
            </div>
          )}

          <div className="blank-layout">
            <div className="blank-legend">
              <ReplicatePanel
                orderedSamples={orderedSamples}
                sampleReplicates={sampleReplicates}
                selectedKeys={selectedKeys}
                onToggleKey={toggleReplicate}
                onToggleSample={toggleSample}
                highlighted={highlighted}
                setHighlighted={setHighlighted}
                sampleColors={sampleColors}
                isPl={isPl}
              />
            </div>

            <div className="blank-main">
              {!chartFullscreen && (
                <PlotControlsPanel
                  title={isPl ? "Plot Controls (przed korekta)" : "Plot Controls (Before blank correction)"}
                  chartTitle={chartTitle}
                  setChartTitle={setChartTitle}
                  xLabel={xLabel}
                  setXLabel={setXLabel}
                  yLabel={resolvedYRaw}
                  setYLabel={setYLabelRaw}
                  fontScale={fontScale}
                  setFontScale={setFontScale}
                  onResetView={() => setResetViewKey((v) => v + 1)}
                  onExportPng={() =>
                    exportPng(rawChartRef, chartTitle || (isPl ? "Przed-korekta" : "before-blank"))
                  }
                  onCopyPng={() =>
                    copyPng(rawChartRef, chartTitle || (isPl ? "Przed-korekta" : "before-blank"))
                  }
                  onToggleLegend={() => setLegendVisibleRaw((v) => !v)}
                  legendOpen={legendVisibleRaw}
                  legendPanel={legendPanel}
                  isPl={isPl}
                  disabled={!visibleSeries.length}
                />
              )}

              <StandardLineChartCard
                heading={isPl ? "Przed korekta blank" : "Before blank correction"}
                helpContent={chartHelp}
                series={visibleSeries}
                chartTitle={
                  chartTitle || (isPl ? "Przed korekta blank" : "Before blank correction")
                }
                xLabel={resolvedXLabel}
                yLabel={resolvedYRaw}
                fontScale={fontScale}
                chartRef={rawChartRef}
                highlightedNames={highlighted}
                selectedPointIds={[]}
                resetViewKey={`${resetViewKey}-raw`}
                minPanX={Number.NEGATIVE_INFINITY}
                minPanY={Number.NEGATIVE_INFINITY}
                height={chartFullscreen === "raw" ? 620 : 380}
                fullscreen={chartFullscreen === "raw"}
                className={
                  chartFullscreen === "raw" && showPlotControls
                    ? "chart-card--with-controls"
                    : ""
                }
                pointMarkers="all"
                pointMarkerRadius={3}
                pointSelectionMode="modifier"
                legendEntries={legendEntries}
                showLegend={legendVisibleRaw}
                legendTitle={legendTitle || (isPl ? "Legenda" : "Legend")}
                legendScale={legendScale}
                actions={
                  <div className="btn-pair" style={{ flexWrap: "wrap" }}>
                    {chartFullscreen === "raw" && (
                      <label
                        className={`parameters-toggle ${showPlotControls ? "is-on" : ""}`}
                        title={
                          showPlotControls
                            ? isPl
                              ? "Ukryj Plot Controls"
                              : "Hide Plot Controls"
                            : isPl
                            ? "Pokaz Plot Controls"
                            : "Show Plot Controls"
                        }
                      >
                        <input
                          type="checkbox"
                          checked={showPlotControls}
                          onChange={() => setShowPlotControls((v) => !v)}
                        />
                        <span className="parameters-toggle__slider" aria-hidden />
                        <span className="parameters-toggle__label">
                          {showPlotControls
                            ? isPl
                              ? "Ukryj Plot Controls"
                              : "Hide Plot Controls"
                            : isPl
                            ? "Pokaz Plot Controls"
                            : "Show Plot Controls"}
                        </span>
                      </label>
                    )}
                    <button
                      type="button"
                      className={`btn ${chartFullscreen === "raw" ? "primary" : ""}`}
                      onClick={() =>
                        setChartFullscreen((prev) => (prev === "raw" ? null : "raw"))
                      }
                    >
                      {chartFullscreen === "raw"
                        ? isPl
                          ? "Zamknij pelny ekran"
                          : "Exit fullscreen"
                        : isPl
                        ? "Pelny ekran"
                        : "Fullscreen"}
                    </button>
                  </div>
                }
              />

              <PanelWithHelp
                title="Apply Blank Correction"
                helpContent={applyHelp}
                className="panel-soft blank-action-panel"
                contentClassName="blank-action-body"
              >
                <div className="blank-action-row" style={{ justifyContent: "center" }}>
                  <button
                    type="button"
                    className="btn primary next-btn blank-apply-btn"
                    onClick={handleApplyBlankCorrection}
                    disabled={!assignments.length}
                  >
                    Apply Blank Correction
                  </button>
                  {hasBlankApplied && lastBlankPayload && (
                    <button type="button" className="btn primary" onClick={handleDownloadAgain}>
                      Download .blanked.json
                    </button>
                  )}
                </div>
              </PanelWithHelp>

              {hasBlankApplied && (
                <div ref={afterBlankRef} style={{ display: "grid", gap: 12 }}>
                  {!chartFullscreen && (
                    <PlotControlsPanel
                      title={isPl ? "Plot Controls (po korekcie)" : "Plot Controls (After blank correction)"}
                      chartTitle={chartTitle}
                      setChartTitle={setChartTitle}
                      xLabel={xLabel}
                      setXLabel={setXLabel}
                      yLabel={resolvedYBlank}
                      setYLabel={setYLabelBlank}
                      fontScale={fontScale}
                      setFontScale={setFontScale}
                      onResetView={() => setResetViewKey((v) => v + 1)}
                      onExportPng={() =>
                        exportPng(
                          blankChartRef,
                          chartTitle || (isPl ? "Po-korekcie" : "after-blank"),
                        )
                      }
                      onCopyPng={() =>
                        copyPng(
                          blankChartRef,
                          chartTitle || (isPl ? "Po-korekcie" : "after-blank"),
                        )
                      }
                      onToggleLegend={() => setLegendVisibleBlank((v) => !v)}
                      legendOpen={legendVisibleBlank}
                      legendPanel={legendPanel}
                      isPl={isPl}
                      disabled={!correctedSeries.length}
                    />
                  )}

                  <StandardLineChartCard
                    heading={isPl ? "Po korekcie blank" : "After blank correction"}
                    helpContent={chartHelp}
                    series={correctedSeries}
                    chartTitle={
                      chartTitle || (isPl ? "Po korekcie blank" : "After blank correction")
                    }
                    xLabel={resolvedXLabel}
                    yLabel={resolvedYBlank}
                    fontScale={fontScale}
                    chartRef={blankChartRef}
                    highlightedNames={highlighted}
                    selectedPointIds={[]}
                    resetViewKey={`${resetViewKey}-blank`}
                    minPanX={Number.NEGATIVE_INFINITY}
                    minPanY={Number.NEGATIVE_INFINITY}
                    height={chartFullscreen === "blank" ? 620 : 380}
                    fullscreen={chartFullscreen === "blank"}
                  className={
                    chartFullscreen === "blank" && showPlotControls
                      ? "chart-card--with-controls"
                      : ""
                  }
                  pointMarkers="all"
                  pointMarkerRadius={3}
                  pointSelectionMode="modifier"
                legendEntries={legendEntries}
                showLegend={legendVisibleBlank}
                legendTitle={legendTitle || (isPl ? "Legenda" : "Legend")}
                legendScale={legendScale}
                      actions={
                        <div className="btn-pair" style={{ flexWrap: "wrap" }}>
                          {chartFullscreen === "blank" && (
                            <label
                              className={`parameters-toggle ${showPlotControls ? "is-on" : ""}`}
                              title={
                                showPlotControls
                                  ? isPl
                                    ? "Ukryj Plot Controls"
                                    : "Hide Plot Controls"
                                  : isPl
                                  ? "Pokaz Plot Controls"
                                  : "Show Plot Controls"
                              }
                            >
                              <input
                                type="checkbox"
                                checked={showPlotControls}
                                onChange={() => setShowPlotControls((v) => !v)}
                              />
                              <span className="parameters-toggle__slider" aria-hidden />
                              <span className="parameters-toggle__label">
                                {showPlotControls
                                  ? isPl
                                    ? "Ukryj Plot Controls"
                                    : "Hide Plot Controls"
                                  : isPl
                                  ? "Pokaz Plot Controls"
                                  : "Show Plot Controls"}
                              </span>
                            </label>
                          )}
                        <button
                          type="button"
                          className={`btn ${chartFullscreen === "blank" ? "primary" : ""}`}
                          onClick={() =>
                            setChartFullscreen((prev) =>
                              prev === "blank" ? null : "blank",
                            )
                          }
                  >
                    {chartFullscreen === "blank"
                      ? isPl
                        ? "Zamknij pelny ekran"
                        : "Exit fullscreen"
                      : isPl
                      ? "Pelny ekran"
                      : "Fullscreen"}
                      </button>
                    </div>
                  }
                />
              <PanelWithHelp
                title={isPl ? "Kolejny krok" : "Next step"}
                helpContent={
                  isPl
                    ? "Przejdz do kolejnej karty, aby kontynuowac przeplyw analizy."
                    : "Go to the next tab to continue the analysis flow."
                }
                className="panel-soft blank-next-panel"
                contentClassName="blank-next-body"
                actions={
                  <div className="blank-next-actions">
                    <button
                      type="button"
                      className="btn primary next-btn"
                      onClick={() => setActiveTab("compiler")}
                    >
                      {isPl ? "Dalej" : "Next"}
                    </button>
                  </div>
                }
              >
                <div />
              </PanelWithHelp>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
