import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { generateDistinctColors } from '@/utils/colors';
import type { Mapping, SampleList, UnifiedDataset } from '@/types';

interface AppState {
  // Sample lists
  sampleLists: Record<string, SampleList>;
  activeSampleListName: string | null;

  // Mappings
  mappings: Record<string, Mapping>;
  activeMappingId: string | null;

  // Datasets (converted files)
  datasets: Record<string, UnifiedDataset>; // runId -> dataset

  // UI
  activeTab: string;

  // actions
  setActiveTab: (t: string) => void;

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

  // sample colors
  setSampleColor: (id: string, sampleName: string, color: string) => void;
  randomizeSampleColors: (id: string) => void;
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      sampleLists: {},
      activeSampleListName: null,

      mappings: {},
      activeMappingId: null,

      datasets: {},
      activeTab: 'home',

      setActiveTab: (t) => set({ activeTab: t }),

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
        const mapping: Mapping = {
          id,
          name,
          createdAt: new Date().toISOString(),
          assignments: {},
          samples,
          sampleColors,
        };
        set((state) => ({
          mappings: { ...state.mappings, [id]: mapping },
          activeMappingId: id,
        }));
        return id;
      },

      updateMappingAssignments: (id, assignments) =>
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
          const { [id]: _deleted, ...rest } = state.mappings;
          const active =
            state.activeMappingId === id ? null : state.activeMappingId;
          return { mappings: rest, activeMappingId: active };
        }),

      addDataset: (ds) =>
        set((state) => ({
          datasets: { ...state.datasets, [ds.runId]: ds },
        })),

      removeDataset: (runId) =>
        set((state) => {
          const { [runId]: _deleted, ...rest } = state.datasets;
          return { datasets: rest };
        }),

      clearAll: () =>
        set({
          sampleLists: {},
          activeSampleListName: null,
          mappings: {},
          activeMappingId: null,
          datasets: {},
        }),

      setSampleColor: (id, sampleName, color) =>
        set((state) => {
          const m = state.mappings[id];
          if (!m) return {};
          const sc = { ...(m.sampleColors ?? {}), [sampleName]: color };
          return {
            mappings: { ...state.mappings, [id]: { ...m, sampleColors: sc } },
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
          return {
            mappings: { ...state.mappings, [id]: { ...m, sampleColors: sc } },
          };
        }),
    }),
    {
      name: 'bgc-webapp-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
