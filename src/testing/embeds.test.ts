/**
 * Components and embeds through the mock host: in process (`createMockMindooDBAppSession`)
 * and over the real bridge port (`createFakeBridgeHost`), which is what an app's
 * `/__haven-test/` page runs against.
 */
import { describe, expect, it } from "vitest";

import { createMindooDBAppBridge } from "../client/createMindooDBAppBridge";
import type { MindooDBAppComponentInfo } from "../types";
import { createFakeBridgeHost, createMemoryAttachments, createMockMindooDBAppSession } from "./index";

const sheet: MindooDBAppComponentInfo = {
  key: "teamgrid:sheet",
  appInstanceId: "teamgrid",
  appId: "teamgrid",
  appLabel: "TeamGrid",
  componentId: "sheet",
  label: "Spreadsheet",
  intents: ["create", "edit", "view"],
  match: { form: "teamgrid" },
  createFields: { form: "teamgrid", title: "" },
};

const crmDatabase = () => ({
  info: { id: "crm", title: "CRM", capabilities: ["read", "create", "update"] as const },
  documents: [
    { id: "sheet1", data: { form: "teamgrid", title: "Budget" } },
    { id: "contact1", data: { form: "contact", name: "Anna" } },
  ],
  methods: { attachments: createMemoryAttachments() },
});

describe("mock components and embeds", () => {
  it("lists components by intent and by document fields", async () => {
    const mock = createMockMindooDBAppSession({ components: [sheet] });
    const session = await mock.bridge.connect();
    await expect(session.components.list({ intent: "create" })).resolves.toHaveLength(1);
    await expect(session.components.list({ document: { form: "teamgrid" } })).resolves.toHaveLength(1);
    await expect(session.components.list({ document: { form: "contact" } })).resolves.toEqual([]);
  });

  it("opens an embed only on a matching root document and settles it when closed", async () => {
    const mock = createMockMindooDBAppSession({
      components: [sheet],
      databases: [{ ...crmDatabase(), info: { ...crmDatabase().info, capabilities: ["read", "create", "update"] } }],
    });
    const session = await mock.bridge.connect();
    const rect = { left: 10, top: 20, width: 300, height: 200 };
    await expect(
      session.embeds.open({ componentKey: sheet.key, databaseId: "crm", docId: "contact1", rect }),
    ).rejects.toThrow(/not a "Spreadsheet" document/);

    const embed = await session.embeds.open({ componentKey: sheet.key, databaseId: "crm", docId: "sheet1", rect });
    expect(mock.listEmbeds()).toMatchObject([{ embedId: embed.embedId, docId: "sheet1", intent: "edit", rect }]);
    await embed.setRect({ left: 0, top: 0, width: 100, height: 100 });
    expect(mock.listEmbeds()[0]?.rect.width).toBe(100);

    const seen: string[] = [];
    embed.onClosed((event) => seen.push(event.reason));
    mock.closeEmbed(embed.embedId, "completed", { rows: 3 });
    await expect(embed.closed).resolves.toEqual({ embedId: embed.embedId, reason: "completed", result: { rows: 3 } });
    expect(seen).toEqual(["completed"]);
    expect(mock.listEmbeds()).toEqual([]);
  });

  it("records how an embedded component finished", async () => {
    const mock = createMockMindooDBAppSession();
    const session = await mock.bridge.connect();
    await session.embedding.complete({ saved: true });
    expect(mock.getEmbeddingFinish()).toEqual({ reason: "completed", result: { saved: true } });
  });

  it("works over the bridge port, including the closed push", async () => {
    const host = createFakeBridgeHost({
      components: [sheet],
      databases: [{ ...crmDatabase(), info: { ...crmDatabase().info, capabilities: ["read", "create", "update"] } }],
    });
    host.install();
    try {
      const session = await createMindooDBAppBridge().connect();
      const [component] = await session.components.list({ intent: "edit" });
      expect(component?.label).toBe("Spreadsheet");
      const embed = await session.embeds.open({
        componentKey: component!.key,
        databaseId: "crm",
        docId: "sheet1",
        rect: { left: 1, top: 2, width: 3, height: 4 },
      });
      expect(host.listEmbeds()).toHaveLength(1);
      host.closeEmbed(embed.embedId, "cancelled");
      await expect(embed.closed).resolves.toMatchObject({ reason: "cancelled" });

      await session.embedding.cancel("nope");
      expect(host.getEmbeddingFinish()).toEqual({ reason: "cancelled", message: "nope" });
    } finally {
      host.dispose();
    }
  });
});

describe("fake bridge host app storage", () => {
  it("answers session.storage over the port", async () => {
    const host = createFakeBridgeHost({ storage: { "a.one": "1" } });
    host.install();
    try {
      const session = await createMindooDBAppBridge().connect();
      await session.storage.set("a.two", "2");
      await expect(session.storage.get("a.one")).resolves.toBe("1");
      await expect(session.storage.keys({ prefix: "a." })).resolves.toEqual(["a.one", "a.two"]);
      await session.storage.remove("a.one");
      await expect(session.storage.snapshot()).resolves.toEqual({ "a.two": "2" });
    } finally {
      host.dispose();
    }
  });
});
