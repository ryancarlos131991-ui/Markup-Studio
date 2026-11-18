/**
 * Phase 1 command set: LINE (L), REVCLOUD (REV), DIST (DI), CALIBRATE (CAL), ZOOM (Z),
 * UNITS (UN), UNDO (U), REDO. Each command is a generator; see `engine.ts`.
 */

import { describeCalibration, pickedLength, realAngle, realDistance } from "../core/coords";
import { type Vec2, distance } from "../core/geometry";
import { DEFAULT_ARC_LENGTH_PT } from "../core/revcloud";
import type { Calibration } from "../core/schema";
import { DISPLAY_UNITS, type DisplayUnit, MM_PER_PT, formatLength, parseLength, parseScaleRatio, unitLabel } from "../core/units";
import { CommandRegistry } from "./engine";
import type { CommandContext, CommandDef, CommandGen, Input, Keyword, Preview } from "./types";

const KW_UNDO: Keyword = { key: "U", label: "Undo" };
const KW_CLOSE: Keyword = { key: "C", label: "Close" };

/** Dynamic-input style readout: "3'-4" < 45.0°". */
function lengthAngleLabel(ctx: CommandContext, a: Vec2, b: Vec2): string {
  const pc = ctx.page();
  return `${formatLength(realDistance(a, b, pc.frame), pc.unit)} < ${realAngle(a, b, pc.frame).toFixed(1)}°`;
}

// ---------------------------------------------------------------------------
// LINE
// ---------------------------------------------------------------------------

function* lineCommand(ctx: CommandContext): CommandGen {
  const first: Input = yield { kind: "point", prompt: "Specify first point" };
  if (first.type !== "point") return;
  const vertices: Vec2[] = [first.p];
  const segments: string[] = [];

  for (;;) {
    const last = vertices[vertices.length - 1]!;
    const keywords: Keyword[] = [];
    if (segments.length >= 2) keywords.push(KW_CLOSE);
    if (segments.length >= 1) keywords.push(KW_UNDO);
    const input: Input = yield {
      kind: "point",
      prompt: "Specify next point",
      base: last,
      keywords,
      allowNone: true,
      preview: (c): Preview[] => [
        { kind: "line", a: last, b: c },
        { kind: "label", at: c, text: lengthAngleLabel(ctx, last, c) },
      ],
    };

    if (input.type === "none") return;
    if (input.type === "keyword" && input.key === KW_UNDO.key) {
      const id = segments.pop();
      if (id) ctx.remove([id]);
      vertices.pop();
      ctx.setLastPoint(vertices[vertices.length - 1] ?? null);
      continue;
    }
    if (input.type === "keyword" && input.key === KW_CLOSE.key) {
      const start = vertices[0]!;
      if (distance(last, start) > 0) ctx.add([{ type: "line", a: last, b: start }]);
      ctx.setLastPoint(start);
      return;
    }
    if (input.type !== "point") continue;
    if (distance(last, input.p) === 0) {
      ctx.print("Zero-length segment ignored.", "error");
      continue;
    }
    const created = ctx.add([{ type: "line", a: last, b: input.p }]);
    if (!created) return;
    segments.push(created[0]!.id);
    vertices.push(input.p);
  }
}

// ---------------------------------------------------------------------------
// REVCLOUD
// ---------------------------------------------------------------------------

const KW_RECT: Keyword = { key: "R", label: "Rectangular" };
const KW_POLY: Keyword = { key: "P", label: "Polygonal" };
const KW_ARC: Keyword = { key: "A", label: "Arc length" };

