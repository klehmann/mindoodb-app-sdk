/** @vitest-environment jsdom */
/**
 * Agent tools over the real bridge port against the fake host: the app declares tools
 * and context, the test calls them as an agent would, and files travel both ways
 * through the mock exchange.
 */
import { describe, expect, it } from "vitest";

import { MindooDBAppAgentToolError } from "../client/agentTools";
import { createMindooDBAppBridge } from "../client/createMindooDBAppBridge";
import { createFakeBridgeHost, mockAgentToolPrefix } from "./index";

async function connected(options: Parameters<typeof createFakeBridgeHost>[0] = {}) {
  const host = createFakeBridgeHost({ launchContext: { appId: "mindoodb-app-teamslides" }, ...options });
  host.install();
  const session = await createMindooDBAppBridge().connect();
  return { host, session, agent: session.agent! };
}

describe("agent tools in the fake host", () => {
  it("takes declarations with Haven's prefix and rules", async () => {
    const { host, agent } = await connected({ agentToolPrefix: "slides" });
    try {
      const registration = await agent.registerTools([
        { name: "deck_read", description: "Reads.", inputSchema: { type: "object" }, execute: async () => ({}) },
      ]);
      expect(registration).toEqual({ enabled: true, exposedNames: ["slides_deck_read"] });
      expect(host.agent.tools().map((tool) => tool.name)).toEqual(["deck_read"]);
      await expect(
        agent.registerTools([
          { name: "bad", description: "x".repeat(2001), inputSchema: { type: "object" }, execute: async () => ({}) },
        ]),
      ).rejects.toThrow(/too long/);
      await agent.setContext({ deck: "d1" });
      expect(host.agent.context()).toEqual({ deck: "d1" });
    } finally {
      host.dispose();
    }
  });

  it("derives the prefix from the app id like Haven", () => {
    expect(mockAgentToolPrefix("mindoodb-app-teamslides")).toBe("teamslides");
    expect(mockAgentToolPrefix("anything", "vega")).toBe("vega");
    expect(mockAgentToolPrefix("mindoodb-app-1x")).toBe("app_1x");
  });

  it("calls tools and returns results and agent errors", async () => {
    const { host, agent } = await connected();
    try {
      await agent.registerTools([
        {
          name: "echo",
          description: "Echoes.",
          inputSchema: { type: "object" },
          execute: async (input) => ({ got: input }),
        },
        {
          name: "fails",
          description: "Fails.",
          inputSchema: { type: "object" },
          execute: async () => {
            throw new MindooDBAppAgentToolError("INVALID_STATE", "No deck.", "open one");
          },
        },
      ]);
      expect(await host.agent.call("teamslides_echo", { a: 1 })).toMatchObject({ ok: true, result: { got: { a: 1 } } });
      expect(await host.agent.call("fails")).toMatchObject({
        ok: false,
        error: { code: "INVALID_STATE", message: "No deck.", requiredAction: "open one" },
      });
      expect(await host.agent.call("missing")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
      expect(host.agent.calls().map((c) => c.tool)).toEqual(["echo", "fails", "missing"]);
    } finally {
      host.dispose();
    }
  });

  it("asks before consequential tools and honours switched-off access", async () => {
    const { host, agent } = await connected({ agentConsent: "deny" });
    try {
      let ran = false;
      await agent.registerTools([
        {
          name: "delete_all",
          description: "Deletes.",
          inputSchema: { type: "object" },
          annotations: { consequentialHint: true },
          execute: async () => {
            ran = true;
            return {};
          },
        },
      ]);
      expect(await host.agent.call("delete_all")).toMatchObject({ ok: false, error: { code: "NOT_ALLOWED" } });
      expect(ran).toBe(false);
      host.agent.setConsent(({ tool }) => tool === "delete_all");
      expect(await host.agent.call("delete_all")).toMatchObject({ ok: true });
      host.agent.setEnabled(false);
      expect(await host.agent.call("delete_all")).toMatchObject({ ok: false, error: { code: "NOT_ALLOWED" } });
    } finally {
      host.dispose();
    }
  });

  it("moves files both ways through the exchange", async () => {
    const { host, agent } = await connected();
    try {
      const fileRef = await host.agent.importFile({ name: "logo.png", mimeType: "image/png", data: new Uint8Array([1, 2, 3]) });
      const file = await agent.takeFile(fileRef);
      expect(file.name).toBe("logo.png");
      expect(file.type).toBe("image/png");
      expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([1, 2, 3]);

      const provided = await agent.provideFile(new Uint8Array([9, 8]), { name: "deck.pptx", mimeType: "application/zip" });
      expect(provided.size).toBe(2);
      expect(host.agent.getFile(provided.fileRef)).toMatchObject({ name: "deck.pptx", source: "app" });
      expect([...host.agent.getFile(provided.fileRef)!.data]).toEqual([9, 8]);
      // like Haven: an app cannot take back what it handed over, nor unknown refs
      await expect(agent.takeFile(provided.fileRef)).rejects.toThrow(/Unknown or expired/);
      await expect(agent.takeFile("file_nope")).rejects.toThrow(/Unknown or expired/);
      expect(host.agent.files()).toHaveLength(2);
    } finally {
      host.dispose();
    }
  });
});
