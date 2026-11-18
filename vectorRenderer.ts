/**
 * Vector markup layer: committed entities (world space), command previews, and the CAD
 * crosshair (screen space). Entities outside the visible world rect are culled by bbox.
 */

import type { Preview } from "../cli/types";
import { type PageFrame, realDistance } from "../core/coords";
import { entityBounds } from "../core/entities";
import { type Affine, type Rect, type Vec2, applyAffine, invert, rectsOverlap, transformRect, uniformScale } from "../core/geometry";
import { type CloudArc, buildCloudArcs, traceCloud } from "../core/revcloud";
import type { Entity, Layer, MarkupStyle } from "../core/schema";
import { type DisplayUnit, formatLength } from "../core/units";

const PREVIEW_COLOR = "#3b9eff";
const CROSSHAIR_COLOR = "rgba(255,255,255,0.38)";
const PICKBOX_PX = 6;

const cloudCache = new WeakMap<Entity, CloudArc[]>();
function cloudArcsOf(e: Extract<Entity, { type: "revcloud" }>): CloudArc[] {
  let arcs = cloudCache.get(e);
  if (!arcs) {
    arcs = buildCloudArcs(e.points, e.arcLength);
    cloudCache.set(e, arcs);
  }
  return arcs;
}

export interface VectorScene {
  view: Affine;
  dpr: number;
  cssWidth: number;
  cssHeight: number;
  entities: readonly Entity[];
  layers: readonly Layer[];
  pageIndex: number;
  frame: PageFrame;
  unit: DisplayUnit;
  previews: readonly Preview[];
  /** Raw cursor in world space (crosshair), and the request base point if any. */
  cursor: Vec2 | null;
  basePoint: Vec2 | null;
}

function setWorld(ctx: CanvasRenderingContext2D, v: Affine, dpr: number) {
  ctx.setTransform(dpr * v.a, dpr * v.b, dpr * v.c, dpr * v.d, dpr * v.e, dpr * v.f);
}

