/**
 * 2D geometry primitives and affine matrix math.
 *
 * Coordinate spaces used throughout the app:
 *  - WORLD  : PDF page space in points (1/72"), origin top-left of the rendered page,
 *             +Y down. This is what pdf.js renders at scale 1 and what entities store.
 *  - SCREEN : CSS pixels relative to the viewport's top-left corner.
 *  - DEVICE : physical canvas pixels (SCREEN × devicePixelRatio).
 *  - REAL   : calibrated real-world millimetres, origin bottom-left of page, +Y up
 *             (AutoCAD convention). See `coords.ts`.
 */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export const midpoint = (a: Vec2, b: Vec2): Vec2 => lerp(a, b, 0.5);
export const normalize = (a: Vec2): Vec2 => {
  const l = length(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};
export const equals = (a: Vec2, b: Vec2, eps = 1e-9): boolean =>
  Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

/** Constrains `p` to the horizontal or vertical through `base` (AutoCAD F8 Ortho). */
export function orthoConstrain(base: Vec2, p: Vec2): Vec2 {
  const dx = p.x - base.x;
  const dy = p.y - base.y;
  return Math.abs(dx) >= Math.abs(dy) ? { x: p.x, y: base.y } : { x: base.x, y: p.y };
}

/** Signed polygon area via the shoelace formula (sign depends on winding). */
export function signedArea(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

// ---------------------------------------------------------------------------
// Rectangles
// ---------------------------------------------------------------------------

export interface Rect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export const EMPTY_RECT: Rect = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

export const rectIsEmpty = (r: Rect): boolean => !(r.maxX >= r.minX && r.maxY >= r.minY);
export const rectWidth = (r: Rect): number => r.maxX - r.minX;
export const rectHeight = (r: Rect): number => r.maxY - r.minY;

export function boundsOf(points: readonly Vec2[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function unionRect(a: Rect, b: Rect): Rect {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function inflateRect(r: Rect, d: number): Rect {
  return { minX: r.minX - d, minY: r.minY - d, maxX: r.maxX + d, maxY: r.maxY + d };
}

export function intersectRect(a: Rect, b: Rect): Rect {
  return {
    minX: Math.max(a.minX, b.minX),
    minY: Math.max(a.minY, b.minY),
    maxX: Math.min(a.maxX, b.maxX),
    maxY: Math.min(a.maxY, b.maxY),
  };
}

export const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

export const rectContainsRect = (outer: Rect, inner: Rect): boolean =>
  inner.minX >= outer.minX &&
  inner.minY >= outer.minY &&
  inner.maxX <= outer.maxX &&
  inner.maxY <= outer.maxY;

// ---------------------------------------------------------------------------
// Affine matrices — same layout as CanvasRenderingContext2D.setTransform(a,b,c,d,e,f):
//   x' = a·x + c·y + e
//   y' = b·x + d·y + f
// ---------------------------------------------------------------------------

export interface Affine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export const translation = (tx: number, ty: number): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty });
export const scaling = (sx: number, sy = sx): Affine => ({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });

/** Returns m1 ∘ m2 — i.e. apply m2 first, then m1. */
export function compose(m1: Affine, m2: Affine): Affine {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function invert(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c;
  if (det === 0 || !Number.isFinite(det)) {
    throw new Error("Affine matrix is not invertible");
  }
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

export const applyAffine = (m: Affine, p: Vec2): Vec2 => ({
  x: m.a * p.x + m.c * p.y + m.e,
  y: m.b * p.x + m.d * p.y + m.f,
});

/** Applies only the linear part (for direction vectors). */
export const applyLinear = (m: Affine, v: Vec2): Vec2 => ({
  x: m.a * v.x + m.c * v.y,
  y: m.b * v.x + m.d * v.y,
});

/** Uniform scale factor of a similarity transform (rotation + uniform scale + translation). */
export const uniformScale = (m: Affine): number => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));

export function transformRect(m: Affine, r: Rect): Rect {
  return boundsOf([
    applyAffine(m, { x: r.minX, y: r.minY }),
    applyAffine(m, { x: r.maxX, y: r.minY }),
    applyAffine(m, { x: r.maxX, y: r.maxY }),
    applyAffine(m, { x: r.minX, y: r.maxY }),
  ]);
}

// ---------------------------------------------------------------------------
// View (world → screen) helpers
// ---------------------------------------------------------------------------

export const MIN_VIEW_SCALE = 0.01;
export const MAX_VIEW_SCALE = 128;

/** Zooms `view` by `factor` keeping the world point under `screenPt` fixed (zoom-to-cursor). */
export function zoomAt(view: Affine, screenPt: Vec2, factor: number): Affine {
  const current = uniformScale(view);
  const clamped = Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, current * factor));
  const k = clamped / current;
  if (k === 1) return view;
  // T(p) · S(k) · T(-p) · view
  return compose(
    translation(screenPt.x, screenPt.y),
    compose(scaling(k), compose(translation(-screenPt.x, -screenPt.y), view)),
  );
}

export const panBy = (view: Affine, dx: number, dy: number): Affine => compose(translation(dx, dy), view);

/** Builds a view that fits `world` inside a `width`×`height` screen with a margin fraction. */
export function fitRect(world: Rect, width: number, height: number, margin = 0.04): Affine {
  const w = Math.max(rectWidth(world), 1e-6);
  const h = Math.max(rectHeight(world), 1e-6);
  const availW = Math.max(1, width * (1 - 2 * margin));
  const availH = Math.max(1, height * (1 - 2 * margin));
  const s = Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, Math.min(availW / w, availH / h)));
  const cx = (world.minX + world.maxX) / 2;
  const cy = (world.minY + world.maxY) / 2;
  return { a: s, b: 0, c: 0, d: s, e: width / 2 - cx * s, f: height / 2 - cy * s };
}

/** Normalizes an angle in degrees to [0, 360). */
export const normalizeDegrees = (deg: number): number => ((deg % 360) + 360) % 360;
export const toRadians = (deg: number): number => (deg * Math.PI) / 180;
export const toDegrees = (rad: number): number => (rad * 180) / Math.PI;
