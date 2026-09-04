import type { MindooDBAppBridge, MindooDBAppHostingMode, MindooDBAppSession } from "../types";
import { createMindooDBAppBridge } from "./createMindooDBAppBridge";
import { readMindooDBAppHostingMode } from "./hosting";

/**
 * A `localStorage` replacement for apps running from a host-served bundle.
 *
 * A hosted app lives in an opaque origin, where reading `window.localStorage` throws a
 * `SecurityError`. Note that the property still *exists*, so `typeof localStorage` style
 * feature detection reports success and the app crashes on first access anyway.
 *
 * The shim keeps the app's synchronous call sites intact by holding every value in memory
 * and mirroring the keys the app asked to persist through to the host over the (async)
 * bridge. That trade is only sound because of three properties:
 *
 * - **Hydration is complete.** Only keys under a `persistPrefix` are ever written to the
 *   host, so one `appStorage.snapshot({ prefixes })` at boot provably returns everything
 *   a later `getItem` could find. Reads never need to consult the host again.
 * - **Writes are coalesced.** High-frequency writers exist in the wild — a resize handler
 *   that persists a width on every `pointermove` would otherwise turn into ~60
 *   `postMessage` calls per second.
 * - **Quota is accounted locally.** Real `setItem` reports quota failures synchronously by
 *   throwing. The shim cannot await the host's verdict, so it tracks the same budget
 *   itself and throws rather than silently dropping data.
 *
 * Not emulated: the `storage` event, and cross-instance consistency between two launches
 * of the same app. Their in-memory maps drift apart and the last writer wins — the same
 * outcome two browser tabs have today, minus the event.
 */

/** Mirrors the host-side budget in `bridgeHost.ts`. */
const DEFAULT_QUOTA_BYTES = 256 * 1024;
const DEFAULT_MAX_VALUE_BYTES = 64 * 1024;
const DEFAULT_COALESCE_MS = 200;
const DEFAULT_TIMEOUT_MS = 2000;

/** Upper bound on how long a continuously-rewritten key may stay unpersisted. */
const MAX_COALESCE_MULTIPLIER = 5;

export interface InstallHavenStorageShimOptions {
  /**
   * Key prefixes whose values are written through to the host and restored on the next
   * launch. Keys outside these prefixes stay in memory for the lifetime of the document.
   */
  persistPrefixes?: string[];
  /** Give up waiting for the host and boot with empty storage. Defaults to 2000 ms. */
  timeoutMs?: number;
  /** Debounce window for write-through. Defaults to 200 ms. */
  coalesceMs?: number;
  /** Total budget for persisted keys, matching the host. Defaults to 256 KiB. */
  quotaBytes?: number;
  /** Largest single persisted value, matching the host. Defaults to 64 KiB. */
  maxValueBytes?: number;
  /** Also replace `sessionStorage` with an in-memory shim. Defaults to `true`. */
  shimSessionStorage?: boolean;
  /** Overrides the hosting mode detected from the URL. Intended for tests. */
  hosting?: MindooDBAppHostingMode;
  /** Overrides the bridge used to reach the host. Intended for tests. */
  bridge?: MindooDBAppBridge;
  /** Forwarded to `bridge.connect()` when the URL carries no launch id. */
  launchId?: string;
}

export interface HavenStorageShimHandle {
  /** False when the app is not running hosted; nothing was replaced in that case. */
  installed: boolean;
  /** True once storage was hydrated from the host. False after a boot timeout. */
  connected: boolean;
  /** Writes out everything still pending. Resolves once the host has acknowledged. */
  flush(): Promise<void>;
  /** Restores the original globals. Pending writes are flushed first. */
  uninstall(): Promise<void>;
}

const textEncoder = typeof TextEncoder === "undefined" ? null : new TextEncoder();

function byteLength(value: string) {
  return textEncoder ? textEncoder.encode(value).byteLength : value.length;
}

function createQuotaExceededError(message: string) {
  if (typeof DOMException === "function") {
    return new DOMException(message, "QuotaExceededError");
  }
  const error = new Error(message);
  error.name = "QuotaExceededError";
  return error;
}

const STORAGE_MEMBERS = ["length", "key", "getItem", "setItem", "removeItem", "clear"] as const;

interface StorageBackendOptions {
  quotaBytes: number;
  maxValueBytes: number;
  isPersisted: (key: string) => boolean;
  onPersistedChange: (key: string, value: string | null) => void;
}

/**
 * Builds a `Storage`-shaped Proxy over an in-memory map.
 *
 * A Proxy rather than a plain object because `localStorage` exposes its keys as named
 * properties: `localStorage.foo`, `delete localStorage.foo` and `Object.keys(localStorage)`
 * all have to keep working for apps that use that style.
 */
