/**
 * Runtime validation for JSON loaded from disk. Rust checks the envelope; this checks
 * every entity/layer and drops (with a warning) anything malformed rather than refusing
 * to open the whole drawing.
 */

import { type Vec2 } from "./geometry";
import { DEFAULT_ARC_LENGTH_PT } from "./revcloud";
import { defaultLayers, defaultStyle, defaultToolChests } from "./defaults";
import {
  BPX_FORMAT,
  BPX_VERSION,
  type BpxDocument,
  type Calibration,
  type Entity,
  type Layer,
  type MarkupStatus,
  type MarkupStyle,
  type PageState,
  TOOLCHEST_FORMAT,
  type ToolChestFile,
  type ToolChestSet,
  type ToolPreset,
} from "./schema";
import { DISPLAY_UNITS, type DisplayUnit } from "./units";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isVec = (v: unknown): v is Vec2 => isObj(v) && isNum(v.x) && isNum(v.y);
const str = (v: unknown, fallback: string) => (isStr(v) ? v : fallback);
const STATUSES: readonly MarkupStatus[] = ["none", "open", "accepted", "rejected", "completed"];

export interface ValidationResult<T> {
  value: T;
  warnings: string[];
}

function readStyle(v: unknown, fallbackColor: string): MarkupStyle {
  const base = defaultStyle(fallbackColor);
  if (!isObj(v)) return base;
  const stroke = isObj(v.stroke) ? v.stroke : {};
  const fill = isObj(v.fill) ? v.fill : {};
  return {
    stroke: {
      color: str(stroke.color, base.stroke.color),
      width: isNum(stroke.width) && stroke.width >= 0 ? stroke.width : base.stroke.width,
      opacity: isNum(stroke.opacity) ? Math.min(1, Math.max(0, stroke.opacity)) : 1,
      dash: Array.isArray(stroke.dash) && stroke.dash.every(isNum) ? (stroke.dash as number[]) : [],
    },
    fill: {
      color: isStr(fill.color) ? fill.color : null,
      opacity: isNum(fill.opacity) ? Math.min(1, Math.max(0, fill.opacity)) : 0,
    },
    fontSize: isNum(v.fontSize) && v.fontSize > 0 ? v.fontSize : base.fontSize,
  };
}

function readEntity(v: unknown, layerIds: Set<string>, fallbackLayer: string): Entity | string {
  if (!isObj(v)) return "entity is not an object";
  if (!isStr(v.id) || v.id === "") return "entity has no id";
  if (!isNum(v.pageIndex) || v.pageIndex < 0) return `entity ${v.id}: invalid pageIndex`;
  const now = new Date(0).toISOString();
  const base = {
    id: v.id,
    seq: isNum(v.seq) ? v.seq : 0,
    pageIndex: Math.floor(v.pageIndex),
    layerId: isStr(v.layerId) && layerIds.has(v.layerId) ? v.layerId : fallbackLayer,
    subject: str(v.subject, ""),
    label: str(v.label, ""),
    status: STATUSES.includes(v.status as MarkupStatus) ? (v.status as MarkupStatus) : "none",
    author: str(v.author, ""),
    createdAt: str(v.createdAt, now),
    modifiedAt: str(v.modifiedAt, now),
    style: readStyle(v.style, "#ff3b30"),
  };
  switch (v.type) {
    case "line":
    case "measure-length":
      if (!isVec(v.a) || !isVec(v.b)) return `entity ${v.id}: missing endpoints`;
      return { ...base, type: v.type, a: { x: v.a.x, y: v.a.y }, b: { x: v.b.x, y: v.b.y } };
    case "revcloud":
      if (!Array.isArray(v.points) || v.points.length < 3 || !v.points.every(isVec)) {
        return `entity ${v.id}: revision cloud needs ≥3 points`;
      }
      return {
        ...base,
        type: "revcloud",
        points: (v.points as Vec2[]).map((p) => ({ x: p.x, y: p.y })),
        arcLength: isNum(v.arcLength) && v.arcLength > 0 ? v.arcLength : DEFAULT_ARC_LENGTH_PT,
      };
    default:
      return `entity ${v.id}: unknown type "${String(v.type)}" (newer app version?)`;
  }
}

function readCalibration(v: unknown): Calibration | null {
  if (!isObj(v) || !isNum(v.mmPerPtX) || !isNum(v.mmPerPtY) || v.mmPerPtX <= 0 || v.mmPerPtY <= 0) return null;
  const src = isObj(v.source) ? v.source : {};
  const source: Calibration["source"] =
    src.kind === "ratio" && isNum(src.ratio)
      ? { kind: "ratio", ratio: src.ratio, text: str(src.text, `1:${src.ratio}`) }
      : {
          kind: "measured",
          axis: src.axis === "x" || src.axis === "y" ? src.axis : "both",
          realMm: isNum(src.realMm) ? src.realMm : 0,
          pickedPt: isNum(src.pickedPt) ? src.pickedPt : 0,
        };
  return { mmPerPtX: v.mmPerPtX, mmPerPtY: v.mmPerPtY, source };
}