function* revcloudCommand(ctx: CommandContext): CommandGen {
  let arcLength = ctx.template?.arcLength ?? DEFAULT_ARC_LENGTH_PT;
  let mode: "polygonal" | "rectangular" = "polygonal";
  const color = ctx.template?.style?.stroke?.color;

  // Leading options loop.
  let firstPoint: Vec2 | null = null;
  while (!firstPoint) {
    const arcMm = (arcLength * MM_PER_PT).toFixed(1);
    const input: Input = yield {
      kind: "point",
      prompt: `Arc length ${arcMm} mm (paper), mode ${mode}. Specify first ${mode === "rectangular" ? "corner" : "point"}`,
      keywords: [mode === "polygonal" ? KW_RECT : KW_POLY, KW_ARC],
    };
    if (input.type === "point") firstPoint = input.p;
    else if (input.type === "keyword" && input.key === KW_RECT.key) mode = "rectangular";
    else if (input.type === "keyword" && input.key === KW_POLY.key) mode = "polygonal";
    else if (input.type === "keyword" && input.key === KW_ARC.key) {
      for (;;) {
        const v: Input = yield {
          kind: "value",
          prompt: "Specify arc length on paper",
          defaultValue: `${arcMm}mm`,
        };
        if (v.type !== "value") break;
        // Arc length is a paper-space size (like text height), so it ignores calibration.
        const mm = parseLength(v.text, "mm");
        if (mm !== null && mm > 0) {
          arcLength = mm / MM_PER_PT;
          break;
        }
        ctx.print("Arc length must be a positive length, e.g. 4mm or 3/16\".", "error");
      }
    }
  }

  if (mode === "rectangular") {
    const start = firstPoint;
    const corner: Input = yield {
      kind: "point",
      prompt: "Specify opposite corner",
      base: start,
      preview: (c) => [{ kind: "cloud", points: rectCorners(start, c), arcLength, color }],
    };
    if (corner.type !== "point") return;
    const pts = rectCorners(start, corner.p);
    if (Math.abs(corner.p.x - start.x) === 0 || Math.abs(corner.p.y - start.y) === 0) {
      ctx.print("Revision cloud rectangle has zero area.", "error");
      return;
    }
    if (ctx.add([{ type: "revcloud", points: pts, arcLength }])) ctx.print("Revision cloud created.");
    return;
  }

  const pts: Vec2[] = [firstPoint];
  for (;;) {
    const last = pts[pts.length - 1]!;
    const input: Input = yield {
      kind: "point",
      prompt: pts.length >= 3 ? "Specify next point or press Enter to close" : "Specify next point",
      base: last,
      keywords: pts.length > 1 ? [KW_UNDO] : [],
      allowNone: true,
      preview: (c): Preview[] =>
        pts.length >= 2
          ? [{ kind: "cloud", points: [...pts, c], arcLength, color }]
          : [{ kind: "line", a: last, b: c, dashed: true }],
    };
    if (input.type === "none") {
      if (pts.length < 3) {
        ctx.print("A revision cloud needs at least 3 points; nothing created.", "error");
        return;
      }
      if (ctx.add([{ type: "revcloud", points: pts, arcLength }])) ctx.print("Revision cloud created.");
      return;
    }
    if (input.type === "keyword" && input.key === KW_UNDO.key) {
      pts.pop();
      ctx.setLastPoint(pts[pts.length - 1] ?? null);
      continue;
    }
    if (input.type !== "point") continue;
    // Clicking back on the first point closes the cloud.
    if (pts.length >= 3 && distance(input.p, pts[0]!) <= ctx.host.pixelsToWorld(8)) {
      if (ctx.add([{ type: "revcloud", points: pts, arcLength }])) ctx.print("Revision cloud created.");
      return;
    }
    if (distance(input.p, last) === 0) continue;
    pts.push(input.p);
  }
}

function rectCorners(a: Vec2, b: Vec2): Vec2[] {
  return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
}

// ---------------------------------------------------------------------------
// DIST
// ---------------------------------------------------------------------------

function* distCommand(ctx: CommandContext): CommandGen {
  const p1: Input = yield { kind: "point", prompt: "Specify first point" };
  if (p1.type !== "point") return;
  const a = p1.p;
  const p2: Input = yield {
    kind: "point",
    prompt: "Specify second point",
    base: a,
    preview: (c) => [
      { kind: "line", a, b: c, dashed: true },
      { kind: "marker", at: a },
      { kind: "label", at: c, text: lengthAngleLabel(ctx, a, c) },
    ],
  };
  if (p2.type !== "point") return;
  const b = p2.p;
  const pc = ctx.page();
  const d = realDistance(a, b, pc.frame);
  const dx = (b.x - a.x) * pc.frame.sx;
  const dy = -(b.y - a.y) * pc.frame.sy;
  ctx.print(
    `Distance = ${formatLength(d, pc.unit)},  Angle in XY Plane = ${realAngle(a, b, pc.frame).toFixed(2)}°,  ` +
      `Delta X = ${formatLength(dx, pc.unit)},  Delta Y = ${formatLength(dy, pc.unit)}`,
  );
  if (!pc.calibration) ctx.print("Page is uncalibrated (1:1 paper). Run CAL to set the drawing scale.", "info");
  if (d > 0) ctx.add([{ type: "measure-length", a, b }]);
}

