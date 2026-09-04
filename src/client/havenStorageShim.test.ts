import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MindooDBAppBridge, MindooDBAppSession } from "../types";
import { installHavenStorageShim, type HavenStorageShimHandle } from "./havenStorageShim";

interface FakeHost {
  bridge: MindooDBAppBridge;
  entries: Map<string, string>;
  setCalls: { key: string; value: string }[];
  removeCalls: string[];
  snapshotCalls: number;
  /** Runs the app's before-close listeners, as the host does before a teardown. */
  requestBeforeClose(): Promise<void>;
}

function createFakeHost(
  initial: Record<string, string> = {},
  overrides: { connect?: () => Promise<MindooDBAppSession> } = {},
): FakeHost {
  const entries = new Map(Object.entries(initial));
  const setCalls: { key: string; value: string }[] = [];
  const removeCalls: string[] = [];
  const beforeCloseListeners = new Set<() => void | Promise<void>>();
  const host: FakeHost = {
    bridge: null as never,
    entries,
    setCalls,
    removeCalls,
    snapshotCalls: 0,
    async requestBeforeClose() {
      await Promise.all([...beforeCloseListeners].map(async (listener) => listener()));
    },
  };

  const session = {
    onBeforeClose(listener: () => void | Promise<void>) {
      beforeCloseListeners.add(listener);
      return () => beforeCloseListeners.delete(listener);
    },
    storage: {
      async snapshot({ prefixes }: { prefixes?: string[] } = {}) {
        host.snapshotCalls += 1;
        const result: Record<string, string> = {};
        entries.forEach((value, key) => {
          if (!prefixes?.length || prefixes.some((prefix) => key.startsWith(prefix))) {
            result[key] = value;
          }
        });
        return result;
      },
      async get(key: string) {
        return entries.get(key) ?? null;
      },
      async set(key: string, value: string) {
        setCalls.push({ key, value });
        entries.set(key, value);
      },
      async remove(key: string) {
        removeCalls.push(key);
        entries.delete(key);
      },
      async keys() {
        return [...entries.keys()];
      },
      async clear() {
        entries.clear();
      },
    },
  } as unknown as MindooDBAppSession;

  host.bridge = {
    connect: overrides.connect ?? (async () => session),
  };
  return host;
}

let handle: HavenStorageShimHandle | null = null;

beforeEach(() => {
  // The shim defines its globals on `window`. Pointing `window` at the realm's global
  // object reproduces the browser, where `window === globalThis` and a bare
  // `localStorage` reference therefore resolves to the installed shim.
  Object.defineProperty(globalThis, "window", {
    value: globalThis,
    configurable: true,
    writable: true,
  });
});

afterEach(async () => {
  await handle?.uninstall();
  handle = null;
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, "window");
});

