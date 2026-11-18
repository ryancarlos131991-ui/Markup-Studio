/**
 * AutoCAD-style command-line engine.
 *
 * Commands are generators that `yield` input requests (point / value / keyword) and receive
 * the user's answer. The engine owns the typed buffer, keyword matching, coordinate parsing
 * (absolute, @relative, polar, direct distance), Ortho, command repeat and cancellation.
 * It is UI-agnostic: React subscribes via `subscribe/getSnapshot`, the viewport feeds
 * cursor/picks, and all document access goes through `EngineHost`.
 */

import { parseCoordinate, pointAtRealDistance, resolveCoordinate } from "../core/coords";
import { type Vec2, orthoConstrain } from "../core/geometry";
import type { EntityTemplate } from "../core/schema";
import { parseLength } from "../core/units";
import type {
  CommandContext,
  CommandDef,
  CommandGen,
  EngineHost,
  EngineSnapshot,
  Input,
  Keyword,
  LogKind,
  LogLine,
  Preview,
  Request,
} from "./types";

const LOG_LIMIT = 300;
const TYPED_HISTORY_LIMIT = 100;
export const IDLE_PROMPT = "Command";

export function matchKeyword(text: string, keywords: readonly Keyword[] | undefined): Keyword | undefined {
  if (!keywords || keywords.length === 0) return undefined;
  const t = text.trim().toUpperCase();
  if (t === "") return undefined;
  const exact = keywords.find((k) => k.key.toUpperCase() === t);
  if (exact) return exact;
  const prefixed = keywords.filter((k) => k.label.toUpperCase().startsWith(t));
  return prefixed.length === 1 ? prefixed[0] : undefined;
}

export function formatPrompt(req: Request | null): string {
  if (!req) return `${IDLE_PROMPT}:`;
  let s = req.prompt;
  if (req.keywords && req.keywords.length) s += ` [${req.keywords.map((k) => k.label).join("/")}]`;
  const def = defaultHintOf(req);
  if (def) s += ` <${def}>`;
  return `${s}:`;
}

function defaultHintOf(req: Request): string | null {
  if (req.kind === "value" && req.defaultValue !== undefined) return req.defaultValue;
  if (req.defaultKeyword) {
    return req.keywords?.find((k) => k.key === req.defaultKeyword)?.label ?? req.defaultKeyword;
  }
  return null;
}

export class CommandRegistry {
  private readonly byToken = new Map<string, CommandDef>();
  constructor(readonly commands: readonly CommandDef[]) {
    for (const def of commands) {
      for (const token of [def.name, ...def.aliases]) {
        const key = token.toUpperCase();
        if (this.byToken.has(key)) throw new Error(`Duplicate command token ${key}`);
        this.byToken.set(key, def);
      }
    }
  }
  lookup(token: string): CommandDef | undefined {
    return this.byToken.get(token.trim().toUpperCase());
  }
}

export class CommandEngine {
  private gen: CommandGen | null = null;
  private request: Request | null = null;
  private active: CommandDef | null = null;
  private template: EntityTemplate | undefined;
  private groupOpen = false;
  private lastInvocation: { def: CommandDef; template: EntityTemplate | undefined } | null = null;

  private buffer = "";
  private log: LogLine[] = [];
  private logSeq = 0;
  private ortho = false;
  private cursor: Vec2 | null = null;
  private lastPoint: Vec2 | null = null;
  private typed: string[] = [];
  private typedCursor = -1;

  private listeners = new Set<() => void>();
  private snapshot: EngineSnapshot;

  constructor(
    private readonly host: EngineHost,
    private readonly registry: CommandRegistry,
  ) {
    this.snapshot = this.buildSnapshot();
  }

