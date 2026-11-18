import { ChevronDown, ChevronRight, Cloud, Minus, PenLine, Plus, Ruler, SquareDashed, Trash2 } from "lucide-react";
import { engine, useEngine } from "../app/engine";
import type { ToolChestSet, ToolPreset } from "../core/schema";
import { useToolChests } from "../store/toolchests";

const ICONS: Record<ToolPreset["icon"], typeof Minus> = {
  minus: Minus,
  cloud: Cloud,
  ruler: Ruler,
  "pen-line": PenLine,
  "square-dashed": SquareDashed,
};

function PresetButton({ preset, set, active }: { preset: ToolPreset; set: ToolChestSet; active: boolean }) {
  const { recordUse, setActivePreset, addToMyTools, removeFromSet } = useToolChests.getState();
  const Icon = ICONS[preset.icon];
  const color = preset.template.style?.stroke?.color ?? "#c6cbd3";
  const removable = set.kind === "my-tools" || set.kind === "recent" || set.kind === "custom";

  const launch = () => {
    if (engine.start(preset.command, preset.template)) {
      recordUse(preset);
      setActivePreset(preset.id);
    }
  };

  return (
    <div
      className={`group relative flex items-center gap-2 rounded border px-2 py-1.5 ${
        active ? "border-accent bg-accent/15" : "border-transparent hover:border-ws-600 hover:bg-ws-800"
      }`}
      title={`${preset.description}\nCommand: ${preset.command}`}
    >
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={launch} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-ws-950" style={{ color }}>
          <Icon size={14} />
        </span>
        <span className="truncate text-ws-200">{preset.name}</span>
      </button>
      {removable ? (
        <button
          type="button"
          title={set.kind === "recent" ? "Remove from Recent" : "Delete tool"}
          onClick={() => removeFromSet(set.id, preset.id)}
          className="hidden rounded p-0.5 text-ws-400 hover:bg-ws-700 hover:text-cmd-error group-hover:block"
        >
          <Trash2 size={12} />
        </button>
      ) : (
        <button
          type="button"
          title="Copy to My Tools"
          onClick={() => addToMyTools(preset)}
          className="hidden rounded p-0.5 text-ws-400 hover:bg-ws-700 hover:text-ws-100 group-hover:block"
        >
          <Plus size={12} />
        </button>
      )}
    </div>
  );
}

export function ToolChestPanel() {
  const file = useToolChests((s) => s.file);
  const activePresetId = useToolChests((s) => s.activePresetId);
  const { activeCommand } = useEngine();
  const toggle = useToolChests((s) => s.toggleCollapsed);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-ws-700 bg-ws-900">
      <div className="flex h-8 items-center border-b border-ws-700 px-3 text-2xs font-semibold uppercase tracking-wider text-ws-400">
        Tool Chest
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {file.sets.map((set) => (
          <section key={set.id} className="px-1.5 pb-1">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => toggle(set.id)}
              className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-ws-300 hover:text-ws-100"
            >
              {set.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              <span className="font-semibold">{set.name}</span>
              <span className="ml-auto text-2xs text-ws-500">{set.presets.length}</span>
            </button>
            {!set.collapsed && (
              <div className="flex flex-col gap-px pl-1">
                {set.presets.length === 0 && (
                  <div className="px-2 py-1 text-2xs italic text-ws-500">
                    {set.kind === "recent" ? "Tools you use appear here." : "Empty. Use + on any tool to copy it here."}
                  </div>
                )}
                {set.presets.map((p) => (
                  <PresetButton
                    key={`${set.id}:${p.id}`}
                    preset={p}
                    set={set}
                    active={activeCommand !== null && activePresetId === p.id}
                  />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
      <div className="border-t border-ws-700 px-3 py-2 text-2xs leading-relaxed text-ws-500">
        Type a command anywhere: <span className="font-mono text-ws-300">L</span>,{" "}
        <span className="font-mono text-ws-300">REV</span>, <span className="font-mono text-ws-300">DI</span>,{" "}
        <span className="font-mono text-ws-300">CAL</span>, <span className="font-mono text-ws-300">Z</span>. F8 = Ortho.
      </div>
    </aside>
  );
}
