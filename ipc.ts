/** Typed wrappers around the Rust `tauri::command` handlers and native dialogs. */

import { invoke } from "@tauri-apps/api/core";
import { ask, open } from "@tauri-apps/plugin-dialog";

export interface PdfFileInfo {
  path: string;
  fileName: string;
  byteLength: number;
  modifiedMs: number;
  sidecarPath: string;
  sidecarExists: boolean;
}

export interface SaveResult {
  path: string;
  bytesWritten: number;
  backupPath: string | null;
}

export const ipc = {
  statPdf: (path: string) => invoke<PdfFileInfo>("stat_pdf", { path }),
  /** Raw binary IPC response → ArrayBuffer (no base64). */
  readPdf: async (path: string) => new Uint8Array(await invoke<ArrayBuffer>("read_pdf", { path })),
  loadBpx: (pdfPath: string) => invoke<unknown | null>("load_bpx", { pdfPath }),
  saveBpx: (pdfPath: string, document: unknown) => invoke<SaveResult>("save_bpx", { pdfPath, document }),
  loadToolChests: () => invoke<unknown | null>("load_tool_chests"),
  saveToolChests: (document: unknown) => invoke<void>("save_tool_chests", { document }),
};

export async function pickPdfFiles(): Promise<string[]> {
  const result = await open({
    title: "Open drawings",
    multiple: true,
    directory: false,
    filters: [{ name: "PDF drawings", extensions: ["pdf", "PDF"] }],
  });
  if (result === null) return [];
  return Array.isArray(result) ? result : [result];
}

export async function askSaveBeforeClose(name: string): Promise<boolean> {
  return ask(`"${name}" has unsaved markups. Save them to the .bpx sidecar before closing?`, {
    title: "Unsaved markups",
    kind: "warning",
    okLabel: "Save",
    cancelLabel: "Discard",
  });
}

export function errorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return JSON.stringify(err);
}
