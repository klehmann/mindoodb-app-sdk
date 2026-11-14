import { afterEach, describe, expect, it } from "vitest";

import { createMindooDBAppBridge } from "./createMindooDBAppBridge";
import type { MindooDBAppBridgePortMessage } from "../types";
import { createMockMindooDBAppSession, MockForbiddenError } from "../testing";
import { subtractFreeBusyIntervals } from "../freeBusy";

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
      location: { search: `?mindoodbAppLaunchId=launch-colleague-${++launchCounter}` },
      setTimeout,
      clearTimeout,
    },
    configurable: true,
  });
  return { calls, open: async () => (await createMindooDBAppBridge().connect()).openDatabase("main") };
}

const range = { from: "2026-11-09T00:00:00.000Z", to: "2026-11-10T00:00:00.000Z" };

describe("calendar.colleagueEvents / sharedCalendars (bridge client)", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("asks the host and passes the answer through", async () => {
    const answer = [{ username: "CN=Ben/O=Acme", level: "business", state: "ok", events: [], busy: [] }];
    const host = connectToHost({
      "calendar.colleagueEvents": () => answer,
      "calendar.sharedCalendars": () => [{ username: "CN=Ben/O=Acme", level: "business" }],
    });
    const db = await host.open();
    expect(await db.calendar.colleagueEvents({ usernames: ["CN=Ben/O=Acme"], ...range })).toEqual(answer);
    expect(host.calls.find((call) => call.method === "calendar.colleagueEvents")?.params).toEqual({
      databaseId: "main",
      usernames: ["CN=Ben/O=Acme"],
      ...range,
    });
    expect(await db.calendar.sharedCalendars()).toEqual([{ username: "CN=Ben/O=Acme", level: "business" }]);
  });

  it("older hosts: nothing shared", async () => {
    const host = connectToHost({});
    const db = await host.open();
    expect(await db.calendar.colleagueEvents({ usernames: ["a"], ...range })).toEqual([
      { username: "a", level: "none", state: "unknown", events: [], busy: [] },
    ]);
    expect(await db.calendar.sharedCalendars()).toEqual([]);
  });

  it("rejects more than 20 people before asking", async () => {
    const host = connectToHost({ "calendar.colleagueEvents": () => [] });
    const db = await host.open();
    const usernames = Array.from({ length: 21 }, (_, index) => `u${index}`);
    await expect(db.calendar.colleagueEvents({ usernames, ...range })).rejects.toThrow(RangeError);
    expect(host.calls.some((call) => call.method === "calendar.colleagueEvents")).toBe(false);
  });
});

describe("calendar.colleagueEvents (mock host)", () => {
  const ten = { start: "2026-11-09T10:00:00.000Z", end: "2026-11-09T11:00:00.000Z" };
  const two = { start: "2026-11-09T14:00:00.000Z", end: "2026-11-09T15:00:00.000Z" };
  const people = [
    {
      username: "CN=Ben/O=Acme",
      level: "business" as const,
      busy: [{ ...ten, status: "busy" as const }, { ...two, status: "busy" as const }],
      events: [
        { ...ten, allDay: false, title: "Review", location: "Room 1", status: "busy" as const },
        { ...two, allDay: false, title: "Doctor", location: "", status: "busy" as const, private: true },
      ],
    },
    { username: "CN=Carla/O=Acme", level: "all" as const, events: [{ ...two, allDay: false, title: "Doctor", location: "", status: "busy" as const, private: true }] },
    { username: "CN=Dora/O=Acme", busy: [{ ...ten, status: "busy" as const }] },
  ];

  it("shows business appointments, private ones only at all, the rest as busy", async () => {
    const mock = createMockMindooDBAppSession({
      databases: [{ info: { id: "main", title: "Main", capabilities: ["read", "calendarshare"] } }],
      freeBusy: people,
      enforceCapabilities: true,
    });
    const db = await (await mock.bridge.connect()).openDatabase("main");
    const [ben, carla, dora, eve] = await db.calendar.colleagueEvents({
      usernames: ["CN=Ben/O=Acme", "CN=Carla/O=Acme", "CN=Dora/O=Acme", "CN=Eve/O=Acme"],
      ...range,
    });
    expect(ben!.level).toBe("business");
    expect(ben!.events.map((event) => event.title)).toEqual(["Review"]);
    expect(ben!.busy).toEqual([{ ...two, status: "busy" }]);
    expect(carla!.events.map((event) => event.title)).toEqual(["Doctor"]);
    expect(carla!.busy).toEqual([]);
    expect(dora).toMatchObject({ level: "busy", events: [], busy: [{ ...ten, status: "busy" }] });
    expect(eve).toMatchObject({ level: "none", state: "unknown" });
    expect((await db.calendar.sharedCalendars()).map((entry) => entry.username)).toEqual([
      "CN=Ben/O=Acme",
      "CN=Carla/O=Acme",
    ]);
  });

  it("needs the calendarshare capability when capabilities are enforced", async () => {
    const mock = createMockMindooDBAppSession({
      databases: [{ info: { id: "main", title: "Main", capabilities: ["read", "freebusy"] } }],
      freeBusy: people,
      enforceCapabilities: true,
    });
    const db = await (await mock.bridge.connect()).openDatabase("main");
    await expect(db.calendar.colleagueEvents({ usernames: ["CN=Ben/O=Acme"], ...range })).rejects.toBeInstanceOf(
      MockForbiddenError,
    );
    await expect(db.calendar.freeBusy({ usernames: ["CN=Ben/O=Acme"], ...range })).resolves.toHaveLength(1);
  });
});

describe("subtractFreeBusyIntervals", () => {
  it("cuts the covered parts out", () => {
    expect(
      subtractFreeBusyIntervals(
        [{ start: "2026-11-09T09:00:00.000Z", end: "2026-11-09T12:00:00.000Z", status: "busy" }],
        [{ start: "2026-11-09T10:00:00.000Z", end: "2026-11-09T11:00:00.000Z" }],
      ),
    ).toEqual([
      { start: "2026-11-09T09:00:00.000Z", end: "2026-11-09T10:00:00.000Z", status: "busy" },
      { start: "2026-11-09T11:00:00.000Z", end: "2026-11-09T12:00:00.000Z", status: "busy" },
    ]);
  });
});
