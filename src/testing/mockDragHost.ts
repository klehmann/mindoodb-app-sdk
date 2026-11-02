/**
 * Haven's host-owned drag, as the fake bridge host plays it: the app under test can
 * be a drop target (`over` / `drop` push what another app would offer, files
 * included) and a drag source (`started` lists what it offered, `readFile` asks it
 * for one of its files the way a target would).
 *
 * @module mockDragHost
 */
import {
  MINDOODB_APP_DRAG_FILE_TTL_MS,
  mindooDBAppDragFileMatches,
  normalizeDragAccepts,
  normalizeDragFileAccepts,
  normalizeDragStartInput,
} from "../drag";
import type {
  MindooDBAppBridgePortMessage,
  MindooDBAppDragEffect,
  MindooDBAppDragFileDescriptor,
  MindooDBAppDragOffer,
  MindooDBAppDragStartResult,
} from "../types";

const PROTOCOL = "mindoodb-app-bridge";
const HOVER_TIMEOUT_MS = 1000;
const FILE_TIMEOUT_MS = 30_000;

/** A file another app offers in a simulated drop. */
export interface MockDragFile {
  type: string;
  name: string;
  data: string | Uint8Array | ArrayBuffer | Blob;
}

/** What the app under test offered when it started a drag. */
export interface MockStartedDrag {
  offers: MindooDBAppDragOffer[];
  files: MindooDBAppDragFileDescriptor[];
  /** How the gesture ended; `null` while it is still running. */
  result: MindooDBAppDragStartResult | null;
}

export interface MockDragProfile {
  accepts: string[];
  acceptsFiles: string[];
}

export interface MockDragHostController {
  /** What the app said it accepts (`drag.setProfile`), or `null` before it did. */
  profile(): MockDragProfile | null;
  /**
   * As if another app's drag moved over the app at frame-local `x`/`y`: pushes
   * `drag-over` and resolves with the app's hover answer.
   */
  over(input: { x: number; y: number; types: string[]; files?: Array<{ type: string; name: string; size?: number }> }): Promise<{ accept: boolean; effect: MindooDBAppDragEffect }>;
  /** As if the drag left the app. */
  leave(): void;
  /**
   * As if another app dropped here: pushes `drag-drop` with the items and files the
   * app accepts. Resolves with what was delivered.
   */
  drop(input: { x: number; y: number; items?: Record<string, string>; files?: MockDragFile[] }): Promise<{ types: string[]; files: string[] }>;
  /** Drags the app under test started, oldest first. */
  started(): MockStartedDrag[];
  /** Asks the app for one of the files its latest drag offered, as a target would. */
  readFile(fileId: string): Promise<Blob>;
  /** Ends the app's running drag as Haven would (default: copied). */
  finish(result?: MindooDBAppDragStartResult): void;
  /** Called when something changed (a drag started or ended, a profile was set). */
  onChange(listener: () => void): () => void;
}

export interface MockDragHost {
  controller: MockDragHostController;
  /** Handles `drag.*` requests; `undefined` for other methods. */
  dispatch(method: string, params: unknown): Promise<{ result: unknown } | undefined>;
  /** Handles `drag-file-result` from the app; true when it was one. */
  handleMessage(message: MindooDBAppBridgePortMessage): boolean;
  reset(): void;
}

async function bytesOf(data: MockDragFile["data"]): Promise<Uint8Array> {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(await data.arrayBuffer());
}

