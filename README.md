# Markup Studio: Phase 1

A Tauri v2 desktop app for PDF markup, quantity takeoff and 2D drafting, with an AutoCAD-style command line and Bluebeam-style tool chests.

## Run

```bash
npm install          # also copies pdf.js cmaps/fonts/wasm into public/pdfjs
npm run tauri dev    # desktop app
npm test             # core math + CLI engine tests (headless)
cd src-tauri && cargo test   # Rust sidecar/tool-chest tests
```

Requires Rust ≥ 1.77 and the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

## Directory structure

```
src-tauri/
  src/lib.rs           Tauri builder, plugin + command registration
  src/bpx.rs           stat_pdf, read_pdf (raw binary IPC), load_bpx, save_bpx (atomic + .bak)
  src/toolchest.rs     load/save tool chests in the OS app-config dir
  src/fsutil.rs        atomic_write, run_blocking, extension checks
  src/error.rs         AppError → string over IPC
  capabilities/        dialog + window permissions only (file I/O goes through own commands)
src/
  core/                pure TypeScript, no React/Tauri imports
    schema.ts          .bpx v1 schema: entities, layers, calibration, tool-chest presets
    geometry.ts        Vec2, Rect, Affine (canvas-compatible) matrix math, zoomAt, fitRect
    coords.ts          WORLD↔REAL (Y-flip, separate X/Y scale), @x,y / @d<a parsing
    units.ts           mm/cm/m/in/ft-in parsing & formatting (10'-6 1/2"), scale ratios
    revcloud.ts        outward-bulging scallop arcs
    history.ts         invertible ops (insert/delete/update/calibrate/batch)
    validate.ts        runtime validation of .bpx + tool-chest JSON
    defaults.ts        default layers, Structural/Architectural/My Tools presets
  cli/                 command engine (generator-based) + LINE/REVCLOUD/DIST/CAL/ZOOM/UNITS/UNDO/REDO
  store/               Zustand: workspace (tabs, per-tab undo/redo), tool chests, cursor
  viewport/            dual canvas: pdfLayer (base + detail bitmaps), vectorRenderer, Viewport.tsx
  components/          TopBar/tabs, ToolChestPanel, InspectorPanel, MarkupList, CommandBar, StatusBar
  hooks/useGlobalKeyboard.ts   type-anywhere command capture
```

## Coordinate model

- **World**: PDF points of the rendered page, with the origin at top-left and +Y pointing down. All entities are stored this way, so markups never drift when you recalibrate.
- **Real**: millimetres, with the origin at the bottom-left of the page, +Y pointing up and angles measured CCW from +X (AutoCAD convention). The page calibration supplies `mmPerPtX` and `mmPerPtY`, which can differ.
- **Screen**: world × view matrix. The PDF canvas and the vector canvas share that same matrix.

## Command line (Phase 1)

Typing goes to the command line from anywhere. Enter, Space or a right-click confirms. Enter on an empty line repeats the last command. Esc cancels.

| Command | Alias | Notes |
|---|---|---|
| LINE | L | Segments; `U` undoes the last one, `C` closes. The whole command is one undo step. |
| REVCLOUD | REV | Polygonal: click points, then Enter or click the first point to close. `R` = rectangular, `A` = arc length (paper mm). |
| DIST | DI | Reports distance, angle, ΔX and ΔY, and keeps a length markup. |
| CALIBRATE | CAL | Pick 2 points and type a real length (`1000`, `3.5m`, `10'-6"`). `R` = ratio (`1:50`, `1/4"=1'-0"`), `X`/`Y` = one axis, `Clear`. |
| ZOOM | Z | `E` extents (default), `I`/`O`, `2x`. |
| UNITS | UN | MM / CM / M / IN / FT. |
| UNDO / REDO | U | Also Ctrl+Z / Ctrl+Y. |

**Point input**: you can click, type `x,y`, `@dx,dy`, `@dist<angle` or `dist<angle`, or type a bare distance to go that far toward the cursor (direct distance entry).

**Navigation**: middle-drag pans, the wheel zooms to the cursor, and a double middle-click or Home zooms to extents. PgUp/PgDn change pages.

**F8** toggles Ortho. **Ctrl+O / S / W / Tab** open, save, close and switch tabs.

Space confirms input, as in AutoCAD, so type fractional inches as `6-1/2"` rather than `6 1/2"`.

## Phase 2 (not yet implemented, awaiting review)

- Object snaps (F3) with an R-tree spatial index, and grid (F7).
- Parametric structural and architectural symbols with angle-aware placement.
- PL, REC, C, LEADER; the modify commands; AREA and CNT.
- Markups List sorting, filtering and CSV export; flattened or interactive PDF export.
- Synchronized split view.
