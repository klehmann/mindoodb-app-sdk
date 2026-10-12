import { describe, expect, it, vi } from "vitest";

import type { MindooDBAppBridgePortMessage } from "../types";
import { MindooDBAppRemindersApiImpl } from "./reminders";
import type { PortRpcClient } from "./portRpcClient";

function fakeRpc(answer: (method: string, params: unknown) => unknown) {
  const listeners: Array<(message: MindooDBAppBridgePortMessage) => void> = [];
  const calls: Array<{ method: string; params: unknown }> = [];
  const rpc = {
    call: vi.fn(async (method: string, params: unknown) => {
      calls.push({ method, params });
      return answer(method, params);
    }),
    addMessageListener: (listener: (message: MindooDBAppBridgePortMessage) => void) => {
      listeners.push(listener);
      return () => {};
    },
  } as unknown as PortRpcClient;
  const push = (message: unknown) => listeners.forEach((listener) => listener(message as MindooDBAppBridgePortMessage));
  return { rpc, calls, push };
}

describe("session.reminders", () => {
  it("sends Date times as epoch milliseconds", async () => {
    const { rpc, calls } = fakeRpc(() => ({ status: "scheduled", reminder: {} }));
    const api = new MindooDBAppRemindersApiImpl(rpc);
    await api.schedule({ id: "r1", title: "Call", at: new Date(5000), target: "doc-1" });
    expect(calls[0]).toEqual({
      method: "reminders.schedule",
      params: { id: "r1", title: "Call", body: undefined, at: 5000, target: "doc-1" },
    });
  });

  it("reports unsupported on hosts without reminders", async () => {
    const { rpc } = fakeRpc(() => {
      throw Object.assign(new Error("unknown"), { code: "method-not-found" });
    });
    const api = new MindooDBAppRemindersApiImpl(rpc);
    expect(await api.schedule({ id: "r1", title: "x", at: Date.now() + 1000 })).toEqual({ status: "unsupported" });
    expect(await api.list()).toEqual([]);
    await expect(api.cancel("r1")).resolves.toBeUndefined();
  });

  it("holds taps until a handler is registered, then subscribes and delivers", async () => {
    const { rpc, calls, push } = fakeRpc(() => ({ ok: true }));
    const api = new MindooDBAppRemindersApiImpl(rpc);
    push({ protocol: "mindoodb-app-bridge", kind: "reminder-opened", reminder: { id: "r1", target: "t", action: "open" } });
    const seen: unknown[] = [];
    api.onOpened((opened) => {
      seen.push(opened);
    });
    await Promise.resolve();
    expect(calls.some((call) => call.method === "reminders.subscribe")).toBe(true);
    expect(seen).toEqual([{ id: "r1", target: "t", action: "open" }]);
  });
});

describe("mock session reminders", () => {
  it("schedules, lists and delivers a tap", async () => {
    const { createMockMindooDBAppSession } = await import("../testing");
    const mock = createMockMindooDBAppSession();
    const at = Date.now() + 60_000;
    expect((await mock.session.reminders.schedule({ id: "r1", title: "Call", at, target: "doc-1" })).status).toBe("scheduled");
    expect(await mock.session.reminders.list()).toEqual([{ id: "r1", title: "Call", at, target: "doc-1" }]);
    const seen: unknown[] = [];
    mock.session.reminders.onOpened((opened) => {
      seen.push(opened);
    });
    await mock.emitReminderOpened("r1");
    expect(seen).toEqual([{ id: "r1", target: "doc-1", action: "open" }]);
    expect(mock.listReminders()).toEqual([]);
  });
});
