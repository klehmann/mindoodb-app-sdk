/**
 * Client helpers for host-owned cross-iframe drag.
 *
 * Validation lives here so the SDK rejects bad `start` / `setProfile`
 * payloads before they cross the bridge. Haven re-validates the same
 * limits on untyped JSON. `bindDragSource` and `snapshotElementToPng`
 * stay in the app document: Haven only ever receives PNG bytes and
 * string snapshots.
 *
 * @module drag
 */
import type {
  MindooDBAppDragBindSourceOptions,
  MindooDBAppDragOffer,
  MindooDBAppDragPreview,
  MindooDBAppDragStartInput,
  MindooDBAppDragStartResult,
} from "./types";

/** Maximum number of types in one profile or start payload. */
export const MINDOODB_APP_MAX_DRAG_TYPES = 8;
/** Maximum UTF-8 size of one offer string. */
export const MINDOODB_APP_MAX_DRAG_PAYLOAD_BYTES = 32 * 1024;
/** Maximum encoded PNG size for the host ghost. */
export const MINDOODB_APP_MAX_DRAG_PREVIEW_BYTES = 256 * 1024;
/** Longest CSS-pixel edge Haven will display for a ghost. */
export const MINDOODB_APP_MAX_DRAG_PREVIEW_EDGE = 512;
/** Touch hold before the host takes over. */
export const DEFAULT_DRAG_LONG_PRESS_MS = 400;
/** Mouse/pen start distance, and touch scroll-cancel slop. */
export const DEFAULT_DRAG_POINTER_THRESHOLD_PX = 8;

/**
 * 1×1 PNG used when the browser cannot snapshot a node. Haven still
 * sizes the ghost from `preview.width` / `preview.height`.
 */
export const MINIMAL_DRAG_PREVIEW_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (character) => character.charCodeAt(0),
);

const DRAG_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

/** Structured validation failure. `name` is the bridge error code. */
export class MindooDBAppDragInputError extends Error {
  override name = "invalid-drag-input";

  constructor(message: string) {
    super(message);
  }
}

/** True when `type` is a MIME-like token Haven will accept. */
export function isMindooDBAppDragType(type: string): boolean {
  return DRAG_TYPE_PATTERN.test(type);
}

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

function requireFiniteNumber(value: unknown, fieldPath: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MindooDBAppDragInputError(`Expected ${fieldPath} to be a finite number.`);
  }
  return value;
}

function toPreviewArrayBuffer(value: unknown): ArrayBuffer | null {
  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
  }
  return null;
}

function normalizeDragType(value: unknown, fieldPath: string) {
  if (typeof value !== "string" || !isMindooDBAppDragType(value)) {
    throw new MindooDBAppDragInputError(`Expected ${fieldPath} to be a MIME-like type string.`);
  }
  return value;
}

function normalizeOffers(value: unknown): MindooDBAppDragOffer[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new MindooDBAppDragInputError("A drag must offer at least one type.");
  }
  if (value.length > MINDOODB_APP_MAX_DRAG_TYPES) {
    throw new MindooDBAppDragInputError(
      `A drag supports at most ${MINDOODB_APP_MAX_DRAG_TYPES} types.`,
    );
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new MindooDBAppDragInputError(`Expected offers[${index}] to be an object.`);
    }
    const candidate = entry as { type?: unknown; data?: unknown };
    const type = normalizeDragType(candidate.type, `offers[${index}].type`);
    if (seen.has(type)) {
      throw new MindooDBAppDragInputError(`Duplicate drag type "${type}".`);
    }
    seen.add(type);
    if (typeof candidate.data !== "string") {
      throw new MindooDBAppDragInputError(`Expected offers[${index}].data to be a string.`);
    }
    if (utf8ByteLength(candidate.data) > MINDOODB_APP_MAX_DRAG_PAYLOAD_BYTES) {
      throw new MindooDBAppDragInputError(
        `offers[${index}].data exceeds ${MINDOODB_APP_MAX_DRAG_PAYLOAD_BYTES} bytes.`,
      );
    }
    return { type, data: candidate.data };
  });
}

/** Project and validate the `accepts` list sent with `drag.setProfile`. */
export function normalizeDragAccepts(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new MindooDBAppDragInputError("A drag profile must accept at least one type.");
  }
  if (value.length > MINDOODB_APP_MAX_DRAG_TYPES) {
    throw new MindooDBAppDragInputError(
      `A drag profile supports at most ${MINDOODB_APP_MAX_DRAG_TYPES} types.`,
    );
  }
  const seen = new Set<string>();
  const accepts: string[] = [];
  value.forEach((entry, index) => {
    const type = normalizeDragType(entry, `accepts[${index}]`);
    if (seen.has(type)) {
      return;
    }
    seen.add(type);
    accepts.push(type);
  });
  return accepts;
}

