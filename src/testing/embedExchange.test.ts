/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import { createMindooDBAppBridge } from "../client/createMindooDBAppBridge";
import type { MindooDBAppCapability, MindooDBAppComponentInfo } from "../types";
import { createFakeBridgeHost, createMemoryAttachments, createMockMindooDBAppSession } from "./index";

const word: MindooDBAppComponentInfo = {
  key: "teamedit/word",
  appInstanceId: "teamedit",
  appId: "mindoodb-app-teamedit",
  appLabel: "TeamEdit",
  componentId: "word",
  label: "Word",
  intents: ["create", "edit", "view"],
  match: { form: "word" },
  createFields: { form: "word" },
  supports: ["variables", "template", "export:pdf"],
};

const crmDatabase = () => ({
  info: { id: "crm", title: "CRM", capabilities: ["read", "create", "update"] as MindooDBAppCapability[] },
  documents: [
    { id: "letter", data: { form: "word", subject: "Offer" } },
    { id: "vorlage", data: { form: "word", subject: "Vorlage Angebot", istemplate: true } },
    { id: "note", data: { form: "note" } },
  ],
  methods: { attachments: createMemoryAttachments() },
});

const variables = [{ key: "company.name", label: "Firma", value: "Müller GmbH", group: "Firma" }];

describe("host side", () => {
  it("passes variables and a template on, and exports through the component", async () => {
    const mock = createMockMindooDBAppSession({
      components: [word],
      databases: [crmDatabase()],
      embedExport: (embed, request) => new Blob([`${embed.docId}.${request.format}`], { type: "application/pdf" }),
    });
    const session = await mock.bridge.connect();
    await expect(
      session.embeds.open({ componentKey: word.key, databaseId: "crm", docId: "letter", template: { docId: "note" } }),
    ).rejects.toThrow(/not a "Word" document/);
    const embed = await session.embeds.open({ componentKey: word.key, databaseId: "crm", docId: "letter", variables, template: { docId: "vorlage" } });
    expect(mock.listEmbeds()[0]).toMatchObject({ variables, template: { databaseId: "crm", docId: "vorlage" } });
    await embed.setVariables([{ key: "person.name", label: "Name", value: "Anna" }]);
    expect(mock.listEmbeds()[0]?.variables).toEqual([{ key: "person.name", label: "Name", value: "Anna" }]);
    const file = await embed.export({ format: "pdf" });
    expect(file.name).toBe("document.pdf");
    expect(await file.text()).toBe("letter.pdf");
    await expect(embed.export({ format: "docx" })).rejects.toThrow(/cannot export docx/);
  });

  it("works over the bridge port", async () => {
    const host = createFakeBridgeHost({
      components: [word],
      databases: [crmDatabase()],
      embedExport: () => ({ data: new Uint8Array([37, 80, 68, 70]), name: "Angebot.pdf" }),
    });
    host.install();
    try {
      const session = await createMindooDBAppBridge().connect();
      const embed = await session.embeds.open({ componentKey: word.key, databaseId: "crm", docId: "letter", variables, rect: { left: 0, top: 0, width: 1, height: 1 } });
      expect(host.listEmbeds()[0]?.variables).toEqual(variables);
      await embed.setVariables([]);
      expect(host.listEmbeds()[0]?.variables).toEqual([]);
      const file = await embed.export({ format: "pdf" });
      expect(file).toMatchObject({ name: "Angebot.pdf", type: "application/pdf", size: 4 });
    } finally {
      host.dispose();
    }
  });
});

describe("component side", () => {
  it("reads and follows the host's variables and answers exports over the port", async () => {
    const host = createFakeBridgeHost({ databases: [crmDatabase()], embeddingVariables: variables });
    host.install();
    try {
      const session = await createMindooDBAppBridge().connect();
      await expect(session.embedding.getVariables()).resolves.toEqual(variables);
      const seen: unknown[] = [];
      session.embedding.onVariablesChange((next) => seen.push(next));
      await host.requestEmbeddingVariables([{ key: "x", label: "X", value: "1" }]);
      expect(seen).toEqual([[{ key: "x", label: "X", value: "1" }]]);
      await expect(session.embedding.getVariables()).resolves.toEqual([{ key: "x", label: "X", value: "1" }]);

      await expect(host.requestEmbeddingExport({ format: "pdf" })).rejects.toThrow("unsupported");
      session.embedding.provideExport((request) => {
        if (request.format !== "pdf") throw new Error("Only PDF.");
        return new Blob(["%PDF-1.7"], { type: "application/pdf" });
      });
      const file = await host.requestEmbeddingExport({ format: "pdf" });
      expect(file).toMatchObject({ name: "document.pdf", type: "application/pdf" });
      await expect(host.requestEmbeddingExport({ format: "png" })).rejects.toThrow("Only PDF.");
    } finally {
      host.dispose();
    }
  });

  it("gets nothing outside an embed in process", async () => {
    const mock = createMockMindooDBAppSession();
    const session = await mock.bridge.connect();
    await expect(session.embedding.getVariables()).resolves.toEqual([]);
  });
});
