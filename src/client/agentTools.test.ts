import { describe, expect, it, vi } from "vitest";

import type { MindooDBAppBridgePortMessage } from "../types";
import {
  isMindooDBAppAgentImage,
  MindooDBAppAgentApiImpl,
  MindooDBAppAgentToolError,
  type AgentToolsRpc,
} from "./agentTools";

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

  it("drops placeholder values for optional fields unless the tool keeps them", async () => {
    const { rpc, posted } = createRpc();
    const api = new MindooDBAppAgentApiImpl(rpc);
    const inputSchema = {
      type: "object",
      required: ["title"],
      properties: { title: { type: "string" }, keyId: { type: "string" }, shareWith: { type: "array" } },
    };
    await api.registerTools([
      { name: "plain", description: "", inputSchema, execute: async (input) => input },
      { name: "kept", description: "", inputSchema, keepEmptyInput: true, execute: async (input) => input },
    ]);
    const input = { title: "", keyId: "", shareWith: [], onlyMe: false };
    invoke(rpc, "plain", input);
    await flush();
    invoke(rpc, "kept", input);
    await flush();
    const results = posted.map((message) => (message.kind === "agent-result" ? message.result : null));
    expect(results).toEqual([{ title: "", onlyMe: false }, input]);
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

  it("passes files to and from Haven by reference", async () => {
    const { rpc } = createRpc();
    const call = rpc.call as unknown as ReturnType<typeof vi.fn>;
    call.mockImplementation(async (method: string) =>
      method === "agent.provideFile"
        ? { fileRef: "file_1", size: 3 }
        : { name: "notes.md", mimeType: "text/markdown", data: new TextEncoder().encode("# Hi").buffer },
    );
    const api = new MindooDBAppAgentApiImpl(rpc);
    await expect(api.provideFile(new Blob(["abc"], { type: "text/plain" }), { name: "a.txt" })).resolves.toEqual({
      fileRef: "file_1",
      size: 3,
    });
    const [, params] = call.mock.calls[0] as [string, { name: string; mimeType: string; data: ArrayBuffer }];
    expect(params).toMatchObject({ name: "a.txt", mimeType: "text/plain" });
    expect(params.data.byteLength).toBe(3);
    const file = await api.takeFile("file_2");
    expect(file.name).toBe("notes.md");
    expect(await file.text()).toBe("# Hi");
  });

  it("hands over an image as a file and returns the marker for a tool result", async () => {
    const { rpc } = createRpc();
    const call = rpc.call as unknown as ReturnType<typeof vi.fn>;
    call.mockImplementation(async () => ({ fileRef: "file_9", size: 4 }));
    const api = new MindooDBAppAgentApiImpl(rpc);
    const image = await api.provideImage(new Uint8Array([137, 80, 78, 71]), {
      name: "slide-1.png",
      alt: "Title slide",
      width: 1200,
      height: 675,
    });
    expect(image).toEqual({
      type: "image",
      fileRef: "file_9",
      name: "slide-1.png",
      mimeType: "image/png",
      size: 4,
      alt: "Title slide",
      width: 1200,
      height: 675,
    });
    expect(isMindooDBAppAgentImage(image)).toBe(true);
    expect(isMindooDBAppAgentImage({ type: "image", data: "…", mimeType: "image/png" })).toBe(false);
    expect(call.mock.calls[0]).toEqual(["agent.provideFile", expect.objectContaining({ mimeType: "image/png" })]);
    await expect(api.provideImage(new Blob(["x"], { type: "text/plain" }), { name: "a.txt" })).rejects.toThrow(
      /needs an image/,
    );
  });

  describe("attributing writes to the call", () => {
    function createAttributingRpc() {
      const base = createRpc();
      let provider: (() => string | undefined) | null = null;
      const sent: Array<{ method: string; agentCallId?: string }> = [];
      const rpc = Object.assign(base.rpc, {
        setAgentCallProvider: (next: (() => string | undefined) | null) => {
          provider = next;
        },
        call: vi.fn(async (method: string) => {
          sent.push({ method, agentCallId: provider?.() });
          return { enabled: true, exposedNames: [] };
        }) as AgentToolsRpc["call"],
      });
      return { rpc, posted: base.posted, sent, provider: () => provider };
    }

    it("passes the call id to execute and on every request made while it runs", async () => {
      const { rpc, sent } = createAttributingRpc();
      const api = new MindooDBAppAgentApiImpl(rpc);
      let seen: unknown;
      await api.registerTools([
        {
          name: "save",
          description: "",
          inputSchema: {},
          execute: async (_input, context) => {
            seen = context;
            await rpc.call("documents.update", {});
            await flush();
            await rpc.call("documents.create", {});
            return null;
          },
        },
      ]);
      invoke(rpc, "save");
      await flush();
      await flush();
      await rpc.call("documents.update", {});
      expect(seen).toEqual({ callId: "c1" });
      expect(sent.slice(1)).toEqual([
        { method: "documents.update", agentCallId: "c1" },
        { method: "documents.create", agentCallId: "c1" },
        { method: "documents.update", agentCallId: undefined },
      ]);
      expect(api.currentCallId()).toBeUndefined();
    });

    it("hands the change message Haven prepared to execute", async () => {
      const { rpc } = createAttributingRpc();
      const api = new MindooDBAppAgentApiImpl(rpc);
      const seen: unknown[] = [];
      await api.registerTools([
        { name: "edit", description: "", inputSchema: {}, execute: async (_input, context) => seen.push(context) },
      ]);
      rpc.emit({
        protocol: "mindoodb-app-bridge",
        kind: "agent-invoke",
        callId: "c2",
        tool: "edit",
        input: {},
        changeMessage: '{"mindoo.attribution":{"v":1,"kind":"agent","via":"mcp"}}',
      });
      invoke(rpc, "edit");
      await flush();
      expect(seen).toEqual([
        { callId: "c2", changeMessage: '{"mindoo.attribution":{"v":1,"kind":"agent","via":"mcp"}}' },
        { callId: "c1" },
      ]);
    });

    it("clears the call when the tool fails", async () => {
      const { rpc } = createAttributingRpc();
      const api = new MindooDBAppAgentApiImpl(rpc);
      await api.registerTools([
        {
          name: "boom",
          description: "",
          inputSchema: {},
          execute: async () => {
            throw new Error("nope");
          },
        },
      ]);
      invoke(rpc, "boom");
      await flush();
      expect(api.currentCallId()).toBeUndefined();
    });

    it("attributes later writes inside withCall, the latest call winning", async () => {
      const { rpc, sent } = createAttributingRpc();
      const api = new MindooDBAppAgentApiImpl(rpc);
      let release!: () => void;
      const outer = api.withCall("first", async () => {
        await new Promise<void>((resolve) => (release = resolve));
        await rpc.call("documents.update", {});
      });
      await api.withCall("second", async () => {
        await rpc.call("documents.update", {});
      });
      release();
      await outer;
      await api.withCall("", async () => {
        await rpc.call("documents.delete", {});
      });
      expect(sent).toEqual([
        { method: "documents.update", agentCallId: "second" },
        { method: "documents.update", agentCallId: "first" },
        { method: "documents.delete", agentCallId: undefined },
      ]);
    });

    it("stops providing call ids once disposed", () => {
      const { rpc, provider } = createAttributingRpc();
      const api = new MindooDBAppAgentApiImpl(rpc);
      expect(provider()).not.toBeNull();
      api.dispose();
      expect(provider()).toBeNull();
    });
  });
});
