import type { PageFrame } from "../core/coords";
import type { Vec2 } from "../core/geometry";
import type { Calibration, Entity, EntityTemplate } from "../core/schema";
import type { DisplayUnit } from "../core/units";

export interface Keyword {
  /** Exact token that selects it (case-insensitive), e.g. "C". */
  key: string;
  /** Full word shown in the prompt; unique prefixes also select it. */
  label: string;
}

/** Transient geometry drawn by the viewport while a command is waiting for input. */
export type Preview =
  | { kind: "line"; a: Vec2; b: Vec2; dashed?: boolean }
  | { kind: "polyline"; points: Vec2[]; closed: boolean; dashed?: boolean }
  | { kind: "cloud"; points: Vec2[]; arcLength: number; color?: string }
  | { kind: "label"; at: Vec2; text: string }
  | { kind: "marker"; at: Vec2 };

export interface PointRequest {
  kind: "point";
  prompt: string;
  /** Base point for ortho, rubber-banding and direct distance entry. */
  base?: Vec2;
  keywords?: Keyword[];
  defaultKeyword?: string;
  /** Enter/Space with an empty buffer yields `{ type: "none" }`. */
  allowNone?: boolean;
  preview?: (cursor: Vec2) => Preview[];
}

export interface ValueRequest {
  kind: "value";
  prompt: string;
  keywords?: Keyword[];
  defaultKeyword?: string;
  allowNone?: boolean;
  /** Shown as `<default>` in the prompt; Enter with empty buffer submits it as a value. */
  defaultValue?: string;
}

export type Request = PointRequest | ValueRequest;

export type Input =
  | { type: "point"; p: Vec2 }
  | { type: "keyword"; key: string }
  | { type: "value"; text: string }
  | { type: "none" };

export type CommandGen = Generator<Request, void, Input>;

export interface PageContext {
  tabId: string;
  pageIndex: number;
  frame: PageFrame;
  unit: DisplayUnit;
  calibration: Calibration | null;
}

/** Geometry-only part of an entity; the host fills ids, layer, style and metadata. */
export type EntityGeometry =
  | { type: "line"; a: Vec2; b: Vec2 }
  | { type: "revcloud"; points: Vec2[]; arcLength: number }
  | { type: "measure-length"; a: Vec2; b: Vec2 };

export type AddResult = { ok: true; entities: Entity[] } | { ok: false; error: string };

/** Everything the engine needs from the application. Implemented in `app/engineHost.ts`. */
export interface EngineHost {
  getPageContext(): PageContext | null;
  addEntities(geometry: EntityGeometry[], template: EntityTemplate | undefined): AddResult;
  removeEntities(ids: string[]): void;
  setCalibration(pageIndex: number, calibration: Calibration | null): void;
  setDisplayUnit(unit: DisplayUnit): void;
  /** Groups every op committed until `endGroup` into one undo step. */
  beginGroup(label: string): void;
  endGroup(): void;
  /** Return the label of the undone/redone step, or null if nothing to do. */
  undo(): string | null;
  redo(): string | null;
  zoomExtents(): void;
  zoomBy(factor: number): void;
  /** Converts a screen-pixel tolerance to world units at the current zoom. */
  pixelsToWorld(px: number): number;
}

export interface CommandContext {
  readonly template: EntityTemplate | undefined;
  /** Current page context; commands only run while one exists. */
  page(): PageContext;
  print(text: string, kind?: LogKind): void;
  add(geometry: EntityGeometry[]): Entity[] | null;
  remove(ids: string[]): void;
  setLastPoint(p: Vec2 | null): void;
  readonly host: EngineHost;
}

export interface CommandDef {
  name: string;
  aliases: string[];
  description: string;
  /** Requires an open document/page. */
  needsPage: boolean;
  /** Creates an undo group for everything the command commits. */
  undoable: boolean;
  run(ctx: CommandContext): CommandGen;
}

export type LogKind = "command" | "echo" | "info" | "result" | "error";

export interface LogLine {
  id: number;
  kind: LogKind;
  text: string;
}

export interface EngineSnapshot {
  activeCommand: string | null;
  prompt: string;
  keywords: Keyword[];
  defaultHint: string | null;
  buffer: string;
  requestKind: "point" | "value" | null;
  ortho: boolean;
  log: readonly LogLine[];
}