function normalizePreview(value: unknown): MindooDBAppDragPreview {
  if (!value || typeof value !== "object") {
    throw new MindooDBAppDragInputError("A drag preview is required.");
  }
  const candidate = value as {
    png?: unknown;
    width?: unknown;
    height?: unknown;
    hotspotX?: unknown;
    hotspotY?: unknown;
  };
  const pngBuffer = toPreviewArrayBuffer(candidate.png);
  if (!pngBuffer) {
    throw new MindooDBAppDragInputError("preview.png must be an ArrayBuffer.");
  }
  if (pngBuffer.byteLength === 0 || pngBuffer.byteLength > MINDOODB_APP_MAX_DRAG_PREVIEW_BYTES) {
    throw new MindooDBAppDragInputError(
      `preview.png must be between 1 and ${MINDOODB_APP_MAX_DRAG_PREVIEW_BYTES} bytes.`,
    );
  }
  const width = requireFiniteNumber(candidate.width, "preview.width");
  const height = requireFiniteNumber(candidate.height, "preview.height");
  if (width <= 0 || height <= 0 || width > MINDOODB_APP_MAX_DRAG_PREVIEW_EDGE * 4
    || height > MINDOODB_APP_MAX_DRAG_PREVIEW_EDGE * 4) {
    throw new MindooDBAppDragInputError("preview width/height are out of range.");
  }
  return {
    png: pngBuffer,
    width,
    height,
    hotspotX: requireFiniteNumber(candidate.hotspotX, "preview.hotspotX"),
    hotspotY: requireFiniteNumber(candidate.hotspotY, "preview.hotspotY"),
  };
}

/** Project and validate a `drag.start` payload. */
export function normalizeDragStartInput(value: unknown): MindooDBAppDragStartInput {
  if (!value || typeof value !== "object") {
    throw new MindooDBAppDragInputError("drag.start requires a payload object.");
  }
  const candidate = value as {
    offers?: unknown;
    preview?: unknown;
    pointer?: unknown;
    allowedEffects?: unknown;
  };
  if (!candidate.pointer || typeof candidate.pointer !== "object") {
    throw new MindooDBAppDragInputError("pointer is required.");
  }
  const pointer = candidate.pointer as { x?: unknown; y?: unknown };
  let allowedEffects: Array<"copy"> | undefined;
  if (candidate.allowedEffects !== undefined) {
    if (
      !Array.isArray(candidate.allowedEffects)
      || candidate.allowedEffects.length === 0
      || candidate.allowedEffects.some((effect) => effect !== "copy")
    ) {
      throw new MindooDBAppDragInputError("allowedEffects may only include \"copy\".");
    }
    allowedEffects = ["copy"];
  }
  return {
    offers: normalizeOffers(candidate.offers),
    preview: normalizePreview(candidate.preview),
    pointer: {
      x: requireFiniteNumber(pointer.x, "pointer.x"),
      y: requireFiniteNumber(pointer.y, "pointer.y"),
    },
    allowedEffects,
  };
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  if (typeof canvas.toBlob === "function") {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Could not encode the drag preview as PNG."));
          return;
        }
        void blob.arrayBuffer().then(resolve, reject);
      }, "image/png");
    });
  }
  if (typeof canvas.toDataURL !== "function") {
    return Promise.resolve(MINIMAL_DRAG_PREVIEW_PNG.buffer.slice(0));
  }
  const dataUrl = canvas.toDataURL("image/png");
  const encoded = dataUrl.split(",")[1];
  if (!encoded) {
    return Promise.resolve(MINIMAL_DRAG_PREVIEW_PNG.buffer.slice(0));
  }
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return Promise.resolve(bytes.buffer);
}

function drawFallbackCard(element: HTMLElement, width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  context.fillStyle = "#1c2333";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#6ea8fe";
  context.strokeRect(0.5, 0.5, width - 1, height - 1);
  context.fillStyle = "#f4f7fb";
  context.font = "12px sans-serif";
  const label = (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 48);
  context.fillText(label || "Drag", 8, Math.min(20, height - 6));
  return canvas;
}