export function createMockDragHost(post: (message: MindooDBAppBridgePortMessage, transfer?: Transferable[]) => boolean): MockDragHost {
  let profile: MockDragProfile | null = null;
  const started: MockStartedDrag[] = [];
  let finishActive: ((result: MindooDBAppDragStartResult) => void) | null = null;
  let hoverWaiter: ((answer: { accept: boolean; effect: MindooDBAppDragEffect }) => void) | null = null;
  const drops = new Map<string, Map<string, { type: string; bytes: Uint8Array }>>();
  const fileRequests = new Map<string, { resolve: (blob: Blob) => void; reject: (error: Error) => void; type: string }>();
  const listeners = new Set<() => void>();
  let counter = 0;
  const changed = () => listeners.forEach((listener) => listener());

  const accepted = (types: string[]) => types.filter((type) => profile?.accepts.includes(type));
  const acceptedFiles = <T extends { type: string }>(files: T[]) =>
    files.filter((file) => profile?.acceptsFiles.some((pattern) => mindooDBAppDragFileMatches(pattern, file.type)));

  function finish(result: MindooDBAppDragStartResult = { action: "copied" }) {
    const resolve = finishActive;
    finishActive = null;
    resolve?.(result);
  }

  const controller: MockDragHostController = {
    profile: () => (profile ? { accepts: [...profile.accepts], acceptsFiles: [...profile.acceptsFiles] } : null),
    over(input) {
      const files = acceptedFiles(input.files ?? []).map(({ type, name, size }) => ({ type, name, ...(size !== undefined ? { size } : {}) }));
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          hoverWaiter = null;
          resolve({ accept: false, effect: "forbidden" });
        }, HOVER_TIMEOUT_MS);
        hoverWaiter = (answer) => {
          clearTimeout(timer);
          hoverWaiter = null;
          resolve(answer);
        };
        if (!post({ protocol: PROTOCOL, kind: "drag-over", x: input.x, y: input.y, types: [...input.types], files })) {
          clearTimeout(timer);
          hoverWaiter = null;
          resolve({ accept: false, effect: "forbidden" });
        }
      });
    },
    leave() {
      post({ protocol: PROTOCOL, kind: "drag-leave" });
    },
    async drop(input) {
      const items: Record<string, string> = {};
      for (const type of accepted(Object.keys(input.items ?? {}))) items[type] = input.items![type]!;
      const dropId = `drop-${++counter}`;
      const stored = new Map<string, { type: string; bytes: Uint8Array }>();
      const files: MindooDBAppDragFileDescriptor[] = [];
      for (const file of acceptedFiles(input.files ?? [])) {
        const bytes = await bytesOf(file.data);
        const id = `${dropId}-${files.length}`;
        stored.set(id, { type: file.type, bytes });
        files.push({ id, type: file.type, name: file.name, size: bytes.byteLength });
      }
      drops.set(dropId, stored);
      setTimeout(() => drops.delete(dropId), MINDOODB_APP_DRAG_FILE_TTL_MS);
      post({ protocol: PROTOCOL, kind: "drag-drop", x: input.x, y: input.y, items, dropId, files });
      return { types: Object.keys(items), files: files.map((file) => file.name) };
    },
    started: () => started.map((drag) => ({ ...drag, offers: [...drag.offers], files: [...drag.files] })),
    readFile(fileId) {
      const requestId = `file-${++counter}`;
      const descriptor = started.at(-1)?.files.find((file) => file.id === fileId);
      return new Promise<Blob>((resolve, reject) => {
        const timer = setTimeout(() => {
          fileRequests.delete(requestId);
          reject(new Error("The app did not answer the file request."));
        }, FILE_TIMEOUT_MS);
        fileRequests.set(requestId, {
          type: descriptor?.type ?? "application/octet-stream",
          resolve: (blob) => {
            clearTimeout(timer);
            resolve(blob);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        if (!post({ protocol: PROTOCOL, kind: "drag-file-request", requestId, fileId })) {
          fileRequests.delete(requestId);
          clearTimeout(timer);
          reject(new Error("The app is not connected."));
        }
      });
    },
    finish,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  async function dispatch(method: string, params: unknown): Promise<{ result: unknown } | undefined> {
    const input = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      case "drag.setProfile": {
        const acceptsFiles = normalizeDragFileAccepts(input.acceptsFiles);
        profile = { accepts: normalizeDragAccepts(input.accepts, acceptsFiles.length > 0), acceptsFiles };
        changed();
        return { result: null };
      }
      case "drag.start": {
        const normalized = normalizeDragStartInput(input);
        const files = (normalized.files ?? []) as unknown as MindooDBAppDragFileDescriptor[];
        finish({ action: "cancelled", reason: "replaced" });
        const drag: MockStartedDrag = { offers: normalized.offers, files, result: null };
        started.push(drag);
        changed();
        const result = await new Promise<MindooDBAppDragStartResult>((resolve) => {
          finishActive = resolve;
        });
        drag.result = result;
        changed();
        return { result };
      }
      case "drag.reportHover": {
        const accept = input.accept === true;
        hoverWaiter?.({ accept, effect: accept && input.effect === "copy" ? "copy" : "forbidden" });
        return { result: null };
      }
      case "drag.reportPointer":
        return { result: null };
      case "drag.release":
        finish({ action: "copied" });
        return { result: null };
      case "drag.cancel":
        finish({ action: "cancelled", reason: "source_cancelled" });
        return { result: { ok: true } };
      case "drag.readFile": {
        const file = drops.get(String(input.dropId))?.get(String(input.fileId));
        if (!file) throw Object.assign(new Error("The dropped file is no longer available."), { name: "not-found" });
        return { result: { bytes: file.bytes.slice().buffer, type: file.type } };
      }
      default:
        return undefined;
    }
  }

  function handleMessage(message: MindooDBAppBridgePortMessage) {
    if (message.kind !== "drag-file-result") return false;
    const request = fileRequests.get(message.requestId);
    if (!request) return true;
    fileRequests.delete(message.requestId);
    if (message.ok && message.bytes) request.resolve(new Blob([message.bytes], { type: message.type || request.type }));
    else request.reject(new Error(message.error || "The app could not produce the file."));
    return true;
  }

  return {
    controller,
    dispatch,
    handleMessage,
    reset() {
      finish({ action: "cancelled", reason: "hide" });
      profile = null;
      changed();
    },
  };
}
