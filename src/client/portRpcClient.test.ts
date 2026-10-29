import { describe, expect, it } from "vitest";

import { PortRpcClient } from "./portRpcClient";

describe("PortRpcClient", () => {
  it("round-trips request and response messages over a MessageChannel", async () => {
    const channel = new MessageChannel();
    const client = new PortRpcClient(channel.port1);

    channel.port2.addEventListener("message", (event) => {
      channel.port2.postMessage({
        protocol: "mindoodb-app-bridge",
        kind: "success",
        id: event.data.id,
        result: { ok: true },
      });
    });
    channel.port2.start();

    await expect(client.call("session.getLaunchContext", {})).resolves.toEqual({ ok: true });
    client.dispose();
  });

  it("normalizes proxy params into cloneable plain data before posting", async () => {
    const channel = new MessageChannel();
    const client = new PortRpcClient(channel.port1);

    const params = new Proxy({
      databaseId: "main",
      request: new Proxy({
        pageSize: 25,
      }, {}),
    }, {});

    expect(() => structuredClone(params)).toThrow();

    channel.port2.addEventListener("message", (event) => {
      expect(event.data.params).toEqual({
        databaseId: "main",
        request: {
          pageSize: 25,
        },
      });
      channel.port2.postMessage({
        protocol: "mindoodb-app-bridge",
        kind: "success",
        id: event.data.id,
        result: { ok: true },
      });
    });
    channel.port2.start();

    await expect(client.call("views.page", params)).resolves.toEqual({ ok: true });
    client.dispose();
  });

  it("adds the running agent call to requests", async () => {
    const channel = new MessageChannel();
    const client = new PortRpcClient(channel.port1);
    const received: unknown[] = [];
    channel.port2.addEventListener("message", (event) => {
      received.push(event.data.agentCallId);
      channel.port2.postMessage({ protocol: "mindoodb-app-bridge", kind: "success", id: event.data.id, result: null });
    });
    channel.port2.start();

    let current: string | undefined = "call-7";
    client.setAgentCallProvider(() => current);
    await client.call("documents.update", {});
    current = undefined;
    await client.call("documents.update", {});
    client.setAgentCallProvider(null);
    await client.call("documents.update", {});

    expect(received).toEqual(["call-7", undefined, undefined]);
    client.dispose();
  });
});
