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
});
