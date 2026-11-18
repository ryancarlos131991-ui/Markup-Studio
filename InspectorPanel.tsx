import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Eye, EyeOff, Lock, Ruler, Unlock } from "lucide-react";
import { engine, useEngine } from "../app/engine";
import { describeCalibration } from "../core/coords";
import { DISPLAY_UNITS, type DisplayUnit, MM_PER_PT, formatLength, unitLabel } from "../core/units";
import { selectActiveTab, useWorkspace } from "../store/workspace";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-ws-700 px-3 py-2.5">
      <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-ws-400">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-ws-400">{label}</span>
      <span className="min-w-0 truncate text-right text-ws-100">{children}</span>
    </div>
  );
}

export function InspectorPanel() {
  const tab = useWorkspace(selectActiveTab);
  const { ortho } = useEngine();
  const { setPage, setDisplayUnit, updateLayer, setActiveLayer } = useWorkspace.getState();

  if (!tab) {
    return (
      <aside className="w-64 shrink-0 border-l border-ws-700 bg-ws-900 p-3 text-ws-500">No document open.</aside>
    );
  }
  const size = tab.pageSizes[tab.pageIndex];
  const cal = tab.doc.pages[String(tab.pageIndex)]?.calibration ?? null;
  const counts = new Map<string, number>();
  for (const e of tab.doc.entities) counts.set(e.layerId, (counts.get(e.layerId) ?? 0) + 1);

  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-l border-ws-700 bg-ws-900">
      <Section title="Page">
        <div className="mb-2 flex items-center gap-1">
          <button
            type="button"
            className="rounded p-1 hover:bg-ws-700 disabled:opacity-30"
            disabled={tab.pageIndex === 0}
            onClick={() => setPage(tab.id, tab.pageIndex - 1)}
            title="Previous page (PgUp)"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="flex-1 text-center text-ws-100">
            Page {tab.pageIndex + 1} / {tab.pageCount}
          </span>
          <button
            type="button"
            className="rounded p-1 hover:bg-ws-700 disabled:opacity-30"
            disabled={tab.pageIndex >= tab.pageCount - 1}
            onClick={() => setPage(tab.id, tab.pageIndex + 1)}
            title="Next page (PgDn)"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        {size && (
          <Row label="Sheet">
            {formatLength(size.width * MM_PER_PT, "mm")} × {formatLength(size.height * MM_PER_PT, "mm")}
          </Row>
        )}
        <Row label="Scale">{describeCalibration(cal)}</Row>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => engine.start("CAL")}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-ws-600 py-1 text-ws-200 hover:border-accent hover:text-ws-100"
        >
          <Ruler size={12} /> Calibrate (CAL)
        </button>
      </Section>

      <Section title="Units & drafting">
        <label className="flex items-center justify-between gap-2 py-0.5">
          <span className="text-ws-400">Display units</span>
          <select
            value={tab.doc.displayUnit}
            onChange={(e) => {
              setDisplayUnit(tab.id, e.target.value as DisplayUnit);
              e.target.blur(); // hand the keyboard back to the command line
            }}
            className="rounded border border-ws-600 bg-ws-800 px-1 py-0.5 text-ws-100 outline-none focus:border-accent"
          >
            {DISPLAY_UNITS.map((u) => (
              <option key={u} value={u}>
                {unitLabel(u)}
              </option>
            ))}
          </select>
        </label>
        <Row label="Ortho (F8)">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => engine.toggleOrtho()}
            className={`rounded px-2 py-0.5 font-semibold ${ortho ? "bg-accent text-ws-950" : "bg-ws-700 text-ws-300"}`}
          >
            {ortho ? "ON" : "OFF"}
          </button>
        </Row>
      </Section>

      <Section title="Layers">
        <ul className="flex flex-col gap-px">
          {tab.doc.layers.map((l) => {
            const active = l.id === tab.doc.activeLayerId;
            return (
              <li
                key={l.id}
                onClick={() => setActiveLayer(tab.id, l.id)}
                className={`flex cursor-default items-center gap-2 rounded px-1.5 py-1 ${
                  active ? "bg-accent/15 ring-1 ring-accent/60" : "hover:bg-ws-800"
                }`}
                title={active ? "Active layer: new markups go here" : "Click to make active"}
              >
                <span className="h-3 w-3 shrink-0 rounded-sm border border-black/40" style={{ background: l.color }} />
                <span className={`flex-1 truncate ${l.visible ? "text-ws-100" : "text-ws-500"}`}>{l.name}</span>
                <span className="text-2xs text-ws-500">{counts.get(l.id) ?? 0}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    updateLayer(tab.id, l.id, { visible: !l.visible });
                  }}
                  className="rounded p-0.5 text-ws-400 hover:bg-ws-700 hover:text-ws-100"
                  title={l.visible ? "Hide layer" : "Show layer"}
                >
                  {l.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    updateLayer(tab.id, l.id, { locked: !l.locked });
                  }}
                  className={`rounded p-0.5 hover:bg-ws-700 ${l.locked ? "text-cmd-kw" : "text-ws-400 hover:text-ws-100"}`}
                  title={l.locked ? "Unlock layer" : "Lock layer"}
                >
                  {l.locked ? <Lock size={12} /> : <Unlock size={12} />}
                </button>
              </li>
            );
          })}
        </ul>
      </Section>
    </aside>
  );
}
