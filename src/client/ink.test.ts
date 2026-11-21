import { describe, expect, it, vi } from "vitest";

import type { MindooDBAppBridgePortMessage, MindooDBAppInkProgress } from "../types";
import { MindooDBAppInkApiImpl } from "./ink";
import type { PortRpcClient } from "./portRpcClient";

function fakeRpc(answer: (method: string, params: unknown, push: (message: unknown) => void) => unknown) {
  const listeners: Array<(message: MindooDBAppBridgePortMessage) => void> = [];
  const calls: Array<{ method: string; params: unknown }> = [];
  const push = (message: unknown) => listeners.forEach((listener) => listener(message as MindooDBAppBridgePortMessage));
  const rpc = {
    call: vi.fn(async (method: string, params: unknown) => {
      calls.push({ method, params });
      return answer(method, params, push);
    }),
    addMessageListener: (listener: (message: MindooDBAppBridgePortMessage) => void) => {
      listeners.push(listener);
      return () => {};
    },
  } as unknown as PortRpcClient;
  return { rpc, calls, push };
}

const notFound = () => {
  throw Object.assign(new Error("unknown"), { code: "method-not-found" });
};

describe("session.ink", () => {
  it("answers unsupported / none on an older Haven", async () => {
    const api = new MindooDBAppInkApiImpl(fakeRpc(notFound).rpc);
    expect(await api.capabilities()).toEqual({ recognize: "none", engines: [], languages: {} });
    expect(await api.prepare({ languages: ["de-DE"] })).toEqual({ status: "unsupported", languages: {} });
    expect(await api.recognize({ strokes: [[{ x: 1, y: 2 }]] })).toEqual({ status: "unsupported" });
  });

  it("sends clean strokes and clamps options", async () => {
    const { rpc, calls } = fakeRpc(() => ({ status: "ok", engine: "e", language: "de-DE", candidates: [] }));
    const api = new MindooDBAppInkApiImpl(rpc);
    const pointer = { x: 1.23456, y: 2, t: 10.6, pressure: 0.5, pointerId: 7 } as never;
    await api.recognize({
      strokes: [[pointer, { x: Number.NaN, y: 1 }], []],
      area: { w: 180, h: 64 },
      language: "de-DE",
      preContext: "a".repeat(30),
      maxCandidates: 50,
    });
    expect(calls[0]).toEqual({
      method: "ink.recognize",
      params: {
        strokes: [[{ x: 1.23, y: 2, t: 11, pressure: 0.5 }]],
        area: { w: 180, h: 64 },
        language: "de-DE",
        preContext: "a".repeat(20),
        maxCandidates: 10,
      },
    });
    expect(await api.recognize({ strokes: [] })).toEqual({ status: "failed", reason: "no strokes" });
  });

  it("relays progress of the asked languages to prepare's onProgress while it runs", async () => {
    const { rpc, push } = fakeRpc((method, _params, pushNow) => {
      if (method === "ink.prepare") {
        pushNow({ protocol: "mindoodb-app-bridge", kind: "ink-progress", progress: { language: "de-DE", phase: "downloading", fraction: 0.4 } });
        pushNow({ protocol: "mindoodb-app-bridge", kind: "ink-progress", progress: { language: "fr-FR", phase: "downloading" } });
        return { status: "ready", languages: { "de-DE": "installed" } };
      }
      return null;
    });
    const api = new MindooDBAppInkApiImpl(rpc);
    const seen: MindooDBAppInkProgress[] = [];
    const all: MindooDBAppInkProgress[] = [];
    api.onProgress((progress) => all.push(progress));
    expect((await api.prepare({ languages: ["de-DE"], onProgress: (progress) => seen.push(progress) })).status).toBe("ready");
    expect(seen).toEqual([{ language: "de-DE", phase: "downloading", fraction: 0.4 }]);
    push({ protocol: "mindoodb-app-bridge", kind: "ink-progress", progress: { language: "de-DE", phase: "installed" } });
    expect(seen).toHaveLength(1);
    expect(all).toHaveLength(3);
  });
});

describe("mock session ink", () => {
  it("recognizes with the configured answer and downloads missing languages with progress", async () => {
    const { createMockMindooDBAppSession } = await import("../testing");
    const mock = createMockMindooDBAppSession();
    mock.ink.answer([{ text: "Elternabend 7b" }, { text: "Elternabend 76" }]);
    const result = await mock.session.ink.recognize({ strokes: [[{ x: 1, y: 1 }]], language: "de-DE", maxCandidates: 1 });
    expect(result).toEqual({ status: "ok", engine: "mock-ink", language: "de-DE", candidates: [{ text: "Elternabend 7b" }] });
    expect(mock.ink.requests()).toHaveLength(1);

    expect((await mock.session.ink.capabilities({ languages: ["fr-FR"] })).languages["fr-FR"]).toBe("downloadable");
    expect((await mock.session.ink.recognize({ strokes: [[{ x: 1, y: 1 }]], language: "fr-FR" })).status).toBe("model-downloading");
    const progress: MindooDBAppInkProgress[] = [];
    mock.ink.setLanguageState("nl-NL", "downloadable");
    const prepared = await mock.session.ink.prepare({ languages: ["nl-NL"], onProgress: (p) => progress.push(p) });
    expect(prepared).toEqual({ status: "ready", languages: { "nl-NL": "installed" } });
    expect(progress.map((p) => p.phase)).toEqual(["downloading", "downloading", "downloading", "installed"]);

    mock.ink.setRecognize("none");
    expect(await mock.session.ink.recognize({ strokes: [[{ x: 1, y: 1 }]] })).toEqual({ status: "unsupported" });
  });

  it("works over the bridge port with pushed progress (Level 2)", async () => {
    const { createFakeBridgeHost } = await import("../testing");
    const { createMindooDBAppBridge } = await import("./createMindooDBAppBridge");
    const host = createFakeBridgeHost({ databases: [], launchContext: { appId: "app" }, ink: { languages: {} } });
    host.install();
    try {
      const session = await createMindooDBAppBridge().connect();
      const progress: MindooDBAppInkProgress[] = [];
      const prepared = await session.ink.prepare({ languages: ["de-DE"], onProgress: (p) => progress.push(p) });
      expect(prepared.status).toBe("ready");
      expect(progress.at(-1)).toEqual({ language: "de-DE", phase: "installed", fraction: 1 });
      host.ink.answer("Hallo");
      expect(await session.ink.recognize({ strokes: [[{ x: 1, y: 1, t: 0 }]], language: "de-DE" })).toMatchObject({
        status: "ok",
        candidates: [{ text: "Hallo" }],
      });
      expect((await session.ink.capabilities()).recognize).toBe("native");
    } finally {
      host.dispose();
    }
  });
});
