/**
 * Workspace store: open tabs (MDI), each holding a BpxDocument plus its own deterministic
 * undo/redo history. All undoable mutations go through `commit(op)`; see core/history.ts.
 */

import { create } from "zustand";
import { createEmptyDocument } from "../core/defaults";
import { type HistoryEntry, HISTORY_LIMIT, type Op, applyOp, invertOp, isEmptyOp } from "../core/history";
import type { BpxDocument, Layer, LayerId } from "../core/schema";
import type { DisplayUnit } from "../core/units";
import { validateBpx } from "../core/validate";
import { askSaveBeforeClose, errorMessage, ipc } from "../platform/ipc";
import { loadPdfDocument, pdfRegistry } from "../platform/pdfjs";

export interface PageSize {
  width: number;
  height: number;
}

export interface Tab {
  id: string;
  pdfPath: string;
  title: string;
  doc: BpxDocument;
  pageCount: number;
  pageIndex: number;
  /** Page sizes in points (rotation applied), filled as pages are first displayed. */
  pageSizes: Record<number, PageSize>;
  undo: HistoryEntry[];
  redo: HistoryEntry[];
  pendingGroup: { label: string; ops: Op[] } | null;
  dirty: boolean;
  lastSavedAt: number | null;
}

type LogFn = (text: string, kind: "info" | "error" | "result") => void;
let log: LogFn = (text, kind) => (kind === "error" ? console.error(text) : console.info(text));
/** The CLI log is the app's console; the engine module wires itself in here. */
export const setWorkspaceLogger = (fn: LogFn) => {
  log = fn;
};

interface WorkspaceState {
  tabs: Tab[];
  activeTabId: string | null;
  loadingPaths: string[];

  openPaths(paths: string[]): Promise<void>;
  closeTab(tabId: string): Promise<void>;
  setActiveTab(tabId: string): void;
  cycleTab(direction: 1 | -1): void;
  setPage(tabId: string, pageIndex: number): void;
  setPageSize(tabId: string, pageIndex: number, size: PageSize): void;

  commit(tabId: string, op: Op, label: string, nextEntitySeq?: number): void;
  beginGroup(tabId: string, label: string): void;
  endGroup(tabId: string): void;
  undo(tabId: string): string | null;
  redo(tabId: string): string | null;

  updateLayer(tabId: string, layerId: LayerId, patch: Partial<Omit<Layer, "id">>): void;
  setActiveLayer(tabId: string, layerId: LayerId): void;
  setDisplayUnit(tabId: string, unit: DisplayUnit): void;

  save(tabId: string): Promise<boolean>;
}

