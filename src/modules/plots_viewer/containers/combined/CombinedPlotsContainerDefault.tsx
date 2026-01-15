import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import { PanelWithHelp } from "@/components/PanelWithHelp";
import { StandardLineChartCard } from "@/components/StandardLineChartCard";
import { HelpTooltip } from "@/components/HelpTooltip";
import { useApp } from "@/state/store";
import type { Series } from "@/components/SimpleLineChart";
import type { RawReplicatePointMeta } from "../../types";
import type {
  ReplicateSelectionContainerComponent,
  SampleReplicate,
} from "../replicate_selection";

type LegendEntry = {
  id: string;
  label: string;
  color: string;
  hidden?: boolean;
  kind?: "series" | "excluded";
};
export type CombinedPlotsContainerDefaultProps = {
  fontScale: number;
  setFontScale: Dispatch<SetStateAction<number>>;
  title: string;
  setTitle: Dispatch<SetStateAction<string>>;
  xLabel: string;
  setXLabel: Dispatch<SetStateAction<string>>;
  yLabel: string;
  setYLabel: Dispatch<SetStateAction<string>>;
  pointsSeries: Series[];
  chartRef: MutableRefObject<HTMLDivElement | null>;
  highlightedNames: string[];
  orderedSamples: string[];
  sampleReplicates: Record<string, SampleReplicate[]>;
  selectedKeys: string[];
  onToggleKey: (key: string) => void;
  onToggleSample: (sample: string) => void;
  highlighted: string[];
  setHighlighted: Dispatch<SetStateAction<string[]>>;
  sampleColors: Record<string, string>;
  varyReplicateColor: (base: string, replicate: number) => string;
  allKeys: string[];
  onToggleAll: () => void;
  replicateExclusionState: Record<string, "none" | "partial" | "all">;
  sampleExclusionState: Record<string, "none" | "partial" | "all">;
  onSetReplicateExcluded: (
    sample: string,
    replicate: number,
    exclude: boolean,
  ) => void;
  onSetSampleExcluded: (sample: string, exclude: boolean) => void;
  replicateSelectionContainerComponent: ReplicateSelectionContainerComponent;
  lowestPointCount: number;
  onLowestPointCountChange: (value: number) => void;
  outlierThreshold: number;
  onOutlierThresholdChange: (value: number) => void;
  outlierWindowMinutes: number;
  onOutlierWindowMinutesChange: (value: number) => void;
  outlierWindowPercent: number;
  onOutlierWindowPercentChange: (value: number) => void;
  onRerunAutoExclusion: () => void;
  selectedPointIds: string[];
  onChartPointToggle: (point: RawReplicatePointMeta) => void;
  onChartSelection: (points: RawReplicatePointMeta[]) => void;
  minPanX?: number;
  minPanY?: number;
  resetViewKey?: string;
  onResetView: () => void;
  onExportCurated: () => void;
  onSendToBlankCorrection: () => void;
};

type PlotControlsPanelProps = {
  fontScale: number;
  setFontScale: Dispatch<SetStateAction<number>>;
  title: string;
  setTitle: Dispatch<SetStateAction<string>>;
  xLabel: string;
  setXLabel: Dispatch<SetStateAction<string>>;
  yLabel: string;
  setYLabel: Dispatch<SetStateAction<string>>;
  onResetView: () => void;
  onExportPng: () => void;
  onCopyPng: () => void;
  onToggleLegend: () => void;
  legendOpen: boolean;
  isPl: boolean;
  legendPanel?: JSX.Element | null;
};

