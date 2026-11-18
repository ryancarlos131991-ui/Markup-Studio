/**
 * pdf.js setup. The legacy build is used because it carries polyfills for the older
 * WebKit engines Tauri uses on macOS (WKWebView) and Linux (WebKitGTK).
 */

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";

// Copied into public/pdfjs by scripts/copy-pdfjs-assets.mjs (runs on npm install).
const ASSETS = `${import.meta.env.BASE_URL}pdfjs/`;

export interface LoadedPdf {
  doc: PDFDocumentProxy;
  /** Tears down the worker-side document (pdf.js 5+: destroy lives on the loading task). */
  destroy(): Promise<void>;
}

export async function loadPdfDocument(data: Uint8Array): Promise<LoadedPdf> {
  const task = pdfjs.getDocument({
    data,
    cMapUrl: `${ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
    iccUrl: `${ASSETS}iccs/`,
    // Drawings are rendered as a static underlay; form widgets/annotations are drawn
    // by pdf.js into the page bitmap rather than as interactive DOM.
    enableXfa: false,
  });
  const doc = await task.promise;
  return { doc, destroy: () => task.destroy() };
}

export function isRenderCancelled(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: string }).name === "RenderingCancelledException";
}

/** PDFDocumentProxy objects aren't serializable, so they live outside Zustand. */
const documents = new Map<string, LoadedPdf>();

export const pdfRegistry = {
  get: (tabId: string) => documents.get(tabId)?.doc,
  set: (tabId: string, pdf: LoadedPdf) => void documents.set(tabId, pdf),
  async release(tabId: string): Promise<void> {
    const pdf = documents.get(tabId);
    documents.delete(tabId);
    if (pdf) await pdf.destroy();
  },
};
