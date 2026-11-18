import { type PageFrame, realDistance } from "./coords";
import { type Rect, boundsOf, inflateRect } from "./geometry";
import { cloudBounds } from "./revcloud";
import type { Entity } from "./schema";

const boundsCache = new WeakMap<Entity, Rect>();

/** World-space bounding box (entities are immutable, so results are cached per object). */
export function entityBounds(e: Entity): Rect {
  const cached = boundsCache.get(e);
  if (cached) return cached;
  let r: Rect;
  switch (e.type) {
    case "line":
      r = inflateRect(boundsOf([e.a, e.b]), e.style.stroke.width / 2);
      break;
    case "measure-length":
      // Leave room for end ticks and the label above the line.
      r = inflateRect(boundsOf([e.a, e.b]), e.style.fontSize * 2);
      break;
    case "revcloud":
      r = inflateRect(cloudBounds(e.points, e.arcLength), e.style.stroke.width / 2);
      break;
  }
  boundsCache.set(e, r);
  return r;
}

/** Real-world length in mm for linear entities; null when length isn't meaningful. */
export function entityLengthMm(e: Entity, frame: PageFrame): number | null {
  switch (e.type) {
    case "line":
    case "measure-length":
      return realDistance(e.a, e.b, frame);
    case "revcloud": {
      let sum = 0;
      for (let i = 0; i < e.points.length; i++) {
        sum += realDistance(e.points[i]!, e.points[(i + 1) % e.points.length]!, frame);
      }
      return sum;
    }
  }
}

export function entityTypeLabel(e: Entity): string {
  switch (e.type) {
    case "line":
      return "Line";
    case "revcloud":
      return "Revision Cloud";
    case "measure-length":
      return "Length";
  }
}
