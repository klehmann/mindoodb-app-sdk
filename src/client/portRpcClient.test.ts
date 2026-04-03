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
});
