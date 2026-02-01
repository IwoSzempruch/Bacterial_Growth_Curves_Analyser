import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { generateDistinctColors, hexToHsl, hslToHex } from '@/utils/colors';
import type {
  Mapping,
  SampleList,
  UnifiedDataset,
  SmoothedCurvesPayload,
  LogPhaseSelection,
} from '@/types';
import type { AssignmentEntry } from '@/utils/assignments';

export interface BlankPointSelection {
  sample: string;
  well: string;
  timeSeconds: number;
  value: number;
  measurementType: string;
}

export type RawDataPointOverride = 'include' | 'exclude';

export interface RawDataSettings {
  lowestPointCount: number;
  removeEarlierPoints: boolean;
  outlierThreshold: number;
  outlierWindowMinutes: number;
  outlierWindowPercent: number;
}

export type AutoRunStage = 'idle' | 'toBlank' | 'blankQueued' | 'loessQueued' | 'waitingParameters' | 'done' | 'error';

export interface AutoRunState {
  runId: string | null;
  mappingId: string | null;
  stage: AutoRunStage;
  startedAt: string | null;
  error: string | null;
}

export interface SharedSmoothedContext {
  smoothed: SmoothedCurvesPayload;
  assignment: AssignmentEntry | null;
  rawPayload: any | null;
  blankedInfo?: { version?: number; createdAt?: string; blanked?: boolean | null };
  filename?: string;
}

interface AppState {
  // Sample lists
  sampleLists: Record<string, SampleList>;
  activeSampleListName: string | null;

  // UI preferences
  language: 'pl' | 'en';
  theme: 'light' | 'dark';

  // Mappings
  mappings: Record<string, Mapping>;
  activeMappingId: string | null;

  // Datasets (converted files)
  datasets: Record<string, UnifiedDataset>; // runId -> dataset
  // Saved mapping chosen per dataset (runId -> mappingId)
  datasetMapping: Record<string, string>;

  // UI
  activeTab: string;
  plotsSelectedRunId: string | null;
  interactiveAnalysis: any | null;
  blankSelections: Record<string, Record<string, BlankPointSelection[]>>;
  blankCorrectionAssignments: AssignmentEntry[] | null;
  curvesSmoothingAssignments: AssignmentEntry[] | null;
  curvesSmoothingSmoothed: SharedSmoothedContext | null;
  rawDataPointOverrides: Record<string, Record<string, RawDataPointOverride>>;
  rawDataSettings: RawDataSettings;
  autoRun: AutoRunState;

  // actions
  setLanguage: (lang: 'pl' | 'en') => void;
  toggleLanguage: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setActiveTab: (t: string) => void;
  setPlotsSelectedRunId: (runId: string | null) => void;
  setInteractiveAnalysis: (data: any | null) => void;
  toggleBlankPoint: (runId: string, point: BlankPointSelection) => void;
  setBlankCorrectionAssignments: (entries: AssignmentEntry[] | null) => void;
  setBlankSelectionsForRun: (
    runId: string,
    selections: Record<string, BlankPointSelection[]>,
  ) => void;
  clearBlankPointsForWell: (runId: string, well: string) => void;
  clearBlankSelections: (runId: string) => void;
  setCurvesSmoothingAssignments: (entries: AssignmentEntry[] | null) => void;
  setCurvesSmoothingSmoothed: (payload: SharedSmoothedContext | null) => void;
  setRawDataPointOverride: (runId: string, pointId: string, override: RawDataPointOverride | null) => void;
  resetRawDataPointOverrides: (runId: string) => void;
  setRawDataSettings: (settings: Partial<RawDataSettings>) => void;
  setAutoRun: (update: Partial<AutoRunState>) => void;
  resetAutoRun: () => void;

  createSampleList: (name: string, items: string[]) => void;
  setActiveSampleList: (name: string | null) => void;
  updateSampleList: (name: string, items: string[]) => void;
  deleteSampleList: (name: string) => void;

