/**
 * Revision cloud geometry: the boundary polygon is resampled into equal chords and each
 * chord becomes a circular arc bulging outward (away from the polygon interior).
 */

import { type Rect, type Vec2, boundsOf, inflateRect, signedArea } from "./geometry";

export interface CloudArc {
  cx: number;
  cy: number;
  r: number;
  /** Start angle (radians, WORLD space, +Y down like canvas). */
  start: number;
  /** Signed sweep in radians; |sweep| = INCLUDED_ANGLE. */
  sweep: number;
}

/** Included angle of each scallop. 120° gives the classic "bumpy" revision-cloud look. */
const INCLUDED_ANGLE = (120 * Math.PI) / 180;

export const DEFAULT_ARC_LENGTH_PT = 12;

/** Subdivides the closed polygon into chords no longer than ~arcLength. */
function resample(points: readonly Vec2[], arcLength: number): Vec2[] {
  const out: Vec2[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const steps = Math.max(1, Math.round(len / arcLength));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

export function buildCloudArcs(points: readonly Vec2[], arcLength: number): CloudArc[] {
  if (points.length < 2 || !(arcLength > 0)) return [];
  const verts = resample(points, arcLength);
  if (verts.length < 2) return [];
  // Outward normal of edge (dx,dy) is (dy,-dx) when signed area > 0, else (-dy,dx).
  const orientation = signedArea(points) >= 0 ? 1 : -1;
  const half = INCLUDED_ANGLE / 2;
  const arcs: CloudArc[] = [];
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i]!;
    const q = verts[(i + 1) % verts.length]!;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const chord = Math.hypot(dx, dy);
    if (chord === 0) continue;
    const nx = (orientation * dy) / chord;
    const ny = (orientation * -dx) / chord;
    const r = chord / (2 * Math.sin(half));
    const h = r * Math.cos(half);
    // Center sits inward of the chord so the minor arc bulges outward.
    const cx = (p.x + q.x) / 2 - nx * h;
    const cy = (p.y + q.y) / 2 - ny * h;
    const start = Math.atan2(p.y - cy, p.x - cx);
    const end = Math.atan2(q.y - cy, q.x - cx);
    let sweep = end - start;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep <= -Math.PI) sweep += 2 * Math.PI;
    arcs.push({ cx, cy, r, start, sweep });
  }
  return arcs;
}

/** Traces arcs into a canvas path (works for CanvasRenderingContext2D and Path2D). */
export function traceCloud(
  ctx: { moveTo(x: number, y: number): void; arc(x: number, y: number, r: number, s: number, e: number, ccw?: boolean): void; closePath(): void },
  arcs: readonly CloudArc[],
): void {
  if (arcs.length === 0) return;
  const first = arcs[0]!;
  ctx.moveTo(first.cx + first.r * Math.cos(first.start), first.cy + first.r * Math.sin(first.start));
  for (const a of arcs) ctx.arc(a.cx, a.cy, a.r, a.start, a.start + a.sweep, a.sweep < 0);
  ctx.closePath();
}

/** Samples the cloud outline into a polyline (for hit-testing and vector PDF export). */
export function sampleCloud(arcs: readonly CloudArc[], segmentsPerArc = 8): Vec2[] {
  const out: Vec2[] = [];
  for (const a of arcs) {
    for (let k = 0; k < segmentsPerArc; k++) {
      const t = a.start + (a.sweep * k) / segmentsPerArc;
      out.push({ x: a.cx + a.r * Math.cos(t), y: a.cy + a.r * Math.sin(t) });
    }
  }
  return out;
}

/** Conservative bounds: polygon bounds grown by the maximum scallop bulge. */
export function cloudBounds(points: readonly Vec2[], arcLength: number): Rect {
  // `resample` rounds the chord count, so a chord can be up to 1.5 × arcLength.
  const r = (1.5 * arcLength) / (2 * Math.sin(INCLUDED_ANGLE / 2));
  const bulge = r - r * Math.cos(INCLUDED_ANGLE / 2);
  return inflateRect(boundsOf(points), bulge);
}
