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
    ? "Możesz dowolnie zmienić tytuł wykresu, nazwy osi, wielkość elementów wykresu i in. Możesz pokazać lub ukryć legendę. Reset przywraca domyślny zoom i pozycję wykresu."
    : "You can customize the chart title, axis labels, text size, and more. You can show or hide the legend. Reset restores the default zoom and position of the chart.";

  return (
    <PanelWithHelp
      title={isPl ? "Sterowanie wykresem" : "Plot Controls"}
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
            value={title}
            onChange={(e) => setTitle(e.target.value)}
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
        <div className="control-actions control-actions--tight">
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
          <button type="button" className="btn basic-btn" onClick={onResetView}>
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
        className="field-input auto-exclusion-input"
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
    ? "Program stara się znaleźć poziom bazowy: przed 45 minutą pomiaru wybierana jest grupa kolejnych punktów o wskazanej liczności ze wskazaną tolerancją. Jeżeli możliwe było ustalenie poziomu bazowego, wykluczane są wszystkie punkty przed nim. Następnie w kolejnym, wskazanym przedziale punktów sprawdzana jest monotoniczność ich wartości z uwzględnieniem tolerancji spadku. Dostosuj parametry automatycznego wykluczania: długość bazy, tolerancję bazy, tolerancję monotoniczną oraz okno czasowe dla kontroli monotoniczności."
    : "The system attempts to find a baseline level: before 45 minutes into the measurement, a group of consecutive points of the specified count within the specified tolerance is selected. If a baseline level could be established, all points before it are excluded. Then, within the specified window of points, their monotonicity is checked with the allowed drop tolerance. Adjust the automatic exclusion parameters: baseline run length, baseline tolerance, monotonic tolerance, and time window for monotonicity check.";

  const baselineRunHelp = isPl
    ? "Liczba kolejnych punktów przed 45 minutą, które program próbuje uznać za poziom bazowy."
    : "Number of consecutive points before 45 minutes that the system tries to identify as the baseline.";
  const baselineToleranceHelp = isPl
    ? "Odchylenie dopuszczalne od poziomu bazowego, mierzony w jendostkach OD600 (ΔOD). Większa wartość = większa tolerancja w wyznaczaniu poziomu bazowego."
    : "Allowed deviation from the baseline level, measured in OD600 units (ΔOD). Higher values mean more tolerance in establishing the baseline.";
  const monotonicWindowHelp = isPl
    ? "Wielkość przedziału czasowego w którym program wyklucza punkty tak aby krzywa była niemalejąca. 0 = brak sprawdzania monotoniczności."
    : "Size of the time window in which the system excludes points to ensure the curve is non-decreasing. 0 = no monotonicity check.";
  const monotonicToleranceHelp = isPl
    ? "Maksymalny spadek (ΔOD) dopuszczony w trakcie monotonicznego odcinka. Większa wartość = mniej wykluczeń."
    : "Maximum drop (ΔOD) allowed while enforcing monotonicity. Higher values mean fewer exclusions.";

  return (
    <PanelWithHelp
      title={isPl ? "Automatyczne wykluczanie" : "Automatic exclusion"}
      helpContent={helpContent}
      className="panel-soft control-panel auto-exclusion-panel"
    >
      <p className="isSmall">
        {isPl
          ? "Program starał się wykluczyć dane na początku każdej z krzywych, tak aby zachowana była ich monotoniczność. Liczba bakterii nie powinna maleć w czasie. Dostosuj parametry automatycznego wykluczania i ponownie uruchom krok, jeżeli wykluczenia nie są satysfakcjonujące. Program próbuje pozbyć się szumu z początku pomiarów, kiedy za zmienność danych odpowiadają w większym stopniu czynniki techniczne niż biologiczne. Próbuje też pozbyć się niespodziewanych spadków OD600 podczas wzrostu hodowli do wskazanego pomiaru (wahania OD w późniejszych fazach wzrostu są znacznie częstrze, a wykluczanie tych danych nie wpływa na kolejne etapy analizy). Wykluczać można też ręcznie, klikając punkty na wykresie. Wykluczyć całą próbę lub replikat można w panelu 'Próby i replikaty'."
          : "The system has attempted to exclude data at the beginning of each curve to maintain monotonicity. Bacterial counts should not decrease over time. Adjust the automatic exclusion parameters and re-run the step if the exclusions are unsatisfactory. The system tries to eliminate noise from the start of measurements, where variability is more due to technical than biological factors. It also attempts to remove unexpected drops in OD600 during culture growth up to the specified measurement (OD fluctuations in later growth phases are more frequent, and excluding these data does not affect subsequent analysis steps). You can also exclude points manually by clicking on them in the chart. To exclude an entire sample or replicate, use the 'Samples and Replicates' panel."}
      </p>
      <div className="control-grid">
        <NumberFieldWithHelp
          label={isPl ? "Wielkość poziomu bazowego (n)" : "Baseline length (n)"}
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
          label={isPl ? "Tolerancja poziomu bazowego (OD600)" : "Baseline tolerance (OD600)"}
          value={outlierThreshold}
          min={0}
          step={0.0001}
          onChange={(val) => onOutlierThresholdChange(Math.max(0, val || 0))}
          helpContent={baselineToleranceHelp}
        />
        <NumberFieldWithHelp
          label={isPl ? "Zakres sprawdzania monotoniczności (min)" : "Monotonicity check window (min)"}
          value={outlierWindowMinutes}
          min={0}
          onChange={(val) =>
            onOutlierWindowMinutesChange(
              Math.max(0, Number.isFinite(val) ? val : 0),
            )}
          helpContent={monotonicWindowHelp}
        />
        <NumberFieldWithHelp
          label={isPl ? "Tolerancja sprawdzania monotoniczności (OD600)" : "Monotonicity tolerance (OD600)"}
          value={outlierWindowPercent}
          min={0}
          step={0.0001}
          onChange={(val) => onOutlierWindowPercentChange(Math.max(0, val || 0))}
          helpContent={monotonicToleranceHelp}
        />
      </div>
      <div className="control-actions">
        <button type="button" className="btn basic-btn" onClick={onRerunAutoExclusion}>
          {isPl ? "Przelicz wykluczanie" : "Re-run exclusion"}
        </button>
        <button type="button" className="btn basic-btn" onClick={onExportCurated}>
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
  const [showReplicatePanel, setShowReplicatePanel] = useState(false);
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
      } else if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        onResetView();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [chartFullscreen, onResetView]);

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
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        onResetView();
      }
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true } as any);
  }, [onResetView]);
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
          <label className="field legend-editor__title-field">
            <div className="field-label-row">
              <span>{isPl ? "Tytuł legendy" : "Legend title"}</span>
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
              className={`legend-editor__swatch ${entry.kind === "excluded" ? "legend-editor__swatch--excluded" : ""}`.trim()}
              style={
                entry.kind === "excluded"
                  ? undefined
                  : { ["--legend-swatch-color" as string]: entry.color }
              }
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
    ? "Kliklnij R lub przycisk 'Reset widoku' aby przywrócić domyślny widok. Możesz przesuwać wykres lub go powiększać/zmniejszać za pomocą touchpada lub scrolla na myszy. Przytrzymanie i przeciągnięcie myszą na osiach liczbowych zmieni 'rozdzielczość' wykresu. Przytrzymując shift i przeciągając myszą po wykresie zaznaczysz/odznaczysz wiele punktów na raz.": "Click R or the 'Reset view' button to restore the default view. You can pan the chart or zoom in/out using a trackpad or mouse scroll. Holding and dragging on the numeric axes will change the chart's 'resolution'. Holding shift and dragging on the chart will select/deselect multiple points at once.";

  const sidePanelOpen = chartFullscreen && (showPlotControls || showReplicatePanel);

  const chartCardClassName = sidePanelOpen ? "chart-card--with-controls" : "";

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

      {chartFullscreen && (showPlotControls || showReplicatePanel) && (
        <div className="plot-controls-float">
          <div className="plot-controls-float__body">
            {showPlotControls && renderPlotControlsPanel()}
            {showReplicatePanel && (
              <div className="plot-controls-float__replicates">
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
              </div>
            )}
          </div>
        </div>
      )}

      <div
        className={`raw-data-chart-grid ${sidePanelOpen ? "raw-data-chart-grid--with-overlay" : ""}`.trim()}
      >
        {!chartFullscreen && (
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
        )}

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
            <div className="btn-pair btn-pair--wrap">
              {chartFullscreen && (
                <>
                  <button
                    type="button"
                    className="btn basic-btn"
                    onClick={() => setShowPlotControls((v) => !v)}
                    aria-pressed={showPlotControls}
                  >
                    {showPlotControls
                      ? isPl
                        ? "Ukryj sterowanie wykresem"
                        : "Hide Plot Controls"
                      : isPl
                        ? "Pokaż sterowanie wykresem"
                        : "Show Plot Controls"}
                  </button>
                  <button
                    type="button"
                    className="btn basic-btn"
                    onClick={() => setShowReplicatePanel((v) => !v)}
                    aria-pressed={showReplicatePanel}
                  >
                    {showReplicatePanel
                      ? isPl
                        ? "Ukryj Panel Prób i Replikatów"
                        : "Hide Samples & Replicates"
                      : isPl
                      ? "Pokaż Panel Prób i Replikatów"
                      : "Show Samples & Replicates"}
                  </button>
                </>
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
                  ? "Pełny ekran"
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
          <div className="btn-pair btn-pair--wide">
            <button
              type="button"
              className="btn primary"
              onClick={onSendToBlankCorrection}
            >
              {isPl ? "Wyślij do wyznaczenia blank" : "Send to blank correction"}
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
              ? "Wysyła dane wraz z adnotacjami o ich wykluczeniu z analizy do kolejnego etapu - wyznaczania blank. W panelu na samej górze tej strony możesz wyekportować (pobrać) dane wraz z tymi adnotacjami aby móc skontrolować działanie programu."
              : "Sends the data along with annotations about their exclusion from analysis to the next step - blank determination. In the panel at the very top of this page, you can export (download) the data along with these annotations to review the system's performance."}
          </HelpTooltip>
        </div>
      </div>
    </>
  );
}