  createMapping: (name: string, samples: string[]) => string;
  updateMappingAssignments: (
    id: string,
    assignments: Record<string, string>
  ) => void;
  renameMapping: (id: string, newName: string) => void;
  setActiveMapping: (id: string | null) => void;
  deleteMapping: (id: string) => void;

  addDataset: (ds: UnifiedDataset) => void;
  removeDataset: (runId: string) => void;
  clearAll: () => void;

  // dataset <-> mapping links
  setDatasetMapping: (runId: string, mappingId: string) => void;
  setDatasetMappings: (pairs: Record<string, string>) => void;

  // bulk upserts (for assignment import/export)
  upsertDatasets: (arr: UnifiedDataset[]) => void;
  upsertMappings: (arr: Mapping[]) => void;

  // sample colors
  setSampleColor: (id: string, sampleName: string, color: string) => void;
  setSampleSaturation: (
    id: string,
    sampleName: string,
    saturation: number
  ) => void;
  randomizeSampleColors: (id: string) => void;
  setMappingSamples: (id: string, samples: string[]) => void;
  duplicateMapping: (sourceId: string) => string | null;
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      sampleLists: {},
      activeSampleListName: null,

      language: 'en',
      theme: 'light',

      mappings: {},
      activeMappingId: null,

      datasets: {},
      datasetMapping: {},
      activeTab: 'home',
      plotsSelectedRunId: null,
      interactiveAnalysis: null,
      blankSelections: {},
      blankCorrectionAssignments: null,
      curvesSmoothingAssignments: null,
      curvesSmoothingSmoothed: null,
      rawDataPointOverrides: {},
      rawDataSettings: {
        lowestPointCount: 3,
        removeEarlierPoints: true,
        outlierThreshold: 0.001,
        outlierWindowMinutes: 400,
        outlierWindowPercent: 0,
      },
      autoRun: {
        runId: null,
        mappingId: null,
        stage: 'idle',
        startedAt: null,
        error: null,
      },

