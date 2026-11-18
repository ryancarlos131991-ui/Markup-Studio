import type { ReactNode } from "react";
import { FileText, FolderOpen, Loader2, PanelLeft, PanelRight, Redo2, Save, Undo2, X } from "lucide-react";
import { engine } from "../app/engine";
import { openWithDialog } from "../hooks/useGlobalKeyboard";
import { selectActiveTab, useWorkspace } from "../store/workspace";

interface Props {
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft(): void;
  onToggleRight(): void;
}

function IconButton(props: { title: string; disabled?: boolean; onClick(): void; children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      onMouseDown={(e) => e.preventDefault()}
      className={`flex h-7 w-7 items-center justify-center rounded text-ws-200 hover:bg-ws-700 disabled:opacity-35 disabled:hover:bg-transparent ${
        props.active ? "bg-ws-700 text-accent" : ""
      }`}
    >
      {props.children}
    </button>
  );
}

export function TopBar({ leftOpen, rightOpen, onToggleLeft, onToggleRight }: Props) {
  const tabs = useWorkspace((s) => s.tabs);
  const activeTabId = useWorkspace((s) => s.activeTabId);
  const loading = useWorkspace((s) => s.loadingPaths.length);
  const active = useWorkspace(selectActiveTab);
  const { setActiveTab, closeTab, save } = useWorkspace.getState();

  const undoCmd = (redo: boolean) => {
    if (engine.isActive()) engine.cancel();
    engine.start(redo ? "REDO" : "UNDO");
  };

  return (
    <header className="flex h-9 shrink-0 items-center gap-1 border-b border-ws-700 bg-ws-900 px-2">
      <span className="mr-2 font-semibold tracking-wide text-ws-100">
        Markup<span className="text-accent">Studio</span>
      </span>
      <IconButton title="Toggle Tool Chest" onClick={onToggleLeft} active={leftOpen}>
        <PanelLeft size={15} />
      </IconButton>
      <IconButton title="Open PDF (Ctrl+O)" onClick={() => void openWithDialog()}>
        <FolderOpen size={15} />
      </IconButton>
      <IconButton title="Save markups to .bpx (Ctrl+S)" disabled={!active} onClick={() => active && void save(active.id)}>
        <Save size={15} />
      </IconButton>
      <IconButton title="Undo (Ctrl+Z)" disabled={!active || active.undo.length === 0} onClick={() => undoCmd(false)}>
        <Undo2 size={15} />
      </IconButton>
      <IconButton title="Redo (Ctrl+Y)" disabled={!active || active.redo.length === 0} onClick={() => undoCmd(true)}>
        <Redo2 size={15} />
      </IconButton>

      <div className="mx-2 h-5 w-px bg-ws-700" />

      <nav className="flex min-w-0 flex-1 items-end gap-px self-stretch overflow-x-auto pt-1">
        {tabs.map((t) => (
          <div
            key={t.id}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                void closeTab(t.id);
              } else setActiveTab(t.id);
            }}
            title={t.pdfPath}
            className={`group flex h-full max-w-[220px] cursor-default items-center gap-1.5 rounded-t border border-b-0 px-2 ${
              t.id === activeTabId
                ? "border-ws-600 bg-ws-800 text-ws-100"
                : "border-transparent text-ws-400 hover:bg-ws-850 hover:text-ws-200"
            }`}
          >
            <FileText size={12} className="shrink-0" />
            <span className="truncate">{t.title}</span>
            {t.dirty && <span className="text-accent" title="Unsaved changes">●</span>}
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => void closeTab(t.id)}
              className="ml-0.5 rounded p-0.5 opacity-60 hover:bg-ws-600 hover:opacity-100"
              title="Close (Ctrl+W)"
            >
              <X size={11} />
            </button>
          </div>
        ))}
        {loading > 0 && (
          <div className="flex items-center gap-1 px-2 text-ws-400">
            <Loader2 size={12} className="animate-spin" /> Opening…
          </div>
        )}
      </nav>

      <IconButton title="Toggle Properties / Layers" onClick={onToggleRight} active={rightOpen}>
        <PanelRight size={15} />
      </IconButton>
    </header>
  );
}
