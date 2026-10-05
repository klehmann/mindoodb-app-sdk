import { describe, expect, it, vi } from "vitest";

import type { MindooDBAppBridgePortMessage } from "../types";
import { MINDOODB_APP_INCOMING_READ_CHUNK_BYTES, MindooDBAppIncomingApiImpl } from "./incomingContent";
import type { PortRpcClient } from "./portRpcClient";

function createRpc(bytes: Uint8Array) {
  let listener: ((message: MindooDBAppBridgePortMessage) => void) | null = null;
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const rpc = {
    addMessageListener(next: (message: MindooDBAppBridgePortMessage) => void) {
      listener = next;
      return () => {
        listener = null;
      };
    },
    call: vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "incoming.read") {
        const offset = params.offset as number;
        const length = params.length as number;
        return bytes.slice(offset, offset + length).buffer;
      }
      return undefined;
    }),
  };
  const push = (message: MindooDBAppBridgePortMessage) => listener?.(message);
  return { rpc: rpc as unknown as PortRpcClient, calls, push };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("MindooDBAppIncomingApiImpl", () => {
  it("holds a delivery until a handler registers, reads in chunks and reports the result", async () => {
    const size = MINDOODB_APP_INCOMING_READ_CHUNK_BYTES * 2 + 10;
    const bytes = new Uint8Array(size).map((_, index) => index % 251);
    const { rpc, calls, push } = createRpc(bytes);
    const api = new MindooDBAppIncomingApiImpl(rpc);

    push({
      protocol: "mindoodb-app-bridge",
      kind: "incoming-content",
      content: {
        deliveryId: "d1",
        acceptId: "attach",
        source: "drop",
        items: [
          { itemId: "i1", path: "assets/big.bin", kind: "file", type: "application/octet-stream", size },
          { itemId: "i2", path: "note.txt", kind: "text", type: "text/plain", size: 5, text: "hello" },
        ],
      },
    });
    await flush();
    expect(calls.some((call) => call.method === "incoming.complete")).toBe(false);

    let received: Uint8Array | null = null;
    let text = "";
    api.onIncomingContent(async (content) => {
      expect(content.acceptId).toBe("attach");
      expect(content.items.map((item) => item.path)).toEqual(["assets/big.bin", "note.txt"]);
      received = new Uint8Array(await (await content.items[0]!.read()).arrayBuffer());
      text = await content.items[1]!.readText();
      return { status: "accepted", message: "2 items" };
    });
    await vi.waitFor(() => expect(calls.some((call) => call.method === "incoming.complete")).toBe(true));

    expect(calls[0]!.method).toBe("incoming.subscribe");
    expect(calls.filter((call) => call.method === "incoming.read")).toHaveLength(3);
    expect(received).toEqual(bytes);
    expect(text).toBe("hello");
    expect(calls.at(-1)).toEqual({
      method: "incoming.complete",
      params: { deliveryId: "d1", status: "accepted", message: "2 items" },
    });
  });

  it("reports a throwing handler as rejected", async () => {
    const { rpc, calls, push } = createRpc(new Uint8Array());
    const api = new MindooDBAppIncomingApiImpl(rpc);
    api.onIncomingContent(() => {
      throw new Error("No document open");
    });
    push({
      protocol: "mindoodb-app-bridge",
      kind: "incoming-content",
      content: { deliveryId: "d2", acceptId: "attach", source: "picker", items: [] },
    });
    await vi.waitFor(() => expect(calls.some((call) => call.method === "incoming.complete")).toBe(true));
    expect(calls.at(-1)!.params).toEqual({ deliveryId: "d2", status: "rejected", message: "No document open" });
  });
});