// ---------------------------------------------------------------------------
// CALIBRATE
// ---------------------------------------------------------------------------

const KW_RATIO: Keyword = { key: "R", label: "Ratio" };
const KW_X: Keyword = { key: "X", label: "Xaxis" };
const KW_Y: Keyword = { key: "Y", label: "Yaxis" };
const KW_RESET: Keyword = { key: "CLEAR", label: "Clear" };

function* calibrateCommand(ctx: CommandContext): CommandGen {
  const pc = ctx.page();
  ctx.print(`Current scale: ${describeCalibration(pc.calibration)}`, "info");
  let axis: "both" | "x" | "y" = "both";
  let first: Vec2 | null = null;

  while (!first) {
    const input: Input = yield {
      kind: "point",
      prompt: axis === "both" ? "Pick first point of a known distance" : `Pick first point (${axis.toUpperCase()} axis only)`,
      keywords: [KW_RATIO, KW_X, KW_Y, KW_RESET],
    };
    if (input.type === "point") {
      first = input.p;
    } else if (input.type === "keyword") {
      if (input.key === KW_X.key) axis = "x";
      else if (input.key === KW_Y.key) axis = "y";
      else if (input.key === KW_RESET.key) {
        ctx.host.setCalibration(pc.pageIndex, null);
        ctx.print(`Page ${pc.pageIndex + 1} calibration cleared.`);
        return;
      } else if (input.key === KW_RATIO.key) {
        for (;;) {
          const v: Input = yield { kind: "value", prompt: 'Enter drawing scale (1:50, 1/4"=1\'-0")' };
          if (v.type !== "value") return;
          const ratio = parseScaleRatio(v.text);
          if (ratio === null) {
            ctx.print('Not a scale. Try 1:100, 1:50, 1/8"=1\'-0" or 10mm=1m.', "error");
            continue;
          }
          const cal: Calibration = {
            mmPerPtX: MM_PER_PT * ratio,
            mmPerPtY: MM_PER_PT * ratio,
            source: { kind: "ratio", text: v.text.trim(), ratio },
          };
          ctx.host.setCalibration(pc.pageIndex, cal);
          ctx.print(`Page ${pc.pageIndex + 1} calibrated: ${describeCalibration(cal)}`);
          return;
        }
      }
    }
  }

  const a = first;
  const second: Input = yield {
    kind: "point",
    prompt: "Pick second point",
    base: a,
    preview: (c) => [
      { kind: "line", a, b: axis === "x" ? { x: c.x, y: a.y } : axis === "y" ? { x: a.x, y: c.y } : c, dashed: true },
      { kind: "marker", at: a },
    ],
  };
  if (second.type !== "point") return;
  const b = second.p;
  const picked = pickedLength(a, b, axis);
  if (picked <= 0) {
    ctx.print("The two points are identical along the chosen axis.", "error");
    return;
  }

  for (;;) {
    const v: Input = yield {
      kind: "value",
      prompt: `Enter real-world length (${unitLabel(pc.unit).toLowerCase()} unless a unit is given)`,
    };
    if (v.type !== "value") return;
    const mm = parseLength(v.text, pc.unit);
    if (mm === null || mm <= 0) {
      ctx.print(`"${v.text}" is not a positive length. Examples: 1000, 3.5m, 10'-6", 126in.`, "error");
      continue;
    }
    const mmPerPt = mm / picked;
    const prev = pc.calibration;
    const cal: Calibration = {
      mmPerPtX: axis === "y" ? (prev?.mmPerPtX ?? MM_PER_PT) : mmPerPt,
      mmPerPtY: axis === "x" ? (prev?.mmPerPtY ?? MM_PER_PT) : mmPerPt,
      source: { kind: "measured", axis, realMm: mm, pickedPt: picked },
    };
    ctx.host.setCalibration(pc.pageIndex, cal);
    ctx.print(`Page ${pc.pageIndex + 1} calibrated: ${describeCalibration(cal)}`);
    return;
  }
}

