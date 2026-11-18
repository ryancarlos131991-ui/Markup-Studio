/**
 * Real-world length parsing/formatting. Internally all real lengths are millimetres.
 *
 * Accepted input (case-insensitive, whitespace tolerant):
 *   1000          → bare number in the document's display unit (inches when ft-in)
 *   1000mm 45cm 1.2m 18in 12ft
 *   10'-6"  10'6"  10'-6 1/2"  10'  -3'-2"  6"  6 1/2"  1/2"
 */

export type DisplayUnit = "mm" | "cm" | "m" | "in" | "ft-in";

export const DISPLAY_UNITS: readonly DisplayUnit[] = ["mm", "cm", "m", "in", "ft-in"];

export const MM_PER: Readonly<Record<"mm" | "cm" | "m" | "in" | "ft", number>> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
};

/** One PDF point (1/72 inch) in millimetres. */
export const MM_PER_PT = 25.4 / 72;

const NUM = String.raw`\d+(?:\.\d+)?|\.\d+`;

function bareUnitMm(unit: DisplayUnit): number {
  switch (unit) {
    case "mm":
      return MM_PER.mm;
    case "cm":
      return MM_PER.cm;
    case "m":
      return MM_PER.m;
    case "in":
    case "ft-in":
      return MM_PER.in;
  }
}

/** Parses "6", "6 1/2", "6-1/2", "1/2", "6.25" (optionally followed by `"` or `in`) → inches. */
function parseInchBody(raw: string): number | null {
  const s = raw.trim().replace(/(?:"|in)$/, "").trim();
  if (s === "") return 0;
  const m = new RegExp(String.raw`^(?:(${NUM})(?:\s+|-)?)?(?:(\d+)\/(\d+))?$`).exec(s);
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  const whole = m[1] !== undefined ? parseFloat(m[1]) : 0;
  let frac = 0;
  if (m[2] !== undefined && m[3] !== undefined) {
    const den = parseInt(m[3], 10);
    if (den === 0) return null;
    frac = parseInt(m[2], 10) / den;
  }
  return whole + frac;
}

/** Returns millimetres, or null if `raw` is not a length. */
export function parseLength(raw: string, defaultUnit: DisplayUnit): number | null {
  let s = raw.trim().toLowerCase().replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  if (s === "") return null;
  let sign = 1;
  if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }

  // Feet and inches: 10'-6 1/2"
  const ftIdx = s.indexOf("'");
  if (ftIdx >= 0) {
    const ftStr = s.slice(0, ftIdx).trim();
    if (!new RegExp(`^(?:${NUM})$`).test(ftStr)) return null;
    let rest = s.slice(ftIdx + 1).trim();
    if (rest.startsWith("-")) rest = rest.slice(1).trim();
    const inches = parseInchBody(rest);
    if (inches === null) return null;
    return sign * (parseFloat(ftStr) * 12 + inches) * MM_PER.in;
  }

  // Explicit inches with fraction: 6 1/2"  or  1/2"
  const hasInchMark = s.endsWith('"');
  const hasFraction = /\d\/\d/.test(s.replace(/\s+/g, ""));
  if (hasInchMark || hasFraction) {
    const value = parseInchBody(s);
    if (value === null) return null;
    const explicitInches = hasInchMark || s.endsWith("in");
    return sign * value * (explicitInches ? MM_PER.in : bareUnitMm(defaultUnit));
  }

  const m = new RegExp(String.raw`^(${NUM})(?:e([-+]?\d+))?\s*(mm|cm|m|in|ft)?$`).exec(s);
  if (!m) return null;
  let value = parseFloat(m[1]!);
  if (m[2] !== undefined) value *= Math.pow(10, parseInt(m[2], 10));
  const unit = m[3] as keyof typeof MM_PER | undefined;
  const factor = unit ? MM_PER[unit] : bareUnitMm(defaultUnit);
  return sign * value * factor;
}

/**
 * Parses a drawing scale into a real/paper ratio.
 *   "1:50" → 50    "1 : 100" → 100    "2:1" → 0.5
 *   '1/4"=1\'-0"' → 48   "1in = 10ft" → 120   "10mm=1m" → 100
 */
export function parseScaleRatio(raw: string): number | null {
  const s = raw.trim();
  const ratio = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(s);
  if (ratio) {
    const paper = parseFloat(ratio[1]!);
    const real = parseFloat(ratio[2]!);
    return paper > 0 && real > 0 ? real / paper : null;
  }
  const eq = s.indexOf("=");
  if (eq > 0) {
    const paper = parseLength(s.slice(0, eq), "in");
    const real = parseLength(s.slice(eq + 1), "ft-in");
    if (paper !== null && real !== null && paper > 0 && real > 0) return real / paper;
  }
  return null;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Formats inches to the nearest 1/`denominator` as 10'-6 1/2". */
export function formatFeetInches(mm: number, denominator = 16): string {
  const sign = mm < 0 ? "-" : "";
  const totalUnits = Math.round((Math.abs(mm) / MM_PER.in) * denominator);
  const feet = Math.floor(totalUnits / (12 * denominator));
  const remUnits = totalUnits - feet * 12 * denominator;
  const wholeIn = Math.floor(remUnits / denominator);
  const fracUnits = remUnits - wholeIn * denominator;
  let inches = `${wholeIn}`;
  if (fracUnits > 0) {
    const g = gcd(fracUnits, denominator);
    inches = `${wholeIn} ${fracUnits / g}/${denominator / g}`;
  }
  return `${sign}${feet}'-${inches}"`;
}

export function formatLength(mm: number, unit: DisplayUnit, precision?: number): string {
  switch (unit) {
    case "mm":
      return `${(mm).toFixed(precision ?? 0)} mm`;
    case "cm":
      return `${(mm / MM_PER.cm).toFixed(precision ?? 1)} cm`;
    case "m":
      return `${(mm / MM_PER.m).toFixed(precision ?? 3)} m`;
    case "in":
      return `${(mm / MM_PER.in).toFixed(precision ?? 2)}"`;
    case "ft-in":
      return formatFeetInches(mm);
  }
}

/** Short numeric value (no unit suffix) for coordinate readouts. */
export function formatCoordinate(mm: number, unit: DisplayUnit): string {
  switch (unit) {
    case "mm":
      return mm.toFixed(0);
    case "cm":
      return (mm / MM_PER.cm).toFixed(1);
    case "m":
      return (mm / MM_PER.m).toFixed(3);
    case "in":
      return (mm / MM_PER.in).toFixed(2);
    case "ft-in":
      return formatFeetInches(mm);
  }
}

export function unitLabel(unit: DisplayUnit): string {
  switch (unit) {
    case "mm":
      return "Millimetres";
    case "cm":
      return "Centimetres";
    case "m":
      return "Metres";
    case "in":
      return "Inches";
    case "ft-in":
      return "Feet & inches";
  }
}
