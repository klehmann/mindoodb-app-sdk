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
  MindooDBAppDragFileDescriptor,
  MindooDBAppDragFileOffer,
  MindooDBAppDragOffer,
  MindooDBAppDragPreview,
  MindooDBAppDragStartInput,
  MindooDBAppDragStartResult,
} from "./types";

/** Maximum number of types in one profile or start payload. */
export const MINDOODB_APP_MAX_DRAG_TYPES = 8;
/** Maximum UTF-8 size of one offer string. */
export const MINDOODB_APP_MAX_DRAG_PAYLOAD_BYTES = 32 * 1024;
/** Maximum number of files one drag offers. */
export const MINDOODB_APP_MAX_DRAG_FILES = 8;
/** Largest file a drag hands over. */
export const MINDOODB_APP_MAX_DRAG_FILE_BYTES = 50 * 1024 * 1024;
/** Longest file name a drag offers. */
export const MINDOODB_APP_MAX_DRAG_FILE_NAME = 255;
/** How long after a drop a target can still read the dropped files. */
export const MINDOODB_APP_DRAG_FILE_TTL_MS = 2 * 60 * 1000;
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
  // `instanceof` fails for a buffer that crossed a realm (a port in tests, another frame).
  if (value instanceof ArrayBuffer || Object.prototype.toString.call(value) === "[object ArrayBuffer]") {
    return (value as ArrayBuffer).slice(0);
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

function normalizeOffers(value: unknown, allowEmpty = false): MindooDBAppDragOffer[] {
  if (!Array.isArray(value) || (value.length === 0 && !allowEmpty)) {
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

const FILE_PATTERN = /^(\*\/\*|[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/(\*|[a-z0-9][a-z0-9!#$&^_.+-]{0,126}))$/i;

/** Whether a file of `type` matches an `acceptsFiles` pattern (`application/pdf`, `image/*`, `*\/*`). */
export function mindooDBAppDragFileMatches(pattern: string, type: string): boolean {
  const wanted = pattern.toLowerCase();
  const actual = type.toLowerCase();
  if (wanted === "*/*" || wanted === actual) return true;
  return wanted.endsWith("/*") && actual.startsWith(wanted.slice(0, -1));
}

/** Project and validate the `acceptsFiles` patterns sent with `drag.setProfile`. */
export function normalizeDragFileAccepts(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MINDOODB_APP_MAX_DRAG_TYPES) {
    throw new MindooDBAppDragInputError(`acceptsFiles takes at most ${MINDOODB_APP_MAX_DRAG_TYPES} patterns.`);
  }
  return [...new Set(value.map((entry, index) => {
    if (typeof entry !== "string" || !FILE_PATTERN.test(entry)) {
      throw new MindooDBAppDragInputError(`Expected acceptsFiles[${index}] to be a MIME type or pattern such as image/*.`);
    }
    return entry.toLowerCase();
  }))];
}

/**
 * Validate the files of a drag: type, name and size of each. Keeps `id` (as sent
 * over the bridge) and `read` (in the source app) as they are.
 */
export function normalizeDragFiles<T extends MindooDBAppDragFileOffer | MindooDBAppDragFileDescriptor>(value: unknown): T[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MINDOODB_APP_MAX_DRAG_FILES) {
    throw new MindooDBAppDragInputError(`A drag offers at most ${MINDOODB_APP_MAX_DRAG_FILES} files.`);
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new MindooDBAppDragInputError(`Expected files[${index}] to be an object.`);
    }
    const candidate = entry as Record<string, unknown>;
    const type = normalizeDragType(candidate.type, `files[${index}].type`).toLowerCase();
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    if (!name || name.length > MINDOODB_APP_MAX_DRAG_FILE_NAME || /[\\/\u0000-\u001f]/.test(name)) {
      throw new MindooDBAppDragInputError(`files[${index}].name must be a file name without slashes.`);
    }
    let size: number | undefined;
    if (candidate.size !== undefined) {
      size = requireFiniteNumber(candidate.size, `files[${index}].size`);
      if (size < 0 || size > MINDOODB_APP_MAX_DRAG_FILE_BYTES) {
        throw new MindooDBAppDragInputError(`files[${index}] is larger than ${MINDOODB_APP_MAX_DRAG_FILE_BYTES} bytes.`);
      }
    }
    const result: Record<string, unknown> = { type, name, ...(size !== undefined ? { size } : {}) };
    if (typeof candidate.id === "string") result.id = candidate.id;
    if (typeof candidate.read === "function") result.read = candidate.read;
    if (candidate.id === undefined && typeof candidate.read !== "function") {
      throw new MindooDBAppDragInputError(`files[${index}].read must be a function.`);
    }
    return result as unknown as T;
  });
}

/** Project and validate the `accepts` list sent with `drag.setProfile`. */
export function normalizeDragAccepts(value: unknown, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (value.length === 0 && !allowEmpty)) {
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

/** Project iframe-local pointer coordinates sent after `drag.start`. */
export function normalizeDragPointerInput(value: unknown): { x: number; y: number } {
  if (!value || typeof value !== "object") {
    throw new MindooDBAppDragInputError("A drag pointer payload is required.");
  }
  const candidate = value as { x?: unknown; y?: unknown };
  return {
    x: requireFiniteNumber(candidate.x, "pointer.x"),
    y: requireFiniteNumber(candidate.y, "pointer.y"),
  };
}

/** Project and validate a `drag.start` payload. */
export function normalizeDragStartInput(value: unknown): MindooDBAppDragStartInput {
  if (!value || typeof value !== "object") {
    throw new MindooDBAppDragInputError("drag.start requires a payload object.");
  }
  const candidate = value as {
    offers?: unknown;
    files?: unknown;
    preview?: unknown;
    pointer?: unknown;
    allowedEffects?: unknown;
  };
  const pointer = normalizeDragPointerInput(candidate.pointer);
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
  const files = normalizeDragFiles<MindooDBAppDragFileOffer>(candidate.files);
  return {
    offers: normalizeOffers(candidate.offers, files.length > 0),
    ...(files.length ? { files } : {}),
    preview: normalizePreview(candidate.preview),
    pointer,
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

function readFiles(options: MindooDBAppDragBindSourceOptions): MindooDBAppDragFileOffer[] {
  if (!options.files) return [];
  return typeof options.files === "function" ? options.files() : options.files;
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
export type MindooDBAppDragPointerFollow = {
  move: (x: number, y: number) => void;
  release: (x: number, y: number) => void;
};

export function bindDragSource(
  element: HTMLElement,
  options: MindooDBAppDragBindSourceOptions,
  start: (input: MindooDBAppDragStartInput) => Promise<MindooDBAppDragStartResult>,
  follow?: MindooDBAppDragPointerFollow,
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

  let pendingRelease: { x: number; y: number } | null = null;
  let hostListening = false;

  const beginHostDrag = (event: PointerEvent) => {
    if (!active || active.started) {
      return;
    }
    active.started = true;
    try {
      element.setPointerCapture(active.pointerId);
    } catch {
      // Capture is best-effort; the window listeners still get the moves of this frame.
    }
    if (active.timer != null) {
      clearTimeout(active.timer);
      active.timer = null;
    }
    const offers = readOffers(options);
    const files = readFiles(options);
    if (offers.length === 0 && files.length === 0) {
      reset();
      return;
    }
    event.preventDefault();
    const pointerId = active.pointerId;
    const hotX = event.clientX - element.getBoundingClientRect().left;
    const hotY = event.clientY - element.getBoundingClientRect().top;
    const pointer = { x: event.clientX, y: event.clientY };
    void (async () => {
      const preview = await active?.preview;
      if (!active || active.pointerId !== pointerId || !preview) {
        return;
      }
      const session = start({
        offers,
        ...(files.length ? { files } : {}),
        preview: {
          ...preview,
          hotspotX: hotX,
          hotspotY: hotY,
        },
        pointer,
        allowedEffects: ["copy"],
      });
      hostListening = true;
      if (pendingRelease) {
        follow?.release(pendingRelease.x, pendingRelease.y);
        pendingRelease = null;
      }
      try {
        await session;
      } finally {
        hostListening = false;
        pendingRelease = null;
        reset();
      }
    })();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    reset();
    pendingRelease = null;
    hostListening = false;
    // No pointer capture yet: it would send the click that follows a plain press to
    // this element instead of the checkbox or button under the pointer. Moves reach the
    // window listeners anyway; the capture is taken once the drag starts.
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
    if (!active || event.pointerId !== active.pointerId) {
      return;
    }
    if (active.started) {
      follow?.move(event.clientX, event.clientY);
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
    try {
      if (typeof element.hasPointerCapture === "function" && element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore elements that never captured.
    }
    if (active.started) {
      const point = { x: event.clientX, y: event.clientY };
      if (hostListening) {
        follow?.release(point.x, point.y);
      } else {
        pendingRelease = point;
      }
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
