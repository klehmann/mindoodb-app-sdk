/**
 * Handwriting ("ink") stored next to text: the `MindooInk` format, its compact
 * point encoding, a hash that ties a recognition to exactly these strokes, and
 * a small SVG renderer for apps that do not draw ink themselves.
 *
 * The text a person wrote belongs in the document's normal field (`title`);
 * the ink is the original and lives in a companion field (`titleInk`), stored
 * with `MindooDBAppValue.atomic()` so it is written and replaced as a whole.
 *
 * @module ink
 */

/** One sampled point. `x`/`y` in CSS pixels of the writing area, `t` in ms since writing began, `pressure` 0..1. */
export interface MindooInkPoint {
  x: number;
  y: number;
  t?: number;
  pressure?: number;
}

/** A stroke as stored: style plus the points encoded with {@link encodeInkPoints}. */
export interface MindooInkStroke {
  id: string;
  /** CSS color, e.g. `#1f2937`. */
  color: string;
  /** Line width in CSS pixels of the writing area. */
  width: number;
  tool?: "pen" | "marker";
  /** Encoded points, see {@link encodeInkPoints}. */
  pts: string;
}

/** What a recognition found for this ink. */
export interface MindooInkRecognition {
  status: "recognized" | "pending" | "failed";
  /** Best candidate as recognized (not the field text the person may have corrected). */
  text?: string;
  alternatives?: string[];
  /** BCP 47 language tag, e.g. `de-DE`. */
  lang: string;
  /** e.g. `mlkit-digitalink`. */
  engine: string;
  /** ISO time of the recognition. */
  at: string;
  /** {@link computeInkHash} of the strokes it was made for; a recognition with another hash is stale. */
  inkHash: string;
}

/** Handwriting, version 1. Coordinates refer to `area`, in CSS pixels at writing time. */
export interface MindooInk {
  v: 1;
  area: { w: number; h: number };
  strokes: MindooInkStroke[];
  /** Absent until something was recognized. */
  recognition?: MindooInkRecognition;
  /** True once the person confirmed or changed the field text: a later recognition must not overwrite it. */
  textConfirmed?: boolean;
}

/** A stroke before encoding, e.g. from pointer events. */
export interface MindooInkStrokeInput {
  id?: string;
  color?: string;
  width?: number;
  tool?: "pen" | "marker";
  points: MindooInkPoint[];
}

/**
 * Above this many bytes of JSON, keep the ink in an attachment (`ink-<field>.json`)
 * and only a reference in the companion field.
 */
export const MINDOO_INK_INLINE_MAX_BYTES = 32 * 1024;

const FLAG_TIME = 1;
const FLAG_PRESSURE = 2;
const FORMAT_VERSION = 1;
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64UrlEncode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]!;
  }
  return out;
}

function base64UrlDecode(text: string): Uint8Array {
  const clean = text.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of clean) {
    const value = B64.indexOf(char === "+" ? "-" : char === "/" ? "_" : char);
    if (value < 0) throw new Error(`Invalid character in encoded ink points: "${char}"`);
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, index);
}

function pushVarint(out: number[], value: number) {
  // Zigzag, then 7 bits per byte. Uses arithmetic so values beyond 31 bits stay exact.
  let n = value >= 0 ? value * 2 : -value * 2 - 1;
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
}

function readVarint(bytes: Uint8Array, cursor: { at: number }): number {
  let result = 0;
  let factor = 1;
  for (;;) {
    if (cursor.at >= bytes.length) throw new Error("Encoded ink points end in the middle of a value.");
    const byte = bytes[cursor.at++]!;
    result += (byte & 0x7f) * factor;
    if (byte < 0x80) break;
    factor *= 0x80;
  }
  return result % 2 === 0 ? result / 2 : -(result + 1) / 2;
}

/**
 * Encodes a stroke's points compactly: x/y at 0.1 px, time in whole ms,
 * pressure in 1/255, each as the difference to the previous point (zigzag
 * varint), base64url. Time and pressure are kept only when every point has
 * them. Roughly 3–5 bytes per point instead of ~40 as JSON.
 */