export const useWorkspace = create<WorkspaceState>()((set, get) => {
  const patchTab = (tabId: string, fn: (t: Tab) => Tab) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? fn(t) : t)) }));
  const findTab = (tabId: string) => get().tabs.find((t) => t.id === tabId);

  async function openOne(path: string): Promise<void> {
    const existing = get().tabs.find((t) => t.pdfPath === path);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    set((s) => ({ loadingPaths: [...s.loadingPaths, path] }));
    const tabId = crypto.randomUUID();
    try {
      const [info, bytes, sidecar] = await Promise.all([ipc.statPdf(path), ipc.readPdf(path), ipc.loadBpx(path)]);
      const loaded = await loadPdfDocument(bytes);
      const pdf = loaded.doc;
      const fingerprint = {
        fileName: info.fileName,
        byteLength: info.byteLength,
        modifiedMs: info.modifiedMs,
        pageCount: pdf.numPages,
      };
      let doc: BpxDocument;
      if (sidecar) {
        const { value, warnings } = validateBpx(sidecar);
        doc = value;
        for (const w of warnings) log(`${info.fileName}.bpx: ${w}`, "error");
        if (value.pdf.byteLength !== info.byteLength || value.pdf.pageCount !== pdf.numPages) {
          log(
            `${info.fileName}: the PDF differs from the one these markups were saved against ` +
              `(size or page count changed). Check alignment on re-issued sheets.`,
            "error",
          );
        }
        const orphaned = value.entities.filter((e) => e.pageIndex >= pdf.numPages).length;
        if (orphaned) log(`${orphaned} markup(s) reference pages beyond page ${pdf.numPages}.`, "error");
        log(`Opened ${info.fileName} with ${value.entities.length} markup(s) from ${info.sidecarPath}`, "info");
      } else {
        doc = createEmptyDocument(fingerprint);
        log(`Opened ${info.fileName} (${pdf.numPages} page${pdf.numPages === 1 ? "" : "s"}, no markups yet)`, "info");
      }
      pdfRegistry.set(tabId, loaded);
      const tab: Tab = {
        id: tabId,
        pdfPath: path,
        title: info.fileName,
        doc,
        pageCount: pdf.numPages,
        pageIndex: 0,
        pageSizes: {},
        undo: [],
        redo: [],
        pendingGroup: null,
        dirty: false,
        lastSavedAt: null,
      };
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tabId }));
    } catch (err) {
      await pdfRegistry.release(tabId);
      log(`Could not open ${path}: ${errorMessage(err)}`, "error");
    } finally {
      set((s) => ({ loadingPaths: s.loadingPaths.filter((p) => p !== path) }));
    }
  }

  return {
    tabs: [],
    activeTabId: null,
    loadingPaths: [],

    async openPaths(paths) {
      for (const p of paths) await openOne(p);
    },

    async closeTab(tabId) {
      const tab = findTab(tabId);
      if (!tab) return;
      if (tab.dirty && (await askSaveBeforeClose(tab.title))) {
        const ok = await get().save(tabId);
        if (!ok) return; // keep the tab open if saving failed
      }
      set((s) => {
        const idx = s.tabs.findIndex((t) => t.id === tabId);
        const tabs = s.tabs.filter((t) => t.id !== tabId);
        let activeTabId = s.activeTabId;
        if (activeTabId === tabId) activeTabId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null;
        return { tabs, activeTabId };
      });
      await pdfRegistry.release(tabId);
    },

    setActiveTab(tabId) {
      if (findTab(tabId)) set({ activeTabId: tabId });
    },

    cycleTab(direction) {
      const { tabs, activeTabId } = get();
      if (tabs.length < 2) return;
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      const next = tabs[(idx + direction + tabs.length) % tabs.length]!;
      set({ activeTabId: next.id });
    },

    setPage(tabId, pageIndex) {
      patchTab(tabId, (t) => {
        const clamped = Math.min(t.pageCount - 1, Math.max(0, pageIndex));
        return clamped === t.pageIndex ? t : { ...t, pageIndex: clamped };
      });
    },

    setPageSize(tabId, pageIndex, size) {
      patchTab(tabId, (t) => {
        const prev = t.pageSizes[pageIndex];
        if (prev && prev.width === size.width && prev.height === size.height) return t;
        return { ...t, pageSizes: { ...t.pageSizes, [pageIndex]: size } };
      });
    },

    commit(tabId, op, label, nextEntitySeq) {
      if (isEmptyOp(op)) return;
      patchTab(tabId, (t) => {
        let doc = applyOp(t.doc, op);
        if (nextEntitySeq !== undefined && nextEntitySeq > doc.counters.nextEntitySeq) {
          doc = { ...doc, counters: { ...doc.counters, nextEntitySeq } };
        }
        if (t.pendingGroup) {
          return { ...t, doc, dirty: true, redo: [], pendingGroup: { ...t.pendingGroup, ops: [...t.pendingGroup.ops, op] } };
        }
        const undo = [...t.undo, { label, op }].slice(-HISTORY_LIMIT);
        return { ...t, doc, dirty: true, undo, redo: [] };
      });
    },

    beginGroup(tabId, label) {
      patchTab(tabId, (t) => ({ ...t, pendingGroup: { label, ops: [] } }));
    },

    endGroup(tabId) {
      patchTab(tabId, (t) => {
        const g = t.pendingGroup;
        if (!g) return t;
        if (g.ops.length === 0) return { ...t, pendingGroup: null };
        const op: Op = g.ops.length === 1 ? g.ops[0]! : { type: "batch", ops: g.ops };
        return { ...t, pendingGroup: null, undo: [...t.undo, { label: g.label, op }].slice(-HISTORY_LIMIT) };
      });
    },

    undo(tabId) {
      const t = findTab(tabId);
      const entry = t?.undo[t.undo.length - 1];
      if (!t || !entry || t.pendingGroup) return null;
      try {
        const doc = applyOp(t.doc, invertOp(entry.op));
        patchTab(tabId, (x) => ({ ...x, doc, dirty: true, undo: x.undo.slice(0, -1), redo: [...x.redo, entry] }));
        return entry.label;
      } catch (err) {
        log(`Undo failed (history out of sync): ${errorMessage(err)}`, "error");
        patchTab(tabId, (x) => ({ ...x, undo: [], redo: [] }));
        return null;
      }
    },

    redo(tabId) {
      const t = findTab(tabId);
      const entry = t?.redo[t.redo.length - 1];
      if (!t || !entry || t.pendingGroup) return null;
      try {
        const doc = applyOp(t.doc, entry.op);
        patchTab(tabId, (x) => ({ ...x, doc, dirty: true, redo: x.redo.slice(0, -1), undo: [...x.undo, entry] }));
        return entry.label;
      } catch (err) {
        log(`Redo failed (history out of sync): ${errorMessage(err)}`, "error");
        patchTab(tabId, (x) => ({ ...x, undo: [], redo: [] }));
        return null;
      }
    },

    // Layer visibility/lock and display units are view settings: saved in the sidecar,
    // but deliberately outside undo history (as in AutoCAD/Revu).
    updateLayer(tabId, layerId, patch) {
      patchTab(tabId, (t) => ({
        ...t,
        dirty: true,
        doc: { ...t.doc, layers: t.doc.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)) },
      }));
    },

    setActiveLayer(tabId, layerId) {
      patchTab(tabId, (t) =>
        t.doc.layers.some((l) => l.id === layerId) ? { ...t, dirty: true, doc: { ...t.doc, activeLayerId: layerId } } : t,
      );
    },

    setDisplayUnit(tabId, unit) {
      patchTab(tabId, (t) => ({ ...t, dirty: true, doc: { ...t.doc, displayUnit: unit } }));
    },

    async save(tabId) {
      const tab = findTab(tabId);
      if (!tab) return false;
      try {
        const info = await ipc.statPdf(tab.pdfPath);
        const doc: BpxDocument = {
          ...tab.doc,
          pdf: {
            fileName: info.fileName,
            byteLength: info.byteLength,
            modifiedMs: info.modifiedMs,
            pageCount: tab.pageCount,
          },
        };
        const result = await ipc.saveBpx(tab.pdfPath, doc);
        // Only clear `dirty` if nothing changed while the save was in flight.
        patchTab(tabId, (t) => ({
          ...t,
          doc: t.doc === tab.doc ? doc : { ...t.doc, pdf: doc.pdf },
          dirty: t.doc === tab.doc ? false : t.dirty,
          lastSavedAt: Date.now(),
        }));
        log(`Saved ${result.path} (${(result.bytesWritten / 1024).toFixed(1)} KB)`, "result");
        return true;
      } catch (err) {
        log(`Save failed: ${errorMessage(err)}`, "error");
        return false;
      }
    },
  };
});

export const selectActiveTab = (s: WorkspaceState): Tab | null =>
  s.tabs.find((t) => t.id === s.activeTabId) ?? null;