// ---------------------------------------------------------------------------
// ZOOM / UNITS / UNDO / REDO
// ---------------------------------------------------------------------------

const KW_EXTENTS: Keyword = { key: "E", label: "Extents" };
const KW_IN: Keyword = { key: "I", label: "In" };
const KW_OUT: Keyword = { key: "O", label: "Out" };

function* zoomCommand(ctx: CommandContext): CommandGen {
  const input: Input = yield {
    kind: "value",
    prompt: "Specify zoom option or scale factor (nX)",
    keywords: [KW_EXTENTS, KW_IN, KW_OUT],
    defaultKeyword: KW_EXTENTS.key,
  };
  if (input.type === "keyword") {
    if (input.key === KW_EXTENTS.key) ctx.host.zoomExtents();
    else if (input.key === KW_IN.key) ctx.host.zoomBy(2);
    else if (input.key === KW_OUT.key) ctx.host.zoomBy(0.5);
    return;
  }
  if (input.type === "value") {
    const m = /^(\d+(?:\.\d+)?)x$/i.exec(input.text.trim());
    if (m && parseFloat(m[1]!) > 0) ctx.host.zoomBy(parseFloat(m[1]!));
    else ctx.print("Invalid zoom option.", "error");
  }
}

const UNIT_KEYWORDS: Keyword[] = [
  { key: "MM", label: "Millimetres" },
  { key: "CM", label: "Centimetres" },
  { key: "M", label: "Metres" },
  { key: "IN", label: "Inches" },
  { key: "FT", label: "Feet-inches" },
];
const UNIT_BY_KEY: Record<string, DisplayUnit> = { MM: "mm", CM: "cm", M: "m", IN: "in", FT: "ft-in" };

function* unitsCommand(ctx: CommandContext): CommandGen {
  const pc = ctx.page();
  const current = UNIT_KEYWORDS[DISPLAY_UNITS.indexOf(pc.unit)]!;
  const input: Input = yield {
    kind: "value",
    prompt: "Display units",
    keywords: UNIT_KEYWORDS,
    defaultKeyword: current.key,
  };
  if (input.type !== "keyword") {
    if (input.type === "value") ctx.print("Choose MM, CM, M, IN or FT.", "error");
    return;
  }
  const unit = UNIT_BY_KEY[input.key]!;
  ctx.host.setDisplayUnit(unit);
  ctx.print(`Units set to ${unitLabel(unit)}.`);
}

// eslint-disable-next-line require-yield
function* undoCommand(ctx: CommandContext): CommandGen {
  const label = ctx.host.undo();
  ctx.print(label ? `Undo: ${label}` : "Nothing to undo.", label ? "result" : "error");
}

// eslint-disable-next-line require-yield
function* redoCommand(ctx: CommandContext): CommandGen {
  const label = ctx.host.redo();
  ctx.print(label ? `Redo: ${label}` : "Nothing to redo.", label ? "result" : "error");
}

export const COMMANDS: CommandDef[] = [
  { name: "LINE", aliases: ["L"], description: "Draw line segments", needsPage: true, undoable: true, run: lineCommand },
  { name: "REVCLOUD", aliases: ["REV"], description: "Revision cloud", needsPage: true, undoable: true, run: revcloudCommand },
  { name: "DIST", aliases: ["DI"], description: "Measure linear distance", needsPage: true, undoable: true, run: distCommand },
  { name: "CALIBRATE", aliases: ["CAL"], description: "Set page scale", needsPage: true, undoable: true, run: calibrateCommand },
  { name: "ZOOM", aliases: ["Z"], description: "Zoom (E = extents)", needsPage: true, undoable: false, run: zoomCommand },
  { name: "UNITS", aliases: ["UN"], description: "Display units", needsPage: true, undoable: false, run: unitsCommand },
  { name: "UNDO", aliases: ["U"], description: "Undo last step", needsPage: true, undoable: false, run: undoCommand },
  { name: "REDO", aliases: [], description: "Redo", needsPage: true, undoable: false, run: redoCommand },
];

export const createRegistry = (): CommandRegistry => new CommandRegistry(COMMANDS);

