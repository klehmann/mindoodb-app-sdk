import { describe, expect, it, vi } from "vitest";

import type { MindooDBAppBridgePortMessage } from "../types";
import { MindooDBAppAgentApiImpl, MindooDBAppAgentToolError, type AgentToolsRpc } from "./agentTools";

function createRpc() {
  const listeners = new Set<(message: MindooDBAppBridgePortMessage) => void>();
  const posted: MindooDBAppBridgePortMessage[] = [];
  const rpc: AgentToolsRpc & { emit(message: MindooDBAppBridgePortMessage): void } = {
    call: vi.fn(async () => ({ enabled: true, exposedNames: ["demo_echo"] })) as AgentToolsRpc["call"],
    postMessage: (message) => posted.push(message),
    addMessageListener: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: (message) => listeners.forEach((listener) => listener(message)),
  };
  return { rpc, posted };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function invoke(rpc: ReturnType<typeof createRpc>["rpc"], tool: string, input: Record<string, unknown> = {}) {
  rpc.emit({ protocol: "mindoodb-app-bridge", kind: "agent-invoke", callId: "c1", tool, input });
}

describe("MindooDBAppAgentApiImpl", () => {
  it("sends descriptors only and returns Haven's registration", async () => {
    const { rpc } = createRpc();
    const api = new MindooDBAppAgentApiImpl(rpc);
    const result = await api.registerTools([
      {
        name: "echo",
        description: "Echo",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
        execute: async (input) => input,
      },
    ]);
    expect(result).toEqual({ enabled: true, exposedNames: ["demo_echo"] });
    expect(rpc.call).toHaveBeenCalledWith("agent.registerTools", {
      tools: [
        {
          name: "echo",
          description: "Echo",
          inputSchema: { type: "object", properties: {} },
          annotations: { readOnlyHint: true },
        },
      ],
    });
  });

  it("rejects names agents cannot use and duplicates", async () => {
    const { rpc } = createRpc();
    const api = new MindooDBAppAgentApiImpl(rpc);
    const tool = { description: "", inputSchema: {}, execute: async () => null };
    await expect(api.registerTools([{ ...tool, name: "Maps.List" }])).rejects.toThrow(/Invalid agent tool name/);
    await expect(api.registerTools([{ ...tool, name: "a" }, { ...tool, name: "a" }])).rejects.toThrow(/twice/);
  });

  it("runs the tool on agent-invoke and posts a JSON result", async () => {
    const { rpc, posted } = createRpc();
    const api = new MindooDBAppAgentApiImpl(rpc);
    await api.registerTools([
      {
        name: "echo",
        description: "",
        inputSchema: {},
        execute: async (input) => ({ got: input, at: new Date("2026-10-01T00:00:00Z") }),
      },
    ]);
    invoke(rpc, "echo", { q: 1 });
    await flush();
    expect(posted).toEqual([
      {
        protocol: "mindoodb-app-bridge",
        kind: "agent-result",
        callId: "c1",
        ok: true,
        result: { got: { q: 1 }, at: "2026-10-01T00:00:00.000Z" },
      },
    ]);
  });

  it("reports coded errors, plain errors and unknown tools", async () => {
    const { rpc, posted } = createRpc();
    const api = new MindooDBAppAgentApiImpl(rpc);
    await api.registerTools([
      {
        name: "coded",
        description: "",
        inputSchema: {},
        execute: async () => {
          throw new MindooDBAppAgentToolError("NOT_FOUND", "No map x.", "call vega_maps_list");
        },
      },
      {
        name: "plain",
        description: "",
        inputSchema: {},
        execute: async () => {
          throw new Error("boom");
        },
      },
    ]);
    invoke(rpc, "coded");
    invoke(rpc, "plain");
    invoke(rpc, "missing");
    await flush();
    const errors = posted.map((message) => (message.kind === "agent-result" ? message.error : null));
    expect(errors).toHaveLength(3);
    expect(errors).toEqual(expect.arrayContaining([
      { code: "NOT_FOUND", message: "No map x.", requiredAction: "call vega_maps_list" },
      { code: "FAILED", message: "boom" },
      { code: "NOT_FOUND", message: 'The app has no tool "missing" (any more).' },
    ]));
  });
});
