import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useApp } from "@/state/store";
import { HelpTooltip } from "@/components/HelpTooltip";

// Default replicate selection container consumed by CombinedPlotsContainerDefault.tsx.
// Add alternative replicate selection behaviours by dropping new components into src/modules/plots_viewer/containers/replicate_selection.

export type SampleReplicate = { well: string; replicate: number };

export type ReplicateSelectionContainerDefaultProps = {
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
};

export function ReplicateSelectionContainerDefault({
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
}: ReplicateSelectionContainerDefaultProps) {
  const language = useApp((state) => state.language);
  const activeTab = useApp((state) => state.activeTab);
  const isPl = language === "pl";
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
      reps.forEach((rep) => {
        list.push(`${sample}|${rep.replicate}`);
      });
    });
    return list;
  }, [orderedSamples, sampleReplicates]);
  const orderedKeysSignature = useMemo(
    () => orderedKeys.join("|"),
    [orderedKeys],
  );
  const selectedKeysSignature = useMemo(
    () => selectedKeys.slice().sort().join("|"),
    [selectedKeys],
  );

  const setActiveWithHighlight = useCallback(
    (key: string | null) => {
      setActiveKey(key);
      if (!key) return;
      const [sample, repStr] = key.split("|");
      const repNum = Number(repStr);
      if (sample && Number.isFinite(repNum)) {
        setHighlighted([`${sample} R${repNum}`]);
      }
    },
    [setHighlighted],
  );

  useEffect(() => {
    if (keySignatureRef.current !== orderedKeysSignature) {
      keySignatureRef.current = orderedKeysSignature;
      bootstrapRef.current = false;
      setActiveWithHighlight(orderedKeys[0] ?? null);
    }
  }, [orderedKeys, orderedKeysSignature, setActiveWithHighlight]);

  useEffect(() => {
    if (!orderedKeys.length) return;
    if (!activeKey) setActiveWithHighlight(orderedKeys[0]);
    if (!bootstrapRef.current && selectedKeys.length === 0) {
      onToggleKey(orderedKeys[0]);
      setActiveWithHighlight(orderedKeys[0]);
      bootstrapRef.current = true;
    }
  }, [activeKey, onToggleKey, orderedKeys, selectedKeys, setActiveWithHighlight]);

  // Keep an active pivot in sync with external selection changes so arrow navigation works without prior clicks.
  useEffect(() => {
    if (activeKey && orderedKeys.includes(activeKey)) return;
    if (!orderedKeys.length) return;
    const firstSelected =
      selectedKeys.find((key) => orderedKeys.includes(key)) ?? orderedKeys[0];
    setActiveWithHighlight(firstSelected);
  }, [activeKey, orderedKeys, selectedKeysSignature, setActiveWithHighlight]);

  useEffect(() => {
    if (selectedKeys.length > 0) bootstrapRef.current = true;
  }, [selectedKeys.length]);

  useEffect(() => {
    if (activeTab !== "plots") {
      setShowHelp(false);
    }
  }, [activeTab]);

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
      const fallbackKey =
        selectedKeys.find((key) => orderedKeys.includes(key)) ?? orderedKeys[0];
      const currentKey =
        (activeKey && orderedKeys.includes(activeKey)
          ? activeKey
          : fallbackKey) ?? null;

      if (!currentKey) return;

      // Keep exactly one replicate selected while navigating.
      const desired = new Set<string>();

      // If nothing is selected yet, start with the current key so keyboard
      // navigation works immediately without the first click.
      if (selectedKeys.length === 0 && !withSample) {
        desired.add(currentKey);
        applySelection(desired);
        setActiveWithHighlight(currentKey);
        return;
      }

      if (withSample) {
        const currentSample = currentKey.split("|")[0];
        const targetSample = findNextSample(currentSample, direction) ?? currentSample;
        const targetKeys = getSampleKeys(targetSample);
        if (!targetKeys.length) return;
        desired.add(targetKeys[0]);
        applySelection(desired);
        setActiveWithHighlight(targetKeys[0]);
        return;
      }

      const nextKey = findNextKey(currentKey, direction);
      if (!nextKey) return;
      desired.add(nextKey);
      applySelection(desired);
      setActiveWithHighlight(nextKey);
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
      setActiveWithHighlight,
    ],
  );

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
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      handleNavigate(event.key === "ArrowDown" ? 1 : -1, event.shiftKey);
    };
    if (activeTab === "plots") {
      window.addEventListener("keydown", handler as any, { capture: true });
      return () => window.removeEventListener("keydown", handler as any, { capture: true } as any);
    }
    return undefined;
  }, [activeTab, handleNavigate]);

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
    setActiveWithHighlight(null);
    setHighlighted([]);
  }, [onToggleKey, selectedKeys, setActiveWithHighlight, setHighlighted]);

  const helpText = isPl
    ? "Kliknij przycisk wykresu aby uwidocznić krzywą danego replikatu na wyrkresie. Użyj strzałek góra/dół na klawiaturze aby zrobić pokazać kolejny replikat. Kliknij przycisk analizy aby wykluczyć/anulować wykluczenie całego replikatu. Klikaj w punkty na wykresie aby wykluczyć/anulować ich wykluczenie z dalszej analizy."
    : "Click the plot button to show a replicate's curve on the plot. Use the up/down arrow keys to navigate through replicates. Click the analysis button to exclude/include entire replicates from analysis. Click points on the plot to exclude/include them from further analysis.";

  const panels = useMemo(() => {
    const blocks = [] as JSX.Element[];

    for (const sampleName of orderedSamples) {
      const reps = sampleReplicates[sampleName] ?? [];
      if (!reps.length) continue;
      const baseColor = sampleColors[sampleName] ?? "#60a5fa";
      const sampleStatus = sampleExclusionState[sampleName] ?? "none";
      const sampleExcluded = sampleStatus === "all";

      const sampleKeys = reps.map((rep) => `${sampleName}|${rep.replicate}`);
      const selectedCount = sampleKeys.filter((key) =>
        selectedKeys.includes(key),
      ).length;
      const fullySelected =
        selectedCount === sampleKeys.length && sampleKeys.length > 0;
      const partiallySelected =
        selectedCount > 0 && selectedCount < sampleKeys.length;
      const sampleAnalysisPartial = sampleStatus === "partial";

      blocks.push(
        <div
          key={sampleName}
          className={`replicate-card ${sampleExcluded ? "is-excluded" : ""}`}
          onClick={() => {
            onToggleSample(sampleName);
            setActiveWithHighlight(sampleKeys[0]);
          }}
          ref={(node) => {
            if (node) refs.current[sampleName] = node;
          }}
        >
          <div
            className="replicate-card__top"
            onClick={(event) => {
              event.stopPropagation();
              onToggleSample(sampleName);
              setActiveWithHighlight(sampleKeys[0]);
            }}
          >
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
                title={
                  fullySelected
                    ? isPl
                      ? "Ukryj replikaty tej próby"
                      : "Hide all replicates in this sample"
                    : isPl
                    ? "Pokaż replikaty tej próby"
                    : "Show all replicates in this sample"
                }
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleSample(sampleName);
                  setActiveWithHighlight(sampleKeys[0]);
                }}
                aria-pressed={fullySelected}
              >
                📈 {fullySelected ? "✓" : partiallySelected ? "~" : "✕"}
              </button>
              <button
                type="button"
                className={`state-pill state-pill--analysis ${!sampleExcluded ? "is-on" : ""} ${sampleAnalysisPartial ? "is-partial" : ""}`}
                title={
                  sampleExcluded
                    ? isPl
                      ? "Przywróć próbę do analizy"
                      : "Include sample in analysis"
                    : isPl
                    ? "Wyłącz próbę z analizy"
                    : "Exclude sample from analysis"
                }
                onClick={(event) => {
                  event.stopPropagation();
                  onSetSampleExcluded(sampleName, !sampleExcluded);
                  setActiveWithHighlight(sampleKeys[0]);
                }}
                aria-pressed={!sampleExcluded}
              >
                📊 {!sampleExcluded ? "✓" : "✕"}
              </button>
            </div>
          </div>
          <div className="replicate-card__list" onKeyDown={handleKeyNav}>
            {reps.map((rep) => {
              const key = `${sampleName}|${rep.replicate}`;
              const active = selectedKeys.includes(key);
              const repExcluded =
                (replicateExclusionState[key] ?? "none") === "all";
              const highlightedMatch = highlighted.includes(
                `${sampleName} R${rep.replicate}`,
              );
              const replicateLabel = `R${rep.replicate} (${rep.well.toUpperCase()})`;

              return (
                <div
                  key={key}
                  className={`replicate-row ${activeKey === key ? "is-focused" : ""} ${repExcluded ? "is-excluded" : ""} ${highlightedMatch ? "is-highlighted" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleKey(key);
                    setActiveWithHighlight(key);
                  }}
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onToggleKey(key);
                      setActiveWithHighlight(key);
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
                        borderColor: varyReplicateColor(
                          baseColor,
                          rep.replicate,
                        ),
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
                    setActiveWithHighlight(key);
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
                  <button
                    type="button"
                    className={`state-pill state-pill--analysis ${!repExcluded ? "is-on" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSetReplicateExcluded(
                        sampleName,
                        rep.replicate,
                        !repExcluded,
                      );
                      setActiveWithHighlight(key);
                    }}
                    aria-pressed={!repExcluded}
                    title={
                      repExcluded
                        ? isPl
                          ? "Przywróć replikat do analizy"
                          : "Include replicate in analysis"
                        : isPl
                        ? "Wyłącz replikat z analizy"
                        : "Exclude replicate from analysis"
                    }
                  >
                    {!repExcluded ? "✓" : "✕"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>,
      );
    }

    if (!blocks.length) {
      blocks.push(
        <div key="empty" className="small">
          {isPl ? "Brak replikatów do wyświetlenia." : "No replicates assigned."}
        </div>,
      );
    }

    return blocks;
  }, [
    activeKey,
    handleKeyNav,
    highlighted,
    isPl,
    onSetReplicateExcluded,
    onSetSampleExcluded,
    onToggleKey,
    onToggleSample,
    orderedSamples,
    replicateExclusionState,
    sampleColors,
    sampleExclusionState,
    sampleReplicates,
    selectedKeys,
    setHighlighted,
    varyReplicateColor,
  ]);

  return (
    <div className="replicate-panel">
      <button
        ref={helpAnchorRef}
        type="button"
        className="help-btn circle replicate-panel__help-btn"
        aria-expanded={showHelp}
        aria-label={isPl ? "Pokaż pomoc" : "Toggle help"}
        onClick={() => setShowHelp((prev) => !prev)}
        onMouseEnter={() => setShowHelp(true)}
        onFocus={() => setShowHelp(true)}
        onMouseLeave={() => setShowHelp(false)}
        onBlur={() => setShowHelp(false)}
      >
        ?
      </button>
      <div className="replicate-panel__header">
        <div>
          <h3 className="replicate-panel__title">
            {isPl ? "Próby i replikaty" : "Samples and replicates"}
          </h3>
          <p className="replicate-panel__description">
            {isPl
              ? "Wyklucz dane z dalszej analizy."
              : "Exclude data from further analysis."}
          </p>
        </div>
        <div className="replicate-panel__actions">
          <button
            className="btn"
            onClick={handleDeselectAll}
            disabled={!selectedKeys.length}
            title={isPl ? "Odznacz wszystkie" : "Deselect all"}
          >
            {isPl ? "Odznacz wszystkie" : "Deselect all"}
          </button>
        </div>
      </div>
      <HelpTooltip anchorRef={helpAnchorRef} open={showHelp}>
        {helpText}
      </HelpTooltip>

      <div className="replicate-panel__legend">
        <span className="replicate-panel__legend-label">
          {isPl ? "Próba" : "Sample"}
        </span>
        <div className="replicate-panel__legend-pills">
          <span>{isPl ? "Wykres" : "Plot"}</span>
          <span>{isPl ? "Analiza" : "Analysis"}</span>
        </div>
      </div>

      <div className="replicate-panel__list" onKeyDown={handleKeyNav}>
        {panels}
      </div>
    </div>
  );
}