function PlotControlsPanel({
  fontScale,
  setFontScale,
  title,
  setTitle,
  xLabel,
  setXLabel,
  yLabel,
  setYLabel,
  onResetView,
  onExportPng,
  onCopyPng,
  onToggleLegend,
  legendOpen,
  isPl,
  legendPanel,
}: PlotControlsPanelProps) {
  const helpContent = isPl
    ? "Steruj tytulem wykresu, etykietami osi i rozmiarem czcionki. Reset przywraca domyslny widok i powiekszenie wykresu."
    : "Adjust chart title, axis labels, and text size. Reset restores the default zoom and pan for the plot.";

  return (
    <PanelWithHelp
      title="Plot Controls"
      helpContent={helpContent}
      className="panel-soft control-panel"
    >
      <div className="control-grid">
        <label className="field">
          <div className="field-label-row">
            <span>{isPl ? "Tytul wykresu" : "Chart title"}</span>
          </div>
          <input
            className="field-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <div className="field-label-row">
            <span>{isPl ? "Os X" : "X axis"}</span>
          </div>
          <input
            className="field-input"
            value={xLabel}
            onChange={(e) => setXLabel(e.target.value)}
          />
        </label>
        <label className="field">
          <div className="field-label-row">
            <span>{isPl ? "Os Y" : "Y axis"}</span>
          </div>
          <input
            className="field-input"
            value={yLabel}
            onChange={(e) => setYLabel(e.target.value)}
          />
        </label>
      </div>
      <div className="control-row">
        <div className="btn-pair">
          <button
            className="btn"
            onClick={() => setFontScale((s) => Math.max(0.6, +(s - 0.1).toFixed(1)))}
            title={isPl ? "Mniejsza czcionka" : "Smaller text"}
          >
            A-
          </button>
          <button
            className="btn"
            onClick={() => setFontScale((s) => Math.min(2, +(s + 0.1).toFixed(1)))}
            title={isPl ? "Wieksza czcionka" : "Larger text"}
          >
            A+
          </button>
        </div>
        <div className="control-actions" style={{ gap: 8 }}>
          <button type="button" className="btn" onClick={onExportPng}>
            {isPl ? "Eksportuj PNG" : "Export PNG"}
          </button>
          <button type="button" className="btn" onClick={onCopyPng}>
            {isPl ? "Kopiuj PNG" : "Copy PNG"}
          </button>
          <label
            className={`parameters-toggle ${legendOpen ? "is-on" : ""}`}
            title={legendOpen ? (isPl ? "Ukryj legendę" : "Hide legend") : isPl ? "Pokaż legendę" : "Show legend"}
          >
            <input type="checkbox" checked={legendOpen} onChange={onToggleLegend} aria-pressed={legendOpen} />
            <span className="parameters-toggle__slider" aria-hidden />
            <span className="parameters-toggle__label">
              {legendOpen ? (isPl ? "Ukryj legendę" : "Hide legend") : isPl ? "Legenda" : "Legend"}
            </span>
          </label>
          <button type="button" className="btn primary" onClick={onResetView}>
            {isPl ? "Reset widoku" : "Reset view"}
          </button>
        </div>
      </div>
      {legendPanel}
    </PanelWithHelp>
  );
}

type ExcludingPointsPanelProps = {
  lowestPointCount: number;
  onLowestPointCountChange: (value: number) => void;
  outlierThreshold: number;
  onOutlierThresholdChange: (value: number) => void;
  outlierWindowMinutes: number;
  onOutlierWindowMinutesChange: (value: number) => void;
  outlierWindowPercent: number;
  onOutlierWindowPercentChange: (value: number) => void;
  onRerunAutoExclusion: () => void;
  onExportCurated: () => void;
  isPl: boolean;
};

