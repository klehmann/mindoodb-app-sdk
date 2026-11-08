import { afterEach, describe, expect, it } from "vitest";

import { createMindooDBAppBridge } from "./createMindooDBAppBridge";
import type { MindooDBAppBridgePortMessage } from "../types";
import { createFakeBridgeHost, createMockMindooDBAppSession, MockForbiddenError } from "../testing";

let launchCounter = 0;

/** A host that answers the methods in `answers`; everything else is unknown to it, like an older Haven. */
function connectToHost(answers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const host = {
    postMessage(_message: unknown, _targetOrigin?: string, transfer?: Transferable[]) {
      const port = transfer?.[0] as MessagePort | undefined;
      if (!port) throw new Error("Expected bridge connection port transfer.");
      port.addEventListener("message", (event: MessageEvent<MindooDBAppBridgePortMessage>) => {
        const message = event.data;
        if (message.kind !== "request") return;
        const params = (message.params ?? {}) as Record<string, unknown>;
        calls.push({ method: message.method, params });
        const answer = message.method === "session.openDatabase" ? () => ({ ok: true }) : answers[message.method];
        port.postMessage(
          answer
            ? { protocol: "mindoodb-app-bridge", kind: "success", id: message.id, result: answer(params) }
            : {
                protocol: "mindoodb-app-bridge",
                kind: "error",
                id: message.id,
                error: { code: "method-not-found", message: "Unknown method." },
              },
        );
      });
      port.start();
      port.postMessage({ protocol: "mindoodb-app-bridge", type: "mindoodb-app:connected" });
    },
  };
  Object.defineProperty(globalThis, "window", {
    value: {
      parent: host,
      opener: null,
      location: { search: `?mindoodbAppLaunchId=launch-free-busy-${++launchCounter}` },
      setTimeout,
      clearTimeout,
    },
    configurable: true,
  });
  return { calls, open: async () => (await createMindooDBAppBridge().connect()).openDatabase("main") };
}

const range = { from: "2026-11-09T00:00:00.000Z", to: "2026-11-10T00:00:00.000Z" };

describe("calendar.freeBusy (bridge client)", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("asks the host with databaseId, usernames and the range", async () => {
    const answer = [{ username: "CN=Ben/O=Acme", state: "ok", busy: [], computedAt: range.from }];
    const host = connectToHost({ "calendar.freeBusy": () => answer });
    const db = await host.open();
    expect(await db.calendar.freeBusy({ usernames: ["CN=Ben/O=Acme"], ...range })).toEqual(answer);
    expect(host.calls.find((call) => call.method === "calendar.freeBusy")?.params).toEqual({
      databaseId: "main",
      usernames: ["CN=Ben/O=Acme"],
      ...range,
    });
  });

  it("older hosts: everyone unknown; nobody asked: no call", async () => {
    const host = connectToHost({});
    const db = await host.open();
    expect(await db.calendar.freeBusy({ usernames: ["a", "b"], ...range })).toEqual([
      { username: "a", state: "unknown", busy: [] },
      { username: "b", state: "unknown", busy: [] },
    ]);
    const before = host.calls.length;
    expect(await db.calendar.freeBusy({ usernames: [], ...range })).toEqual([]);
    expect(host.calls.length).toBe(before);
  });

  it("rejects requests over the limits before asking", async () => {
    const host = connectToHost({ "calendar.freeBusy": () => [] });
    const db = await host.open();
    await expect(
      db.calendar.freeBusy({ usernames: ["a"], from: range.from, to: "2027-03-01T00:00:00Z" }),
    ).rejects.toThrow(RangeError);
    expect(host.calls.some((call) => call.method === "calendar.freeBusy")).toBe(false);
  });
});

describe("calendar.freeBusy (mock host)", () => {
  const people = [
    {
      username: "CN=Ben/O=Acme",
      busy: [{ start: "2026-11-09T10:00:00Z", end: "2026-11-09T11:00:00Z", status: "busy" as const }],
      computedAt: "2026-11-08T10:00:00.000Z",
    },
    { username: "CN=Carla/O=Acme", state: "unpublished" as const },
  ];

  it("answers from the freeBusy option and setFreeBusy replaces it", async () => {
    const mock = createMockMindooDBAppSession({
      databases: [{ info: { id: "main", title: "Main", capabilities: ["read", "freebusy"] } }],
      freeBusy: people,
      enforceCapabilities: true,
    });
    const db = await (await mock.bridge.connect()).openDatabase("main");
    const result = await db.calendar.freeBusy({ usernames: ["CN=Ben/O=Acme", "CN=Carla/O=Acme", "CN=Dora/O=Acme"], ...range });
    expect(result.map((entry) => entry.state)).toEqual(["ok", "unpublished", "unknown"]);
    expect(result[0]!.busy).toEqual([
      { start: "2026-11-09T10:00:00.000Z", end: "2026-11-09T11:00:00.000Z", status: "busy" },
    ]);
    mock.setFreeBusy([]);
    expect((await db.calendar.freeBusy({ usernames: ["CN=Ben/O=Acme"], ...range }))[0]!.state).toBe("unknown");
  });

  it("needs the freebusy capability when capabilities are enforced", async () => {
    const mock = createMockMindooDBAppSession({
      databases: [{ info: { id: "main", title: "Main", capabilities: ["read", "directory"] } }],
      freeBusy: people,
      enforceCapabilities: true,
    });
    const db = await (await mock.bridge.connect()).openDatabase("main");
    await expect(db.calendar.freeBusy({ usernames: ["CN=Ben/O=Acme"], ...range })).rejects.toBeInstanceOf(MockForbiddenError);
  });

  it("the fake bridge host answers calendar.freeBusy over the wire", async () => {
    const host = createFakeBridgeHost({
      databases: [{ info: { id: "main", title: "Main", capabilities: ["read", "freebusy"] } }],
      freeBusy: people,
    });
    host.install();
    try {
      const db = await (await createMindooDBAppBridge().connect()).openDatabase("main");
      const result = await db.calendar.freeBusy({ usernames: ["CN=Carla/O=Acme", "CN=Ben/O=Acme"], ...range });
      expect(result.map((entry) => entry.state)).toEqual(["unpublished", "ok"]);
      expect(result[1]!.computedAt).toBe("2026-11-08T10:00:00.000Z");
      host.setFreeBusy([]);
      expect((await db.calendar.freeBusy({ usernames: ["CN=Ben/O=Acme"], ...range }))[0]!.state).toBe("unknown");
    } finally {
      host.dispose();
    }
  });
});
