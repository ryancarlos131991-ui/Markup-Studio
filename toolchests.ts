import { create } from "zustand";
import { RECENT_TOOLS_LIMIT, defaultToolChests } from "../core/defaults";
import type { ToolChestFile, ToolChestSet, ToolPreset } from "../core/schema";
import { validateToolChests } from "../core/validate";
import { errorMessage, ipc } from "../platform/ipc";

interface ToolChestState {
  file: ToolChestFile;
  loaded: boolean;
  activePresetId: string | null;
  load(): Promise<string[]>;
  toggleCollapsed(setId: string): void;
  recordUse(preset: ToolPreset): void;
  addToMyTools(preset: ToolPreset): void;
  removeFromSet(setId: string, presetId: string): void;
  setActivePreset(presetId: string | null): void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist(file: ToolChestFile) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    ipc.saveToolChests(file).catch((err) => console.error(`Tool chest save failed: ${errorMessage(err)}`));
  }, 400);
}

const mapSet = (file: ToolChestFile, setId: string, fn: (s: ToolChestSet) => ToolChestSet): ToolChestFile => ({
  ...file,
  sets: file.sets.map((s) => (s.id === setId ? fn(s) : s)),
});

export const useToolChests = create<ToolChestState>()((set, get) => {
  const update = (fn: (f: ToolChestFile) => ToolChestFile) => {
    const file = fn(get().file);
    set({ file });
    persist(file);
  };

  return {
    file: defaultToolChests(),
    loaded: false,
    activePresetId: null,

    async load() {
      try {
        const raw = await ipc.loadToolChests();
        const { value, warnings } = raw ? validateToolChests(raw) : { value: defaultToolChests(), warnings: [] };
        set({ file: value, loaded: true });
        return warnings;
      } catch (err) {
        set({ loaded: true });
        return [`Tool chests could not be loaded: ${errorMessage(err)}`];
      }
    },

    toggleCollapsed(setId) {
      update((f) => mapSet(f, setId, (s) => ({ ...s, collapsed: !s.collapsed })));
    },

    recordUse(preset) {
      update((f) =>
        mapSet(f, "recent", (s) => ({
          ...s,
          presets: [preset, ...s.presets.filter((p) => p.id !== preset.id)].slice(0, RECENT_TOOLS_LIMIT),
        })),
      );
    },

    addToMyTools(preset) {
      const copy: ToolPreset = { ...preset, id: `my-${crypto.randomUUID()}`, template: structuredClone(preset.template) };
      update((f) => mapSet(f, "my-tools", (s) => ({ ...s, presets: [...s.presets, copy] })));
    },

    removeFromSet(setId, presetId) {
      update((f) => mapSet(f, setId, (s) => ({ ...s, presets: s.presets.filter((p) => p.id !== presetId) })));
    },

    setActivePreset(presetId) {
      set({ activePresetId: presetId });
    },
  };
});
