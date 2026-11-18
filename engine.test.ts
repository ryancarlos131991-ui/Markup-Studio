import assert from "node:assert/strict";
import { test } from "node:test";
import { frameFor, realDistance } from "../core/coords";
import { createEmptyDocument } from "../core/defaults";
import { appendOp, applyOp, deleteOp, invertOp, type Op } from "../core/history";
import type { BpxDocument, Calibration, Entity } from "../core/schema";
import type { DisplayUnit } from "../core/units";
import { createRegistry } from "./commands";
import { CommandEngine } from "./engine";
import type { EngineHost, EntityGeometry } from "./types";

/** Minimal in-memory host mirroring the real one's grouping semantics. */
class FakeHost implements EngineHost {
  doc: BpxDocument = createEmptyDocument({ fileName: "t.pdf", byteLength: 1, modifiedMs: 0, pageCount: 1 });
  undoStack: { label: string; op: Op }[] = [];
  redoStack: { label: string; op: Op }[] = [];
  group: { label: string; ops: Op[] } | null = null;
  extentsCalls = 0;
  seq = 0;

  private commit(op: Op) {
    this.doc = applyOp(this.doc, op);
    if (this.group) this.group.ops.push(op);
    else this.undoStack.push({ label: "op", op });
    this.redoStack = [];
  }
  getPageContext() {
    const cal = this.doc.pages["0"]?.calibration ?? null;
    return { tabId: "t", pageIndex: 0, frame: frameFor(1000, cal), unit: this.doc.displayUnit, calibration: cal };
  }
  addEntities(geometry: EntityGeometry[]) {
    const entities = geometry.map(
      (g) =>
        ({
          ...g,
          id: `e${++this.seq}`,
          seq: this.seq,
          pageIndex: 0,
          layerId: this.doc.activeLayerId,
          subject: "",
          label: "",
          status: "none",
          author: "",
          createdAt: "",
          modifiedAt: "",
          style: { stroke: { color: "#f00", width: 1, opacity: 1, dash: [] }, fill: { color: null, opacity: 0 }, fontSize: 9 },
        }) as Entity,
    );
    this.commit(appendOp(this.doc, entities));
    return { ok: true as const, entities };
  }
  removeEntities(ids: string[]) {
    const op = deleteOp(this.doc, ids);
    if (op) this.commit(op);
  }
  setCalibration(pageIndex: number, calibration: Calibration | null) {
    this.commit({ type: "calibrate", pageIndex, before: this.doc.pages[String(pageIndex)]?.calibration ?? null, after: calibration });
  }
  setDisplayUnit(unit: DisplayUnit) {
    this.doc = { ...this.doc, displayUnit: unit };
  }
  beginGroup(label: string) {
    this.group = { label, ops: [] };
  }
  endGroup() {
    const g = this.group;
    this.group = null;
    if (g && g.ops.length) this.undoStack.push({ label: g.label, op: { type: "batch", ops: g.ops } });
  }
  undo() {
    const e = this.undoStack.pop();
    if (!e) return null;
    this.doc = applyOp(this.doc, invertOp(e.op));
    this.redoStack.push(e);
    return e.label;
  }
  redo() {
    const e = this.redoStack.pop();
    if (!e) return null;
    this.doc = applyOp(this.doc, e.op);
    this.undoStack.push(e);
    return e.label;
  }
  zoomExtents() {
    this.extentsCalls++;
  }
  zoomBy() {}
  pixelsToWorld(px: number) {
    return px;
  }
}

function setup() {
  const host = new FakeHost();
  const engine = new CommandEngine(host, createRegistry());
  const type = (s: string) => {
    for (const ch of s) engine.typeChar(ch);
    engine.submit();
  };
  return { host, engine, type };
}

test("LINE with relative/polar entry, U and C, single undo group", () => {
  const { host, engine, type } = setup();
  type("L");
  assert.equal(engine.getSnapshot().activeCommand, "LINE");
  engine.pick({ x: 100, y: 500 });
  type("@1000,0"); // uncalibrated: 1000 mm on paper
  type("@500<90");
  type("@100,100");
  type("U"); // removes last segment
  assert.equal(host.doc.entities.length, 2);
  type("C"); // closes back to start
  assert.equal(engine.getSnapshot().activeCommand, null);
  assert.equal(host.doc.entities.length, 3);
  const [l1, l2] = host.doc.entities as Extract<Entity, { type: "line" }>[];
  const f = host.getPageContext().frame;
  assert.ok(Math.abs(realDistance(l1!.a, l1!.b, f) - 1000) < 1e-6);
  assert.ok(l2!.b.y < l2!.a.y, "@<90 goes up the page");
  assert.equal(host.undoStack.length, 1, "whole LINE command is one undo step");
  assert.equal(host.undo(), "LINE");
  assert.equal(host.doc.entities.length, 0);
});