      setLanguage: (lang) => set({ language: lang }),
      toggleLanguage: () =>
        set((state) => ({ language: state.language === 'en' ? 'pl' : 'en' })),
      setTheme: (theme) => set({ theme }),
      toggleTheme: () =>
        set((state) => ({ theme: state.theme === 'light' ? 'dark' : 'light' })),
      setActiveTab: (t) => set({ activeTab: t }),
      setPlotsSelectedRunId: (runId) => set({ plotsSelectedRunId: runId }),
      setInteractiveAnalysis: (data) => set({ interactiveAnalysis: data }),
      setBlankCorrectionAssignments: (entries) =>
        set({ blankCorrectionAssignments: entries ?? null }),
      toggleBlankPoint: (runId, point) =>
        set((state) => {
          if (!runId || !point?.well) return {}
          const perRun = { ...(state.blankSelections[runId] ?? {}) }
          const well = point.well
          const list = perRun[well] ? [...perRun[well]] : []
          const idx = list.findIndex(
            (p) =>
              Math.abs(p.timeSeconds - point.timeSeconds) < 1e-9 &&
              Math.abs(p.value - point.value) < 1e-9
          )
          if (idx >= 0) {
            list.splice(idx, 1)
          } else {
            list.push(point)
            list.sort((a, b) => a.timeSeconds - b.timeSeconds)
          }
          if (list.length) {
            perRun[well] = list
          } else {
            delete perRun[well]
          }
          const nextSelections = { ...state.blankSelections }
          if (Object.keys(perRun).length) {
            nextSelections[runId] = perRun
          } else {
            delete nextSelections[runId]
          }
          return { blankSelections: nextSelections }
        }),
      setBlankSelectionsForRun: (runId, selections) =>
        set((state) => {
          if (!runId) return {}
          const normalized: Record<string, BlankPointSelection[]> = {}
          Object.entries(selections ?? {}).forEach(([well, points]) => {
            if (!well || !points?.length) return
            const clean = points
              .filter(
                (p): p is BlankPointSelection =>
                  Boolean(
                    p &&
                      typeof p.well === 'string' &&
                      Number.isFinite(p.timeSeconds) &&
                      Number.isFinite(p.value),
                  ),
              )
              .map((p) => ({
                ...p,
                sample: p.sample ?? '',
                measurementType: p.measurementType ?? 'value',
              }))
              .sort((a, b) => a.timeSeconds - b.timeSeconds)
            if (clean.length) normalized[well] = clean
          })
          const nextSelections = { ...state.blankSelections }
          if (Object.keys(normalized).length) {
            nextSelections[runId] = normalized
          } else {
            delete nextSelections[runId]
          }
          return { blankSelections: nextSelections }
        }),
      clearBlankPointsForWell: (runId, well) =>
        set((state) => {
          if (!runId || !well) return {}
          const perRun = state.blankSelections[runId]
          if (!perRun || !perRun[well]) return {}
          const nextRun = { ...perRun }
          delete nextRun[well]
          const nextSelections = { ...state.blankSelections }
          if (Object.keys(nextRun).length) {
            nextSelections[runId] = nextRun
          } else {
            delete nextSelections[runId]
          }
          return { blankSelections: nextSelections }
        }),
      clearBlankSelections: (runId) =>
        set((state) => {
          if (!runId || !state.blankSelections[runId]) return {}
          const nextSelections = { ...state.blankSelections }
          delete nextSelections[runId]
          return { blankSelections: nextSelections }
        }),
      setCurvesSmoothingAssignments: (entries) => set({ curvesSmoothingAssignments: entries ?? null }),
      setCurvesSmoothingSmoothed: (payload) => set({ curvesSmoothingSmoothed: payload ?? null }),
      setRawDataPointOverride: (runId, pointId, override) =>
        set((state) => {
          if (!runId || !pointId) return {};
          const existing = { ...(state.rawDataPointOverrides[runId] ?? {}) };
          if (!override) {
            delete existing[pointId];
          } else {
            existing[pointId] = override;
          }
          return {
            rawDataPointOverrides: {
              ...state.rawDataPointOverrides,
              [runId]: existing,
            },
          };
        }),
      resetRawDataPointOverrides: (runId) =>
        set((state) => {
          if (!runId || !state.rawDataPointOverrides[runId]) return {};
          const next = { ...state.rawDataPointOverrides };
          delete next[runId];
          return { rawDataPointOverrides: next };
        }),
      setRawDataSettings: (settings) =>
        set((state) => ({
          rawDataSettings: {
            ...state.rawDataSettings,
            ...settings,
          },
        })),
      setAutoRun: (update) =>
        set((state) => ({
          autoRun: {
            ...(state.autoRun ?? { runId: null, mappingId: null, stage: 'idle', startedAt: null, error: null }),
            ...update,
          },
        })),
      resetAutoRun: () =>
        set({
          autoRun: { runId: null, mappingId: null, stage: 'idle', startedAt: null, error: null },
        }),

      createSampleList: (name, items) =>
        set((state) => {
          const list: SampleList = {
            name,
            createdAt: new Date().toISOString(),
            items,
          };
          return {
            sampleLists: { ...state.sampleLists, [name]: list },
            activeSampleListName: name,
          };
        }),

      setActiveSampleList: (name) => set({ activeSampleListName: name }),

      updateSampleList: (name, items) =>
        set((state) => {
          const list = state.sampleLists[name];
          if (!list) return {};
          return {
            sampleLists: { ...state.sampleLists, [name]: { ...list, items } },
          };
        }),

