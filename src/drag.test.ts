/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_DRAG_LONG_PRESS_MS,
  MINDOODB_APP_MAX_DRAG_PAYLOAD_BYTES,
  MINDOODB_APP_MAX_DRAG_PREVIEW_BYTES,
  MINDOODB_APP_MAX_DRAG_TYPES,
  MINIMAL_DRAG_PREVIEW_PNG,
  MindooDBAppDragInputError,
  bindDragSource,
  isMindooDBAppDragType,
  normalizeDragAccepts,
  normalizeDragStartInput,
  snapshotElementToPng,
} from "./drag";

function previewPng() {
  return MINIMAL_DRAG_PREVIEW_PNG.buffer.slice(0);
}

function validStartInput() {
  return {
    offers: [{ type: "text/plain", data: "hello" }],
    preview: {
      png: previewPng(),
      width: 120,
      height: 48,
      hotspotX: 8,
      hotspotY: 12,
    },
    pointer: { x: 20, y: 24 },
    allowedEffects: ["copy"] as Array<"copy">,
  };
}

describe("drag validation", () => {
  it("accepts well-known and custom MIME-like types", () => {
    expect(isMindooDBAppDragType("text/plain")).toBe(true);
    expect(isMindooDBAppDragType("text/markdown")).toBe(true);
    expect(isMindooDBAppDragType("application/x-mindoo-document")).toBe(true);
    expect(isMindooDBAppDragType("application/x-mindoo.vega.node")).toBe(true);
    expect(isMindooDBAppDragType("not-a-type")).toBe(false);
    expect(isMindooDBAppDragType("text/")).toBe(false);
  });

  it("normalizes a valid start payload and clones the PNG buffer", () => {
    const input = validStartInput();
    const normalized = normalizeDragStartInput(input);
    expect(normalized.offers).toEqual([{ type: "text/plain", data: "hello" }]);
    expect(normalized.preview.png).not.toBe(input.preview.png);
    expect(new Uint8Array(normalized.preview.png)).toEqual(new Uint8Array(input.preview.png));
  });

  it("rejects too many types, oversize payloads, and empty profiles", () => {
    expect(() => normalizeDragAccepts([])).toThrow(MindooDBAppDragInputError);
    expect(() =>
      normalizeDragAccepts(Array.from({ length: MINDOODB_APP_MAX_DRAG_TYPES + 1 }, (_, index) => `text/t${index}`)),
    ).toThrow(/at most/);
    expect(() =>
      normalizeDragStartInput({
        ...validStartInput(),
        offers: [{ type: "text/plain", data: "a".repeat(MINDOODB_APP_MAX_DRAG_PAYLOAD_BYTES + 1) }],
      }),
    ).toThrow(/exceeds/);
    expect(() =>
      normalizeDragStartInput({
        ...validStartInput(),
        preview: {
          ...validStartInput().preview,
          png: new ArrayBuffer(MINDOODB_APP_MAX_DRAG_PREVIEW_BYTES + 1),
        },
      }),
    ).toThrow(/preview.png/);
  });

  it("rejects move effects and duplicate offer types", () => {
    expect(() =>
      normalizeDragStartInput({
        ...validStartInput(),
        allowedEffects: ["move"],
      }),
    ).toThrow(/copy/);
    expect(() =>
      normalizeDragStartInput({
        ...validStartInput(),
        offers: [
          { type: "text/plain", data: "a" },
          { type: "text/plain", data: "b" },
        ],
      }),
    ).toThrow(/Duplicate/);
  });
});