export function validateBpx(raw: unknown): ValidationResult<BpxDocument> {
  const warnings: string[] = [];
  if (!isObj(raw) || raw.format !== BPX_FORMAT) throw new Error("Not a .bpx document");
  if (raw.version !== BPX_VERSION) throw new Error(`Unsupported .bpx version ${String(raw.version)}`);

  const pdf = isObj(raw.pdf) ? raw.pdf : {};
  const layersRaw = Array.isArray(raw.layers) ? raw.layers : [];
  const layers: Layer[] = [];
  for (const l of layersRaw) {
    if (!isObj(l) || !isStr(l.id) || layers.some((x) => x.id === l.id)) {
      warnings.push("Dropped an invalid or duplicate layer");
      continue;
    }
    layers.push({
      id: l.id,
      name: str(l.name, l.id),
      color: str(l.color, "#ffffff"),
      visible: l.visible !== false,
      locked: l.locked === true,
      printable: l.printable !== false,
    });
  }
  if (layers.length === 0) layers.push(...defaultLayers());
  const layerIds = new Set(layers.map((l) => l.id));
  const activeLayerId = isStr(raw.activeLayerId) && layerIds.has(raw.activeLayerId) ? raw.activeLayerId : layers[0]!.id;

  const entities: Entity[] = [];
  const seen = new Set<string>();
  let maxSeq = 0;
  for (const e of Array.isArray(raw.entities) ? raw.entities : []) {
    const result = readEntity(e, layerIds, activeLayerId);
    if (typeof result === "string") {
      warnings.push(result);
      continue;
    }
    if (seen.has(result.id)) {
      warnings.push(`Duplicate entity id ${result.id} dropped`);
      continue;
    }
    seen.add(result.id);
    maxSeq = Math.max(maxSeq, result.seq);
    entities.push(result);
  }

  const pages: Record<string, PageState> = {};
  if (isObj(raw.pages)) {
    for (const [key, value] of Object.entries(raw.pages)) {
      if (!/^\d+$/.test(key) || !isObj(value)) continue;
      pages[key] = { calibration: readCalibration(value.calibration) };
    }
  }

  const counters = isObj(raw.counters) ? raw.counters : {};
  const nextSeq = isNum(counters.nextEntitySeq) ? counters.nextEntitySeq : 1;

  return {
    value: {
      format: BPX_FORMAT,
      version: BPX_VERSION,
      pdf: {
        fileName: str(pdf.fileName, ""),
        byteLength: isNum(pdf.byteLength) ? pdf.byteLength : 0,
        modifiedMs: isNum(pdf.modifiedMs) ? pdf.modifiedMs : 0,
        pageCount: isNum(pdf.pageCount) ? pdf.pageCount : 0,
      },
      displayUnit: DISPLAY_UNITS.includes(raw.displayUnit as DisplayUnit) ? (raw.displayUnit as DisplayUnit) : "mm",
      pages,
      layers,
      activeLayerId,
      entities,
      counters: { nextEntitySeq: Math.max(nextSeq, maxSeq + 1) },
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Tool chests
// ---------------------------------------------------------------------------

const PRESET_COMMANDS = ["LINE", "REVCLOUD", "DIST"] as const;
const PRESET_ICONS = ["minus", "cloud", "ruler", "pen-line", "square-dashed"] as const;

function readPreset(v: unknown): ToolPreset | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name)) return null;
  if (!PRESET_COMMANDS.includes(v.command as (typeof PRESET_COMMANDS)[number])) return null;
  return {
    id: v.id,
    name: v.name,
    description: str(v.description, ""),
    icon: PRESET_ICONS.includes(v.icon as ToolPreset["icon"]) ? (v.icon as ToolPreset["icon"]) : "minus",
    command: v.command as ToolPreset["command"],
    template: isObj(v.template) ? (v.template as ToolPreset["template"]) : {},
  };
}

/**
 * Loads a saved tool chest file, guaranteeing the built-in sets exist and that the
 * built-in Structural/Architectural presets are current (they're replaced from code so
 * upgrades ship new symbols), while user sets and My Tools are preserved verbatim.
 */
export function validateToolChests(raw: unknown): ValidationResult<ToolChestFile> {
  const defaults = defaultToolChests();
  const warnings: string[] = [];
  if (!isObj(raw) || raw.format !== TOOLCHEST_FORMAT || !Array.isArray(raw.sets)) {
    return { value: defaults, warnings: ["Tool chest file unreadable; using defaults"] };
  }
  const loaded = new Map<string, ToolChestSet>();
  for (const s of raw.sets) {
    if (!isObj(s) || !isStr(s.id) || !isStr(s.name)) {
      warnings.push("Dropped an invalid tool chest set");
      continue;
    }
    const presets = (Array.isArray(s.presets) ? s.presets : []).map(readPreset);
    if (presets.some((p) => p === null)) warnings.push(`Dropped invalid presets in "${s.name}"`);
    loaded.set(s.id, {
      id: s.id,
      name: s.name,
      kind: (["recent", "my-tools", "structural", "architectural", "custom"] as const).includes(
        s.kind as ToolChestSet["kind"],
      )
        ? (s.kind as ToolChestSet["kind"])
        : "custom",
      collapsed: s.collapsed === true,
      builtIn: false,
      presets: presets.filter((p): p is ToolPreset => p !== null),
    });
  }
  const sets: ToolChestSet[] = defaults.sets.map((d) => {
    const saved = loaded.get(d.id);
    loaded.delete(d.id);
    if (!saved) return d;
    const keepUserPresets = d.kind === "recent" || d.kind === "my-tools";
    return { ...d, collapsed: saved.collapsed, presets: keepUserPresets ? saved.presets : d.presets };
  });
  for (const custom of loaded.values()) sets.push({ ...custom, kind: "custom" });
  return { value: { ...defaults, sets }, warnings };
}
