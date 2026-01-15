export const BASELINE_T_PRE_MINUTES = 45;
export const BASELINE_BIN_WIDTH = 0.001;
export const BASELINE_DEFAULT_TOLERANCE = 0.001;
export const BASELINE_DEFAULT_MIN_CONSECUTIVE = 3;
export const MONOTONIC_DEFAULT_WINDOW_MINUTES = 400;
export const MONOTONIC_DEFAULT_TOLERANCE = 0;

export function makePointId(well: string, timeSeconds: number): string {
  const normalized = Number(Number(timeSeconds ?? 0).toFixed(6));
  return `${well}|${normalized}`;
}

export type BaselineComputationOptions = {
  minConsecutive: number;
  tolerance: number;
  monotonicTimeMax: number;
  monotonicTolerance: number;
  removePreBaselineSpikes: boolean;
};

export type BaselineComputationResult = {
  baselineIndices: number[];
  baselineLevel: number | null;
  preExcludedIndices: number[];
  monotonicExcludedIndices: number[];
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeBaselineForPoints(
  points: { x: number; value: number }[],
  options: BaselineComputationOptions,
): BaselineComputationResult {
  if (!points.length) {
    return {
      baselineIndices: [],
      baselineLevel: null,
      preExcludedIndices: [],
      monotonicExcludedIndices: [],
    };
  }
  const {
    minConsecutive,
    tolerance,
    monotonicTimeMax,
    monotonicTolerance,
    removePreBaselineSpikes,
  } = options;
  const t = points.map((point) => point.x);
  const y = points.map((point) => point.value);

  const preIndices = t
    .map((time, index) => ({ time, index }))
    .filter(({ time }) => time <= BASELINE_T_PRE_MINUTES)
    .map(({ index }) => index);
  if (preIndices.length < minConsecutive) {
    return {
      baselineIndices: [],
      baselineLevel: null,
      preExcludedIndices: [],
      monotonicExcludedIndices: [],
    };
  }

  const yPre = preIndices.map((index) => y[index]);
  const yMin = Math.min(...yPre);
  const bins = new Map<number, number[]>();
  preIndices.forEach((index) => {
    const value = y[index];
    const binIndex = Math.floor((value - yMin) / BASELINE_BIN_WIDTH);
    if (!bins.has(binIndex)) bins.set(binIndex, []);
    bins.get(binIndex)!.push(index);
  });
  if (!bins.size) {
    return {
      baselineIndices: [],
      baselineLevel: null,
      preExcludedIndices: [],
      monotonicExcludedIndices: [],
    };
  }

  let bestBinIndices: number[] = [];
  bins.forEach((indices) => {
    if (indices.length > bestBinIndices.length) bestBinIndices = indices;
  });
  const baselineValues = bestBinIndices.map((index) => y[index]);
  const baselineLevel = median(baselineValues);

  const candidateIndices = preIndices
    .filter((index) => Math.abs(y[index] - baselineLevel) <= tolerance)
    .sort((a, b) => a - b);
  if (!candidateIndices.length) {
    return {
      baselineIndices: [],
      baselineLevel,
      preExcludedIndices: [],
      monotonicExcludedIndices: [],
    };
  }

  const runs: number[][] = [];
  let currentRun: number[] = [candidateIndices[0]];
  for (let i = 1; i < candidateIndices.length; i += 1) {
    const index = candidateIndices[i];
    if (index === currentRun[currentRun.length - 1] + 1) {
      currentRun.push(index);
    } else {
      runs.push(currentRun);
      currentRun = [index];
    }
  }
  runs.push(currentRun);

  const validRuns = runs.filter((run) => run.length >= minConsecutive);
  const baselineIndices = (
    validRuns.length
      ? validRuns.reduce((a, b) => (b.length > a.length ? b : a))
      : candidateIndices
  ).slice();

  const preExcludedIndices: number[] = [];
  if (removePreBaselineSpikes && baselineIndices.length) {
    const earliestBaselineIndex = Math.min(...baselineIndices);
    preIndices.forEach((index) => {
      if (
        index < earliestBaselineIndex &&
        Math.abs(y[index] - baselineLevel) > tolerance
      ) {
        preExcludedIndices.push(index);
      }
    });
  }

  if (!baselineIndices.length) {
    return {
      baselineIndices,
      baselineLevel,
      preExcludedIndices,
      monotonicExcludedIndices: [],
    };
  }

  const excludedIndexSet = new Set(preExcludedIndices);
  const windowLimit =
    monotonicTimeMax > 0 ? monotonicTimeMax : Number.POSITIVE_INFINITY;
  const startIndex = Math.min(...baselineIndices);
  const monoIndices: number[] = [];
  for (let i = startIndex; i < points.length; i += 1) {
    if (excludedIndexSet.has(i)) continue;
    if (t[i] > windowLimit) break;
    monoIndices.push(i);
  }

  if (monoIndices.length <= 1) {
    return {
      baselineIndices,
      baselineLevel,
      preExcludedIndices,
      monotonicExcludedIndices: [],
    };
  }
  const monoValues = monoIndices.map((index) => y[index]);

  const dpLen: number[] = new Array(monoValues.length).fill(1);
  const prevIdx: number[] = new Array(monoValues.length).fill(-1);
  let bestEnd = 0;
  for (let j = 0; j < monoValues.length; j += 1) {
    for (let i = 0; i < j; i += 1) {
      if (
        monoValues[i] <= monoValues[j] + monotonicTolerance &&
        dpLen[i] + 1 > dpLen[j]
      ) {
        dpLen[j] = dpLen[i] + 1;
        prevIdx[j] = i;
      }
    }
    if (dpLen[j] > dpLen[bestEnd]) bestEnd = j;
  }
  let cursor: number | null = bestEnd;
  const lndsSet = new Set<number>();
  while (cursor != null && cursor >= 0) {
    lndsSet.add(monoIndices[cursor]);
    cursor = prevIdx[cursor];
  }
  const monotonicExcludedIndices: number[] = [];
  monoIndices.forEach((index) => {
    if (!lndsSet.has(index)) monotonicExcludedIndices.push(index);
  });

  return {
    baselineIndices,
    baselineLevel,
    preExcludedIndices,
    monotonicExcludedIndices,
  };
}