function setScreen(ctx: CanvasRenderingContext2D, dpr: number) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function applyStroke(ctx: CanvasRenderingContext2D, style: MarkupStyle, viewScale: number) {
  const s = style.stroke;
  ctx.strokeStyle = s.color;
  ctx.globalAlpha = s.opacity;
  // Weight is in points but never thinner than one CSS pixel.
  ctx.lineWidth = Math.max(s.width, 1 / viewScale);
  ctx.setLineDash(s.dash.length ? s.dash : []);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

/** Draws text centred on `at` (screen px), rotated by `angle`, with a dark halo. */
function haloText(ctx: CanvasRenderingContext2D, text: string, at: Vec2, angle: number, px: number, color: string) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  ctx.font = `600 ${px}px Inter, "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.lineWidth = Math.max(2, px / 4);
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineJoin = "round";
  ctx.strokeText(text, 0, -px * 0.25);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, -px * 0.25);
  ctx.restore();
}

function drawMeasureLabel(
  ctx: CanvasRenderingContext2D,
  e: Extract<Entity, { type: "measure-length" }>,
  scene: VectorScene,
  viewScale: number,
) {
  const px = e.style.fontSize * viewScale;
  if (px < 5) return; // unreadably small at this zoom
  const a = applyAffine(scene.view, e.a);
  const b = applyAffine(scene.view, e.b);
  let angle = Math.atan2(b.y - a.y, b.x - a.x);
  if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI; // keep text upright
  const text = formatLength(realDistance(e.a, e.b, scene.frame), scene.unit);
  const label = e.label ? `${e.label}: ${text}` : text;
  haloText(ctx, label, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, angle, Math.min(px, 64), e.style.stroke.color);
}

function drawEntity(ctx: CanvasRenderingContext2D, e: Entity, scene: VectorScene, viewScale: number) {
  setWorld(ctx, scene.view, scene.dpr);
  applyStroke(ctx, e.style, viewScale);
  switch (e.type) {
    case "line": {
      ctx.beginPath();
      ctx.moveTo(e.a.x, e.a.y);
      ctx.lineTo(e.b.x, e.b.y);
      ctx.stroke();
      break;
    }
    case "revcloud": {
      ctx.beginPath();
      traceCloud(ctx, cloudArcsOf(e));
      if (e.style.fill.color && e.style.fill.opacity > 0) {
        ctx.save();
        ctx.globalAlpha = e.style.fill.opacity;
        ctx.fillStyle = e.style.fill.color;
        ctx.fill();
        ctx.restore();
      }
      ctx.stroke();
      break;
    }
    case "measure-length": {
      const dx = e.b.x - e.a.x;
      const dy = e.b.y - e.a.y;
      const len = Math.hypot(dx, dy);
      ctx.beginPath();
      ctx.moveTo(e.a.x, e.a.y);
      ctx.lineTo(e.b.x, e.b.y);
      if (len > 0) {
        // 45° architectural ticks at both ends, sized from the label font.
        const t = e.style.fontSize * 0.45;
        const ux = dx / len;
        const uy = dy / len;
        const tx = (ux - uy) * t * Math.SQRT1_2;
        const ty = (uy + ux) * t * Math.SQRT1_2;
        for (const p of [e.a, e.b]) {
          ctx.moveTo(p.x - tx, p.y - ty);
          ctx.lineTo(p.x + tx, p.y + ty);
        }
      }
      ctx.setLineDash([]);
      ctx.stroke();
      setScreen(ctx, scene.dpr);
      ctx.globalAlpha = 1;
      drawMeasureLabel(ctx, e, scene, viewScale);
      break;
    }
  }
  ctx.globalAlpha = 1;
}

function drawPreview(ctx: CanvasRenderingContext2D, p: Preview, scene: VectorScene, viewScale: number) {
  const px = 1 / viewScale; // one CSS pixel in world units
  setWorld(ctx, scene.view, scene.dpr);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.25 * px;
  ctx.strokeStyle = PREVIEW_COLOR;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (p.kind) {
    case "line":
      ctx.setLineDash(p.dashed ? [6 * px, 4 * px] : []);
      ctx.beginPath();
      ctx.moveTo(p.a.x, p.a.y);
      ctx.lineTo(p.b.x, p.b.y);
      ctx.stroke();
      break;
    case "polyline":
      ctx.setLineDash(p.dashed ? [6 * px, 4 * px] : []);
      ctx.beginPath();
      p.points.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
      if (p.closed) ctx.closePath();
      ctx.stroke();
      break;
    case "cloud":
      ctx.setLineDash([]);
      ctx.strokeStyle = p.color ?? PREVIEW_COLOR;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      traceCloud(ctx, buildCloudArcs(p.points, p.arcLength));
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    case "marker": {
      const s = 5 * px;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(p.at.x - s, p.at.y - s);
      ctx.lineTo(p.at.x + s, p.at.y + s);
      ctx.moveTo(p.at.x + s, p.at.y - s);
      ctx.lineTo(p.at.x - s, p.at.y + s);
      ctx.stroke();
      break;
    }
    case "label": {
      setScreen(ctx, scene.dpr);
      const at = applyAffine(scene.view, p.at);
      ctx.font = `500 11px "JetBrains Mono", Consolas, ui-monospace, monospace`;
      const w = ctx.measureText(p.text).width + 10;
      const x = Math.min(at.x + 18, scene.cssWidth - w - 4);
      const y = Math.min(at.y + 18, scene.cssHeight - 22);
      ctx.fillStyle = "rgba(20,23,28,0.92)";
      ctx.strokeStyle = "rgba(59,158,255,0.8)";
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.rect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), 18);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#e4e7ec";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(p.text, x + 5, y + 9.5);
      break;
    }
  }
  ctx.setLineDash([]);
}

function drawCrosshair(ctx: CanvasRenderingContext2D, scene: VectorScene) {
  if (!scene.cursor) return;
  setScreen(ctx, scene.dpr);
  const c = applyAffine(scene.view, scene.cursor);
  const x = Math.round(c.x) + 0.5;
  const y = Math.round(c.y) + 0.5;
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = CROSSHAIR_COLOR;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(x - PICKBOX_PX - 2, y);
  ctx.moveTo(x + PICKBOX_PX + 2, y);
  ctx.lineTo(scene.cssWidth, y);
  ctx.moveTo(x, 0);
  ctx.lineTo(x, y - PICKBOX_PX - 2);
  ctx.moveTo(x, y + PICKBOX_PX + 2);
  ctx.lineTo(x, scene.cssHeight);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.strokeRect(x - PICKBOX_PX, y - PICKBOX_PX, PICKBOX_PX * 2, PICKBOX_PX * 2);
}

function drawBasePoint(ctx: CanvasRenderingContext2D, scene: VectorScene) {
  if (!scene.basePoint) return;
  setScreen(ctx, scene.dpr);
  const b = applyAffine(scene.view, scene.basePoint);
  ctx.strokeStyle = PREVIEW_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2);
  ctx.stroke();
}

export function visibleWorldRect(view: Affine, cssWidth: number, cssHeight: number): Rect {
  return transformRect(invert(view), { minX: 0, minY: 0, maxX: cssWidth, maxY: cssHeight });
}

export function drawVectorScene(ctx: CanvasRenderingContext2D, scene: VectorScene): void {
  setScreen(ctx, scene.dpr);
  ctx.clearRect(0, 0, scene.cssWidth, scene.cssHeight);
  const viewScale = uniformScale(scene.view);
  const visible = visibleWorldRect(scene.view, scene.cssWidth, scene.cssHeight);
  const shown = new Set(scene.layers.filter((l) => l.visible).map((l) => l.id));

  for (const e of scene.entities) {
    if (e.pageIndex !== scene.pageIndex || !shown.has(e.layerId)) continue;
    if (!rectsOverlap(entityBounds(e), visible)) continue;
    drawEntity(ctx, e, scene, viewScale);
  }
  for (const p of scene.previews) drawPreview(ctx, p, scene, viewScale);
  drawBasePoint(ctx, scene);
  drawCrosshair(ctx, scene);
  setScreen(ctx, scene.dpr);
  ctx.globalAlpha = 1;
}
