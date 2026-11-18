// Copies pdf.js runtime assets (CMaps, standard fonts, WASM decoders, ICC profiles)
// into public/pdfjs so they ship inside the Tauri bundle and load without network access.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const target = join(process.cwd(), "public", "pdfjs");

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  const src = join(pdfjsRoot, dir);
  if (existsSync(src)) {
    cpSync(src, join(target, dir), { recursive: true });
    console.log(`[pdfjs-assets] copied ${dir}`);
  } else {
    console.warn(`[pdfjs-assets] ${dir} not present in pdfjs-dist; skipping`);
  }
}
