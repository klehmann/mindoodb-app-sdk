import { describe, expect, it } from "vitest";

import { MindooDBAppEmbedsClient } from "./embeds";
import type { PortRpcClient } from "./portRpcClient";

function fakeRpc(call: (method: string, params: unknown) => Promise<unknown>) {
  return { call, addMessageListener: () => () => {} } as unknown as PortRpcClient;
}

describe("embeds.requestAccess", () => {
  it("leaves everything to `open` on Havens that predate it", async () => {
    const client = new MindooDBAppEmbedsClient(
      fakeRpc(async () => {
        throw Object.assign(new Error("Unknown method."), { name: "method-not-found" });
      }),
    );
    await expect(
      client.embeds.requestAccess({
        components: [{ componentKey: "a", databaseIds: ["crm", "crm2"] }, { componentKey: "b" }],
      }),
    ).resolves.toEqual({
      granted: [],
      pending: [
        { componentKey: "a", databaseId: "crm" },
        { componentKey: "a", databaseId: "crm2" },
      ],
    });
  });

  it("passes other errors on", async () => {
    const client = new MindooDBAppEmbedsClient(
      fakeRpc(async () => {
        throw Object.assign(new Error("Nope."), { name: "forbidden" });
      }),
    );
    await expect(client.embeds.requestAccess({ components: [] })).rejects.toThrow("Nope.");
  });
});