describe("installHavenStorageShim", () => {
  it("does nothing outside hosted mode", async () => {
    const host = createFakeHost();
    handle = await installHavenStorageShim({
      hosting: "external",
      bridge: host.bridge,
      persistPrefixes: ["app-"],
    });

    expect(handle.installed).toBe(false);
    expect(Object.getOwnPropertyDescriptor(window, "localStorage")).toBeUndefined();
    expect(host.snapshotCalls).toBe(0);
  });

  it("hydrates from the host in a single round trip and reads synchronously", async () => {
    const host = createFakeHost({ "app-theme": "dark", "other-key": "ignored" });
    handle = await installHavenStorageShim({
      hosting: "hosted",
      bridge: host.bridge,
      persistPrefixes: ["app-"],
    });

    expect(handle.connected).toBe(true);
    expect(host.snapshotCalls).toBe(1);
    expect(localStorage.getItem("app-theme")).toBe("dark");
    expect(localStorage.getItem("other-key")).toBeNull();
    expect(localStorage.getItem("missing")).toBeNull();
  });

  it("coalesces repeated writes to the same key into the last value", async () => {
    vi.useFakeTimers();
    const host = createFakeHost();
    handle = await installHavenStorageShim({
      hosting: "hosted",
      bridge: host.bridge,
      persistPrefixes: ["app-"],
      coalesceMs: 200,
    });

    for (let width = 300; width < 360; width += 1) {
      localStorage.setItem("app-width", String(width));
      // Reads stay exact while the write-through is still queued.
      expect(localStorage.getItem("app-width")).toBe(String(width));
      vi.advanceTimersByTime(16);
    }

    await handle.flush();

    expect(host.setCalls).toEqual([{ key: "app-width", value: "359" }]);
  });

  it("persists a continuously rewritten key instead of starving it", async () => {
    vi.useFakeTimers();
    const host = createFakeHost();
    handle = await installHavenStorageShim({
      hosting: "hosted",
      bridge: host.bridge,
      persistPrefixes: ["app-"],
      coalesceMs: 100,
    });

    // Never idles long enough for a plain trailing debounce to fire.
    for (let tick = 0; tick < 60; tick += 1) {
      localStorage.setItem("app-width", String(tick));
      await vi.advanceTimersByTimeAsync(16);
    }

    expect(host.setCalls.length).toBeGreaterThan(0);
    expect(host.setCalls.length).toBeLessThan(10);
  });

  it("flushes queued writes when the host announces a teardown", async () => {
    vi.useFakeTimers();
    const host = createFakeHost();
    handle = await installHavenStorageShim({
      hosting: "hosted",
      bridge: host.bridge,
      persistPrefixes: ["app-"],
      coalesceMs: 200,
    });

    localStorage.setItem("app-width", "420");
    // Still inside the coalescing window: removing the iframe now would lose the write.
    expect(host.setCalls).toEqual([]);

    await host.requestBeforeClose();

    expect(host.setCalls).toEqual([{ key: "app-width", value: "420" }]);
  });

  it("keeps keys outside the persist prefixes in memory only", async () => {
    const host = createFakeHost();
    handle = await installHavenStorageShim({
      hosting: "hosted",
      bridge: host.bridge,
      persistPrefixes: ["app-"],
      coalesceMs: 0,
    });

    localStorage.setItem("scratch", "value");
    await handle.flush();

    expect(localStorage.getItem("scratch")).toBe("value");
    expect(host.setCalls).toEqual([]);
  });

  it("forwards removals and clear to the host", async () => {
    const host = createFakeHost({ "app-a": "1", "app-b": "2" });
    handle = await installHavenStorageShim({
      hosting: "hosted",
      bridge: host.bridge,
      persistPrefixes: ["app-"],
      coalesceMs: 0,
    });

    localStorage.removeItem("app-a");
    await handle.flush();
    expect(host.removeCalls).toEqual(["app-a"]);

    localStorage.clear();
    await handle.flush();
    expect(host.removeCalls.sort()).toEqual(["app-a", "app-b"]);
    expect(localStorage.length).toBe(0);
  });

  it("throws QuotaExceededError synchronously, like real localStorage", async () => {
    const host = createFakeHost();
    handle = await installHavenStorageShim({
      hosting: "hosted",
      bridge: host.bridge,
      persistPrefixes: ["app-"],
      quotaBytes: 100,
      maxValueBytes: 60,
    });

    expect(() => localStorage.setItem("app-big", "x".repeat(61))).toThrow(
      expect.objectContaining({ name: "QuotaExceededError" }),
    );
    expect(() => localStorage.setItem("app-a", "x".repeat(50))).not.toThrow();
    expect(() => localStorage.setItem("app-b", "x".repeat(50))).toThrow(
      expect.objectContaining({ name: "QuotaExceededError" }),
    );
    // The rejected write left no trace.
    expect(localStorage.getItem("app-b")).toBeNull();

    // Freeing space makes room again — the accounting is not one-way.
    localStorage.removeItem("app-a");
    expect(() => localStorage.setItem("app-b", "x".repeat(50))).not.toThrow();
  });

  it("does not count in-memory keys against the host quota", async () => {
    const host = createFakeHost();
    handle = await installHavenStorageShim({
      hosting: "hosted",
      bridge: host.bridge,
      persistPrefixes: ["app-"],
      quotaBytes: 100,
      maxValueBytes: 100,
    });

    expect(() => localStorage.setItem("scratch", "x".repeat(5000))).not.toThrow();
    expect(() => localStorage.setItem("app-a", "x".repeat(50))).not.toThrow();
  });

  it("boots with empty storage when the host stays silent", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const host = createFakeHost({ "app-theme": "dark" }, { connect: () => new Promise(() => {}) });

    const pendingInstall = installHavenStorageShim({
      hosting: "hosted",
      bridge: host.bridge,
      persistPrefixes: ["app-"],
      timeoutMs: 2000,
    });
    await vi.advanceTimersByTimeAsync(2000);
    handle = await pendingInstall;

    expect(handle.installed).toBe(true);
    expect(handle.connected).toBe(false);
    expect(localStorage.getItem("app-theme")).toBeNull();
    // The app keeps working; the value simply does not survive the launch.
    localStorage.setItem("app-theme", "light");
    expect(localStorage.getItem("app-theme")).toBe("light");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("supports named property access the way localStorage does", async () => {
    const host = createFakeHost({ "app-theme": "dark" });
    handle = await installHavenStorageShim({
      hosting: "hosted",
      bridge: host.bridge,
      persistPrefixes: ["app-"],
      coalesceMs: 0,
    });

    const store = localStorage as unknown as Record<string, unknown>;
    expect(store["app-theme"]).toBe("dark");
    expect("app-theme" in store).toBe(true);
    expect(Object.keys(localStorage)).toEqual(["app-theme"]);
    expect(localStorage.key(0)).toBe("app-theme");
    expect(localStorage.length).toBe(1);

    store["app-mode"] = "compact";
    await handle.flush();
    expect(host.setCalls).toEqual([{ key: "app-mode", value: "compact" }]);

    delete store["app-theme"];
    await handle.flush();
    expect(host.removeCalls).toEqual(["app-theme"]);
    expect(localStorage.getItem("app-theme")).toBeNull();
  });

  it("shims sessionStorage without writing through", async () => {
    const host = createFakeHost();
    handle = await installHavenStorageShim({
      hosting: "hosted",
      bridge: host.bridge,
      persistPrefixes: ["app-"],
      coalesceMs: 0,
    });

    sessionStorage.setItem("app-boot-attempts", "2");
    await handle.flush();

    expect(sessionStorage.getItem("app-boot-attempts")).toBe("2");
    expect(host.setCalls).toEqual([]);
  });

  it("restores the original globals on uninstall", async () => {
    const host = createFakeHost();
    const shim = await installHavenStorageShim({
      hosting: "hosted",
      bridge: host.bridge,
      persistPrefixes: ["app-"],
    });

    expect(Object.getOwnPropertyDescriptor(window, "localStorage")).toBeDefined();
    await shim.uninstall();
    expect(Object.getOwnPropertyDescriptor(window, "localStorage")).toBeUndefined();
  });
});
