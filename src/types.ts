export type MeasurementType = 'OD600' | 'FLUO' | 'LUM' | string;

export interface UnifiedRow {
  runId: string;
  plateId: string;
  sourceFile: string;
  well: string; // A1..H12
  timeSeconds: number;
  timeLabel?: string;
  measurementType: MeasurementType;
  value: number;
}

export interface UnifiedDatasetMeta {
  runId: string;
  plateId: string;
  sourceFile: string;
  measurementType: MeasurementType;
  createdAt: string;
  parserId: string;
}

export interface UnifiedDataset extends UnifiedDatasetMeta {
  rows: UnifiedRow[];
}

export interface Mapping {
  id: string;
  name: string;
  createdAt: string;
  assignments: Record<string, string>; // well -> sample
  samples: string[];
  sampleColors?: Record<string, string>; // sample -> hex (#rrggbb)
  sampleSaturations?: Record<string, number>; // sample -> saturation 0-100
  notes?: string;
}

export interface AssignedRow extends UnifiedRow {
  sample?: string;
}

export interface SampleList {
  name: string;
  createdAt: string;
  items: string[];
}

export interface SmoothedSampleHistoryPoint {
  x: number;
  y: number;
  logPhase?: boolean;
}

export interface SmoothedSampleHistoryState {
  label: string;
  points: SmoothedSampleHistoryPoint[];
}

export interface SmoothedSampleHistory {
  sample: string;
  color: string;
  wells: { well: string; replicate: number }[];
  history: SmoothedSampleHistoryState[];
}

export interface SampleCurvesExportRecord {
  sample: string;
  time_min: number[];
  od600_smoothed_vals: number[];
}

export interface WellCurveExportRecord {
  sample: string;
  well: string;
  replicate?: number;
  time_min: number[];
  od600_smoothed?: number[];
  od600_blank_corrected?: number[];
  od600_raw?: number[];
  curation?: { excluded_points?: number[]; excludedIndices?: number[] };
}

export interface LogPhasePoint {
  t_min: number;
  od600: number;
}

export interface LogPhaseSelection {
  sample: string;
  start: number;
  end: number;
  createdAt: string;
  points?: LogPhasePoint[];
}

export interface SmoothedCurvesPayload {
  version: number;
  generatedAt: string;
  source: {
    file: string;
    runId: string;
    plateId: string;
  };
  smoothing: {
    span: string;
    degree: number;
  };
  sample_curves?: SampleCurvesExportRecord[];
  well_curves?: WellCurveExportRecord[];
  samples: SmoothedSampleHistory[];
  logPhases?: LogPhaseSelection[];
}
