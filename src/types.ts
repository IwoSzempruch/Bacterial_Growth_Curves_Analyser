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
  assignments: Record<string, string>; // well -> sampleName
  samples: string[];
  sampleColors?: Record<string, string>; // sampleName -> hex (#rrggbb)
  notes?: string;
}

export interface AssignedRow extends UnifiedRow {
  sampleName?: string;
}

export interface SampleList {
  name: string;
  createdAt: string;
  items: string[];
}
