import { DEFAULT_ARC_LENGTH_PT } from "./revcloud";
import {
  BPX_FORMAT,
  BPX_VERSION,
  type BpxDocument,
  type EntityTemplate,
  type Layer,
  type MarkupStyle,
  type PdfFingerprint,
  TOOLCHEST_FORMAT,
  TOOLCHEST_VERSION,
  type ToolChestFile,
  type ToolChestSet,
  type ToolPreset,
} from "./schema";
import type { DisplayUnit } from "./units";

export const LAYER_MARKUP = "layer-markup";
export const LAYER_STRUCTURAL = "layer-s-struct";
export const LAYER_ARCHITECTURAL = "layer-a-arch";
export const LAYER_MEASURE = "layer-measure";
export const LAYER_REVISIONS = "layer-revisions";

export function defaultLayers(): Layer[] {
  return [
    { id: LAYER_MARKUP, name: "Markups", color: "#ff3b30", visible: true, locked: false, printable: true },
    { id: LAYER_STRUCTURAL, name: "S-Structural", color: "#3b9eff", visible: true, locked: false, printable: true },
    { id: LAYER_ARCHITECTURAL, name: "A-Architectural", color: "#34c759", visible: true, locked: false, printable: true },
    { id: LAYER_MEASURE, name: "Measurements", color: "#ff9f0a", visible: true, locked: false, printable: true },
    { id: LAYER_REVISIONS, name: "Revisions", color: "#ff2d55", visible: true, locked: false, printable: true },
  ];
}

export function defaultStyle(color: string): MarkupStyle {
  return {
    stroke: { color, width: 1, opacity: 1, dash: [] },
    fill: { color: null, opacity: 0 },
    fontSize: 9,
  };
}

/** Merges an EntityTemplate's partial style over a base style. */
export function mergeStyle(base: MarkupStyle, template?: EntityTemplate["style"]): MarkupStyle {
  if (!template) return base;
  return {
    stroke: { ...base.stroke, ...template.stroke },
    fill: { ...base.fill, ...template.fill },
    fontSize: template.fontSize ?? base.fontSize,
  };
}

export function createEmptyDocument(pdf: PdfFingerprint, displayUnit: DisplayUnit = "mm"): BpxDocument {
  return {
    format: BPX_FORMAT,
    version: BPX_VERSION,
    pdf,
    displayUnit,
    pages: {},
    layers: defaultLayers(),
    activeLayerId: LAYER_MARKUP,
    entities: [],
    counters: { nextEntitySeq: 1 },
  };
}

// ---------------------------------------------------------------------------
// Default Tool Chests (Phase 1 presets; Phase 2 adds parametric symbols)
// ---------------------------------------------------------------------------

const preset = (p: ToolPreset): ToolPreset => p;

export const BUILTIN_STRUCTURAL: ToolPreset[] = [
  preset({
    id: "s-beam-line",
    name: "Beam Line",
    description: "Blue 1.5 pt line on S-Structural",
    icon: "minus",
    command: "LINE",
    template: { subject: "Beam", layerId: LAYER_STRUCTURAL, style: { stroke: { color: "#3b9eff", width: 1.5 } } },
  }),
  preset({
    id: "s-hidden-line",
    name: "Hidden / Below",
    description: "Dashed line for elements below the cut plane",
    icon: "pen-line",
    command: "LINE",
    template: {
      subject: "Hidden Line",
      layerId: LAYER_STRUCTURAL,
      style: { stroke: { color: "#5ac8fa", width: 0.75, dash: [6, 3] } },
    },
  }),
  preset({
    id: "s-rev-cloud",
    name: "Structural Revision",
    description: "Revision cloud on S-Structural",
    icon: "cloud",
    command: "REVCLOUD",
    template: {
      subject: "Structural Revision",
      layerId: LAYER_STRUCTURAL,
      arcLength: DEFAULT_ARC_LENGTH_PT,
      style: { stroke: { color: "#3b9eff", width: 1 } },
    },
  }),
  preset({
    id: "s-span",
    name: "Span Check",
    description: "Distance measurement for spans and clearances",
    icon: "ruler",
    command: "DIST",
    template: { subject: "Span", layerId: LAYER_MEASURE, style: { stroke: { color: "#ff9f0a", width: 0.75 } } },
  }),
];

export const BUILTIN_ARCHITECTURAL: ToolPreset[] = [
  preset({
    id: "a-wall-line",
    name: "Wall Line",
    description: "Green 2 pt line on A-Architectural",
    icon: "minus",
    command: "LINE",
    template: { subject: "Wall", layerId: LAYER_ARCHITECTURAL, style: { stroke: { color: "#34c759", width: 2 } } },
  }),
  preset({
    id: "a-rev-cloud",
    name: "Revision Cloud",
    description: "Red revision cloud on Revisions",
    icon: "cloud",
    command: "REVCLOUD",
    template: {
      subject: "Revision Cloud",
      layerId: LAYER_REVISIONS,
      arcLength: DEFAULT_ARC_LENGTH_PT,
      style: { stroke: { color: "#ff2d55", width: 1.25 } },
    },
  }),
  preset({
    id: "a-clearance",
    name: "Clearance Dim",
    description: "Distance measurement for door/egress clearances",
    icon: "ruler",
    command: "DIST",
    template: { subject: "Clearance", layerId: LAYER_MEASURE, style: { stroke: { color: "#ff9f0a", width: 0.75 } } },
  }),
];

export function defaultToolChests(): ToolChestFile {
  const sets: ToolChestSet[] = [
    { id: "recent", name: "Recent Tools", kind: "recent", collapsed: false, builtIn: true, presets: [] },
    {
      id: "my-tools",
      name: "My Tools",
      kind: "my-tools",
      collapsed: false,
      builtIn: true,
      presets: [
        preset({
          id: "my-red-line",
          name: "Markup Line",
          description: "Red 1 pt line on Markups",
          icon: "minus",
          command: "LINE",
          template: { subject: "Line", layerId: LAYER_MARKUP, style: { stroke: { color: "#ff3b30", width: 1 } } },
        }),
        preset({
          id: "my-distance",
          name: "Length",
          description: "Linear distance measurement",
          icon: "ruler",
          command: "DIST",
          template: { subject: "Length Measurement", layerId: LAYER_MEASURE },
        }),
      ],
    },
    { id: "structural", name: "Structural", kind: "structural", collapsed: false, builtIn: true, presets: BUILTIN_STRUCTURAL },
    {
      id: "architectural",
      name: "Architectural",
      kind: "architectural",
      collapsed: false,
      builtIn: true,
      presets: BUILTIN_ARCHITECTURAL,
    },
  ];
  return { format: TOOLCHEST_FORMAT, version: TOOLCHEST_VERSION, sets };
}

export const RECENT_TOOLS_LIMIT = 8;