describe("snapshotElementToPng", () => {
  it("returns a PNG buffer sized from the element box", async () => {
    const element = document.createElement("div");
    element.textContent = "Card";
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () => ({
        left: 0,
        top: 0,
        width: 180,
        height: 72,
        right: 180,
        bottom: 72,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    document.body.appendChild(element);
    const preview = await snapshotElementToPng(element);
    expect(preview.width).toBe(180);
    expect(preview.height).toBe(72);
    expect(preview.png.byteLength).toBeGreaterThan(0);
    element.remove();
  });
});

describe("bindDragSource", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mountSource() {
    const element = document.createElement("div");
    element.textContent = "Source";
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () => ({
        left: 10,
        top: 20,
        width: 100,
        height: 40,
        right: 110,
        bottom: 60,
        x: 10,
        y: 20,
        toJSON: () => ({}),
      }),
    });
    document.body.appendChild(element);
    return element;
  }

  it("starts a mouse drag after the move threshold", async () => {
    const element = mountSource();
    const start = vi.fn(async () => ({ action: "cancelled" as const, reason: "gap" as const }));
    const unbind = bindDragSource(
      element,
      { offers: [{ type: "text/plain", data: "hi" }] },
      start,
    );
    element.dispatchEvent(new PointerEvent("pointerdown", {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 12,
      clientY: 22,
      bubbles: true,
    }));
    window.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 22,
      clientY: 22,
      bubbles: true,
    }));
    await vi.waitFor(() => {
      expect(start).toHaveBeenCalled();
    });
    unbind();
    element.remove();
  });

  it("forwards pointer moves and the button-up after the host drag starts", async () => {
    const element = mountSource();
    const move = vi.fn();
    const release = vi.fn();
    const start = vi.fn(() => new Promise<never>(() => undefined));
    const unbind = bindDragSource(
      element,
      { offers: [{ type: "text/plain", data: "hi" }] },
      start,
      { move, release },
    );
    element.dispatchEvent(new PointerEvent("pointerdown", {
      button: 0,
      pointerId: 7,
      pointerType: "mouse",
      clientX: 12,
      clientY: 22,
      bubbles: true,
    }));
    window.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 7,
      pointerType: "mouse",
      clientX: 22,
      clientY: 22,
      bubbles: true,
    }));
    await vi.waitFor(() => {
      expect(start).toHaveBeenCalled();
    });
    window.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 7,
      pointerType: "mouse",
      clientX: 80,
      clientY: 40,
      bubbles: true,
    }));
    expect(move).toHaveBeenCalledWith(80, 40);
    window.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: 7,
      pointerType: "mouse",
      clientX: 90,
      clientY: 44,
      bubbles: true,
    }));
    expect(release).toHaveBeenCalledWith(90, 44);
    unbind();
    element.remove();
  });

  it("starts a touch drag only after the long-press", async () => {
    const element = mountSource();
    const start = vi.fn(async () => ({ action: "cancelled" as const, reason: "gap" as const }));
    const unbind = bindDragSource(
      element,
      { offers: [{ type: "text/plain", data: "hi" }] },
      start,
    );
    const down = new PointerEvent("pointerdown", {
      button: 0,
      pointerId: 2,
      pointerType: "touch",
      clientX: 12,
      clientY: 22,
      bubbles: true,
    });
    element.dispatchEvent(down);
    window.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 14,
      clientY: 22,
      bubbles: true,
    }));
    expect(start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DEFAULT_DRAG_LONG_PRESS_MS);
    await vi.waitFor(() => {
      expect(start).toHaveBeenCalled();
    });
    unbind();
    element.remove();
  });

  it("treats a touch move beyond the threshold as scroll and does not start", async () => {
    const element = mountSource();
    const start = vi.fn(async () => ({ action: "cancelled" as const, reason: "gap" as const }));
    const unbind = bindDragSource(
      element,
      { offers: [{ type: "text/plain", data: "hi" }] },
      start,
    );
    element.dispatchEvent(new PointerEvent("pointerdown", {
      button: 0,
      pointerId: 3,
      pointerType: "touch",
      clientX: 12,
      clientY: 22,
      bubbles: true,
    }));
    window.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 3,
      pointerType: "touch",
      clientX: 40,
      clientY: 22,
      bubbles: true,
    }));
    await vi.advanceTimersByTimeAsync(DEFAULT_DRAG_LONG_PRESS_MS);
    expect(start).not.toHaveBeenCalled();
    unbind();
    element.remove();
  });

  it("does not start when the source currently offers no types", async () => {
    const element = mountSource();
    const start = vi.fn(async () => ({ action: "cancelled" as const, reason: "gap" as const }));
    const unbind = bindDragSource(
      element,
      { offers: () => [] },
      start,
    );
    element.dispatchEvent(new PointerEvent("pointerdown", {
      button: 0,
      pointerId: 4,
      pointerType: "mouse",
      clientX: 12,
      clientY: 22,
      bubbles: true,
    }));
    window.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 4,
      pointerType: "mouse",
      clientX: 22,
      clientY: 22,
      bubbles: true,
    }));
    await Promise.resolve();
    expect(start).not.toHaveBeenCalled();
    unbind();
    element.remove();
  });
});