      deleteSampleList: (name) =>
        set((state) => {
          const { [name]: _deleted, ...rest } = state.sampleLists;
          const active =
            state.activeSampleListName === name
              ? null
              : state.activeSampleListName;
          return { sampleLists: rest, activeSampleListName: active };
        }),

      createMapping: (name, samples) => {
        const id = uuidv4();
        const colors = generateDistinctColors(samples.length);
        const sampleColors = Object.fromEntries(
          samples.map((s, i) => [s, colors[i]])
        );
        const sampleSaturations = Object.fromEntries(
          samples.map((s, i) => [s, hexToHsl(colors[i]).s])
        );
        const mapping: Mapping = {
          id,
          name,
          createdAt: new Date().toISOString(),
          assignments: {},
          samples,
          sampleColors,
          sampleSaturations,
        };
        set((state) => ({
          mappings: { ...state.mappings, [id]: mapping },
          activeMappingId: id,
        }));
        return id;
      },

      updateMappingAssignments: (
        id: string,
        assignments: Record<string, string>
      ) =>
        set((state) => {
          const m = state.mappings[id];
          if (!m) return {};
          return {
            mappings: { ...state.mappings, [id]: { ...m, assignments } },
          };
        }),

      renameMapping: (id, newName) =>
        set((state) => {
          const m = state.mappings[id];
          if (!m) return {};
          return {
            mappings: { ...state.mappings, [id]: { ...m, name: newName } },
          };
        }),

      setActiveMapping: (id) => set({ activeMappingId: id }),

      deleteMapping: (id) =>
        set((state) => {
          const { [id]: _deleted, ...rest } = state.mappings
          const remainingIds = Object.keys(rest)
          const active =
            state.activeMappingId === id
              ? remainingIds.length ? remainingIds[0] : null
              : state.activeMappingId
          return { mappings: rest, activeMappingId: active }
        }),

      addDataset: (ds) =>
        set((state) => ({
          datasets: { ...state.datasets, [ds.runId]: ds },
        })),

      removeDataset: (runId) =>
        set((state) => {
          const { [runId]: _deleted, ...rest } = state.datasets;
          const { [runId]: _mDeleted, ...restLinks } = state.datasetMapping ?? {};
          return { datasets: rest, datasetMapping: restLinks };
        }),

      clearAll: () =>
        set({
          sampleLists: {},
          activeSampleListName: null,
          mappings: {},
          activeMappingId: null,
          datasets: {},
          datasetMapping: {},
          blankSelections: {},
          blankCorrectionAssignments: null,
          curvesSmoothingAssignments: null,
          curvesSmoothingSmoothed: null,
          rawDataPointOverrides: {},
        }),

      setDatasetMapping: (runId, mappingId) =>
        set((state) => ({
          datasetMapping: { ...(state.datasetMapping ?? {}), [runId]: mappingId },
        })),

      setDatasetMappings: (pairs) =>
        set((state) => ({
          datasetMapping: { ...(state.datasetMapping ?? {}), ...pairs },
        })),

      upsertDatasets: (arr) =>
        set((state) => ({
          datasets: {
            ...state.datasets,
            ...Object.fromEntries(arr.map((d) => [d.runId, d])),
          },
        })),

      upsertMappings: (arr) =>
        set((state) => ({
          mappings: {
            ...state.mappings,
            ...Object.fromEntries(arr.map((m) => [m.id, m])),
          },
        })),

      setSampleColor: (id, sampleName, color) =>
        set((state) => {
          const m = state.mappings[id];
          if (!m) return {};
          const sc = { ...(m.sampleColors ?? {}), [sampleName]: color };
          const hs = hexToHsl(color).s;
          const ss = { ...(m.sampleSaturations ?? {}), [sampleName]: hs };
          return {
            mappings: {
              ...state.mappings,
              [id]: { ...m, sampleColors: sc, sampleSaturations: ss },
            },
          };
        }),

