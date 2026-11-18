import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { engine } from "./app/engine";
import { CommandBar } from "./components/CommandBar";
import { InspectorPanel } from "./components/InspectorPanel";
import { MarkupList } from "./components/MarkupList";
import { StatusBar } from "./components/StatusBar";
import { ToolChestPanel } from "./components/ToolChestPanel";
import { TopBar } from "./components/TopBar";
import { openWithDialog, useGlobalKeyboard } from "./hooks/useGlobalKeyboard";
import { useToolChests } from "./store/toolchests";
import { selectActiveTab, useWorkspace } from "./store/workspace";
import { Viewport } from "./viewport/Viewport";
import { viewport } from "./viewport/controller";

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-ws-400">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void openWithDialog()}
        className="flex items-center gap-2 rounded border border-ws-600 bg-ws-850 px-4 py-2 text-sm text-ws-100 hover:border-accent"
      >
        <FolderOpen size={16} /> Open drawings…
      </button>
      <div className="text-2xs">Ctrl+O · markups are saved beside each PDF as a .bpx sidecar</div>
    </div>
  );
}

export default function App() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const hasTab = useWorkspace((s) => s.activeTabId !== null);
  const title = useWorkspace((s) => {
    const t = selectActiveTab(s);
    return t ? `${t.dirty ? "● " : ""}${t.title} (page ${t.pageIndex + 1}) · Markup Studio` : "Markup Studio";
  });

  useGlobalKeyboard();

  useEffect(() => {
    engine.print("Markup Studio ready. Ctrl+O to open drawings; type L, REV, DI, CAL or Z at any time.", "info");
    void useToolChests
      .getState()
      .load()
      .then((warnings) => warnings.forEach((w) => engine.print(w, "error")));
  }, []);

  useEffect(() => {
    void getCurrentWindow().setTitle(title).catch(() => undefined);
  }, [title]);

  // Forget saved views of closed tabs.
  useEffect(
    () =>
      useWorkspace.subscribe((s, prev) => {
        for (const t of prev.tabs) if (!s.tabs.some((x) => x.id === t.id)) viewport.forgetTab(t.id);
      }),
    [],
  );

  // Guard window close when there are unsaved markups.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        const dirty = useWorkspace.getState().tabs.filter((t) => t.dirty);
        if (dirty.length === 0) return;
        const saveAll = await ask(
          `${dirty.length} drawing(s) have unsaved markups:\n${dirty.map((t) => `• ${t.title}`).join("\n")}\n\nSave before quitting?`,
          { title: "Unsaved markups", kind: "warning", okLabel: "Save all", cancelLabel: "Discard" },
        );
        if (!saveAll) return;
        for (const t of dirty) {
          if (!(await useWorkspace.getState().save(t.id))) {
            event.preventDefault(); // a save failed; keep the window open
            return;
          }
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return (
    <div className="flex h-screen w-screen select-none flex-col overflow-hidden bg-ws-950 font-ui text-xs text-ws-100">
      <TopBar
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={() => setLeftOpen((v) => !v)}
        onToggleRight={() => setRightOpen((v) => !v)}
      />
      <div className="flex min-h-0 flex-1">
        {leftOpen && <ToolChestPanel />}
        <main className="relative min-w-0 flex-1">{hasTab ? <Viewport /> : <EmptyState />}</main>
        {rightOpen && <InspectorPanel />}
      </div>
      <MarkupList />
      <CommandBar />
      <StatusBar />
    </div>
  );
}