test("Enter on empty prompt repeats the last command; Esc cancels", () => {
  const { engine, type } = setup();
  type("DI");
  engine.cancel();
  assert.equal(engine.getSnapshot().activeCommand, null);
  engine.submit(); // empty → repeat
  assert.equal(engine.getSnapshot().activeCommand, "DIST");
});

test("F8 Ortho constrains picks to horizontal/vertical", () => {
  const { host, engine, type } = setup();
  engine.toggleOrtho();
  type("L");
  engine.pick({ x: 0, y: 0 });
  engine.pick({ x: 100, y: 7 });
  engine.pick({ x: 103, y: 80 });
  engine.cancel();
  const [a, b] = host.doc.entities as Extract<Entity, { type: "line" }>[];
  assert.deepEqual(a!.b, { x: 100, y: 0 });
  assert.deepEqual(b!.b, { x: 100, y: 80 });
});

test("direct distance entry follows cursor direction", () => {
  const { host, engine, type } = setup();
  type("UN");
  type("M"); // metres
  type("L");
  engine.pick({ x: 0, y: 500 });
  engine.setCursor({ x: 50, y: 500 });
  type("2"); // 2 m to the right
  engine.cancel();
  const l = host.doc.entities[0] as Extract<Entity, { type: "line" }>;
  const f = host.getPageContext().frame;
  assert.ok(Math.abs(realDistance(l.a, l.b, f) - 2000) < 1e-6);
});

test("CAL by ratio and by picked distance; DI then reports real length", () => {
  const { host, engine, type } = setup();
  type("CAL");
  type("R");
  type("1:50");
  assert.ok(Math.abs(host.doc.pages["0"]!.calibration!.mmPerPtX - (25.4 / 72) * 50) < 1e-9);

  type("CAL");
  engine.pick({ x: 0, y: 0 });
  engine.pick({ x: 200, y: 0 });
  type("10m");
  assert.equal(host.doc.pages["0"]!.calibration!.mmPerPtX, 50);

  type("DI");
  engine.pick({ x: 0, y: 100 });
  engine.pick({ x: 30, y: 140 }); // 50 pt → 2500 mm
  const last = engine.getSnapshot().log.find((l) => l.text.startsWith("Distance ="));
  assert.ok(last?.text.includes("2500 mm"), String(last?.text));
  assert.equal(host.doc.entities.at(-1)?.type, "measure-length");
});

test("CAL X axis only keeps Y scale", () => {
  const { host, engine, type } = setup();
  type("CAL");
  type("X");
  engine.pick({ x: 0, y: 0 });
  engine.pick({ x: 100, y: 999 });
  type("1000mm");
  const cal = host.doc.pages["0"]!.calibration!;
  assert.equal(cal.mmPerPtX, 10);
  assert.ok(Math.abs(cal.mmPerPtY - 25.4 / 72) < 1e-12);
});

test("REVCLOUD polygonal (Enter to close) and rectangular", () => {
  const { host, engine, type } = setup();
  type("REV");
  engine.pick({ x: 0, y: 0 });
  engine.pick({ x: 100, y: 0 });
  engine.submit(); // only 2 points → nothing
  assert.equal(host.doc.entities.length, 0);

  type("REV");
  engine.pick({ x: 0, y: 0 });
  engine.pick({ x: 100, y: 0 });
  engine.pick({ x: 100, y: 100 });
  engine.pick({ x: 1, y: 1 }); // near first point (tolerance 8) → closes
  assert.equal(host.doc.entities.length, 1);

  type("REV");
  type("R");
  engine.pick({ x: 0, y: 0 });
  engine.pick({ x: 50, y: 40 });
  const cloud = host.doc.entities[1] as Extract<Entity, { type: "revcloud" }>;
  assert.equal(cloud.points.length, 4);

  type("REV");
  type("A");
  type("6mm");
  type("R");
  engine.pick({ x: 0, y: 0 });
  engine.pick({ x: 50, y: 40 });
  const c2 = host.doc.entities[2] as Extract<Entity, { type: "revcloud" }>;
  assert.ok(Math.abs(c2.arcLength - 6 / (25.4 / 72)) < 1e-9);
});

test("Z then E zooms extents; Z then Enter defaults to Extents", () => {
  const { host, type, engine } = setup();
  type("Z");
  type("E");
  type("Z");
  engine.submit();
  assert.equal(host.extentsCalls, 2);
});

test("invalid input re-prompts without leaving the command", () => {
  const { engine, type } = setup();
  type("L");
  type("banana");
  assert.equal(engine.getSnapshot().activeCommand, "LINE");
  assert.equal(engine.getSnapshot().log.at(-1)?.kind, "error");
});
