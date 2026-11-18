/**
 * Dual-canvas viewport: PDF underlay canvas + vector markup canvas, sharing one
 * world→screen matrix. Middle-drag pans, wheel zooms to cursor, double-middle-click
 * zooms extents, left click feeds the CLI, right click = Enter (AutoCAD default).
 */

import { useEffect, useRef, useState } from "react";
import { engine } from "../app/engine";
import { entityBounds } from "../core/entities";
import { frameFor } from "../core/coords";
import {
  type Affine,
  IDENTITY,
  type Rect,
  type Vec2,
  applyAffine,
  fitRect,
  invert,
  panBy,
  unionRect,
  uniformScale,
  zoomAt,
} from "../core/geometry";
import { pdfRegistry } from "../platform/pdfjs";
import { useCursor } from "../store/cursor";
import { selectActiveTab, useWorkspace } from "../store/workspace";
import { type ViewportApi, viewport } from "./controller";
import { PdfPageRenderer } from "./pdfLayer";
import { drawVectorScene } from "./vectorRenderer";

const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const DOUBLE_MIDDLE_MS = 350;

interface ViewState {
  view: Affine;
  hasView: boolean;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  pdfDirty: boolean;
  vecDirty: boolean;
  raf: number;
  panning: { pointerId: number; x: number; y: number } | null;
  lastMiddleDown: number;
  cursorScreen: Vec2 | null;
}

