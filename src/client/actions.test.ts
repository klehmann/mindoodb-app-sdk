import { describe, expect, it, vi } from "vitest";

import { validateMindooDBAppActions } from "../appDefinition";
import type { MindooDBAppBridgePortMessage } from "../types";
import { MindooDBAppActionsApiImpl } from "./actions";
import type { PortRpcClient } from "./portRpcClient";

function fakeRpc() {
  const listeners: Array<(message: MindooDBAppBridgePortMessage) => void> = [];
  const calls: string[] = [];
  const rpc = {
    call: vi.fn(async (method: string) => {
      calls.push(method);
      return { ok: true };
    }),
    addMessageListener: (listener: (message: MindooDBAppBridgePortMessage) => void) => {
      listeners.push(listener);
      return () => {};
    },
  } as unknown as PortRpcClient;
  const push = (message: unknown) => listeners.forEach((listener) => listener(message as MindooDBAppBridgePortMessage));
  return { rpc, calls, push };
}

describe("session.actions", () => {
  it("holds runs until a handler is registered, then subscribes and delivers", async () => {
    const { rpc, calls, push } = fakeRpc();
    const api = new MindooDBAppActionsApiImpl(rpc);
    const invoked = { id: "timer-toggle", source: "shortcut", invokedAt: 1 };
    push({ protocol: "mindoodb-app-bridge", kind: "action-invoked", action: invoked });
    const seen: unknown[] = [];
    const stop = api.onInvoked((run) => {
      seen.push(run);
    });
    await Promise.resolve();
    expect(calls).toContain("actions.subscribe");
    expect(seen).toEqual([invoked]);
    push({ protocol: "mindoodb-app-bridge", kind: "action-invoked", action: { ...invoked, text: "x" } });
    await Promise.resolve();
    expect(seen).toHaveLength(2);
    stop();
    expect(calls).toContain("actions.unsubscribe");
  });
});

describe("actions in the app definition", () => {
  it("keeps valid actions with localized titles and text", () => {
    const { actions, errors } = validateMindooDBAppActions([
      { id: "new-task", title: { en: "New task", de: "Neue Aufgabe" }, text: { label: "Title", required: true } },
      { id: "timer", title: "Start or stop timer", description: "Toggles the running timer." },
    ]);
    expect(errors).toEqual([]);
    expect(actions).toEqual([
      { id: "new-task", title: { en: "New task", de: "Neue Aufgabe" }, text: { label: "Title", required: true } },
      { id: "timer", title: "Start or stop timer", description: "Toggles the running timer." },
    ]);
  });

  it("rejects bad ids, duplicates and missing titles", () => {
    expect(validateMindooDBAppActions([{ id: "Bad Id", title: "x" }]).errors).toHaveLength(1);
    expect(validateMindooDBAppActions([{ id: "a", title: "x" }, { id: "a", title: "y" }]).errors).toHaveLength(1);
    expect(validateMindooDBAppActions([{ id: "a" }]).errors.length).toBeGreaterThan(0);
    expect(validateMindooDBAppActions([{ id: "a", title: "x", text: {} }]).errors.length).toBeGreaterThan(0);
  });
});

describe("mock session actions", () => {
  it("delivers a run, also one from before registration", async () => {
    const { createMockMindooDBAppSession } = await import("../testing");
    const mock = createMockMindooDBAppSession();
    await mock.emitActionInvoked("new-task", "  Milk ");
    const seen: Array<{ id: string; text?: string }> = [];
    mock.session.actions.onInvoked((run) => {
      seen.push({ id: run.id, text: run.text });
    });
    await mock.emitActionInvoked("timer");
    expect(seen).toEqual([{ id: "new-task", text: "Milk" }, { id: "timer", text: undefined }]);
  });
});
