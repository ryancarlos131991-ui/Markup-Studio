import assert from "node:assert/strict";
import { test } from "node:test";
import {
  frameFor,
  parseCoordinate,
  pointAtRealDistance,
  realAngle,
  realDistance,
  realToWorld,
  resolveCoordinate,
  worldToReal,
} from "./coords";
import { createEmptyDocument } from "./defaults";
import { applyAffine, compose, fitRect, invert, zoomAt } from "./geometry";
import { appendOp, applyOp, deleteOp, invertOp } from "./history";
import { buildCloudArcs } from "./revcloud";
import type { Entity } from "./schema";
import { MM_PER_PT, formatFeetInches, parseLength, parseScaleRatio } from "./units";
import { validateBpx, validateToolChests } from "./validate";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test("parseLength handles metric, imperial and bare numbers", () => {
  close(parseLength("1000", "mm")!, 1000);
  close(parseLength("1.2m", "mm")!, 1200);
  close(parseLength("45 cm", "mm")!, 450);
  close(parseLength("10'-6\"", "mm")!, 126 * 25.4);
  close(parseLength("10'6", "mm")!, 126 * 25.4);
  close(parseLength("10'-6 1/2\"", "mm")!, 126.5 * 25.4);
  close(parseLength("10'-6-1/2\"", "mm")!, 126.5 * 25.4);
  close(parseLength("-3'-2\"", "mm")!, -38 * 25.4);
  close(parseLength("1/2\"", "mm")!, 12.7);
  close(parseLength("18", "ft-in")!, 18 * 25.4);
  close(parseLength("12ft", "mm")!, 12 * 304.8);
  assert.equal(parseLength("abc", "mm"), null);
  assert.equal(parseLength("10'-x", "mm"), null);
  assert.equal(parseLength("", "mm"), null);
});

test("formatFeetInches rounds to 1/16 and reduces fractions", () => {
  assert.equal(formatFeetInches(126 * 25.4), "10'-6\"");
  assert.equal(formatFeetInches(126.5 * 25.4), "10'-6 1/2\"");
  assert.equal(formatFeetInches(0.25 * 25.4), "0'-0 1/4\"");
  assert.equal(formatFeetInches(-38 * 25.4), "-3'-2\"");
});

test("parseScaleRatio understands ratios and architectural scales", () => {
  assert.equal(parseScaleRatio("1:50"), 50);
  assert.equal(parseScaleRatio("1 : 100"), 100);
  assert.equal(parseScaleRatio("2:1"), 0.5);
  close(parseScaleRatio("1/4\"=1'-0\"")!, 48);
  close(parseScaleRatio("10mm=1m")!, 100);
  assert.equal(parseScaleRatio("nope"), null);
});

test("world↔real round trip with independent X/Y scale", () => {
  const f = { heightPt: 800, sx: 2, sy: 3 };
  const p = { x: 100, y: 300 };
  const r = worldToReal(p, f);
  assert.deepEqual(r, { x: 200, y: 1500 });
  const back = realToWorld(r, f);
  close(back.x, p.x);
  close(back.y, p.y);
});

test("coordinate entry: absolute, relative cartesian and polar (Y up, CCW angles)", () => {
  const f = frameFor(1000, { mmPerPtX: 10, mmPerPtY: 10, source: { kind: "ratio", ratio: 1, text: "" } });
  const last = { x: 100, y: 500 };
  const rel = resolveCoordinate(parseCoordinate("@1000,0", "mm")!, last, f)!;
  close(rel.x, 200);
  close(rel.y, 500);
  const up = resolveCoordinate(parseCoordinate("@0,1000", "mm")!, last, f)!;
  close(up.y, 400); // +Y real is up → smaller world y
  const polar = resolveCoordinate(parseCoordinate("@500<45", "mm")!, last, f)!;
  close(realDistance(last, polar, f), 500);
  close(realAngle(last, polar, f), 45);
  const abs = resolveCoordinate(parseCoordinate("0,0", "mm")!, null, f)!;
  assert.deepEqual(abs, { x: 0, y: 1000 }); // bottom-left of page
  assert.equal(resolveCoordinate(parseCoordinate("@1,1", "mm")!, null, f), null);
  assert.equal(parseCoordinate("1,2,3", "mm"), null);
  const ft = parseCoordinate("@10'-6\"<90", "mm");
  assert.equal(ft?.kind, "relative-polar");
});

