/**
 * WORLD ↔ REAL conversion and AutoCAD-style coordinate entry.
 *
 * REAL space: millimetres, origin at the page's bottom-left corner, +Y up, angles
 * measured counter-clockwise from +X (exactly like AutoCAD's WCS). WORLD space is the
 * PDF page in points with +Y down, so Y is flipped on the way through.
 */

import { type Vec2, distance, normalizeDegrees, toDegrees, toRadians } from "./geometry";
import type { Calibration } from "./schema";
import { type DisplayUnit, MM_PER_PT, parseLength } from "./units";

export interface PageFrame {
  /** Page height in points (needed for the Y flip). */
  heightPt: number;
  /** Real mm per point along X / Y. */
  sx: number;
  sy: number;
}

export function frameFor(heightPt: number, calibration: Calibration | null): PageFrame {
  return {
    heightPt,
    sx: calibration?.mmPerPtX ?? MM_PER_PT,
    sy: calibration?.mmPerPtY ?? MM_PER_PT,
  };
}

export const worldToReal = (p: Vec2, f: PageFrame): Vec2 => ({ x: p.x * f.sx, y: (f.heightPt - p.y) * f.sy });
export const realToWorld = (r: Vec2, f: PageFrame): Vec2 => ({ x: r.x / f.sx, y: f.heightPt - r.y / f.sy });
export const realDeltaToWorld = (d: Vec2, f: PageFrame): Vec2 => ({ x: d.x / f.sx, y: -d.y / f.sy });
export const worldDeltaToReal = (d: Vec2, f: PageFrame): Vec2 => ({ x: d.x * f.sx, y: -d.y * f.sy });

export function realDistance(a: Vec2, b: Vec2, f: PageFrame): number {
  return Math.hypot((b.x - a.x) * f.sx, (b.y - a.y) * f.sy);
}

/** Real-world angle of a→b in degrees, CCW from +X, in [0, 360). */
export function realAngle(a: Vec2, b: Vec2, f: PageFrame): number {
  const d = worldDeltaToReal({ x: b.x - a.x, y: b.y - a.y }, f);
  return normalizeDegrees(toDegrees(Math.atan2(d.y, d.x)));
}

/**
 * Returns the world point at real distance `realMm` from `base` in the direction of
 * `toward` (AutoCAD "direct distance entry"). Null if the direction is undefined.
 */
export function pointAtRealDistance(base: Vec2, toward: Vec2, realMm: number, f: PageFrame): Vec2 | null {
  const dx = toward.x - base.x;
  const dy = toward.y - base.y;
  const worldLen = Math.hypot(dx, dy);
  if (worldLen === 0) return null;
  const ux = dx / worldLen;
  const uy = dy / worldLen;
  const realPerWorld = Math.hypot(ux * f.sx, uy * f.sy);
  const k = realMm / realPerWorld;
  return { x: base.x + ux * k, y: base.y + uy * k };
}

// ---------------------------------------------------------------------------
// Coordinate entry parsing
// ---------------------------------------------------------------------------

export type CoordinateInput =
  | { kind: "absolute-cartesian"; x: number; y: number }
  | { kind: "relative-cartesian"; dx: number; dy: number }
  | { kind: "absolute-polar"; distance: number; angleDeg: number }
  | { kind: "relative-polar"; distance: number; angleDeg: number };

function parseAngle(raw: string): number | null {
  const s = raw.trim().replace(/(?:°|d|deg)$/i, "");
  if (!/^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) return null;
  return parseFloat(s);
}

/**
 * Parses `x,y`, `@dx,dy`, `d<a`, `@d<a` (and bare `@` = last point). Lengths accept any
 * unit `parseLength` understands, e.g. `@10'-6",0` or `@1.2m<45`.
 */
export function parseCoordinate(raw: string, unit: DisplayUnit): CoordinateInput | null {
  let s = raw.trim();
  if (s === "") return null;
  let relative = false;
  if (s.startsWith("@")) {
    relative = true;
    s = s.slice(1).trim();
    if (s === "") return { kind: "relative-cartesian", dx: 0, dy: 0 };
  }

  const lt = s.indexOf("<");
  if (lt >= 0) {
    const dist = parseLength(s.slice(0, lt), unit);
    const ang = parseAngle(s.slice(lt + 1));
    if (dist === null || ang === null) return null;
    return relative
      ? { kind: "relative-polar", distance: dist, angleDeg: ang }
      : { kind: "absolute-polar", distance: dist, angleDeg: ang };
  }

  const comma = s.indexOf(",");
  if (comma >= 0) {
    if (s.indexOf(",", comma + 1) >= 0) return null; // no Z in 2D
    const x = parseLength(s.slice(0, comma), unit);
    const y = parseLength(s.slice(comma + 1), unit);
    if (x === null || y === null) return null;
    return relative ? { kind: "relative-cartesian", dx: x, dy: y } : { kind: "absolute-cartesian", x, y };
  }
  return null;
}

/** Converts parsed coordinate input to a WORLD point. Relative input needs `lastPoint`. */
export function resolveCoordinate(input: CoordinateInput, lastPoint: Vec2 | null, f: PageFrame): Vec2 | null {
  switch (input.kind) {
    case "absolute-cartesian":
      return realToWorld({ x: input.x, y: input.y }, f);
    case "absolute-polar": {
      const r = toRadians(input.angleDeg);
      return realToWorld({ x: input.distance * Math.cos(r), y: input.distance * Math.sin(r) }, f);
    }
    case "relative-cartesian": {
      if (!lastPoint) return null;
      const d = realDeltaToWorld({ x: input.dx, y: input.dy }, f);
      return { x: lastPoint.x + d.x, y: lastPoint.y + d.y };
    }
    case "relative-polar": {
      if (!lastPoint) return null;
      const r = toRadians(input.angleDeg);
      const d = realDeltaToWorld({ x: input.distance * Math.cos(r), y: input.distance * Math.sin(r) }, f);
      return { x: lastPoint.x + d.x, y: lastPoint.y + d.y };
    }
  }
}

/** Human description of a calibration, e.g. "1:50" or "X 1:48 / Y 1:50". */
export function describeCalibration(cal: Calibration | null): string {
  if (!cal) return "Uncalibrated (1:1 paper)";
  const rx = cal.mmPerPtX / MM_PER_PT;
  const ry = cal.mmPerPtY / MM_PER_PT;
  const fmt = (r: number) => (r >= 1 ? `1:${trimNum(r)}` : `${trimNum(1 / r)}:1`);
  if (cal.source.kind === "ratio" && Math.abs(rx - ry) < 1e-9) return `${cal.source.text} (${fmt(rx)})`;
  if (Math.abs(rx - ry) / Math.max(rx, ry) < 1e-6) return fmt(rx);
  return `X ${fmt(rx)} / Y ${fmt(ry)}`;
}

function trimNum(n: number): string {
  return Number.isInteger(Math.round(n * 100) / 100) ? `${Math.round(n)}` : n.toFixed(2);
}

/** Distance of a picked segment in points, used by calibration. */
export const pickedLength = (a: Vec2, b: Vec2, axis: "both" | "x" | "y"): number =>
  axis === "x" ? Math.abs(b.x - a.x) : axis === "y" ? Math.abs(b.y - a.y) : distance(a, b);
