/**
 * PDF underlay renderer.
 *
 * Two bitmaps per page:
 *  - BASE   : the whole page at a power-of-two scale bucket, capped at ~16 MP. Covers any
 *             zoom level instantly (blurry when deeply zoomed) and survives pans.
 *  - DETAIL : only the visible region (+margin) at the exact current device scale,
 *             rendered after the view settles (debounced). Gives crisp linework at 6400%
 *             on A0 sheets without ever allocating a gigapixel canvas.
 * Both are blitted through the view matrix each frame, so pan/zoom is a GPU drawImage.
 */

import {
  type Affine,
  type Rect,
  inflateRect,
  intersectRect,
  invert,
  rectContainsRect,
  rectHeight,
  rectIsEmpty,
  rectWidth,
  transformRect,
  uniformScale,
} from "../core/geometry";
import { type PDFPageProxy, type RenderTask, isRenderCancelled } from "../platform/pdfjs";

const MAX_BITMAP_PIXELS = 16_000_000; // under Safari/WebKit's 16.7 MP canvas limit
const MAX_BITMAP_DIM = 8192;
const DETAIL_DEBOUNCE_MS = 120;
const DETAIL_MARGIN = 0.15;

interface Bitmap {
  canvas: HTMLCanvasElement;
  /** Device pixels per point. */
  scale: number;
  /** World rect covered by the canvas. */
  rect: Rect;
}

function releaseCanvas(c: HTMLCanvasElement) {
  // Shrinking to 0 frees GPU/backing memory immediately on WebKit.
  c.width = 0;
  c.height = 0;
}

export class PdfPageRenderer {
  readonly width: number;
  readonly height: number;
  private base: Bitmap | null = null;
  private baseTask: RenderTask | null = null;
  private baseTaskScale = 0;
  private detail: Bitmap | null = null;
  private detailTask: RenderTask | null = null;
  private detailTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(
    private readonly page: PDFPageProxy,
    private readonly onUpdate: () => void,
    private readonly onError: (message: string) => void,
  ) {
    const vp = page.getViewport({ scale: 1 });
    this.width = vp.width;
    this.height = vp.height;
  }

  get pageRect(): Rect {
    return { minX: 0, minY: 0, maxX: this.width, maxY: this.height };
  }

  private get maxBaseScale(): number {
    return Math.min(
      Math.sqrt(MAX_BITMAP_PIXELS / (this.width * this.height)),
      MAX_BITMAP_DIM / this.width,
      MAX_BITMAP_DIM / this.height,
    );
  }

  /** Call whenever the view, viewport size or DPR changes. */
  update(view: Affine, cssWidth: number, cssHeight: number, dpr: number): void {
    if (this.disposed || cssWidth <= 0 || cssHeight <= 0) return;
    const target = uniformScale(view) * dpr;

    const bucket = Math.min(this.maxBaseScale, Math.pow(2, Math.ceil(Math.log2(Math.max(target, 1 / 16)))));
    const haveBase = Math.max(this.base?.scale ?? 0, this.baseTask ? this.baseTaskScale : 0);
    if (bucket > haveBase * 1.001) void this.renderBase(bucket);

    const baseScale = this.base?.scale ?? (this.baseTask ? this.baseTaskScale : 0);
    if (baseScale > 0 && target <= baseScale * 1.15) {
      this.dropDetail();
      return;
    }

    const visible = intersectRect(
      transformRect(invert(view), { minX: 0, minY: 0, maxX: cssWidth, maxY: cssHeight }),
      this.pageRect,
    );
    if (rectIsEmpty(visible)) {
      this.dropDetail();
      return;
    }
    if (this.detail && Math.abs(this.detail.scale - target) / target < 0.02 && rectContainsRect(this.detail.rect, visible)) {
      return;
    }
    clearTimeout(this.detailTimer);
    this.detailTimer = setTimeout(() => {
      const margin = Math.max(rectWidth(visible), rectHeight(visible)) * DETAIL_MARGIN;
      void this.renderDetail(intersectRect(inflateRect(visible, margin), this.pageRect), target);
    }, DETAIL_DEBOUNCE_MS);
  }

  draw(ctx: CanvasRenderingContext2D, view: Affine, dpr: number): void {
    ctx.setTransform(dpr * view.a, dpr * view.b, dpr * view.c, dpr * view.d, dpr * view.e, dpr * view.f);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 18 * dpr;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    for (const bmp of [this.base, this.detail]) {
      if (!bmp) continue;
      ctx.drawImage(bmp.canvas, bmp.rect.minX, bmp.rect.minY, bmp.canvas.width / bmp.scale, bmp.canvas.height / bmp.scale);
    }
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.detailTimer);
    this.baseTask?.cancel();
    this.detailTask?.cancel();
    if (this.base) releaseCanvas(this.base.canvas);
    if (this.detail) releaseCanvas(this.detail.canvas);
    this.base = null;
    this.detail = null;
  }

  private dropDetail(): void {
    clearTimeout(this.detailTimer);
    this.detailTask?.cancel();
    this.detailTask = null;
    if (this.detail) {
      releaseCanvas(this.detail.canvas);
      this.detail = null;
      this.onUpdate();
    }
  }

  private async renderBase(scale: number): Promise<void> {
    this.baseTask?.cancel();
    const viewport = this.page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const task = this.page.render({ canvas, viewport, background: "rgb(255,255,255)" });
    this.baseTask = task;
    this.baseTaskScale = scale;
    try {
      await task.promise;
      if (this.disposed || this.baseTask !== task) {
        releaseCanvas(canvas);
        return;
      }
      if (this.base) releaseCanvas(this.base.canvas);
      this.base = { canvas, scale, rect: this.pageRect };
      this.baseTask = null;
      this.onUpdate();
    } catch (err) {
      releaseCanvas(canvas);
      if (this.baseTask === task) this.baseTask = null;
      if (!isRenderCancelled(err)) this.onError(`PDF render failed: ${String(err)}`);
    }
  }

  private async renderDetail(rect: Rect, requestedScale: number): Promise<void> {
    if (this.disposed || rectIsEmpty(rect)) return;
    this.detailTask?.cancel();
    let scale = requestedScale;
    const px = rectWidth(rect) * scale * rectHeight(rect) * scale;
    if (px > MAX_BITMAP_PIXELS) scale *= Math.sqrt(MAX_BITMAP_PIXELS / px);
    scale = Math.min(scale, MAX_BITMAP_DIM / rectWidth(rect), MAX_BITMAP_DIM / rectHeight(rect));

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(rectWidth(rect) * scale));
    canvas.height = Math.max(1, Math.ceil(rectHeight(rect) * scale));
    const viewport = this.page.getViewport({ scale, offsetX: -rect.minX * scale, offsetY: -rect.minY * scale });
    const task = this.page.render({ canvas, viewport, background: "rgb(255,255,255)" });
    this.detailTask = task;
    try {
      await task.promise;
      if (this.disposed || this.detailTask !== task) {
        releaseCanvas(canvas);
        return;
      }
      if (this.detail) releaseCanvas(this.detail.canvas);
      this.detail = { canvas, scale, rect };
      this.detailTask = null;
      this.onUpdate();
    } catch (err) {
      releaseCanvas(canvas);
      if (this.detailTask === task) this.detailTask = null;
      if (!isRenderCancelled(err)) this.onError(`PDF render failed: ${String(err)}`);
    }
  }
}