test("direct distance entry respects anisotropic scale", () => {
  const f = { heightPt: 1000, sx: 1, sy: 2 };
  const p = pointAtRealDistance({ x: 0, y: 0 }, { x: 3, y: 4 }, 100, f)!;
  close(realDistance({ x: 0, y: 0 }, p, f), 100);
});

test("view matrix: invert, zoom-to-cursor keeps anchor fixed, fitRect centres", () => {
  const v = { a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 };
  const id = compose(v, invert(v));
  close(id.a, 1);
  close(id.e, 0);
  const cursor = { x: 300, y: 200 };
  const worldUnder = applyAffine(invert(v), cursor);
  const z = zoomAt(v, cursor, 1.7);
  const after = applyAffine(z, worldUnder);
  close(after.x, cursor.x);
  close(after.y, cursor.y);
  const fit = fitRect({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 1000, 1000, 0);
  const c = applyAffine(fit, { x: 50, y: 25 });
  close(c.x, 500);
  close(c.y, 500);
});

test("revision cloud arcs bulge outward for both windings", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  for (const pts of [square, [...square].reverse()]) {
    const arcs = buildCloudArcs(pts, 10);
    assert.equal(arcs.length, 40);
    for (const a of arcs) {
      const mid = a.start + a.sweep / 2;
      const mx = a.cx + a.r * Math.cos(mid);
      const my = a.cy + a.r * Math.sin(mid);
      const outside = mx < 0 || mx > 100 || my < 0 || my > 100;
      assert.ok(outside, `arc midpoint (${mx},${my}) should be outside the square`);
    }
  }
});

function line(id: string, seq: number): Entity {
  return {
    id,
    seq,
    type: "line",
    a: { x: 0, y: 0 },
    b: { x: seq, y: 0 },
    pageIndex: 0,
    layerId: "layer-markup",
    subject: "Line",
    label: "",
    status: "none",
    author: "t",
    createdAt: "",
    modifiedAt: "",
    style: { stroke: { color: "#f00", width: 1, opacity: 1, dash: [] }, fill: { color: null, opacity: 0 }, fontSize: 9 },
  };
}

test("history ops are exactly invertible and preserve draw order", () => {
  const d0 = createEmptyDocument({ fileName: "a.pdf", byteLength: 1, modifiedMs: 0, pageCount: 1 });
  const d1 = applyOp(d0, appendOp(d0, [line("a", 1), line("b", 2), line("c", 3), line("d", 4)]));
  const del = deleteOp(d1, ["b", "d"])!;
  const d2 = applyOp(d1, del);
  assert.deepEqual(d2.entities.map((e) => e.id), ["a", "c"]);
  const d3 = applyOp(d2, invertOp(del));
  assert.deepEqual(d3.entities.map((e) => e.id), ["a", "b", "c", "d"]);
  const batch = {
    type: "batch" as const,
    ops: [del, { type: "calibrate" as const, pageIndex: 0, before: null, after: { mmPerPtX: 1, mmPerPtY: 1, source: { kind: "ratio" as const, ratio: 1, text: "1:1" } } }],
  };
  const d4 = applyOp(d1, batch);
  const d5 = applyOp(d4, invertOp(batch));
  assert.deepEqual(d5.entities, d1.entities);
  assert.equal(d5.pages["0"]?.calibration ?? null, null);
});

test("validateBpx keeps good entities, drops bad ones, repairs counters", () => {
  const doc = createEmptyDocument({ fileName: "a.pdf", byteLength: 1, modifiedMs: 0, pageCount: 1 });
  const raw = JSON.parse(
    JSON.stringify({
      ...doc,
      entities: [line("a", 7), { id: "x", type: "hexagon", pageIndex: 0 }, { ...line("a", 8) }],
    }),
  );
  const { value, warnings } = validateBpx(raw);
  assert.equal(value.entities.length, 1);
  assert.equal(value.counters.nextEntitySeq, 8);
  assert.equal(warnings.length, 2);
  assert.throws(() => validateBpx({ format: "bpx", version: 99 }));
});

test("validateToolChests restores built-ins and keeps My Tools", () => {
  const { value } = validateToolChests({
    format: "bpx-toolchest",
    version: 1,
    sets: [{ id: "my-tools", name: "My Tools", kind: "my-tools", presets: [{ id: "p", name: "P", command: "LINE", template: {} }] }],
  });
  assert.deepEqual(value.sets.map((s) => s.id), ["recent", "my-tools", "structural", "architectural"]);
  assert.equal(value.sets[1]!.presets.length, 1);
  assert.ok(value.sets[2]!.presets.length > 0);
});

test("MM_PER_PT sanity", () => close(MM_PER_PT * 72, 25.4));