function scaledPreviewSize(width: number, height: number) {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const scale = Math.min(1, MINDOODB_APP_MAX_DRAG_PREVIEW_EDGE / Math.max(safeWidth, safeHeight));
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

/**
 * Snapshot an element in the app document. Failures fall back to a labeled
 * card or a 1×1 PNG — Haven must never receive HTML.
 */
export async function snapshotElementToPng(element: HTMLElement): Promise<MindooDBAppDragPreview> {
  const bounds = element.getBoundingClientRect();
  const size = scaledPreviewSize(bounds.width || 160, bounds.height || 72);
  const canvas = drawFallbackCard(element, size.width, size.height);
  const png = canvas
    ? await canvasToPng(canvas)
    : MINIMAL_DRAG_PREVIEW_PNG.buffer.slice(0);
  if (png.byteLength > MINDOODB_APP_MAX_DRAG_PREVIEW_BYTES) {
    throw new MindooDBAppDragInputError(
      `Drag preview exceeds ${MINDOODB_APP_MAX_DRAG_PREVIEW_BYTES} bytes.`,
    );
  }
  return {
    png,
    width: size.width,
    height: size.height,
    hotspotX: size.width / 2,
    hotspotY: size.height / 2,
  };
}

function pointerDistance(origin: { x: number; y: number }, event: PointerEvent) {
  const dx = event.clientX - origin.x;
  const dy = event.clientY - origin.y;
  return Math.hypot(dx, dy);
}

function readOffers(options: MindooDBAppDragBindSourceOptions): MindooDBAppDragOffer[] {
  return typeof options.offers === "function" ? options.offers() : options.offers;
}

function readPreviewElement(source: HTMLElement, options: MindooDBAppDragBindSourceOptions) {
  if (!options.preview) {
    return source;
  }
  return typeof options.preview === "function" ? options.preview() : options.preview;
}

/**
 * Start a host drag from a pointer gesture. Mouse/pen use a move threshold;
 * touch waits for a long-press so lists can still scroll.
 */
export function bindDragSource(
  element: HTMLElement,
  options: MindooDBAppDragBindSourceOptions,
  start: (input: MindooDBAppDragStartInput) => Promise<MindooDBAppDragStartResult>,
): () => void {
  const longPressMs = options.longPressMs ?? DEFAULT_DRAG_LONG_PRESS_MS;
  const thresholdPx = options.pointerThresholdPx ?? DEFAULT_DRAG_POINTER_THRESHOLD_PX;
  let active: {
    pointerId: number;
    origin: { x: number; y: number };
    pointerType: string;
    preview: Promise<MindooDBAppDragPreview>;
    timer: ReturnType<typeof setTimeout> | null;
    started: boolean;
  } | null = null;

  const reset = () => {
    if (active?.timer != null) {
      clearTimeout(active.timer);
    }
    active = null;
  };

  const beginHostDrag = async (event: PointerEvent) => {
    if (!active || active.started) {
      return;
    }
    active.started = true;
    if (active.timer != null) {
      clearTimeout(active.timer);
      active.timer = null;
    }
    const offers = readOffers(options);
    if (offers.length === 0) {
      reset();
      return;
    }
    event.preventDefault();
    const preview = await active.preview;
    const hotX = event.clientX - element.getBoundingClientRect().left;
    const hotY = event.clientY - element.getBoundingClientRect().top;
    await start({
      offers,
      preview: {
        ...preview,
        hotspotX: hotX,
        hotspotY: hotY,
      },
      pointer: { x: event.clientX, y: event.clientY },
      allowedEffects: ["copy"],
    });
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    reset();
    const previewElement = readPreviewElement(element, options);
    active = {
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      pointerType: event.pointerType,
      preview: snapshotElementToPng(previewElement).catch(() => ({
        png: MINIMAL_DRAG_PREVIEW_PNG.buffer.slice(0),
        width: Math.max(1, Math.round(previewElement.getBoundingClientRect().width) || 160),
        height: Math.max(1, Math.round(previewElement.getBoundingClientRect().height) || 72),
        hotspotX: 0,
        hotspotY: 0,
      })),
      timer: null,
      started: false,
    };
    if (event.pointerType === "touch") {
      active.timer = setTimeout(() => {
        if (!active || active.started) {
          return;
        }
        void beginHostDrag(event);
      }, longPressMs);
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!active || event.pointerId !== active.pointerId || active.started) {
      return;
    }
    const distance = pointerDistance(active.origin, event);
    if (active.pointerType === "touch") {
      if (distance > thresholdPx) {
        reset();
      }
      return;
    }
    if (distance >= thresholdPx) {
      void beginHostDrag(event);
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!active || event.pointerId !== active.pointerId) {
      return;
    }
    reset();
  };

  element.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  return () => {
    reset();
    element.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
  };
}
