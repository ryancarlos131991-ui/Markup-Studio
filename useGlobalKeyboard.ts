/**
 * AutoCAD-style global keyboard capture: typing anywhere goes to the command line, so the
 * user never has to click into it. Enter/Space confirm (or repeat the last command), Esc
 * cancels, F8 toggles Ortho. Native form controls keep their own keystrokes.
 */

import { useEffect } from "react";
import { engine } from "../app/engine";
import { pickPdfFiles } from "../platform/ipc";
import { selectActiveTab, useWorkspace } from "../store/workspace";
import { viewport } from "../viewport/controller";

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export async function openWithDialog(): Promise<void> {
  const paths = await pickPdfFiles();
  if (paths.length) await useWorkspace.getState().openPaths(paths);
}

function runUndo(redo: boolean) {
  if (engine.isActive()) engine.cancel();
  engine.start(redo ? "REDO" : "UNDO");
}

export function useGlobalKeyboard(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || isEditableTarget(e.target)) return;
      const ws = useWorkspace.getState();
      const tab = selectActiveTab(ws);
      const mod = e.ctrlKey || e.metaKey;

      if (mod) {
        const key = e.key.toLowerCase();
        let handled = true;
        if (key === "z" && !e.shiftKey) runUndo(false);
        else if (key === "y" || (key === "z" && e.shiftKey)) runUndo(true);
        else if (key === "s") {
          if (tab) void ws.save(tab.id);
        } else if (key === "o") void openWithDialog();
        else if (key === "w") {
          if (tab) void ws.closeTab(tab.id);
        } else if (e.key === "Tab") ws.cycleTab(e.shiftKey ? -1 : 1);
        else if (key === "v") {
          navigator.clipboard
            .readText()
            .then((text) => engine.typeText(text))
            .catch(() => engine.print("Clipboard is not available.", "error"));
        } else handled = false;
        if (handled) e.preventDefault();
        return;
      }
      if (e.altKey) return;

      switch (e.key) {
        case "F8":
          e.preventDefault();
          engine.toggleOrtho();
          return;
        case "Escape":
          e.preventDefault();
          engine.cancel();
          return;
        case "Enter":
        case " ":
          e.preventDefault();
          engine.submit();
          return;
        case "Backspace":
          e.preventDefault();
          engine.backspace();
          return;
        case "ArrowUp":
          e.preventDefault();
          engine.recall(-1);
          return;
        case "ArrowDown":
          e.preventDefault();
          engine.recall(1);
          return;
        case "PageUp":
        case "PageDown":
          e.preventDefault();
          if (tab) ws.setPage(tab.id, tab.pageIndex + (e.key === "PageDown" ? 1 : -1));
          return;
        case "Home":
          e.preventDefault();
          viewport.zoomExtents();
          return;
      }
      if (e.key.length === 1) {
        e.preventDefault();
        engine.typeChar(e.key);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