function NumberFieldWithHelp({
  label,
  value,
  onChange,
  min,
  max,
  step,
  helpContent,
}: {
  label: string;
  value: number;
  onChange: (val: number) => void;
  min?: number;
  max?: number;
  step?: number;
  helpContent: string;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  return (
    <label className="field">
      <div className="field-label-row">
        <span>{label}</span>
        <button
          ref={anchorRef}
          type="button"
          className="field-help-btn"
          onClick={() => setOpen((v) => !v)}
          aria-label={`${label} help`}
        >
          ?
        </button>
        <HelpTooltip anchorRef={anchorRef} open={open}>
          {helpContent}
        </HelpTooltip>
      </div>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        className="field-input"
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function ExcludingPointsPanel({
  lowestPointCount,
  onLowestPointCountChange,
  outlierThreshold,
  onOutlierThresholdChange,
  outlierWindowMinutes,
  onOutlierWindowMinutesChange,
  outlierWindowPercent,
  onOutlierWindowPercentChange,
  onRerunAutoExclusion,
  onExportCurated,
  isPl,
}: ExcludingPointsPanelProps) {
  const helpContent = isPl
    ? "Steruj automatycznym wykluczaniem punktów: bazowa liczba punktów, tolerancja bazowa, tolerancja monotoniczna oraz okno czasowe kontroli monotonii."
    : "Control automatic exclusion: baseline run length, baseline tolerance, monotonic tolerance, and the time window for the monotonic check.";

  const baselineRunHelp = isPl
    ? "Minimalna liczba kolejnych punktów przed 45 minutą, potrzebnych do wyznaczenia poziomu bazowego."
    : "Minimum consecutive points before 45 minutes required to set the baseline level.";
  const baselineToleranceHelp = isPl
    ? "Odchylenie dopuszczalne od poziomu bazowego. Większa wartość = więcej punktów zostanie uznanych za bazę."
    : "Allowed deviation from the baseline level. Higher tolerance keeps more points in the baseline run.";
  const monotonicWindowHelp = isPl
    ? "Długość okna (minuty) do kontroli monotonicznego wzrostu po bazie. 0 = brak limitu czasowego."
    : "Length of the window (minutes) where monotonic growth is enforced after baseline. 0 = no time cap.";
  const monotonicToleranceHelp = isPl
    ? "Maksymalny spadek (ΔOD) dopuszczony w trakcie monotonicznego odcinka. Większa wartość = mniej wykluczeń."
    : "Maximum drop (ΔOD) allowed while enforcing monotonicity. Higher values mean fewer exclusions.";

  return (
    <PanelWithHelp
      title={isPl ? "Wykluczanie punktow" : "Excluding points"}
      helpContent={helpContent}
      className="panel-soft control-panel"
    >
      <div className="control-grid">
        <NumberFieldWithHelp
          label={isPl ? "Baseline run" : "Baseline run"}
          value={lowestPointCount}
          min={1}
          max={50}
          onChange={(val) =>
            onLowestPointCountChange(
              Math.max(1, Math.min(50, Math.floor(val) || 1)),
            )}
          helpContent={baselineRunHelp}
        />
        <NumberFieldWithHelp
          label={isPl ? "Baseline tolerance" : "Baseline tolerance"}
          value={outlierThreshold}
          min={0}
          step={0.0001}
          onChange={(val) => onOutlierThresholdChange(Math.max(0, val || 0))}
          helpContent={baselineToleranceHelp}
        />
        <NumberFieldWithHelp
          label={isPl ? "Monotonic window" : "Monotonic window"}
          value={outlierWindowMinutes}
          min={0}
          onChange={(val) =>
            onOutlierWindowMinutesChange(
              Math.max(0, Number.isFinite(val) ? val : 0),
            )}
          helpContent={monotonicWindowHelp}
        />
        <NumberFieldWithHelp
          label={isPl ? "Monotonic tolerance" : "Monotonic tolerance"}
          value={outlierWindowPercent}
          min={0}
          step={0.0001}
          onChange={(val) => onOutlierWindowPercentChange(Math.max(0, val || 0))}
          helpContent={monotonicToleranceHelp}
        />
      </div>
      <div className="control-actions">
        <button type="button" className="btn primary" onClick={onRerunAutoExclusion}>
          {isPl ? "Przelicz wykluczanie" : "Re-run exclusion"}
        </button>
        <button type="button" className="btn primary" onClick={onExportCurated}>
          {isPl ? "Eksportuj curated data" : "Export curated data"}
        </button>
      </div>
    </PanelWithHelp>
  );
}

export function CombinedPlotsContainerDefault({
  fontScale,
  setFontScale,
  title,
  setTitle,
  xLabel,
  setXLabel,
  yLabel,
  setYLabel,
  pointsSeries,
  chartRef,
  highlightedNames,
  orderedSamples,
  sampleReplicates,
  selectedKeys,
  onToggleKey,
  onToggleSample,
  highlighted,
  setHighlighted,
  sampleColors,
  varyReplicateColor,
  allKeys,
  onToggleAll,
  replicateExclusionState,
  sampleExclusionState,
  onSetReplicateExcluded,
  onSetSampleExcluded,
  replicateSelectionContainerComponent,
  lowestPointCount,
  onLowestPointCountChange,
  outlierThreshold,
  onOutlierThresholdChange,
  outlierWindowMinutes,
  onOutlierWindowMinutesChange,
  outlierWindowPercent,
  onOutlierWindowPercentChange,
  onRerunAutoExclusion,
  selectedPointIds,
  onChartPointToggle,
  onChartSelection,
  minPanX,
  minPanY,
  resetViewKey,
  onResetView,
  onExportCurated,
  onSendToBlankCorrection,
}: CombinedPlotsContainerDefaultProps) {
  const ReplicateSelectionContainer = replicateSelectionContainerComponent;
  const language = useApp((state) => state.language);
  const isPl = language === "pl";
  const [chartFullscreen, setChartFullscreen] = useState(false);
  const [showPlotControls, setShowPlotControls] = useState(true);
  const [legendVisible, setLegendVisible] = useState(false);
  const [legendEntries, setLegendEntries] = useState<LegendEntry[]>([]);
  const [legendScale, setLegendScale] = useState(1);
  const [legendTitle, setLegendTitle] = useState(isPl ? "Legenda" : "Legend");
  const blankHelpAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [showBlankHelp, setShowBlankHelp] = useState(false);
  const pointsSeriesKey = useMemo(
    () => pointsSeries.map((s) => `${s.name}:${s.color}`).join("|"),
    [pointsSeries],
  );
  useEffect(() => {
    setLegendEntries((prev) => {
      const prevMap = new Map(prev.map((e) => [e.id, e]));
      const next: LegendEntry[] = [];
      pointsSeries.forEach((series) => {
        const existing = prevMap.get(series.name);
        next.push({
          id: series.name,
          label: existing?.label ?? series.name,
          color: series.color,
          hidden: existing?.hidden ?? false,
          kind: "series",
        });
      });
      const excludedId = "__excluded__";
      const prevExcluded = prevMap.get(excludedId);
      const excludedLabel =
        prevExcluded?.label ??
        (isPl ? "Wykluczone z analizy" : "Excluded from analysis");
      next.push({
        id: excludedId,
        label: excludedLabel,
        color: prevExcluded?.color ?? "#9ca3af",
        hidden: prevExcluded?.hidden ?? false,
        kind: "excluded",
      });
      return next;
    });
  }, [pointsSeriesKey, isPl]);
  useEffect(() => {
    setLegendTitle((prev) =>
      prev && prev !== "Legenda" && prev !== "Legend" ? prev : isPl ? "Legenda" : "Legend",
    );
  }, [isPl]);
  useEffect(() => {
    if (!chartFullscreen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setChartFullscreen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [chartFullscreen]);
  const handleLegendLabelChange = useCallback(
    (id: string, label: string) => {
      setLegendEntries((prev) =>
        prev.map((entry) =>
          entry.id === id ? { ...entry, label } : entry,
        ),
      );
    },
    [],
  );
  const handleLegendToggle = useCallback((id: string) => {
    setLegendEntries((prev) =>
      prev.map((entry) =>
        entry.id === id ? { ...entry, hidden: !entry.hidden } : entry,
      ),
    );
  }, []);

  const getChartSvg = useCallback(() => {
    const node = chartRef.current;
    if (!node) return null;
    return node.querySelector("svg") as SVGSVGElement | null;
  }, [chartRef]);

  const makeSafeName = useCallback((raw: string) => {
    const safe = (raw || "raw-data-plot").replace(/[^a-z0-9_-]+/gi, "-");
    return safe || "raw-data-plot";
  }, []);

  const buildPngBlob = useCallback(async (): Promise<Blob | null> => {
    const svg = getChartSvg();
    if (!svg) return null;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svg);
    const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox?.baseVal;
    const width = Math.max(1, Math.round(viewBox?.width || rect.width || 1200));
    const height = Math.max(1, Math.round(viewBox?.height || rect.height || 600));
    return await new Promise<Blob>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Canvas context unavailable"));
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error("PNG generation failed"));
          }, "image/png");
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("SVG render error"));
      };
      img.src = url;
    });
  }, [getChartSvg]);

  const handleExportPng = useCallback(async () => {
    const blob = await buildPngBlob();
    if (!blob) return;
    const base = makeSafeName(title || "raw-data-plot");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, [buildPngBlob, makeSafeName, title]);

  const handleCopyPng = useCallback(async () => {
    const blob = await buildPngBlob();
    if (!blob) return;
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard && "write" in navigator.clipboard) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        return;
      } catch {
        // fallback
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${makeSafeName(title || "raw-data-plot")}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, [buildPngBlob, makeSafeName, title]);

  const legendPanel = legendVisible ? (
    <div className="legend-editor panel-soft">
      <div className="legend-editor__header">
        <div>
          <div className="legend-editor__title">
            {legendTitle || (isPl ? "Legenda" : "Legend")}
          </div>
          <div className="legend-editor__subtitle">
            {isPl
              ? "Ukryj lub zmien nazwy elementow legendy. Zmiany nie wykluczaja serii z wykresu."
              : "Hide or rename legend entries. Changes do not remove series from the chart."}
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
              <span>{isPl ? "Pokaz" : "Show"}</span>
            </label>
            <div
              className="legend-editor__swatch"
              style={{
                background:
                  entry.kind === "excluded" ? "transparent" : entry.color,
                borderColor: "transparent",
              }}
            >
              {entry.kind === "excluded" && (
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  aria-hidden
                  focusable="false"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="8"
                    fill="#ffffff"
                    stroke="#111111"
                    strokeWidth="2"
                  />
                  <circle
                    cx="12"
                    cy="12"
                    r="11"
                    fill="none"
                    stroke="#9ca3af"
                    strokeWidth="2"
                    opacity="0.8"
                  />
                  <line
                    x1="7"
                    y1="7"
                    x2="17"
                    y2="17"
                    stroke="#111111"
                    strokeWidth="2"
                  />
                  <line
                    x1="17"
                    y1="7"
                    x2="7"
                    y2="17"
                    stroke="#111111"
                    strokeWidth="2"
                  />
                </svg>
              )}
            </div>
            <input
              className="legend-editor__input"
              value={entry.label}
              onChange={(e) => handleLegendLabelChange(entry.id, e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  ) : null;

  const renderPlotControlsPanel = useCallback(
    () => (
      <PlotControlsPanel
        fontScale={fontScale}
        setFontScale={setFontScale}
        title={title}
        setTitle={setTitle}
        xLabel={xLabel}
        setXLabel={setXLabel}
        yLabel={yLabel}
        setYLabel={setYLabel}
        onResetView={onResetView}
        onExportPng={handleExportPng}
        onCopyPng={handleCopyPng}
        onToggleLegend={() => setLegendVisible((v) => !v)}
        legendOpen={legendVisible}
        legendPanel={legendPanel}
        isPl={isPl}
      />
    ),
    [
      fontScale,
      setFontScale,
      title,
      setTitle,
      xLabel,
      setXLabel,
      yLabel,
      setYLabel,
      onResetView,
      handleExportPng,
      handleCopyPng,
      isPl,
      legendVisible,
      legendPanel,
      setLegendVisible,
    ],
  );
  const chartHelp = isPl
    ? "Na wykresie mozesz zaznaczac punkty (Shift/drag), klikac by wykluczyc pojedyncze odczyty i korzystac z zoom/pan. Plot Controls steruja opisem i czcionka."
    : "Use zoom/pan, click points to flag them, or drag-select with modifier keys. Plot Controls adjust labels and text size.";

  const chartCardClassName =
    chartFullscreen && showPlotControls ? "chart-card--with-controls" : "";

  return (
    <>
      <div className="raw-data-layout">
        <ExcludingPointsPanel
          lowestPointCount={lowestPointCount}
          onLowestPointCountChange={onLowestPointCountChange}
          outlierThreshold={outlierThreshold}
          onOutlierThresholdChange={onOutlierThresholdChange}
          outlierWindowMinutes={outlierWindowMinutes}
          onOutlierWindowMinutesChange={onOutlierWindowMinutesChange}
          outlierWindowPercent={outlierWindowPercent}
          onOutlierWindowPercentChange={onOutlierWindowPercentChange}
          onRerunAutoExclusion={onRerunAutoExclusion}
          onExportCurated={onExportCurated}
          isPl={isPl}
        />

      {!chartFullscreen && renderPlotControlsPanel()}

      {chartFullscreen && showPlotControls && (
        <div className="plot-controls-float">{renderPlotControlsPanel()}</div>
      )}

      <div className="raw-data-chart-grid">
        <ReplicateSelectionContainer
          orderedSamples={orderedSamples}
          sampleReplicates={sampleReplicates}
          selectedKeys={selectedKeys}
          onToggleKey={onToggleKey}
          onToggleSample={onToggleSample}
          highlighted={highlighted}
          setHighlighted={setHighlighted}
          sampleColors={sampleColors}
          varyReplicateColor={varyReplicateColor}
          allKeys={allKeys}
          onToggleAll={onToggleAll}
          replicateExclusionState={replicateExclusionState}
          sampleExclusionState={sampleExclusionState}
          onSetReplicateExcluded={onSetReplicateExcluded}
          onSetSampleExcluded={onSetSampleExcluded}
        />

        <StandardLineChartCard
          heading={isPl ? "Wykres surowych danych" : "Raw data plot"}
          helpContent={chartHelp}
          series={pointsSeries}
          chartTitle={title}
          xLabel={xLabel}
          yLabel={yLabel}
          fontScale={fontScale}
          chartRef={chartRef}
          highlightedNames={highlightedNames}
          selectedPointIds={selectedPointIds}
          resetViewKey={resetViewKey}
          minPanX={minPanX}
          minPanY={minPanY}
          height={chartFullscreen ? 620 : 380}
          fullscreen={chartFullscreen}
          className={chartCardClassName}
          legendEntries={legendEntries}
          showLegend={legendVisible}
          legendTitle={legendTitle || (isPl ? "Legenda" : "Legend")}
          legendScale={legendScale}
          actions={
            <div className="btn-pair" style={{ flexWrap: "wrap" }}>
              {chartFullscreen && (
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
                className={`btn ${chartFullscreen ? "primary" : ""}`}
                onClick={() => setChartFullscreen((v) => !v)}
                aria-pressed={chartFullscreen}
              >
                {chartFullscreen
                  ? isPl
                    ? "Zamknij pelny ekran"
                    : "Exit fullscreen"
                  : isPl
                  ? "Pelny ekran"
                  : "Fullscreen"}
              </button>
            </div>
          }
          onPointToggle={onChartPointToggle}
          onPointSelection={onChartSelection}
        />
      </div>

      </div>

      <div className="panel panel-soft raw-data-blank-cta">
        <div className="raw-data-blank-cta__inner">
          <div className="btn-pair" style={{ width: "100%", justifyContent: "center", gap: 16 }}>
            <button
              type="button"
              className="btn primary next-btn"
              onClick={onSendToBlankCorrection}
            >
              {isPl ? "Wyslij do Blank Correction" : "Send to Blank Correction"}
            </button>
            <button
              type="button"
              className="help-btn circle"
              ref={blankHelpAnchorRef}
              onClick={() => setShowBlankHelp((v) => !v)}
              aria-label={isPl ? "Pomoc: Blank Correction" : "Help: Blank Correction"}
            >
              ?
            </button>
          </div>
          <HelpTooltip anchorRef={blankHelpAnchorRef} open={showBlankHelp}>
            {isPl
              ? "Wyślij obecny widok surowych danych (z wykluczeniami) do etapu Blank Correction. Zapisz dane, jeśli chcesz zachować bieżące ustawienia."
              : "Send the current raw-data view (with exclusions) to the Blank Correction step. Save first if you want to keep current settings."}
          </HelpTooltip>
        </div>
      </div>
    </>
  );
}