function createStorageBackend(options: StorageBackendOptions) {
  const entries = new Map<string, string>();
  let persistedBytes = 0;

  function entrySize(key: string, value: string) {
    return byteLength(key) + byteLength(value);
  }

  function write(key: string, value: string, { fromHost }: { fromHost: boolean }) {
    const persisted = options.isPersisted(key);

    if (persisted && !fromHost) {
      // Quota only guards persisted keys: those are the ones the host can refuse, and
      // reporting that refusal synchronously is the whole point of the accounting.
      if (byteLength(value) > options.maxValueBytes) {
        throw createQuotaExceededError(
          `Value for "${key}" exceeds the ${options.maxValueBytes} byte per-value limit.`,
        );
      }
      const previous = entries.get(key);
      const delta = entrySize(key, value) - (previous === undefined ? 0 : entrySize(key, previous));
      if (persistedBytes + delta > options.quotaBytes) {
        throw createQuotaExceededError(
          `Storing "${key}" would exceed the ${options.quotaBytes} byte storage quota.`,
        );
      }
      persistedBytes += delta;
    } else if (persisted) {
      const previous = entries.get(key);
      persistedBytes +=
        entrySize(key, value) - (previous === undefined ? 0 : entrySize(key, previous));
    }

    entries.set(key, value);
    if (persisted && !fromHost) {
      options.onPersistedChange(key, value);
    }
  }

  function remove(key: string, { fromHost }: { fromHost: boolean }) {
    const previous = entries.get(key);
    if (previous === undefined) {
      return;
    }
    entries.delete(key);
    if (options.isPersisted(key)) {
      persistedBytes -= entrySize(key, previous);
      if (!fromHost) {
        options.onPersistedChange(key, null);
      }
    }
  }

  const target = {
    get length() {
      return entries.size;
    },
    key(index: number): string | null {
      return [...entries.keys()][index] ?? null;
    },
    getItem(key: string): string | null {
      const value = entries.get(String(key));
      return value === undefined ? null : value;
    },
    setItem(key: string, value: string): void {
      write(String(key), String(value), { fromHost: false });
    },
    removeItem(key: string): void {
      remove(String(key), { fromHost: false });
    },
    clear(): void {
      [...entries.keys()].forEach((key) => remove(key, { fromHost: false }));
    },
  };

  const memberNames = new Set<string>(STORAGE_MEMBERS);

  const storage = new Proxy(target, {
    get(proxyTarget, property, receiver) {
      if (typeof property === "symbol" || memberNames.has(property)) {
        return Reflect.get(proxyTarget, property, receiver);
      }
      return entries.get(property);
    },
    set(proxyTarget, property, value, receiver) {
      if (typeof property === "symbol" || memberNames.has(property)) {
        return Reflect.set(proxyTarget, property, value, receiver);
      }
      write(property, String(value), { fromHost: false });
      return true;
    },
    has(proxyTarget, property) {
      if (typeof property === "symbol" || memberNames.has(property)) {
        return Reflect.has(proxyTarget, property);
      }
      return entries.has(property);
    },
    deleteProperty(proxyTarget, property) {
      if (typeof property === "symbol" || memberNames.has(property)) {
        return Reflect.deleteProperty(proxyTarget, property);
      }
      remove(property, { fromHost: false });
      return true;
    },
    ownKeys() {
      return [...entries.keys()];
    },
    getOwnPropertyDescriptor(proxyTarget, property) {
      if (typeof property === "symbol" || memberNames.has(property)) {
        return Reflect.getOwnPropertyDescriptor(proxyTarget, property);
      }
      const value = entries.get(property);
      if (value === undefined) {
        return undefined;
      }
      return { value, writable: true, enumerable: true, configurable: true };
    },
  }) as unknown as Storage;

  return {
    storage,
    /** Seeds values from the host without counting them as app-initiated writes. */
    hydrate(values: Record<string, string>) {
      Object.entries(values).forEach(([key, value]) => {
        write(key, value, { fromHost: true });
      });
    },
  };
}

function replaceGlobal(name: "localStorage" | "sessionStorage", value: Storage) {
  const previous = Object.getOwnPropertyDescriptor(window, name);
  // Defining an own property on the window shadows the accessor inherited from
  // Window.prototype, so the throwing getter is never invoked.
  Object.defineProperty(window, name, { value, configurable: true, writable: false });
  return () => {
    if (previous) {
      Object.defineProperty(window, name, previous);
    } else {
      Reflect.deleteProperty(window, name);
    }
  };
}