export function encodeInkPoints(points: readonly MindooInkPoint[]): string {
  const hasTime = points.length > 0 && points.every((point) => Number.isFinite(point.t));
  const hasPressure = points.length > 0 && points.every((point) => Number.isFinite(point.pressure));
  const out: number[] = [FORMAT_VERSION, (hasTime ? FLAG_TIME : 0) | (hasPressure ? FLAG_PRESSURE : 0)];
  let px = 0;
  let py = 0;
  let pt = 0;
  let pp = 0;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("Ink points need finite x and y.");
    const x = Math.round(point.x * 10);
    const y = Math.round(point.y * 10);
    pushVarint(out, x - px);
    pushVarint(out, y - py);
    px = x;
    py = y;
    if (hasTime) {
      const t = Math.round(point.t!);
      pushVarint(out, t - pt);
      pt = t;
    }
    if (hasPressure) {
      const p = Math.round(Math.min(1, Math.max(0, point.pressure!)) * 255);
      pushVarint(out, p - pp);
      pp = p;
    }
  }
  return base64UrlEncode(Uint8Array.from(out));
}

/** Reverses {@link encodeInkPoints}. Throws on input that is not encoded ink. */
export function decodeInkPoints(encoded: string): MindooInkPoint[] {
  const bytes = base64UrlDecode(encoded);
  if (bytes.length < 2) return [];
  if (bytes[0] !== FORMAT_VERSION) throw new Error(`Unknown ink point format ${bytes[0]}.`);
  const hasTime = (bytes[1]! & FLAG_TIME) !== 0;
  const hasPressure = (bytes[1]! & FLAG_PRESSURE) !== 0;
  const cursor = { at: 2 };
  const points: MindooInkPoint[] = [];
  let x = 0;
  let y = 0;
  let t = 0;
  let p = 0;
  while (cursor.at < bytes.length) {
    x += readVarint(bytes, cursor);
    y += readVarint(bytes, cursor);
    const point: MindooInkPoint = { x: x / 10, y: y / 10 };
    if (hasTime) {
      t += readVarint(bytes, cursor);
      point.t = t;
    }
    if (hasPressure) {
      p += readVarint(bytes, cursor);
      point.pressure = Math.round((p / 255) * 1000) / 1000;
    }
    points.push(point);
  }
  return points;
}

let strokeCounter = 0;

function strokeId(): string {
  strokeCounter = (strokeCounter + 1) % 1_000_000;
  return `s${Date.now().toString(36)}${strokeCounter.toString(36)}`;
}

/**
 * Builds a `MindooInk` from raw strokes. Times are made relative to the first
 * point of the first stroke, so `t` reads "ms since writing began".
 */
export function createMindooInk(input: {
  area: { w: number; h: number };
  strokes: readonly MindooInkStrokeInput[];
  color?: string;
  width?: number;
}): MindooInk {
  const start = input.strokes.flatMap((stroke) => stroke.points).find((point) => Number.isFinite(point.t))?.t ?? 0;
  return {
    v: 1,
    area: { w: Math.max(1, Math.round(input.area.w)), h: Math.max(1, Math.round(input.area.h)) },
    strokes: input.strokes
      .filter((stroke) => stroke.points.length > 0)
      .map((stroke) => ({
        id: stroke.id ?? strokeId(),
        color: stroke.color ?? input.color ?? "#1f2937",
        width: stroke.width ?? input.width ?? 2,
        ...(stroke.tool ? { tool: stroke.tool } : {}),
        pts: encodeInkPoints(
          stroke.points.map((point) => (Number.isFinite(point.t) ? { ...point, t: point.t! - start } : point)),
        ),
      })),
  };
}

/** The ink's strokes as point lists, ready for `session.ink.recognize({ strokes })`. */
export function inkStrokePoints(ink: Pick<MindooInk, "strokes">): MindooInkPoint[][] {
  return ink.strokes.map((stroke) => decodeInkPoints(stroke.pts));
}

