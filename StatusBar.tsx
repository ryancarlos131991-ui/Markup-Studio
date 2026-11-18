import { engine, useEngine } from "../app/engine";
import { describeCalibration, frameFor, worldToReal } from "../core/coords";
import { formatCoordinate } from "../core/units";
import { useCursor } from "../store/cursor";
import { selectActiveTab, useWorkspace } from "../store/workspace";

function Toggle({ label, on, title, onClick }: { label: string; on: boolean; title: string; onClick(): void }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`rounded px-1.5 font-semibold tracking-wide ${on ? "bg-accent/25 text-accent" : "text-ws-500 hover:text-ws-300"}`}
    >
      {label}
    </button>
  );
}

export function StatusBar() {
  const tab = useWorkspace(selectActiveTab);
  const world = useCursor((s) => s.world);
  const zoom = useCursor((s) => s.zoom);
  const { ortho } = useEngine();

  let coords = "";
  let scale = "";
  if (tab) {
    const size = tab.pageSizes[tab.pageIndex];
    const cal = tab.doc.pages[String(tab.pageIndex)]?.calibration ?? null;
    scale = describeCalibration(cal);
    if (world && size) {
      const r = worldToReal(world, frameFor(size.height, cal));
      coords = `${formatCoordinate(r.x, tab.doc.displayUnit)}, ${formatCoordinate(r.y, tab.doc.displayUnit)}`;
    }
  }

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-ws-700 bg-ws-900 px-3 font-mono text-2xs text-ws-400">
      <span className="w-48 truncate text-ws-200" title="Cursor (real-world, origin bottom-left)">
        {coords || "—"}
      </span>
      <Toggle label="ORTHO" on={ortho} title="Ortho mode (F8)" onClick={() => engine.toggleOrtho()} />
      <span className="mx-1 h-3 w-px bg-ws-700" />
      {tab && (
        <>
          <span title="Page scale">{scale}</span>
          <span>{tab.doc.displayUnit}</span>
          <span>{Math.round(zoom * 100)}%</span>
          <span>
            Pg {tab.pageIndex + 1}/{tab.pageCount}
          </span>
        </>
      )}
      <span className="ml-auto">{tab ? (tab.dirty ? "Unsaved changes" : "Saved") : "No document"}</span>
    </footer>
  );
}
