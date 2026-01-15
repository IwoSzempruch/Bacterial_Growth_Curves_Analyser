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

  useEffect(() => {
    if (keySignatureRef.current !== orderedKeysSignature) {
      keySignatureRef.current = orderedKeysSignature;
      bootstrapRef.current = false;
      setActiveKey(orderedKeys[0] ?? null);
    }
  }, [orderedKeys, orderedKeysSignature]);

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
            setActiveKey(sampleKeys[0]);
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
              setActiveKey(sampleKeys[0]);
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
                  setActiveKey(sampleKeys[0]);
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
                  setActiveKey(sampleKeys[0]);
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
                      setActiveKey(key);
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
        onClick={() => setShowHelp((prev) => !prev)}
      >
        ?
      </button>
      <div className="replicate-panel__header">
        <div>
          <h3 className="replicate-panel__title">
            {isPl ? "Próby i replikaty" : "Samples & replicates"}
          </h3>
          <p className="replicate-panel__description">
            {isPl
              ? "Kliknij nazwę, aby pokazać lub ukryć krzywą. Kolumny sterują widocznością na wykresie oraz udziałem w analizie."
              : "Click a name to show or hide the curve. Columns control plot visibility and whether data stays in analysis."}
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
          ? "Strzałki góra/dół przełączają replikaty; z Shiftem zaznaczają całą próbę. Kolumny: lewa - widoczność na wykresie, prawa - udział w analizie. Wyłączone wiersze są przyciemnione i obramowane linią przerywaną."
          : "Use up/down arrows to move between replicates; hold Shift to grab the whole sample. Left column = chart visibility, right = analysis inclusion. Excluded rows are dimmed with dashed borders."}
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