/**
 * Hash over the strokes' geometry (their encoded points, in order), so a
 * recognition can be checked against the ink it was made for. Color, width
 * and ids do not change it. `sha256-<base64url>`.
 */
export async function computeInkHash(ink: Pick<MindooInk, "strokes"> | readonly MindooInkStroke[]): Promise<string> {
  const strokes = Array.isArray(ink) ? (ink as readonly MindooInkStroke[]) : (ink as Pick<MindooInk, "strokes">).strokes;
  const data = new TextEncoder().encode(strokes.map((stroke) => stroke.pts).join("\n"));
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("computeInkHash needs Web Crypto (crypto.subtle).");
  const digest = await subtle.digest("SHA-256", data);
  return `sha256-${base64UrlEncode(new Uint8Array(digest))}`;
}

/** True when the ink carries a recognition that was made for exactly its current strokes. */
export async function isInkRecognitionCurrent(ink: MindooInk): Promise<boolean> {
  if (!ink.recognition) return false;
  return ink.recognition.inkHash === (await computeInkHash(ink));
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function safeColor(color: string): string {
  return /^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i.test(color.trim()) ? color.trim() : "#1f2937";
}

function round(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function strokePath(points: readonly MindooInkPoint[]): string {
  if (points.length === 0) return "";
  const first = points[0]!;
  if (points.length === 1) {
    // A dot: a zero-length line still gets a round cap.
    return `M${round(first.x)} ${round(first.y)}l0.01 0`;
  }
  let d = `M${round(first.x)} ${round(first.y)}`;
  // Quadratic segments through the midpoints keep handwriting smooth.
  for (let i = 1; i < points.length - 1; i += 1) {
    const point = points[i]!;
    const next = points[i + 1]!;
    d += `Q${round(point.x)} ${round(point.y)} ${round((point.x + next.x) / 2)} ${round((point.y + next.y) / 2)}`;
  }
  const last = points[points.length - 1]!;
  d += `L${round(last.x)} ${round(last.y)}`;
  return d;
}

export interface InkToSvgOptions {
  /** `width` attribute of the SVG (default: the ink's area width). */
  width?: number | string;
  /** `height` attribute of the SVG (default: the ink's area height). */
  height?: number | string;
  /** Accessible name, e.g. the recognized text. */
  title?: string;
  /** Overrides every stroke's color, e.g. `currentColor` to follow the text color. */
  color?: string;
}

/**
 * Renders ink as an SVG string. The viewBox is the writing area and the ink is
 * fitted uniformly (`preserveAspectRatio="xMidYMid meet"`), so a smaller box
 * shrinks the writing instead of cutting it off.
 */
export function inkToSvg(ink: MindooInk, options: InkToSvgOptions = {}): string {
  const { w, h } = ink.area;
  const width = options.width ?? w;
  const height = options.height ?? h;
  const title = options.title ? `<title>${escapeXml(options.title)}</title>` : "";
  const paths = ink.strokes
    .map((stroke) => {
      let points: MindooInkPoint[];
      try {
        points = decodeInkPoints(stroke.pts);
      } catch {
        return "";
      }
      const d = strokePath(points);
      if (!d) return "";
      const color = options.color === "currentColor" ? "currentColor" : safeColor(options.color ?? stroke.color);
      const marker = stroke.tool === "marker";
      return `<path d="${d}" fill="none" stroke="${escapeXml(color)}" stroke-width="${round(Math.max(0.1, stroke.width))}" stroke-linecap="${marker ? "square" : "round"}" stroke-linejoin="round"${marker ? ' stroke-opacity="0.4"' : ""}/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${escapeXml(String(width))}" height="${escapeXml(String(height))}" preserveAspectRatio="xMidYMid meet" role="img"${options.title ? "" : ' aria-hidden="true"'}>${title}${paths}</svg>`;
}
