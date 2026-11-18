/**
 * Imperative bridge to the mounted <Viewport>. The CLI host and panels call these; the
 * Viewport component attaches the real implementation while mounted.
 */

import type { Affine, Rect } from "../core/geometry";

export interface ViewportApi {
  zoomExtents(): void;
  zoomBy(factor: number): void;
  zoomToRect(rect: Rect): void;
  pixelsToWorld(px: number): number;
  requestRedraw(): void;
}

let api: ViewportApi | null = null;
let pendingFocus: { tabId: string; pageIndex: number; rect: Rect } | null = null;

/** Saved views so switching tabs/pages restores where you were. Key: `${tabId}:${page}`. */
const views = new Map<string, Affine>();

export const viewport = {
  attach(impl: ViewportApi) {
    api = impl;
  },
  detach(impl: ViewportApi) {
    if (api === impl) api = null;
  },
  zoomExtents: () => api?.zoomExtents(),
  zoomBy: (factor: number) => api?.zoomBy(factor),
  zoomToRect: (rect: Rect) => api?.zoomToRect(rect),
  pixelsToWorld: (px: number) => (api ? api.pixelsToWorld(px) : px),
  requestRedraw: () => api?.requestRedraw(),

  /** Zoom to `rect` on a page, after the page has loaded if it isn't current yet. */
  setPendingFocus(tabId: string, pageIndex: number, rect: Rect) {
    pendingFocus = { tabId, pageIndex, rect };
  },
  takePendingFocus(tabId: string, pageIndex: number): Rect | null {
    if (pendingFocus && pendingFocus.tabId === tabId && pendingFocus.pageIndex === pageIndex) {
      const r = pendingFocus.rect;
      pendingFocus = null;
      return r;
    }
    return null;
  },

  getSavedView: (tabId: string, pageIndex: number) => views.get(`${tabId}:${pageIndex}`),
  saveView: (tabId: string, pageIndex: number, view: Affine) => void views.set(`${tabId}:${pageIndex}`, view),
  forgetTab(tabId: string) {
    for (const key of views.keys()) if (key.startsWith(`${tabId}:`)) views.delete(key);
  },
};