      setSampleSaturation: (id, sampleName, saturation) =>
        set((state) => {
          const m = state.mappings[id];
          if (!m) return {};
          const current = m.sampleColors?.[sampleName];
          if (!current) return {};
          const hsl = hexToHsl(current);
          const hex = hslToHex(hsl.h, saturation, hsl.l);
          const sc = { ...(m.sampleColors ?? {}), [sampleName]: hex };
          const ss = { ...(m.sampleSaturations ?? {}), [sampleName]: saturation };
          return {
            mappings: {
              ...state.mappings,
              [id]: { ...m, sampleColors: sc, sampleSaturations: ss },
            },
          };
        }),

      randomizeSampleColors: (id) =>
        set((state) => {
          const m = state.mappings[id];
          if (!m) return {};
          const colors = generateDistinctColors(
            m.samples.length,
            Math.random() * 360
          );
          const sc = Object.fromEntries(
            m.samples.map((s, i) => [s, colors[i]])
          );
          const ss = Object.fromEntries(
            m.samples.map((s, i) => [s, hexToHsl(colors[i]).s])
          );
          return {
            mappings: {
              ...state.mappings,
              [id]: { ...m, sampleColors: sc, sampleSaturations: ss },
            },
          };
        }),

      setMappingSamples: (id, samples) =>
        set((state) => {
          const m = state.mappings[id];
          if (!m) return {};
          // Generate a new color set for the provided samples
          const colors = generateDistinctColors(samples.length);
          const sampleColors = Object.fromEntries(
            samples.map((s, i) => [s, colors[i]])
          );
          const sampleSaturations = Object.fromEntries(
            samples.map((s, i) => [s, hexToHsl(colors[i]).s])
          );
          // Drop assignments that reference samples no longer present
          const newAssignments = Object.fromEntries(
            Object.entries(m.assignments).filter(([, sample]) =>
              samples.includes(sample)
            )
          );
          return {
            mappings: {
              ...state.mappings,
              [id]: {
                ...m,
                samples,
                assignments: newAssignments,
                sampleColors,
                sampleSaturations,
              },
            },
          };
        }),

      duplicateMapping: (sourceId) => {
        const state = get();
        const src = state.mappings[sourceId];
        if (!src) return null;
        const id = uuidv4();
        const existingNames = new Set(Object.values(state.mappings).map((m) => m.name));
        const baseName = src.name.endsWith('_copy') ? src.name : `${src.name}_copy`;
        let name = baseName;
        let counter = 2;
        while (existingNames.has(name)) {
          name = `${baseName}${counter}`;
          counter += 1;
        }
        const mapping: Mapping = {
          id,
          name,
          createdAt: new Date().toISOString(),
          assignments: { ...src.assignments },
          samples: [...src.samples],
          sampleColors: src.sampleColors ? { ...src.sampleColors } : undefined,
          sampleSaturations: src.sampleSaturations
            ? { ...src.sampleSaturations }
            : undefined,
          notes: src.notes,
        };
        set((state) => ({
          mappings: { ...state.mappings, [id]: mapping },
          activeMappingId: id,
        }));
        return id;
      },
    }),
    {
      name: 'bgc-webapp-storage',
      storage: createJSONStorage(() => localStorage),
      // Avoid exceeding localStorage quota: do not persist large datasets
      partialize: (state) => ({
        sampleLists: state.sampleLists,
        activeSampleListName: state.activeSampleListName,
        mappings: state.mappings,
        activeMappingId: state.activeMappingId,
        datasetMapping: state.datasetMapping,
        activeTab: state.activeTab,
        language: state.language,
        theme: state.theme,
        plotsSelectedRunId: state.plotsSelectedRunId,
        interactiveAnalysis: state.interactiveAnalysis,
        rawDataPointOverrides: state.rawDataPointOverrides,
        rawDataSettings: state.rawDataSettings,
        // Keep the heavy smoothing payload in memory only to avoid localStorage quota errors
      }),
    }
  )
);
