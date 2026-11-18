/** Binds the UI-agnostic CLI engine to the Zustand workspace and the viewport. */

import type { AddResult, EngineHost, EntityGeometry, PageContext } from "../cli/types";
import { frameFor } from "../core/coords";
import { defaultStyle, mergeStyle } from "../core/defaults";
import { appendOp, deleteOp } from "../core/history";
import type { Entity, EntityTemplate } from "../core/schema";
import { selectActiveTab, useWorkspace } from "../store/workspace";
import { viewport } from "../viewport/controller";

const DEFAULT_SUBJECT: Record<EntityGeometry["type"], string> = {
  line: "Line",
  revcloud: "Revision Cloud",
  "measure-length": "Length Measurement",
};

function author(): string {
  try {
    return localStorage.getItem("markupStudio.author") || "User";
  } catch {
    return "User";
  }
}

export function createEngineHost(): EngineHost {
  const ws = () => useWorkspace.getState();
  const activeTab = () => selectActiveTab(ws());

  return {
    getPageContext(): PageContext | null {
      const t = activeTab();
      if (!t) return null;
      const size = t.pageSizes[t.pageIndex];
      if (!size) return null; // page still loading
      const calibration = t.doc.pages[String(t.pageIndex)]?.calibration ?? null;
      return {
        tabId: t.id,
        pageIndex: t.pageIndex,
        frame: frameFor(size.height, calibration),
        unit: t.doc.displayUnit,
        calibration,
      };
    },

    addEntities(geometry: EntityGeometry[], template: EntityTemplate | undefined): AddResult {
      const t = activeTab();
      if (!t) return { ok: false, error: "No document is open." };
      const doc = t.doc;
      const layerId =
        template?.layerId && doc.layers.some((l) => l.id === template.layerId) ? template.layerId : doc.activeLayerId;
      const layer = doc.layers.find((l) => l.id === layerId);
      if (!layer) return { ok: false, error: "Active layer not found." };
      if (layer.locked) return { ok: false, error: `Layer "${layer.name}" is locked. Unlock it in the Layers panel.` };

      const now = new Date().toISOString();
      const style = mergeStyle(defaultStyle(layer.color), template?.style);
      let seq = doc.counters.nextEntitySeq;
      const who = author();
      const entities: Entity[] = geometry.map((g) => ({
        ...g,
        id: crypto.randomUUID(),
        seq: seq++,
        pageIndex: t.pageIndex,
        layerId,
        subject: template?.subject ?? DEFAULT_SUBJECT[g.type],
        label: template?.label ?? "",
        status: "none",
        author: who,
        createdAt: now,
        modifiedAt: now,
        style: structuredClone(style),
      }));
      ws().commit(t.id, appendOp(doc, entities), "Add", seq);
      // Drawing onto a hidden layer would make the new markup vanish; reveal the layer.
      if (!layer.visible) ws().updateLayer(t.id, layer.id, { visible: true });
      return { ok: true, entities };
    },

    removeEntities(ids) {
      const t = activeTab();
      if (!t) return;
      const op = deleteOp(t.doc, ids);
      if (op) ws().commit(t.id, op, "Erase");
    },

    setCalibration(pageIndex, calibration) {
      const t = activeTab();
      if (!t) return;
      const before = t.doc.pages[String(pageIndex)]?.calibration ?? null;
      ws().commit(t.id, { type: "calibrate", pageIndex, before, after: calibration }, "Calibrate");
    },

    setDisplayUnit(unit) {
      const t = activeTab();
      if (t) ws().setDisplayUnit(t.id, unit);
    },

    beginGroup(label) {
      const t = activeTab();
      if (t) ws().beginGroup(t.id, label);
    },

    endGroup() {
      // End on every tab: a group can't be left open if the tab changed mid-command.
      for (const t of ws().tabs) if (t.pendingGroup) ws().endGroup(t.id);
    },

    undo() {
      const t = activeTab();
      return t ? ws().undo(t.id) : null;
    },

    redo() {
      const t = activeTab();
      return t ? ws().redo(t.id) : null;
    },

    zoomExtents: () => viewport.zoomExtents(),
    zoomBy: (factor) => viewport.zoomBy(factor),
    pixelsToWorld: (px) => viewport.pixelsToWorld(px),
  };
}