export function Viewport() {
  const tab = useWorkspace(selectActiveTab);
  const setPageSize = useWorkspace((s) => s.setPageSize);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const vecCanvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PdfPageRenderer | null>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const [pageLoading, setPageLoading] = useState(false);
  const s = useRef<ViewState>({
    view: IDENTITY,
    hasView: false,
    cssWidth: 0,
    cssHeight: 0,
    dpr: window.devicePixelRatio || 1,
    pdfDirty: true,
    vecDirty: true,
    raf: 0,
    panning: null,
    lastMiddleDown: 0,
    cursorScreen: null,
  }).current;

  // ----- frame loop ----------------------------------------------------------

  const frameRef = useRef<() => void>(() => {});
  frameRef.current = () => {
    s.raf = 0;
    const t = tabRef.current;
    const pdfCtx = pdfCanvasRef.current?.getContext("2d");
    const vecCtx = vecCanvasRef.current?.getContext("2d");
    if (!pdfCtx || !vecCtx) return;

    if (s.pdfDirty) {
      s.pdfDirty = false;
      pdfCtx.setTransform(1, 0, 0, 1, 0, 0);
      pdfCtx.fillStyle = "#23272e";
      pdfCtx.fillRect(0, 0, pdfCtx.canvas.width, pdfCtx.canvas.height);
      rendererRef.current?.draw(pdfCtx, s.view, s.dpr);
    }
    if (s.vecDirty) {
      s.vecDirty = false;
      const size = t ? t.pageSizes[t.pageIndex] : undefined;
      if (!t || !size) {
        vecCtx.setTransform(1, 0, 0, 1, 0, 0);
        vecCtx.clearRect(0, 0, vecCtx.canvas.width, vecCtx.canvas.height);
        return;
      }
      drawVectorScene(vecCtx, {
        view: s.view,
        dpr: s.dpr,
        cssWidth: s.cssWidth,
        cssHeight: s.cssHeight,
        entities: t.doc.entities,
        layers: t.doc.layers,
        pageIndex: t.pageIndex,
        frame: frameFor(size.height, t.doc.pages[String(t.pageIndex)]?.calibration ?? null),
        unit: t.doc.displayUnit,
        previews: engine.getPreview(),
        cursor: s.cursorScreen ? engine.getCursor() : null,
        basePoint: engine.getRequestBase(),
      });
    }
  };

  const schedule = (pdf: boolean, vec: boolean) => {
    if (pdf) s.pdfDirty = true;
    if (vec) s.vecDirty = true;
    if (!s.raf) s.raf = requestAnimationFrame(() => frameRef.current());
  };

  const screenToWorld = (p: Vec2): Vec2 => applyAffine(invert(s.view), p);

  const setView = (view: Affine) => {
    s.view = view;
    s.hasView = true;
    const t = tabRef.current;
    // Only remember views for a loaded page, never the placeholder before first fit.
    if (t && rendererRef.current) viewport.saveView(t.id, t.pageIndex, view);
    rendererRef.current?.update(view, s.cssWidth, s.cssHeight, s.dpr);
    useCursor.getState().setZoom(uniformScale(view));
    if (s.cursorScreen) {
      const w = screenToWorld(s.cursorScreen);
      engine.setCursor(w);
      useCursor.getState().setWorld(w);
    }
    schedule(true, true);
  };

  const extentsRect = (): Rect | null => {
    const r = rendererRef.current;
    const t = tabRef.current;
    if (!r || !t) return null;
    let rect = r.pageRect;
    for (const e of t.doc.entities) if (e.pageIndex === t.pageIndex) rect = unionRect(rect, entityBounds(e));
    return rect;
  };

  // ----- imperative API for the CLI / panels ---------------------------------

  useEffect(() => {
    const api: ViewportApi = {
      zoomExtents() {
        const rect = extentsRect();
        if (rect && s.cssWidth > 0) setView(fitRect(rect, s.cssWidth, s.cssHeight));
      },
      zoomBy(factor) {
        setView(zoomAt(s.view, { x: s.cssWidth / 2, y: s.cssHeight / 2 }, factor));
      },
      zoomToRect(rect) {
        if (s.cssWidth > 0) setView(fitRect(rect, s.cssWidth, s.cssHeight, 0.2));
      },
      pixelsToWorld: (px) => px / uniformScale(s.view),
      requestRedraw: () => schedule(false, true),
    };
    viewport.attach(api);
    return () => viewport.detach(api);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw markups whenever the document or CLI state changes.
  useEffect(() => schedule(false, true));
  useEffect(() => engine.subscribe(() => schedule(false, true)), []); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- canvas sizing (ResizeObserver + DPR changes between monitors) ---------

  useEffect(() => {
    const container = containerRef.current!;
    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      s.cssWidth = Math.max(1, Math.floor(rect.width));
      s.cssHeight = Math.max(1, Math.floor(rect.height));
      s.dpr = dpr;
      for (const c of [pdfCanvasRef.current, vecCanvasRef.current]) {
        if (!c) continue;
        c.width = Math.round(s.cssWidth * dpr);
        c.height = Math.round(s.cssHeight * dpr);
        c.style.width = `${s.cssWidth}px`;
        c.style.height = `${s.cssHeight}px`;
      }
      if (!rendererRef.current) schedule(true, true);
      else if (!s.hasView) viewport.zoomExtents();
      else setView(s.view);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    let mql: MediaQueryList | null = null;
    const watchDpr = () => {
      mql?.removeEventListener("change", onDpr);
      mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mql.addEventListener("change", onDpr);
    };
    const onDpr = () => {
      resize();
      watchDpr();
    };
    watchDpr();
    resize();
    return () => {
      ro.disconnect();
      mql?.removeEventListener("change", onDpr);
      cancelAnimationFrame(s.raf);
      s.raf = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- page loading ---------------------------------------------------------

  const tabId = tab?.id;
  const pageIndex = tab?.pageIndex;
  useEffect(() => {
    if (tabId === undefined || pageIndex === undefined) return;
    const pdf = pdfRegistry.get(tabId);
    if (!pdf) return;
    let cancelled = false;
    let renderer: PdfPageRenderer | null = null;
    setPageLoading(true);
    s.hasView = false;
    engine.resetContext();

    pdf
      .getPage(pageIndex + 1)
      .then((page) => {
        if (cancelled) return;
        renderer = new PdfPageRenderer(
          page,
          () => schedule(true, false),
          (msg) => engine.print(msg, "error"),
        );
        rendererRef.current = renderer;
        setPageSize(tabId, pageIndex, { width: renderer.width, height: renderer.height });
        const focus = viewport.takePendingFocus(tabId, pageIndex);
        const saved = viewport.getSavedView(tabId, pageIndex);
        if (focus) viewport.zoomToRect(focus);
        else if (saved) setView(saved);
        else viewport.zoomExtents();
        setPageLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          engine.print(`Could not load page ${pageIndex + 1}: ${String(err)}`, "error");
          setPageLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (rendererRef.current === renderer) rendererRef.current = null;
      renderer?.dispose();
      schedule(true, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, pageIndex]);

  // ----- pointer + wheel input --------------------------------------------------

  useEffect(() => {
    const canvas = vecCanvasRef.current!;
    const local = (e: MouseEvent): Vec2 => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const updateCursor = (p: Vec2 | null) => {
      s.cursorScreen = p;
      const w = p ? screenToWorld(p) : null;
      engine.setCursor(w);
      useCursor.getState().setWorld(w);
      schedule(false, true);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        const now = performance.now();
        if (now - s.lastMiddleDown < DOUBLE_MIDDLE_MS) {
          s.lastMiddleDown = 0;
          viewport.zoomExtents();
          return;
        }
        s.lastMiddleDown = now;
        s.panning = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = "grabbing";
        return;
      }
      if (e.button === 0) {
        if (!rendererRef.current) return;
        engine.pick(screenToWorld(local(e)));
        schedule(false, true);
        return;
      }
      if (e.button === 2) {
        engine.submit();
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (s.panning && e.pointerId === s.panning.pointerId) {
        const dx = e.clientX - s.panning.x;
        const dy = e.clientY - s.panning.y;
        s.panning.x = e.clientX;
        s.panning.y = e.clientY;
        setView(panBy(s.view, dx, dy));
      }
      updateCursor(local(e));
    };

    const endPan = (e: PointerEvent) => {
      if (s.panning && e.pointerId === s.panning.pointerId) {
        s.panning = null;
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        canvas.style.cursor = "none";
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;
      else if (e.deltaMode === 2) dy *= s.cssHeight;
      setView(zoomAt(s.view, local(e), Math.exp(-dy * WHEEL_ZOOM_SENSITIVITY)));
    };

    const onLeave = () => {
      if (!s.panning) updateCursor(null);
    };
    const prevent = (e: Event) => e.preventDefault();

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endPan);
    canvas.addEventListener("pointercancel", endPan);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", prevent);
    canvas.addEventListener("auxclick", prevent); // stops Linux middle-click paste
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endPan);
      canvas.removeEventListener("pointercancel", endPan);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", prevent);
      canvas.removeEventListener("auxclick", prevent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden bg-[#23272e]">
      <canvas ref={pdfCanvasRef} className="absolute inset-0" />
      <canvas ref={vecCanvasRef} className="absolute inset-0" style={{ cursor: "none", touchAction: "none" }} />
      {pageLoading && (
        <div className="pointer-events-none absolute left-3 top-3 rounded bg-ws-900/90 px-2 py-1 text-2xs text-ws-300">
          Loading page…
        </div>
      )}
    </div>
  );
}