/**
 * Installs the storage shim when the app runs from a host-served bundle.
 *
 * Call this during boot, before any app module touches `localStorage`, and await it:
 *
 * ```ts
 * await installHavenStorageShim({ persistPrefixes: ["my-app-"] });
 * await import("./main");
 * ```
 *
 * Outside hosted mode this is a no-op and the real `localStorage` stays in place.
 */
export async function installHavenStorageShim(
  options: InstallHavenStorageShimOptions = {},
): Promise<HavenStorageShimHandle> {
  const hosting = options.hosting ?? readMindooDBAppHostingMode();
  if (hosting !== "hosted" || typeof window === "undefined") {
    return {
      installed: false,
      connected: false,
      flush: async () => {},
      uninstall: async () => {},
    };
  }

  const persistPrefixes = options.persistPrefixes ?? [];
  const coalesceMs = options.coalesceMs ?? DEFAULT_COALESCE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let session: MindooDBAppSession | null = null;
  const pending = new Map<string, string | null>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let deadline = 0;
  let flushChain: Promise<void> = Promise.resolve();

  function isPersisted(key: string) {
    return persistPrefixes.some((prefix) => key.startsWith(prefix));
  }

  function runFlush(): Promise<void> {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    deadline = 0;

    const batch = [...pending.entries()];
    pending.clear();
    if (!batch.length || !session) {
      return flushChain;
    }

    const active = session;
    flushChain = flushChain
      .then(async () => {
        for (const [key, value] of batch) {
          if (value === null) {
            await active.storage.remove(key);
          } else {
            await active.storage.set(key, value);
          }
        }
      })
      .catch((error: unknown) => {
        // Nothing to propagate to: the write already returned to the app. Losing a
        // preference must not take the app down, but it must not pass unnoticed either.
        console.warn("[mindoodb-app-sdk] Failed to persist app storage to the host.", error);
      });

    return flushChain;
  }

  function scheduleFlush() {
    if (!session) {
      return;
    }
    const now = Date.now();
    if (deadline === 0) {
      // A key rewritten on every animation frame would keep resetting a plain debounce
      // and never reach the host. Cap the total delay so writes still land mid-drag.
      deadline = now + coalesceMs * MAX_COALESCE_MULTIPLIER;
    }
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
    }
    flushTimer = setTimeout(() => void runFlush(), Math.max(0, Math.min(coalesceMs, deadline - now)));
  }

  /**
   * Drains the queue completely. A write issued while an earlier batch is in flight lands
   * in a fresh batch, so one pass is not always enough; the bound keeps a pathological
   * writer from blocking teardown forever.
   */
  async function flushAll() {
    for (let pass = 0; pass < 3 && pending.size; pass += 1) {
      await runFlush();
    }
    await flushChain;
  }

  const backend = createStorageBackend({
    quotaBytes: options.quotaBytes ?? DEFAULT_QUOTA_BYTES,
    maxValueBytes: options.maxValueBytes ?? DEFAULT_MAX_VALUE_BYTES,
    isPersisted,
    onPersistedChange(key, value) {
      pending.set(key, value);
      scheduleFlush();
    },
  });

  const restoreLocal = replaceGlobal("localStorage", backend.storage);
  const restoreSession =
    options.shimSessionStorage === false
      ? null
      : replaceGlobal(
          "sessionStorage",
          createStorageBackend({
            quotaBytes: Number.POSITIVE_INFINITY,
            maxValueBytes: Number.POSITIVE_INFINITY,
            isPersisted: () => false,
            onPersistedChange: () => {},
          }).storage,
        );

  let connected = false;
  if (persistPrefixes.length) {
    const bridge = options.bridge ?? createMindooDBAppBridge();
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      const connectedSession = await Promise.race([
        bridge.connect(options.launchId ? { launchId: options.launchId } : undefined),
        new Promise<never>((_resolve, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error(`Host did not answer within ${timeoutMs} ms.`)),
            timeoutMs,
          );
        }),
      ]);
      backend.hydrate(await connectedSession.storage.snapshot({ prefixes: persistPrefixes }));
      session = connectedSession;
      connected = true;
      // The coalescing window means a write can still be queued when the host decides to
      // tear the iframe down. Removing the frame would drop it, so flush on request.
      connectedSession.onBeforeClose(() => flushAll());
    } catch (error) {
      // A host that does not answer must not keep the app from starting. Storage stays
      // in memory for this launch; the app sees defaults instead of an exception.
      console.warn(
        "[mindoodb-app-sdk] App storage is not connected to the host; running in-memory only.",
        error,
      );
    } finally {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  return {
    installed: true,
    connected,
    flush: flushAll,
    async uninstall() {
      await flushAll();
      restoreLocal();
      restoreSession?.();
    },
  };
}
