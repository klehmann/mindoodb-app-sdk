import { describe, expect, it } from "vitest";

import {
  computeInkHash,
  createMindooInk,
  decodeInkPoints,
  encodeInkPoints,
  inkStrokePoints,
  inkToSvg,
  isInkRecognitionCurrent,
  type MindooInkPoint,
} from "./ink";

function wave(count: number, t0 = 1000): MindooInkPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    x: 10 + i * 1.37,
    y: 30 + Math.sin(i / 3) * 12.34,
    t: t0 + i * 8,
    pressure: 0.3 + (i % 7) / 10,
  }));
}

describe("ink point encoding", () => {
  it("round-trips to 0.1 px, whole ms and 1/255 pressure", () => {
    const points = wave(50);
    const decoded = decodeInkPoints(encodeInkPoints(points));
    expect(decoded).toHaveLength(50);
    decoded.forEach((point, i) => {
      expect(Math.abs(point.x - points[i]!.x)).toBeLessThanOrEqual(0.0501);
      expect(Math.abs(point.y - points[i]!.y)).toBeLessThanOrEqual(0.0501);
      expect(point.t).toBe(points[i]!.t);
      expect(Math.abs(point.pressure! - points[i]!.pressure!)).toBeLessThanOrEqual(1 / 255);
    });
  });

  it("keeps time and pressure only when every point has them", () => {
    const decoded = decodeInkPoints(encodeInkPoints([{ x: 1, y: 2, t: 5 }, { x: 3, y: 4 }]));
    expect(decoded).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  });

  it("handles negative coordinates, empty strokes and long pauses", () => {
    const points = [{ x: -5.5, y: -0.1, t: 0 }, { x: 4000, y: 3000, t: 3_600_000 }];
    expect(decodeInkPoints(encodeInkPoints(points))).toEqual(points);
    expect(decodeInkPoints(encodeInkPoints([]))).toEqual([]);
  });

  it("is compact: three words of 1000 points stay far below JSON size", () => {
    const strokes = Array.from({ length: 20 }, (_, s) => wave(50, s * 600));
    const encoded = strokes.map((stroke) => encodeInkPoints(stroke)).join("");
    const json = JSON.stringify(strokes);
    expect(encoded.length).toBeLessThan(json.length / 5);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects text that is not encoded ink", () => {
    expect(() => decodeInkPoints("not ink!")).toThrow();
  });
});

describe("MindooInk", () => {
  it("makes times relative to the first point and decodes back", () => {
    const ink = createMindooInk({ area: { w: 180, h: 64 }, strokes: [{ points: wave(5, 5000) }, { points: wave(3, 5400) }] });
    expect(ink.v).toBe(1);
    expect(ink.strokes).toHaveLength(2);
    expect(ink.strokes[0]!.id).toMatch(/^s/);
    const points = inkStrokePoints(ink);
    expect(points[0]![0]!.t).toBe(0);
    expect(points[1]![0]!.t).toBe(400);
  });

  it("hashes geometry only and detects stale recognitions", async () => {
    const ink = createMindooInk({ area: { w: 100, h: 40 }, strokes: [{ points: wave(10) }] });
    const hash = await computeInkHash(ink);
    expect(hash).toMatch(/^sha256-[A-Za-z0-9_-]{43}$/);
    const recolored = { ...ink, strokes: ink.strokes.map((stroke) => ({ ...stroke, color: "red", id: "x" })) };
    expect(await computeInkHash(recolored)).toBe(hash);
    const recognized = { ...ink, recognition: { status: "recognized" as const, text: "Hi", lang: "en-US", engine: "test", at: "2026-11-21T00:00:00Z", inkHash: hash } };
    expect(await isInkRecognitionCurrent(recognized)).toBe(true);
    const changed = { ...recognized, strokes: [...ink.strokes, ...createMindooInk({ area: ink.area, strokes: [{ points: wave(2) }] }).strokes] };
    expect(await isInkRecognitionCurrent(changed)).toBe(false);
  });

  it("renders SVG fitted into the area, with escaped title and safe colors", () => {
    const ink = createMindooInk({ area: { w: 180, h: 64 }, strokes: [{ points: wave(6), color: "url(javascript:x)" }, { points: [{ x: 5, y: 5 }], tool: "marker" }] });
    const svg = inkToSvg(ink, { width: "100%", height: 32, title: "A<b>" });
    expect(svg).toContain('viewBox="0 0 180 64"');
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(svg).toContain("<title>A&lt;b&gt;</title>");
    expect(svg).not.toContain("javascript");
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(inkToSvg(ink, { color: "currentColor" })).toContain('stroke="currentColor"');
  });
});
