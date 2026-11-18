/**
 * Deterministic, invertible document operations for undo/redo.
 *
 * Every mutation of a BpxDocument that should be undoable is expressed as an `Op`.
 * `applyOp` is pure (returns a new document, never mutates), and `invertOp(op)` applied
 * after `op` restores the exact previous document — including entity draw order, because
 * insert/delete ops carry explicit indices.
 */

import type { BpxDocument, Calibration, Entity } from "./schema";

export interface IndexedEntity {
  index: number;
  entity: Entity;
}

export type Op =
  /** Insert entities at the given indices (ascending). */
  | { type: "insert"; items: IndexedEntity[] }
  /** Delete entities found at the given indices (ascending, as they were before deletion). */
  | { type: "delete"; items: IndexedEntity[] }
  | { type: "update"; before: Entity[]; after: Entity[] }
  | { type: "calibrate"; pageIndex: number; before: Calibration | null; after: Calibration | null }
  | { type: "batch"; ops: Op[] };

export interface HistoryEntry {
  label: string;
  op: Op;
}

export const HISTORY_LIMIT = 500;

export function applyOp(doc: BpxDocument, op: Op): BpxDocument {
  switch (op.type) {
    case "insert": {
      const entities = doc.entities.slice();
      const sorted = [...op.items].sort((x, y) => x.index - y.index);
      for (const { index, entity } of sorted) {
        if (index < 0 || index > entities.length) throw new Error(`insert index ${index} out of range`);
        entities.splice(index, 0, entity);
      }
      return { ...doc, entities };
    }
    case "delete": {
      const entities = doc.entities.slice();
      const sorted = [...op.items].sort((x, y) => y.index - x.index);
      for (const { index, entity } of sorted) {
        if (entities[index]?.id !== entity.id) {
          throw new Error(`delete op out of sync: expected ${entity.id} at index ${index}`);
        }
        entities.splice(index, 1);
      }
      return { ...doc, entities };
    }
    case "update": {
      const replacements = new Map(op.after.map((e) => [e.id, e]));
      const entities = doc.entities.map((e) => replacements.get(e.id) ?? e);
      return { ...doc, entities };
    }
    case "calibrate": {
      const key = String(op.pageIndex);
      const page = doc.pages[key] ?? { calibration: null };
      return { ...doc, pages: { ...doc.pages, [key]: { ...page, calibration: op.after } } };
    }
    case "batch":
      return op.ops.reduce(applyOp, doc);
  }
}

export function invertOp(op: Op): Op {
  switch (op.type) {
    case "insert":
      return { type: "delete", items: op.items };
    case "delete":
      return { type: "insert", items: op.items };
    case "update":
      return { type: "update", before: op.after, after: op.before };
    case "calibrate":
      return { type: "calibrate", pageIndex: op.pageIndex, before: op.after, after: op.before };
    case "batch":
      return { type: "batch", ops: op.ops.map(invertOp).reverse() };
  }
}

/** Builds an insert op appending `entities` to the end of the draw order. */
export function appendOp(doc: BpxDocument, entities: Entity[]): Op {
  return {
    type: "insert",
    items: entities.map((entity, i) => ({ index: doc.entities.length + i, entity })),
  };
}

/** Builds a delete op for the given ids (ids not present are ignored). */
export function deleteOp(doc: BpxDocument, ids: readonly string[]): Op | null {
  const wanted = new Set(ids);
  const items: IndexedEntity[] = [];
  doc.entities.forEach((entity, index) => {
    if (wanted.has(entity.id)) items.push({ index, entity });
  });
  return items.length ? { type: "delete", items } : null;
}

export function isEmptyOp(op: Op): boolean {
  switch (op.type) {
    case "insert":
    case "delete":
      return op.items.length === 0;
    case "update":
      return op.after.length === 0;
    case "calibrate":
      return false;
    case "batch":
      return op.ops.every(isEmptyOp);
  }
}
