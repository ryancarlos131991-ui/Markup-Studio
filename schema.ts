/**
 * `.bpx` sidecar schema (version 1) and Tool Chest preset schema.
 *
 * Every geometric value is stored in WORLD units (PDF points of the rendered page, +Y down),
 * so markups stay glued to the drawing regardless of calibration. Real-world quantities
 * (lengths, later areas) are derived at display/export time from the page calibration.
 */

import type { Vec2 } from "./geometry";
import type { DisplayUnit } from "./units";

export const BPX_FORMAT = "bpx" as const;
export const BPX_VERSION = 1 as const;
export const TOOLCHEST_FORMAT = "bpx-toolchest" as const;
export const TOOLCHEST_VERSION = 1 as const;

export type EntityId = string;
export type LayerId = string;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export interface StrokeStyle {
  /** CSS hex colour, e.g. "#ff3b30". */
  color: string;
  /** Line weight in points (world units). Rendered at least 1 device pixel wide. */
  width: number;
  /** 0..1 */
  opacity: number;
  /** Dash pattern in points; empty = solid. */
  dash: number[];
}

export interface FillStyle {
  color: string | null;
  opacity: number;
}

export interface MarkupStyle {
  stroke: StrokeStyle;
  fill: FillStyle;
  /** Font size in points for any label text (measurements, later callouts). */
  fontSize: number;
}

export type MarkupStatus = "none" | "open" | "accepted" | "rejected" | "completed";

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

interface EntityBase {
  id: EntityId;
  /** Human-facing sequential number shown in the Markups List (never reused). */
  seq: number;
  pageIndex: number;
  layerId: LayerId;
  subject: string;
  label: string;
  status: MarkupStatus;
  author: string;
  /** ISO-8601 timestamps. */
  createdAt: string;
  modifiedAt: string;
  style: MarkupStyle;
}

export interface LineEntity extends EntityBase {
  type: "line";
  a: Vec2;
  b: Vec2;
}

export interface RevCloudEntity extends EntityBase {
  type: "revcloud";
  /** Closed boundary polygon (≥3 vertices); the scalloped outline is derived. */
  points: Vec2[];
  /** Target chord length of each scallop, in points (paper space). */
  arcLength: number;
}

export interface MeasureLengthEntity extends EntityBase {
  type: "measure-length";
  a: Vec2;
  b: Vec2;
}

export type Entity = LineEntity | RevCloudEntity | MeasureLengthEntity;
export type EntityType = Entity["type"];
export const ENTITY_TYPES: readonly EntityType[] = ["line", "revcloud", "measure-length"];

// ---------------------------------------------------------------------------
// Layers, pages, calibration
// ---------------------------------------------------------------------------

export interface Layer {
  id: LayerId;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
  printable: boolean;
}

export type CalibrationSource =
  | { kind: "ratio"; text: string; ratio: number }
  | { kind: "measured"; axis: "both" | "x" | "y"; realMm: number; pickedPt: number };

export interface Calibration {
  /** Real millimetres represented by one PDF point along X. */
  mmPerPtX: number;
  /** Real millimetres represented by one PDF point along Y (independent X/Y scales). */
  mmPerPtY: number;
  source: CalibrationSource;
}

export interface PageState {
  calibration: Calibration | null;
}

export interface PdfFingerprint {
  fileName: string;
  byteLength: number;
  modifiedMs: number;
  pageCount: number;
}

export interface BpxDocument {
  format: typeof BPX_FORMAT;
  version: typeof BPX_VERSION;
  pdf: PdfFingerprint;
  displayUnit: DisplayUnit;
  /** Keyed by zero-based page index as a string (JSON object keys). */
  pages: Record<string, PageState>;
  layers: Layer[];
  activeLayerId: LayerId;
  /** Draw order: later entries render on top. */
  entities: Entity[];
  counters: { nextEntitySeq: number };
}

// ---------------------------------------------------------------------------
// Tool Chest
// ---------------------------------------------------------------------------

/** CLI commands a preset can launch. Extended in Phase 2 (symbols, AREA, CNT, …). */
export type PresetCommand = "LINE" | "REVCLOUD" | "DIST";

/** Properties a preset stamps onto every entity its command creates. */
export interface EntityTemplate {
  subject?: string;
  label?: string;
  layerId?: LayerId;
  style?: Partial<{ stroke: Partial<StrokeStyle>; fill: Partial<FillStyle>; fontSize: number }>;
  /** REVCLOUD only: scallop chord length in points. */
  arcLength?: number;
}

export interface ToolPreset {
  id: string;
  name: string;
  description: string;
  /** lucide-react icon name rendered in the chest. */
  icon: "minus" | "cloud" | "ruler" | "pen-line" | "square-dashed";
  command: PresetCommand;
  template: EntityTemplate;
}

export type ToolChestKind = "recent" | "my-tools" | "structural" | "architectural" | "custom";

export interface ToolChestSet {
  id: string;
  name: string;
  kind: ToolChestKind;
  collapsed: boolean;
  /** Built-in sets are restored on load and cannot be deleted. */
  builtIn: boolean;
  presets: ToolPreset[];
}

export interface ToolChestFile {
  format: typeof TOOLCHEST_FORMAT;
  version: typeof TOOLCHEST_VERSION;
  sets: ToolChestSet[];
}