  // ----- subscription (useSyncExternalStore compatible) -------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EngineSnapshot => this.snapshot;

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const l of this.listeners) l();
  }

  private buildSnapshot(): EngineSnapshot {
    const req = this.request;
    return {
      activeCommand: this.active?.name ?? null,
      prompt: formatPrompt(req),
      keywords: req?.keywords ?? [],
      defaultHint: req ? defaultHintOf(req) : null,
      buffer: this.buffer,
      requestKind: req?.kind ?? null,
      ortho: this.ortho,
      log: this.log,
    };
  }

  // ----- state queries ------------------------------------------------------

  isActive(): boolean {
    return this.gen !== null;
  }

  getCursor(): Vec2 | null {
    return this.cursor;
  }

  /** Cursor after Ortho is applied relative to the current request's base point. */
  getEffectiveCursor(): Vec2 | null {
    if (!this.cursor) return null;
    const req = this.request;
    if (this.ortho && req?.kind === "point" && req.base) return orthoConstrain(req.base, this.cursor);
    return this.cursor;
  }

  getPreview(): Preview[] {
    const req = this.request;
    const c = this.getEffectiveCursor();
    if (!req || req.kind !== "point" || !req.preview || !c) return [];
    try {
      return req.preview(c);
    } catch (err) {
      console.error("preview failed", err);
      return [];
    }
  }

  getRequestBase(): Vec2 | null {
    return this.request?.kind === "point" ? (this.request.base ?? null) : null;
  }

  // ----- logging --------------------------------------------------------------

  print(text: string, kind: LogKind = "info"): void {
    this.log = [...this.log, { id: ++this.logSeq, kind, text }];
    if (this.log.length > LOG_LIMIT) this.log = this.log.slice(this.log.length - LOG_LIMIT);
    this.emit();
  }

  clearLog(): void {
    this.log = [];
    this.emit();
  }

  // ----- keyboard buffer ------------------------------------------------------

  typeChar(ch: string): void {
    this.buffer += ch;
    this.typedCursor = -1;
    this.emit();
  }

  typeText(text: string): void {
    this.buffer += text.replace(/[\r\n]+/g, " ");
    this.emit();
  }

  backspace(): void {
    if (this.buffer.length === 0) return;
    this.buffer = this.buffer.slice(0, -1);
    this.emit();
  }

  /** Arrow-up/down recall of previously typed inputs. */
  recall(direction: -1 | 1): void {
    if (this.typed.length === 0) return;
    if (this.typedCursor === -1) this.typedCursor = this.typed.length;
    this.typedCursor = Math.min(this.typed.length, Math.max(0, this.typedCursor + direction));
    this.buffer = this.typed[this.typedCursor] ?? "";
    this.emit();
  }

  // ----- ortho / cursor --------------------------------------------------------

  toggleOrtho(): void {
    this.ortho = !this.ortho;
    this.print(`<Ortho ${this.ortho ? "on" : "off"}>`, "info");
  }

  setCursor(world: Vec2 | null): void {
    this.cursor = world;
  }

  // ----- command lifecycle -----------------------------------------------------

  start(nameOrAlias: string, template?: EntityTemplate): boolean {
    const def = this.registry.lookup(nameOrAlias);
    if (!def) {
      this.print(`Unknown command "${nameOrAlias.toUpperCase()}".`, "error");
      return false;
    }
    if (this.gen) this.cancel();
    if (def.needsPage && !this.host.getPageContext()) {
      this.print(`${def.name}: open a PDF first (Ctrl+O).`, "error");
      return false;
    }
    this.lastInvocation = { def, template };
    this.active = def;
    this.template = template;
    this.print(`${IDLE_PROMPT}: ${def.name}`, "command");
    if (def.undoable) {
      this.host.beginGroup(def.name);
      this.groupOpen = true;
    }
    this.gen = def.run(this.makeContext());
    this.advance(undefined);
    return true;
  }

  cancel(): void {
    if (!this.gen) {
      if (this.buffer) {
        this.buffer = "";
        this.emit();
      }
      return;
    }
    const gen = this.gen;
    this.gen = null; // prevent re-entrancy from finally blocks
    try {
      gen.return(undefined);
    } catch (err) {
      console.error(err);
    }
    this.print("*Cancel*", "info");
    this.finish();
  }

  /** Called when the active tab/page changes: in-flight commands can't span pages. */
  resetContext(): void {
    if (this.gen) this.cancel();
    this.lastPoint = null;
    this.cursor = null;
    this.emit();
  }

  submit(): void {
    const text = this.buffer.trim();
    this.buffer = "";
    if (text) {
      if (this.typed[this.typed.length - 1] !== text) this.typed.push(text);
      if (this.typed.length > TYPED_HISTORY_LIMIT) this.typed.shift();
    }
    this.typedCursor = -1;

    if (!this.gen) {
      if (text === "") {
        if (this.lastInvocation) this.start(this.lastInvocation.def.name, this.lastInvocation.template);
        else this.emit();
        return;
      }
      this.start(text);
      return;
    }

    const req = this.request!;
    this.print(`${formatPrompt(req)} ${text}`, "echo");

    if (text === "") {
      if (req.kind === "value" && req.defaultValue !== undefined) this.advance({ type: "value", text: req.defaultValue });
      else if (req.defaultKeyword) this.advance({ type: "keyword", key: req.defaultKeyword });
      else if (req.allowNone) this.advance({ type: "none" });
      else this.emit();
      return;
    }

    const kw = matchKeyword(text, req.keywords);
    if (kw) {
      this.advance({ type: "keyword", key: kw.key });
      return;
    }

    if (req.kind === "point") {
      const result = this.resolvePointText(text, req.base);
      if (typeof result === "string") {
        this.print(result, "error");
        this.emit();
        return;
      }
      this.acceptPoint(result);
      return;
    }
    this.advance({ type: "value", text });
  }

  /** Clicked keyword in the command bar. */
  chooseKeyword(key: string): void {
    const req = this.request;
    if (!req || !req.keywords?.some((k) => k.key === key)) return;
    this.print(`${formatPrompt(req)} ${key}`, "echo");
    this.buffer = "";
    this.advance({ type: "keyword", key });
  }

  /** Left click in the viewport (world coordinates, before Ortho). */
  pick(world: Vec2): void {
    const req = this.request;
    if (!req || req.kind !== "point") return;
    const p = this.ortho && req.base ? orthoConstrain(req.base, world) : world;
    this.buffer = "";
    this.acceptPoint(p);
  }

  private acceptPoint(p: Vec2): void {
    this.lastPoint = p;
    this.advance({ type: "point", p });
  }

  private resolvePointText(text: string, base: Vec2 | undefined): Vec2 | string {
    const pc = this.host.getPageContext();
    if (!pc) return "No page is open.";
    const coord = parseCoordinate(text, pc.unit);
    if (coord) {
      const p = resolveCoordinate(coord, this.lastPoint, pc.frame);
      return p ?? "No last point yet: relative (@) input needs a previous point.";
    }
    const len = parseLength(text, pc.unit);
    if (len !== null) {
      if (!base) return "Point or option keyword required.";
      if (!this.cursor) return "Move the cursor to show the direction, then type the distance.";
      const toward = this.ortho ? orthoConstrain(base, this.cursor) : this.cursor;
      return pointAtRealDistance(base, toward, len, pc.frame) ?? "Cursor is on the base point; no direction.";
    }
    return "Point or option keyword required.";
  }

  private advance(input: Input | undefined): void {
    const gen = this.gen;
    if (!gen) return;
    let res: IteratorResult<Request, void>;
    try {
      res = input === undefined ? gen.next(undefined as unknown as Input) : gen.next(input);
    } catch (err) {
      this.print(`${this.active?.name ?? "Command"} failed: ${err instanceof Error ? err.message : String(err)}`, "error");
      this.gen = null;
      this.finish();
      return;
    }
    if (this.gen !== gen) return; // command was cancelled/replaced re-entrantly
    if (res.done) {
      this.gen = null;
      this.finish();
      return;
    }
    this.request = res.value;
    this.emit();
  }

  private finish(): void {
    if (this.groupOpen) {
      this.groupOpen = false;
      this.host.endGroup();
    }
    this.gen = null;
    this.request = null;
    this.active = null;
    this.template = undefined;
    this.emit();
  }

  private makeContext(): CommandContext {
    const engine = this;
    return {
      get template() {
        return engine.template;
      },
      host: this.host,
      page() {
        const pc = engine.host.getPageContext();
        if (!pc) throw new Error("No page is open.");
        return pc;
      },
      print: (text, kind) => engine.print(text, kind ?? "result"),
      add(geometry) {
        const r = engine.host.addEntities(geometry, engine.template);
        if (!r.ok) {
          engine.print(r.error, "error");
          return null;
        }
        return r.entities;
      },
      remove(ids) {
        engine.host.removeEntities(ids);
      },
      setLastPoint(p) {
        engine.lastPoint = p;
      },
    };
  }
}
