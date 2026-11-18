import { create } from "zustand";
import type { Vec2 } from "../core/geometry";

/** High-frequency viewport readouts, isolated so only the status bar re-renders on mouse move. */
interface CursorState {
  world: Vec2 | null;
  /** Screen CSS px per PDF point (100% = 1 px per pt = paper size at 96/72 dpi). */
  zoom: number;
  setWorld(world: Vec2 | null): void;
  setZoom(zoom: number): void;
}

export const useCursor = create<CursorState>()((set) => ({
  world: null,
  zoom: 1,
  setWorld: (world) => set({ world }),
  setZoom: (zoom) => set({ zoom }),
}));
