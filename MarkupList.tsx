import { useMemo } from "react";
import { frameFor } from "../core/coords";
import { entityBounds, entityLengthMm, entityTypeLabel } from "../core/entities";
import { formatLength } from "../core/units";
import { selectActiveTab, useWorkspace } from "../store/workspace";
import { viewport } from "../viewport/controller";

/**
 * Phase 1 Markups List: live table of every markup with real-world length. Sorting,
 * filtering, status editing and CSV export arrive in Phase 2.
 */
export function MarkupList() {
  const tab = useWorkspace(selectActiveTab);
  const setPage = useWorkspace((s) => s.setPage);

  const rows = useMemo(() => {
    if (!tab) return [];
    const layerName = new Map(tab.doc.layers.map((l) => [l.id, l.name]));
    return tab.doc.entities.map((e) => {
      const cal = tab.doc.pages[String(e.pageIndex)]?.calibration ?? null;
      // Length is independent of page height, so unvisited pages still report correctly.
      const frame = frameFor(tab.pageSizes[e.pageIndex]?.height ?? 0, cal);
      const len = entityLengthMm(e, frame);
      return {
        e,
        layer: layerName.get(e.layerId) ?? e.layerId,
        length: len === null ? "" : formatLength(len, tab.doc.displayUnit),
      };
    });
  }, [tab]);

  const focus = (row: (typeof rows)[number]) => {
    if (!tab) return;
    const rect = entityBounds(row.e);
    if (row.e.pageIndex === tab.pageIndex) viewport.zoomToRect(rect);
    else {
      viewport.setPendingFocus(tab.id, row.e.pageIndex, rect);
      setPage(tab.id, row.e.pageIndex);
    }
  };

  return (
    <div className="flex h-36 shrink-0 flex-col border-t border-ws-700 bg-ws-900">
      <div className="flex h-6 shrink-0 items-center gap-2 border-b border-ws-700 px-3 text-2xs font-semibold uppercase tracking-wider text-ws-400">
        Markups List <span className="font-normal normal-case text-ws-500">({rows.length})</span>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 bg-ws-850 text-ws-400">
            <tr>
              {["ID", "Type", "Subject", "Label", "Layer", "Page", "Length", "Status", "Author"].map((h) => (
                <th key={h} className="border-b border-ws-700 px-2 py-1 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.e.id}
                onDoubleClick={() => focus(row)}
                className="cursor-default text-ws-200 odd:bg-ws-900 even:bg-ws-850 hover:bg-accent/10"
                title="Double-click to zoom to markup"
              >
                <td className="px-2 py-0.5 font-mono text-ws-400">{row.e.seq}</td>
                <td className="px-2 py-0.5">{entityTypeLabel(row.e)}</td>
                <td className="px-2 py-0.5">
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-sm" style={{ background: row.e.style.stroke.color }} />
                  {row.e.subject}
                </td>
                <td className="px-2 py-0.5">{row.e.label}</td>
                <td className="px-2 py-0.5">{row.layer}</td>
                <td className="px-2 py-0.5">{row.e.pageIndex + 1}</td>
                <td className="px-2 py-0.5 font-mono">{row.length}</td>
                <td className="px-2 py-0.5 capitalize text-ws-400">{row.e.status}</td>
                <td className="px-2 py-0.5 text-ws-400">{row.e.author}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="px-3 py-2 text-ws-500">No markups yet.</div>}
      </div>
    </div>
  );
}
